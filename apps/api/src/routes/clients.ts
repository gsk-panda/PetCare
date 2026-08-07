import type { FastifyInstance } from 'fastify';
import { withTenant } from '../db.js';

export async function clientRoutes(app: FastifyInstance): Promise<void> {
  app.get('/clients', async (req) => {
    return withTenant(req.tenant.schemaName, async (db) => {
      const { rows } = await db.query(
        `SELECT c.id, c.first_name, c.last_name, c.email, c.phone, c.sms_opt_in,
                c.balance_cents, c.created_at,
                COALESCE(json_agg(json_build_object(
                  'id', p.id, 'name', p.name, 'breed', p.breed,
                  'avatarColor', p.avatar_color
                ) ORDER BY p.name) FILTER (WHERE p.id IS NOT NULL), '[]') AS pets
         FROM clients c
         LEFT JOIN pets p ON p.client_id = c.id
         GROUP BY c.id
         ORDER BY c.last_name, c.first_name`,
      );
      return {
        clients: rows.map((r) => ({
          id: r.id,
          firstName: r.first_name,
          lastName: r.last_name,
          email: r.email,
          phone: r.phone,
          smsOptIn: r.sms_opt_in,
          balanceCents: r.balance_cents,
          createdAt: r.created_at,
          pets: r.pets,
        })),
      };
    });
  });

  app.post<{
    Body: {
      firstName: string;
      lastName: string;
      email?: string;
      phone?: string;
      smsOptIn?: boolean;
    };
  }>('/clients', async (req, reply) => {
    const { firstName, lastName, email, phone, smsOptIn } = req.body;
    if (!firstName?.trim() || !lastName?.trim()) {
      return reply.code(400).send({ error: 'firstName and lastName are required' });
    }
    return withTenant(req.tenant.schemaName, async (db) => {
      const { rows } = await db.query(
        `INSERT INTO clients (first_name, last_name, email, phone, sms_opt_in)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [firstName.trim(), lastName.trim(), email ?? null, phone ?? null, smsOptIn ?? false],
      );
      reply.code(201);
      return { id: rows[0].id };
    });
  });

  app.get<{ Params: { petId: string } }>('/pets/:petId', async (req, reply) => {
    return withTenant(req.tenant.schemaName, async (db) => {
      const { rows } = await db.query(
        `SELECT p.*, c.first_name, c.last_name, c.phone AS client_phone,
                c.emergency_name, c.emergency_phone, c.balance_cents
         FROM pets p JOIN clients c ON c.id = p.client_id
         WHERE p.id = $1`,
        [req.params.petId],
      );
      const p = rows[0];
      if (!p) return reply.code(404).send({ error: 'Pet not found' });
      const { rows: vaccinations } = await db.query(
        `SELECT id, vaccine, expires_on::text, verified
         FROM vaccinations WHERE pet_id = $1 ORDER BY expires_on`,
        [p.id],
      );
      return {
        id: p.id,
        name: p.name,
        species: p.species,
        breed: p.breed,
        sex: p.sex,
        birthdate: p.birthdate,
        weightLbs: p.weight_lbs === null ? null : Number(p.weight_lbs),
        avatarColor: p.avatar_color,
        feedingNotes: p.feeding_notes,
        medicationNotes: p.medication_notes,
        allergyNotes: p.allergy_notes,
        owner: {
          id: p.client_id,
          name: `${p.first_name} ${p.last_name}`,
          phone: p.client_phone,
          emergencyName: p.emergency_name,
          emergencyPhone: p.emergency_phone,
          balanceCents: p.balance_cents,
        },
        vaccinations: vaccinations.map((v) => ({
          id: v.id,
          vaccine: v.vaccine,
          expiresOn: v.expires_on,
          verified: v.verified,
        })),
      };
    });
  });
}
