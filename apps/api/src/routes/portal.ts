import type { FastifyInstance, FastifyRequest } from 'fastify';
import { facilityToday, withTenant } from '../db.js';
import { loginCodeMail, mailerConfigured, sendMail } from '../mailer.js';
import {
  clearSessionCookie,
  issueLoginCode,
  readSessionCookie,
  resolveSession,
  revokeSession,
  setSessionCookie,
  verifyLoginCode,
  type PortalSession,
} from '../portal-auth.js';

declare module 'fastify' {
  interface FastifyRequest {
    portal: PortalSession;
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Inline photos only; production moves these to S3 per the architecture. */
const MAX_PHOTO_BYTES = 700_000;
const PHOTO_PREFIX = /^data:image\/(png|jpe?g|webp);base64,/;

/**
 * With no mailer configured there is no other way to get the code, so it comes
 * back in the response. Gated on the mailer rather than on NODE_ENV: a
 * deployment that forgot SES_FROM should fail visibly at the login screen, not
 * quietly start handing out other people's sign-in codes over HTTP.
 */
const EXPOSE_CODES = !mailerConfigured() && process.env.NODE_ENV !== 'production';

export async function portalRoutes(app: FastifyInstance): Promise<void> {
  await app.register(publicRoutes);
  await app.register(protectedRoutes);
}

/* ============================ public ============================ */
async function publicRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { email?: string } }>('/portal/login/request', async (req, reply) => {
    const email = req.body?.email?.trim() ?? '';
    if (!EMAIL_RE.test(email)) {
      return reply.code(400).send({ error: 'Enter a valid email address' });
    }
    const issued = await issueLoginCode(req.tenant.schemaName, email);

    // Same response whether or not the address is a customer, so the endpoint
    // cannot be used to discover who boards here.
    if (!issued) {
      req.log.info({ email }, 'portal login requested for unknown email');
      return { sent: true };
    }
    req.log.info({ identityId: issued.identityId }, 'portal login code issued');

    try {
      await sendMail(
        loginCodeMail(email, issued.code, req.tenant.name),
        (msg, meta) => req.log.warn(meta ?? {}, msg),
      );
    } catch (err) {
      // Deliberately still {sent: true}. Failing loudly only for addresses that
      // exist would turn this endpoint into a way to ask who boards here.
      req.log.error({ err, identityId: issued.identityId }, 'portal login code email failed');
    }

    return EXPOSE_CODES ? { sent: true, devCode: issued.code } : { sent: true };
  });

  app.post<{ Body: { email?: string; code?: string } }>(
    '/portal/login/verify',
    async (req, reply) => {
      const email = req.body?.email?.trim() ?? '';
      const code = req.body?.code?.trim() ?? '';
      if (!EMAIL_RE.test(email) || !/^\d{6}$/.test(code)) {
        return reply.code(400).send({ error: 'Enter the 6-digit code from your email' });
      }
      const session = await verifyLoginCode(
        req.tenant.schemaName,
        email,
        code,
        req.headers['user-agent'],
      );
      if (!session) {
        return reply.code(401).send({ error: 'That code is wrong or has expired. Request a new one.' });
      }
      setSessionCookie(reply, session.token, session.expiresAt);
      return { ok: true };
    },
  );
}

/* ============================ protected ============================ */
async function protectedRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', async (req: FastifyRequest, reply) => {
    const session = await resolveSession(req.tenant.schemaName, readSessionCookie(req));
    if (!session) return reply.code(401).send({ error: 'Please sign in' });
    req.portal = session;
  });

  app.post('/portal/logout', async (req, reply) => {
    await revokeSession(req.tenant.schemaName, readSessionCookie(req));
    clearSessionCookie(reply);
    return { ok: true };
  });

  /* ---- profile ---- */
  app.get('/portal/me', async (req) => {
    return withTenant(req.tenant.schemaName, async (db) => {
      const { rows } = await db.query(
        `SELECT id, first_name, last_name, email, phone, sms_opt_in,
                address_line1, address_line2, city, state, postal_code,
                emergency_name, emergency_phone, balance_cents,
                sms_consent_at, sms_revoked_at
         FROM clients WHERE id = $1`,
        [req.portal.clientId],
      );
      const c = rows[0];
      return {
        email: req.portal.email,
        client: {
          id: c.id,
          firstName: c.first_name,
          lastName: c.last_name,
          contactEmail: c.email,
          phone: c.phone,
          smsOptIn: c.sms_opt_in,
          smsConsentAt: c.sms_consent_at,
          smsRevokedAt: c.sms_revoked_at,
          addressLine1: c.address_line1,
          addressLine2: c.address_line2,
          city: c.city,
          state: c.state,
          postalCode: c.postal_code,
          emergencyName: c.emergency_name,
          emergencyPhone: c.emergency_phone,
          balanceCents: c.balance_cents,
        },
      };
    });
  });

  app.patch<{
    Body: {
      firstName?: string; lastName?: string; contactEmail?: string; phone?: string;
      addressLine1?: string; addressLine2?: string; city?: string; state?: string;
      postalCode?: string; emergencyName?: string; emergencyPhone?: string;
      smsOptIn?: boolean;
    };
  }>('/portal/me', async (req, reply) => {
    const b = req.body ?? {};
    if (b.firstName !== undefined && !b.firstName.trim()) {
      return reply.code(400).send({ error: 'First name cannot be empty' });
    }
    if (b.lastName !== undefined && !b.lastName.trim()) {
      return reply.code(400).send({ error: 'Last name cannot be empty' });
    }
    if (b.contactEmail !== undefined && b.contactEmail.trim() && !EMAIL_RE.test(b.contactEmail.trim())) {
      return reply.code(400).send({ error: 'Enter a valid email address' });
    }

    return withTenant(req.tenant.schemaName, async (db) => {
      // Consent transitions are recorded, not just the resulting boolean.
      const consentSql =
        b.smsOptIn === true
          ? `sms_opt_in = true,
             sms_consent_at = COALESCE(sms_consent_at, now()),
             sms_consent_source = COALESCE(sms_consent_source, 'portal'),
             sms_revoked_at = NULL`
          : b.smsOptIn === false
            ? `sms_opt_in = false, sms_revoked_at = now()`
            : `sms_opt_in = sms_opt_in`;

      const { rows } = await db.query(
        `UPDATE clients SET
           first_name = COALESCE($2, first_name),
           last_name = COALESCE($3, last_name),
           email = COALESCE($4, email),
           phone = COALESCE($5, phone),
           address_line1 = COALESCE($6, address_line1),
           address_line2 = COALESCE($7, address_line2),
           city = COALESCE($8, city),
           state = COALESCE($9, state),
           postal_code = COALESCE($10, postal_code),
           emergency_name = COALESCE($11, emergency_name),
           emergency_phone = COALESCE($12, emergency_phone),
           ${consentSql}
         WHERE id = $1
         RETURNING id`,
        [
          req.portal.clientId,
          b.firstName?.trim() ?? null, b.lastName?.trim() ?? null,
          b.contactEmail?.trim() || null, b.phone?.trim() ?? null,
          b.addressLine1?.trim() ?? null, b.addressLine2?.trim() ?? null,
          b.city?.trim() ?? null, b.state?.trim() ?? null, b.postalCode?.trim() ?? null,
          b.emergencyName?.trim() ?? null, b.emergencyPhone?.trim() ?? null,
        ],
      );
      if (!rows[0]) return reply.code(404).send({ error: 'Account not found' });
      return { ok: true };
    });
  });

  /* ---- pets ---- */
  app.get('/portal/pets', async (req) => {
    return withTenant(req.tenant.schemaName, async (db) => {
      const { rows } = await db.query(
        `SELECT p.id, p.name, p.species, p.breed, p.sex, p.birthdate, p.weight_lbs,
                p.avatar_color, p.photo_url, p.feeding_notes, p.medication_notes,
                p.allergy_notes,
                COALESCE(json_agg(json_build_object(
                  'id', v.id, 'vaccine', v.vaccine,
                  'expiresOn', v.expires_on::text, 'verified', v.verified
                ) ORDER BY v.expires_on) FILTER (WHERE v.id IS NOT NULL), '[]') AS vaccinations
         FROM pets p
         LEFT JOIN vaccinations v ON v.pet_id = p.id
         WHERE p.client_id = $1
         GROUP BY p.id
         ORDER BY p.name`,
        [req.portal.clientId],
      );
      return {
        pets: rows.map((p) => ({
          id: p.id,
          name: p.name,
          species: p.species,
          breed: p.breed,
          sex: p.sex,
          birthdate: p.birthdate,
          weightLbs: p.weight_lbs === null ? null : Number(p.weight_lbs),
          avatarColor: p.avatar_color,
          photoUrl: p.photo_url,
          feedingNotes: p.feeding_notes,
          medicationNotes: p.medication_notes,
          allergyNotes: p.allergy_notes,
          vaccinations: p.vaccinations,
        })),
      };
    });
  });

  app.patch<{
    Params: { petId: string };
    Body: {
      feedingNotes?: string; medicationNotes?: string; allergyNotes?: string;
      weightLbs?: number | null; photoUrl?: string | null;
    };
  }>('/portal/pets/:petId', { bodyLimit: 1_200_000 }, async (req, reply) => {
    const b = req.body ?? {};
    if (b.photoUrl) {
      if (!PHOTO_PREFIX.test(b.photoUrl)) {
        return reply.code(400).send({ error: 'Photo must be a PNG, JPEG or WebP image' });
      }
      if (b.photoUrl.length > MAX_PHOTO_BYTES) {
        return reply.code(413).send({ error: 'That photo is too large. Try one under 500 KB.' });
      }
    }
    if (b.weightLbs !== undefined && b.weightLbs !== null) {
      if (!Number.isFinite(b.weightLbs) || b.weightLbs <= 0 || b.weightLbs > 400) {
        return reply.code(400).send({ error: 'Weight must be between 1 and 400 lb' });
      }
    }

    return withTenant(req.tenant.schemaName, async (db) => {
      const { rows } = await db.query(
        `UPDATE pets SET
           feeding_notes = COALESCE($3, feeding_notes),
           medication_notes = COALESCE($4, medication_notes),
           allergy_notes = COALESCE($5, allergy_notes),
           weight_lbs = COALESCE($6, weight_lbs),
           photo_url = COALESCE($7, photo_url),
           photo_updated_at = CASE WHEN $7 IS NULL THEN photo_updated_at ELSE now() END
         WHERE id = $1 AND client_id = $2
         RETURNING id`,
        [
          req.params.petId, req.portal.clientId,
          b.feedingNotes?.trim() ?? null, b.medicationNotes?.trim() ?? null,
          b.allergyNotes?.trim() ?? null, b.weightLbs ?? null, b.photoUrl ?? null,
        ],
      );
      if (!rows[0]) return reply.code(404).send({ error: 'Pet not found' });
      return { ok: true };
    });
  });

  app.post<{
    Params: { petId: string };
    Body: { vaccine?: string; expiresOn?: string };
  }>('/portal/pets/:petId/vaccinations', async (req, reply) => {
    const vaccine = req.body?.vaccine?.trim();
    const expiresOn = req.body?.expiresOn?.trim();
    if (!vaccine) return reply.code(400).send({ error: 'Which vaccine is this?' });
    if (!expiresOn || !ISO_DATE.test(expiresOn)) {
      return reply.code(400).send({ error: 'Enter the expiry date as YYYY-MM-DD' });
    }

    return withTenant(req.tenant.schemaName, async (db) => {
      const { rows: pet } = await db.query(
        'SELECT id FROM pets WHERE id = $1 AND client_id = $2',
        [req.params.petId, req.portal.clientId],
      );
      if (!pet[0]) return reply.code(404).send({ error: 'Pet not found' });

      // Owner-submitted records start unverified; the desk confirms against
      // the paperwork at drop-off.
      const { rows } = await db.query(
        `INSERT INTO vaccinations (pet_id, vaccine, expires_on, verified)
         VALUES ($1, $2, $3::date, false) RETURNING id`,
        [req.params.petId, vaccine, expiresOn],
      );
      reply.code(201);
      return { id: rows[0].id, verified: false };
    });
  });

  /* ---- reservations ---- */
  app.get('/portal/bookings', async (req) => {
    return withTenant(req.tenant.schemaName, async (db) => {
      const { rows } = await db.query(
        `SELECT b.id, b.service_type, b.status, b.start_date::text, b.end_date::text,
                b.notes, b.source, b.canceled_at, b.cancel_reason,
                p.id AS pet_id, p.name AS pet_name, p.avatar_color, p.photo_url,
                r.code AS run_code, r.label AS run_label
         FROM bookings b
         JOIN pets p ON p.id = b.pet_id
         LEFT JOIN runs r ON r.id = b.run_id
         WHERE b.client_id = $1
         ORDER BY b.start_date DESC`,
        [req.portal.clientId],
      );
      return {
        bookings: rows.map((b) => ({
          id: b.id,
          serviceType: b.service_type,
          status: b.status,
          startDate: b.start_date,
          endDate: b.end_date,
          notes: b.notes,
          source: b.source,
          canceledAt: b.canceled_at,
          cancelReason: b.cancel_reason,
          petId: b.pet_id,
          petName: b.pet_name,
          avatarColor: b.avatar_color,
          photoUrl: b.photo_url,
          runCode: b.run_code,
          runLabel: b.run_label,
        })),
      };
    });
  });

  app.post<{
    Body: {
      petId?: string; serviceType?: 'boarding' | 'daycare';
      startDate?: string; endDate?: string; notes?: string;
    };
  }>('/portal/bookings', async (req, reply) => {
    const { petId, serviceType, startDate, endDate, notes } = req.body ?? {};
    const problem = validateDates(
      serviceType,
      startDate,
      endDate,
      await facilityToday(req.tenant.schemaName),
    );
    if (!petId) return reply.code(400).send({ error: 'Choose a pet' });
    if (problem) return reply.code(400).send({ error: problem });

    return withTenant(req.tenant.schemaName, async (db) => {
      const { rows: pet } = await db.query(
        'SELECT id FROM pets WHERE id = $1 AND client_id = $2',
        [petId, req.portal.clientId],
      );
      if (!pet[0]) return reply.code(404).send({ error: 'Pet not found' });

      // Owner requests land as 'requested' with no run assigned: the desk
      // reviews capacity and places them. The board already shows these.
      const { rows } = await db.query(
        `INSERT INTO bookings
           (pet_id, client_id, service_type, status, start_date, end_date, notes, source)
         VALUES ($1, $2, $3, 'requested', $4::date, $5::date, $6, 'portal')
         RETURNING id`,
        [petId, req.portal.clientId, serviceType, startDate, endDate, notes?.trim() || null],
      );
      reply.code(201);
      return { id: rows[0].id, status: 'requested' };
    });
  });

  app.patch<{
    Params: { bookingId: string };
    Body: { startDate?: string; endDate?: string; notes?: string };
  }>('/portal/bookings/:bookingId', async (req, reply) => {
    const { startDate, endDate, notes } = req.body ?? {};

    return withTenant(req.tenant.schemaName, async (db) => {
      const { rows: current } = await db.query(
        `SELECT id, service_type, status, start_date::text, end_date::text
         FROM bookings WHERE id = $1 AND client_id = $2`,
        [req.params.bookingId, req.portal.clientId],
      );
      const booking = current[0];
      if (!booking) return reply.code(404).send({ error: 'Reservation not found' });
      if (!['requested', 'confirmed'].includes(booking.status)) {
        return reply.code(409).send({
          error: 'This stay has already started. Call us and we will sort it out.',
        });
      }

      const nextStart = startDate ?? booking.start_date;
      const nextEnd = endDate ?? booking.end_date;
      const problem = validateDates(
        booking.service_type,
        nextStart,
        nextEnd,
        await facilityToday(req.tenant.schemaName),
      );
      if (problem) return reply.code(400).send({ error: problem });

      // Any owner change re-enters review; the desk may have already assigned
      // a run that no longer fits the new dates.
      await db.query(
        `UPDATE bookings
         SET start_date = $2::date, end_date = $3::date,
             notes = COALESCE($4, notes),
             status = 'requested', run_id = NULL
         WHERE id = $1`,
        [booking.id, nextStart, nextEnd, notes?.trim() ?? null],
      );
      return { ok: true, status: 'requested' };
    });
  });

  app.delete<{ Params: { bookingId: string }; Body: { reason?: string } }>(
    '/portal/bookings/:bookingId',
    async (req, reply) => {
      return withTenant(req.tenant.schemaName, async (db) => {
        const { rows } = await db.query(
          `UPDATE bookings
           SET status = 'canceled', canceled_at = now(),
               cancel_reason = COALESCE($3, 'Canceled by owner'), run_id = NULL
           WHERE id = $1 AND client_id = $2
             AND status IN ('requested', 'confirmed')
           RETURNING id`,
          [req.params.bookingId, req.portal.clientId, req.body?.reason?.trim() ?? null],
        );
        if (!rows[0]) {
          return reply.code(409).send({
            error: 'That reservation cannot be canceled here — it may have already started.',
          });
        }
        return { ok: true };
      });
    },
  );

  /* ---- stay history ---- */
  app.get<{ Params: { bookingId: string } }>(
    '/portal/bookings/:bookingId/log',
    async (req, reply) => {
      return withTenant(req.tenant.schemaName, async (db) => {
        const { rows: booking } = await db.query(
          `SELECT b.id, b.service_type, b.start_date::text, b.end_date::text, b.status,
                  p.name AS pet_name, r.code AS run_code, r.label AS run_label
           FROM bookings b
           JOIN pets p ON p.id = b.pet_id
           LEFT JOIN runs r ON r.id = b.run_id
           WHERE b.id = $1 AND b.client_id = $2`,
          [req.params.bookingId, req.portal.clientId],
        );
        if (!booking[0]) return reply.code(404).send({ error: 'Stay not found' });

        const { rows: events } = await db.query(
          `SELECT type, slot, subject, note, occurred_at, care_date::text
           FROM care_events WHERE booking_id = $1 ORDER BY occurred_at`,
          [req.params.bookingId],
        );
        const { rows: intake } = await db.query(
          `SELECT belongings, collar_type, food_source, food_description,
                  feeding_amount, feeding_times, bowl_type,
                  treats_allowed, bones_allowed
           FROM stay_intake WHERE booking_id = $1`,
          [req.params.bookingId],
        );
        const { rows: meds } = await db.query(
          `SELECT name, dose, schedule, with_food FROM stay_medications
           WHERE booking_id = $1 ORDER BY created_at`,
          [req.params.bookingId],
        );

        return {
          stay: {
            id: booking[0].id,
            serviceType: booking[0].service_type,
            status: booking[0].status,
            startDate: booking[0].start_date,
            endDate: booking[0].end_date,
            petName: booking[0].pet_name,
            runCode: booking[0].run_code,
            runLabel: booking[0].run_label,
          },
          // Staff-only note text is not exposed; owners see that care happened
          // and when, which is the point of the log.
          events: events.map((e) => ({
            type: e.type,
            slot: e.slot,
            subject: e.subject,
            occurredAt: e.occurred_at,
            careDate: e.care_date,
            note: e.type === 'checkin' || e.type === 'checkout' ? null : e.note,
          })),
          intake: intake[0]
            ? {
                belongings: intake[0].belongings,
                collarType: intake[0].collar_type,
                foodSource: intake[0].food_source,
                foodDescription: intake[0].food_description,
                feedingAmount: intake[0].feeding_amount,
                feedingTimes: intake[0].feeding_times ?? [],
                bowlType: intake[0].bowl_type,
                treatsAllowed: intake[0].treats_allowed,
                bonesAllowed: intake[0].bones_allowed,
              }
            : null,
          medications: meds.map((m) => ({
            name: m.name,
            dose: m.dose,
            schedule: m.schedule,
            withFood: m.with_food,
          })),
        };
      });
    },
  );

  /* ---- alerts ---- */
  app.get('/portal/alerts', async (req) => {
    return withTenant(req.tenant.schemaName, async (db) => {
      const { rows } = await db.query(
        `SELECT v.id, v.vaccine, v.expires_on::text AS expires_on, v.verified,
                (v.expires_on - CURRENT_DATE)::int AS days_left,
                p.id AS pet_id, p.name AS pet_name,
                s.start_date::text AS stay_start, s.end_date::text AS stay_end
         FROM vaccinations v
         JOIN pets p ON p.id = v.pet_id
         LEFT JOIN LATERAL (
           SELECT b.start_date, b.end_date FROM bookings b
           WHERE b.pet_id = p.id AND b.status IN ('requested', 'confirmed', 'checked_in')
             AND b.end_date >= CURRENT_DATE AND v.expires_on <= b.end_date
           ORDER BY b.start_date LIMIT 1
         ) s ON true
         WHERE p.client_id = $1 AND v.expires_on <= CURRENT_DATE + 45
         ORDER BY v.expires_on`,
        [req.portal.clientId],
      );
      return {
        alerts: rows.map((a) => ({
          id: a.id,
          vaccine: a.vaccine,
          expiresOn: a.expires_on,
          daysLeft: a.days_left,
          expired: a.days_left < 0,
          verified: a.verified,
          petId: a.pet_id,
          petName: a.pet_name,
          affectsStay: Boolean(a.stay_start),
          stayStart: a.stay_start,
          stayEnd: a.stay_end,
        })),
      };
    });
  });
}

function validateDates(
  serviceType: string | undefined,
  startDate: string | undefined,
  endDate: string | undefined,
  today: string,
): string | null {
  if (serviceType !== 'boarding' && serviceType !== 'daycare') {
    return 'Choose boarding or daycare';
  }
  if (!startDate || !ISO_DATE.test(startDate)) return 'Choose a start date';
  if (!endDate || !ISO_DATE.test(endDate)) return 'Choose an end date';
  if (endDate < startDate) return 'The end date cannot be before the start date';
  if (serviceType === 'boarding' && endDate === startDate) {
    return 'A boarding stay needs at least one night';
  }
  if (serviceType === 'daycare' && endDate !== startDate) {
    return 'Daycare is a single day';
  }
  // `today` is the facility's date, not the server's. A client booking at
  // 9pm Pacific must not be told that tomorrow is already in the past.
  if (startDate < today) return 'Choose a date from today onwards';
  return null;
}
