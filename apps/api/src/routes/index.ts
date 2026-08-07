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

declare module 'fastify' {
  interface FastifyRequest {
    tenant: TenantRecord;
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

  await app.register(dashboardRoutes);
  await app.register(boardRoutes);
  await app.register(clientRoutes);
  await app.register(bookingRoutes);
  await app.register(calendarRoutes);
  await app.register(runRoutes);
  await app.register(careRoutes);
  await app.register(alertRoutes);
}
