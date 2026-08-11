import type pg from 'pg';
import { bookingConfirmation, queueEmail, sendReleased } from './outbox.js';

/**
 * Queue a confirmation for a booking that has just been created, and try to
 * deliver it.
 *
 * Deliberately swallows its own failures. A confirmation email is a courtesy
 * on top of a booking that already exists; if the mail path is broken, the
 * booking must still be made and the desk must still get its 201.
 */
export async function queueBookingConfirmation(
  db: pg.PoolClient,
  bookingId: string,
  log: (msg: string, meta?: unknown) => void,
  /** All days booked in the same request, so several become one note. */
  dates?: string[],
): Promise<void> {
  try {
    const { rows } = await db.query(
      `SELECT c.id AS client_id, c.first_name, c.email,
              p.name AS pet_name, b.service_type, b.status,
              b.start_date::text AS start_date, b.end_date::text AS end_date,
              t.name AS facility
         FROM bookings b
         JOIN clients c ON c.id = b.client_id
         JOIN pets p ON p.id = b.pet_id
         CROSS JOIN platform.tenants t
        WHERE b.id = $1 AND t.schema_name = current_schema()`,
      [bookingId],
    );
    const b = rows[0];
    if (!b?.email) return;

    const mail = bookingConfirmation({
      facility: b.facility,
      clientFirstName: b.first_name,
      petName: b.pet_name,
      serviceType: b.service_type,
      startDate: b.start_date,
      endDate: b.end_date,
      status: b.status,
      ...(dates && dates.length > 1 ? { dates } : {}),
    });

    await queueEmail(db, {
      kind: 'booking_confirmation',
      clientId: b.client_id,
      toEmail: b.email,
      subject: mail.subject,
      body: mail.body,
      dedupeKey: `booking:${bookingId}`,
      bookingId,
    });
    await sendReleased(db, log);
  } catch (err) {
    log('booking confirmation failed', { bookingId, error: (err as Error).message });
  }
}
