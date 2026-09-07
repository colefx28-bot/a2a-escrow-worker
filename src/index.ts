import { Hono } from 'hono';
import Ajv from 'ajv';
import { Env, EscrowVerificationPayload } from './types';
import { hmacAndIdempotencyMiddleware } from './middleware/auth';
import { submitEIP3009Relay } from './utils/eip3009';

const app = new Hono<{ Bindings: Env }>();
const ajv = new Ajv({ allErrors: true });

app.get('/health', (c) => c.json({
  status: 'active',
  protocol: 'Agentic Micro-Escrow (A2A-Escrow)',
  version: '2.0.0-cloudflare-worker',
  runtime: 'Cloudflare Workers (V8 Isolate)',
  organization: 'Low Level Logic Labs LLC'
}));

app.post('/v1/escrow/verify', hmacAndIdempotencyMiddleware, async (c) => {
  const startTime = Date.now();
  const body = c.get('parsedBody') as EscrowVerificationPayload;

  const { expectedSchema, payload, authorization, maxLatencyMs = 1000 } = body;

  if (!expectedSchema || !payload || !authorization) {
    return c.json({ error: 'expectedSchema, payload, and authorization objects required' }, 400);
  }

  const validate = ajv.compile(expectedSchema);
  const isValid = validate(payload) as boolean;
  const durationMs = Date.now() - startTime;

  if (!isValid || durationMs > maxLatencyMs) {
    return c.json({
      escrowId: `escrow_${crypto.randomUUID()}`,
      status: 'VOIDED_AUTHORIZATION_NOT_SUBMITTED',
      reason: !isValid ? 'SCHEMA_VALIDATION_FAILED' : 'LATENCY_SLA_EXCEEDED',
      errors: validate.errors,
      verificationLatencyMs: durationMs
    }, 422);
  }

  try {
    const txHash = await submitEIP3009Relay(authorization, c.env, false);

    return c.json({
      escrowId: `escrow_${crypto.randomUUID()}`,
      status: 'SETTLED',
      onChainTxHash: txHash,
      verificationLatencyMs: durationMs,
      settlementTimestamp: new Date().toISOString()
    });
  } catch (err: any) {
    return c.json({ error: 'On-chain EIP-3009 relayer execution failed', details: err.message }, 500);
  }
});

export default app;
