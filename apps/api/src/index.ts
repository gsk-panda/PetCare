import Fastify from 'fastify';
import cors from '@fastify/cors';
import { tenantRoutes } from './routes/index.js';
import { getTenantBySlug } from './tenants.js';

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });

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
