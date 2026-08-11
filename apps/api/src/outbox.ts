import type pg from 'pg';
import { mailerConfigured, sendMail } from './mailer.js';

export type EmailKind = 'vaccine_expiry' | 'booking_confirmation' | 'checkout_summary';

const AUTO_COLUMN: Record<EmailKind, string> = {
  vaccine_expiry: 'auto_send_vaccine_reminders',
  booking_confirmation: 'auto_send_booking_confirmation',
  checkout_summary: 'auto_send_checkout_summary',
};

export type QueuedEmail = {
  kind: EmailKind;
  clientId: string;
  toEmail: string;
  subject: string;
  body: string;
  dedupeKey: string;
  bookingId?: string | null;
  invoiceId?: string | null;
};

/**
 * Put a message in the outbox.
 *
 * Returns null when an identical message is already queued or sent — the
 * dedupe key describes the thing being written about, so re-running the
 * vaccine sweep every morning does not send the same reminder twice.
 *
 * Queueing never throws on a delivery problem, because the thing that caused
 * the message — a booking, a check-out — must not fail because of the email.
 */
export async function queueEmail(
  db: pg.PoolClient,
  email: QueuedEmail,
): Promise<{ id: string; autoRelease: boolean } | null> {
  const { rows: settings } = await db.query(
    `SELECT ${AUTO_COLUMN[email.kind]} AS auto FROM facility_settings WHERE singleton`,
  );
  const autoRelease = Boolean(settings[0]?.auto);

  const { rows } = await db.query(
    `INSERT INTO outbound_emails
       (kind, client_id, to_email, subject, body, dedupe_key, booking_id, invoice_id,
        released_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CASE WHEN $9 THEN now() ELSE NULL END)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [
      email.kind,
      email.clientId,
      email.toEmail,
      email.subject,
      email.body,
      email.dedupeKey,
      email.bookingId ?? null,
      email.invoiceId ?? null,
      autoRelease,
    ],
  );
  const row = rows[0];
  if (!row) return null;
  return { id: row.id, autoRelease };
}

/**
 * Try to deliver everything released and not yet sent.
 *
 * A failure is recorded on the row rather than thrown: one bad address must
 * not stop the rest of the batch, and the review screen is where someone
 * finds out.
 */
export async function sendReleased(
  db: pg.PoolClient,
  log: (msg: string, meta?: unknown) => void,
  limit = 50,
): Promise<{ sent: number; failed: number; mailerReady: boolean }> {
  // With no mailer, sendMail logs and returns without error — which would
  // mark everything 'sent' while nothing left the building. Leave them queued
  // instead, so the outbox stays truthful about what has actually gone out.
  if (!mailerConfigured()) {
    const { rows: waiting } = await db.query(
      `SELECT COUNT(*)::int AS n FROM outbound_emails
        WHERE status = 'queued' AND released_at IS NOT NULL`,
    );
    if (waiting[0]?.n > 0) {
      log('mailer not configured; released messages are waiting', { waiting: waiting[0].n });
    }
    return { sent: 0, failed: 0, mailerReady: false };
  }

  const { rows } = await db.query(
    `SELECT id, to_email, subject, body FROM outbound_emails
      WHERE status = 'queued' AND released_at IS NOT NULL
      ORDER BY created_at
      LIMIT $1`,
    [limit],
  );

  let sent = 0;
  let failed = 0;
  for (const m of rows) {
    try {
      await sendMail({ to: m.to_email, subject: m.subject, text: m.body }, log);
      await db.query(
        `UPDATE outbound_emails
            SET status = 'sent', sent_at = now(), attempts = attempts + 1, last_error = NULL
          WHERE id = $1`,
        [m.id],
      );
      sent += 1;
    } catch (err) {
      await db.query(
        `UPDATE outbound_emails
            SET status = 'failed', attempts = attempts + 1, last_error = $2
          WHERE id = $1`,
        [m.id, (err as Error).message.slice(0, 500)],
      );
      failed += 1;
      log('outbound email failed', { id: m.id, error: (err as Error).message });
    }
  }
  return { sent, failed, mailerReady: true };
}

/* ============================ templates ============================ */

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function longDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export function bookingConfirmation(opts: {
  facility: string;
  clientFirstName: string;
  petName: string;
  serviceType: string;
  startDate: string;
  endDate: string;
  status: string;
  /** Several daycare days booked together get one note listing them all. */
  dates?: string[];
}): { subject: string; body: string } {
  const boarding = opts.serviceType === 'boarding';
  const when =
    opts.dates && opts.dates.length > 1
      ? `\n${opts.dates.map((d) => `    ${longDate(d)}`).join('\n')}`
      : boarding
        ? `${longDate(opts.startDate)} to ${longDate(opts.endDate)}`
        : longDate(opts.startDate);
  // 'requested' comes from the portal and is not a promise of a space yet.
  const confirmed = opts.status !== 'requested';

  return {
    subject: confirmed
      ? `${opts.petName} is booked in for ${boarding ? 'boarding' : 'daycare'}`
      : `We have your request for ${opts.petName}`,
    body: [
      `Hi ${opts.clientFirstName},`,
      '',
      confirmed
        ? `${opts.petName} is booked in with us.`
        : `We have your request for ${opts.petName} and will confirm shortly.`,
      '',
      `  ${boarding ? 'Boarding' : 'Daycare'}: ${when}`,
      '',
      confirmed
        ? 'If anything changes, let us know as early as you can and we will do our best.'
        : 'Nothing is held until we confirm, so do let us know if your plans change.',
      '',
      `— ${opts.facility}`,
    ].join('\n'),
  };
}

export function checkoutSummary(opts: {
  facility: string;
  clientFirstName: string;
  petName: string;
  startDate: string;
  endDate: string;
  serviceType: string;
  lines: Array<{ description: string; amountCents: number }>;
  totalCents: number;
  paidCents: number;
}): { subject: string; body: string } {
  const owed = opts.totalCents - opts.paidCents;
  const width = Math.max(...opts.lines.map((l) => l.description.length), 20);

  return {
    subject: `${opts.petName} went home — your receipt`,
    body: [
      `Hi ${opts.clientFirstName},`,
      '',
      `${opts.petName} went home today. Thank you for trusting us with them.`,
      '',
      opts.serviceType === 'boarding'
        ? `  Stay: ${longDate(opts.startDate)} to ${longDate(opts.endDate)}`
        : `  Daycare: ${longDate(opts.startDate)}`,
      '',
      ...opts.lines.map(
        (l) => `  ${l.description.padEnd(width)}  ${money(l.amountCents).padStart(10)}`,
      ),
      `  ${'Total'.padEnd(width)}  ${money(opts.totalCents).padStart(10)}`,
      // null drops the line; '' is a paragraph break and must survive.
      opts.paidCents > 0 ? `  ${'Paid'.padEnd(width)}  ${money(opts.paidCents).padStart(10)}` : null,
      owed > 0 ? `  ${'Still owed'.padEnd(width)}  ${money(owed).padStart(10)}` : null,
      '',
      owed > 0
        ? 'The balance is on your account and can be settled next time you are in.'
        : 'Nothing further to pay.',
      '',
      `— ${opts.facility}`,
    ]
      .filter((l): l is string => l !== null)
      .join('\n'),
  };
}

export function vaccineReminder(opts: {
  facility: string;
  clientFirstName: string;
  items: Array<{ petName: string; vaccine: string; expiresOn: string; daysLeft: number }>;
}): { subject: string; body: string } {
  const expired = opts.items.filter((i) => i.daysLeft < 0);
  const pets = [...new Set(opts.items.map((i) => i.petName))];

  return {
    subject:
      expired.length > 0
        ? `${pets.join(' and ')} — a vaccination has lapsed`
        : `${pets.join(' and ')} — a vaccination is due soon`,
    body: [
      `Hi ${opts.clientFirstName},`,
      '',
      expired.length > 0
        ? 'Our records show a vaccination has run out. We cannot take a dog to stay without it being current, so this one needs sorting before the next visit.'
        : 'A quick note that a vaccination is coming up for renewal.',
      '',
      ...opts.items.map((i) =>
        i.daysLeft < 0
          ? `  ${i.petName} — ${i.vaccine}, expired ${longDate(i.expiresOn)}`
          : `  ${i.petName} — ${i.vaccine}, expires ${longDate(i.expiresOn)} (${i.daysLeft} days)`,
      ),
      '',
      'Send us the updated record whenever you have it and we will put it on file. If you think this is wrong, tell us — it may be that we simply have not been given the latest paperwork.',
      '',
      `— ${opts.facility}`,
    ].join('\n'),
  };
}
