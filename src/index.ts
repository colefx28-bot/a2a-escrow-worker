import { Hono } from 'hono';

type Bindings = {
  IDEMPOTENCY_KV: KVNamespace;
  API_SECRET_KEY: string;
  RELAYER_PRIVATE_KEY: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.get('/health', (c) => {
  return c.json({
    status: 'active',
    protocol: 'Agentic Micro-Escrow (A2A-Escrow)',
    version: '2.0.0-cloudflare-worker',
    runtime: 'Cloudflare Workers (V8 Isolate)',
    organization: 'Low Level Logic Labs LLC'
  });
});

app.post('/verify-escrow', async (c) => {
  const signature = c.req.header('X-Signature');
  const idempotencyKey = c.req.header('X-Idempotency-Key');

  if (!idempotencyKey) {
    return c.json({ error: 'Missing X-Idempotency-Key header' }, 400);
  }

  const existing = await c.env.IDEMPOTENCY_KV.get(idempotencyKey);
  if (existing) {
    return c.json({ error: 'Duplicate request detected. Idempotency key already processed.' }, 409);
  }

  const bodyText = await c.req.text();
  await c.env.IDEMPOTENCY_KV.put(idempotencyKey, 'PROCESSED', { expirationTtl: 86400 });

  return c.json({
    status: 'SETTLED',
    idempotencyKey,
    timestamp: new Date().toISOString()
  });
});

export default app;
