import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import { tenantRoutes } from './routes/index.js';
import { getTenantBySlug } from './tenants.js';

const app = Fastify({ logger: true });

// Credentials are required so the portal session cookie survives the dev proxy.
await app.register(cors, { origin: true, credentials: true });
await app.register(cookie);

app.get('/health', async () => ({ ok: true }));

// Public: theme/branding for the white-label PWA shell (loaded before login).
app.get<{ Params: { slug: string } }>('/api/tenants/:slug/meta', async (req, reply) => {
  const tenant = await getTenantBySlug(req.params.slug);
  if (!tenant) return reply.code(404).send({ error: 'Unknown tenant' });
  return { slug: tenant.slug, name: tenant.name, plan: tenant.plan, theme: tenant.theme };
});

await app.register(tenantRoutes, { prefix: '/api/:tenant' });

const port = Number(process.env.PORT ?? 3001);
await app.listen({ port, host: '0.0.0.0' });
