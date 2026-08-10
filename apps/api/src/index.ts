import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { tenantRoutes } from './routes/index.js';
import { getTenantBySlug } from './tenants.js';
import { facilityTimezone } from './db.js';
import { migrateAll } from './migrations.js';

const app = Fastify({ logger: true });

/**
 * In production the API and the app are one origin, so there is no cross-origin
 * request to allow and reflecting arbitrary origins would only widen the
 * surface. In development the Vite proxy needs credentials to pass through.
 */
const corsOrigin = process.env.CORS_ORIGIN;
if (corsOrigin) {
  await app.register(cors, { origin: corsOrigin.split(',').map((o) => o.trim()), credentials: true });
} else if (process.env.NODE_ENV !== 'production') {
  await app.register(cors, { origin: true, credentials: true });
}

await app.register(cookie);

app.get('/health', async () => ({ ok: true }));

// Public: theme/branding for the white-label PWA shell (loaded before login).
app.get<{ Params: { slug: string } }>('/api/tenants/:slug/meta', async (req, reply) => {
  const tenant = await getTenantBySlug(req.params.slug);
  if (!tenant) return reply.code(404).send({ error: 'Unknown tenant' });
  // The timezone rides along with the branding because the app needs it before
  // anything renders a date, and this is the one call made before sign-in.
  const timezone = await facilityTimezone(tenant.schemaName);
  return {
    slug: tenant.slug,
    name: tenant.name,
    plan: tenant.plan,
    theme: tenant.theme,
    timezone,
  };
});

await app.register(tenantRoutes, { prefix: '/api/:tenant' });

/**
 * Serve the built SPA from the same origin as the API. Same-origin is what
 * lets the session cookies stay sameSite=lax without a CORS dance, so the
 * deployed app behaves like the dev proxy rather than subtly differently.
 */
const webDist = process.env.WEB_DIST ?? fileURLToPath(new URL('../../web/dist', import.meta.url));
if (existsSync(join(webDist, 'index.html'))) {
  // Vite fingerprints every asset filename, so they can be cached forever.
  // index.html is served separately below and must not be.
  await app.register(fastifyStatic, {
    root: webDist,
    index: false,
    wildcard: false,
    maxAge: '1y',
    immutable: true,
  });

  const indexHtml = await readFile(join(webDist, 'index.html'), 'utf8');
  app.setNotFoundHandler((req, reply) => {
    // Client-side routes (/board, /portal/...) are the SPA's to resolve. A
    // missing API route is still a 404, or the frontend would swallow it and
    // report a parse error instead of the real one.
    if (req.method !== 'GET' || req.url.startsWith('/api/')) {
      return reply.code(404).send({ error: 'Not found' });
    }
    return reply.type('text/html').header('cache-control', 'no-cache').send(indexHtml);
  });
  app.log.info({ webDist }, 'serving web app');
}

// Applied at boot so a deployment cannot serve code that is ahead of its
// schema. Serialised across instances by an advisory lock.
if (process.env.MIGRATE_ON_BOOT === 'true') {
  await migrateAll((msg) => app.log.info({ migrate: msg }));
}

const port = Number(process.env.PORT ?? 3001);
await app.listen({ port, host: '0.0.0.0' });

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    app.log.info({ signal }, 'shutting down');
    void app.close().then(() => process.exit(0));
  });
}
