import type { FastifyInstance, FastifyRequest } from 'fastify';
import { getTenantBySlug, type TenantRecord } from '../tenants.js';
import { clientRoutes } from './clients.js';
import { boardRoutes } from './board.js';
import { dashboardRoutes } from './dashboard.js';
import { bookingRoutes } from './bookings.js';
import { calendarRoutes } from './calendar.js';
import { runRoutes } from './runs.js';
import { careRoutes } from './care.js';
import { alertRoutes } from './alerts.js';
import { settingsRoutes } from './settings.js';
import { runSettingsRoutes } from './run-settings.js';
import { billingRoutes } from './billing.js';
import { portalRoutes } from './portal.js';
import { staffAuthRoutes } from './staff.js';
import { readStaffCookie, resolveStaff, type StaffSession } from '../staff-auth.js';

declare module 'fastify' {
  interface FastifyRequest {
    tenant: TenantRecord;
    staff: StaffSession;
  }
}

// Small cache so every request doesn't hit platform.tenants.
const cache = new Map<string, { tenant: TenantRecord; at: number }>();
const CACHE_MS = 30_000;

export async function resolveTenant(slug: string): Promise<TenantRecord | null> {
  const hit = cache.get(slug);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.tenant;
  const tenant = await getTenantBySlug(slug);
  if (tenant) cache.set(slug, { tenant, at: Date.now() });
  return tenant;
}

export async function tenantRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', async (req: FastifyRequest, reply) => {
    const { tenant: slug } = req.params as { tenant: string };
    const tenant = await resolveTenant(slug);
    if (!tenant) {
      return reply.code(404).send({ error: `Unknown tenant: ${slug}` });
    }
    req.tenant = tenant;
  });

  // Owners authenticate separately and must not need a staff session.
  await app.register(portalRoutes);
  await app.register(staffAuthRoutes);
  await app.register(protectedStaffRoutes);
}

/**
 * Everything the business uses. Encapsulated as its own plugin so the staff
 * session hook applies here and nowhere else — the portal tree above keeps its
 * own auth, and staff sign-in stays reachable.
 */
async function protectedStaffRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', async (req: FastifyRequest, reply) => {
    const staff = await resolveStaff(req.tenant.schemaName, readStaffCookie(req));
    if (!staff) return reply.code(401).send({ error: 'Sign in to continue' });
    req.staff = staff;
  });

  app.get('/staff/me', async (req) => ({ staff: req.staff }));

  await app.register(dashboardRoutes);
  await app.register(boardRoutes);
  await app.register(clientRoutes);
  await app.register(bookingRoutes);
  await app.register(calendarRoutes);
  await app.register(runRoutes);
  await app.register(careRoutes);
  await app.register(alertRoutes);
  await app.register(settingsRoutes);
  await app.register(runSettingsRoutes);
  await app.register(billingRoutes);
}
