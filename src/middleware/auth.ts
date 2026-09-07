import { Context, Next } from 'hono';
import { Env } from '../types';

export async function hmacAndIdempotencyMiddleware(c: Context<{ Bindings: Env }>, next: Next) {
  if (!c.env.API_SECRET_KEY) {
    return c.json({ error: 'Server misconfigured: API_SECRET_KEY not bound' }, 500);
  }

  const apiKey = c.req.header('X-Agent-API-Key');
  const timestamp = c.req.header('X-Timestamp');
  const signature = c.req.header('X-Signature');
  const idempotencyKey = c.req.header('X-Idempotency-Key');

  if (!apiKey || !timestamp || !signature || !idempotencyKey) {
    return c.json({ 
      error: 'Missing required security headers: X-Agent-API-Key, X-Timestamp, X-Signature, X-Idempotency-Key' 
    }, 401);
  }

  const reqTime = parseInt(timestamp, 10);
  const now = Math.floor(Date.now() / 1000);
  if (isNaN(reqTime) || Math.abs(now - reqTime) > 30) {
    return c.json({ error: 'Request timestamp expired or out of allowed 30-second window' }, 401);
  }

  const rawBody = await c.req.text();
  const message = `${timestamp}.${idempotencyKey}.${rawBody}`;
  
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(c.env.API_SECRET_KEY),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );

  const signatureBytes = hexToBytes(signature);
  const isValid = await crypto.subtle.verify('HMAC', cryptoKey, signatureBytes, encoder.encode(message));

  if (!isValid) {
    return c.json({ error: 'Invalid HMAC signature' }, 403);
  }

  const existingKey = await c.env.IDEMPOTENCY_KV.get(`idempotency:${idempotencyKey}`);
  if (existingKey) {
    return c.json({ error: 'Duplicate request detected. Idempotency key already processed.' }, 409);
  }

  await c.env.IDEMPOTENCY_KV.put(`idempotency:${idempotencyKey}`, 'LOCKED', { expirationTtl: 86400 });

  c.set('parsedBody', JSON.parse(rawBody));
  await next();
}

function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.substr(i * 2, 2), 16);
  }
  return bytes;
}
