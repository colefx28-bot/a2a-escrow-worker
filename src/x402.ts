import { Hono } from 'hono';
import { Address } from 'viem';
import Ajv from 'ajv';
import { RelayerRequest } from './types';

type Bindings = {
  IDEMPOTENCY_DO: DurableObjectNamespace;
  RELAYER_QUEUE: DurableObjectNamespace;
  DEAL_EXPIRY: DurableObjectNamespace;
  DEALS_KV: KVNamespace;
  VAULT_ADDRESS: Address;
};

const app = new Hono<{ Bindings: Bindings }>();
const ajv = new Ajv();

const HELD_TIER_THRESHOLD = 25_000_000n;

app.post('/deals', async (c) => {
  const { payer, payee, amountRaw, expectedSchema, expirySeconds } = await c.req.json();

  if (!payer || !payee || !amountRaw || !expectedSchema) {
    return c.json({ error: 'MISSING_REQUIRED_DEAL_PARAMETERS' }, 400);
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(payer) || !/^0x[a-fA-F0-9]{40}$/.test(payee)) {
    return c.json({ error: 'INVALID_ADDRESS_FORMAT' }, 400);
  }
  if (typeof amountRaw !== 'string' || !/^\d+$/.test(amountRaw)) {
    return c.json({ error: 'INVALID_AMOUNT_RAW_FORMAT_MUST_BE_STRING_ATOMIC_UNITS' }, 400);
  }

  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const dealId = `0x${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}` as `0x${string}`;

  const mode = BigInt(amountRaw) < HELD_TIER_THRESHOLD ? 'instant' : 'held';
  const expirySecs = expirySeconds || 3600;
  const createdAt = Math.floor(Date.now() / 1000);
  const expiresAt = createdAt + expirySecs;

  const dealRecord = {
    dealId,
    payer: payer.toLowerCase(),
    payee: payee.toLowerCase(),
    amountRaw,
    expectedSchema,
    mode,
    status: 'created',
    expirySeconds: expirySecs,
    createdAt
  };

  const kvKey = `deal:${dealId}`;
  await c.env.DEALS_KV.put(kvKey, JSON.stringify(dealRecord), {
    expirationTtl: expirySecs + 86400
  });

  if (mode === 'held') {
    const expiryDoId = c.env.DEAL_EXPIRY.idFromName(dealId);
    const expiryDo = c.env.DEAL_EXPIRY.get(expiryDoId);
    await expiryDo.fetch('https://expiry.internal/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dealId, expiresAt })
    });
  }

  return c.json({
    status: 'DEAL_PRE_REGISTERED',
    dealId,
    mode,
    amountRaw,
    expirySeconds: expirySecs,
    expiresAt
  });
});

app.post('/v2/x402/settle', async (c) => {
  const { dealId, paymentPayload, deliverablePayload } = await c.req.json();
  const kvKey = `deal:${dealId}`;
  const dealData = await c.env.DEALS_KV.get(kvKey);

  if (!dealData) {
    return c.json({ x402Status: 'SETTLEMENT_FAILED', reason: 'UNKNOWN_OR_EXPIRED_DEAL' }, 404);
  }

  const deal = JSON.parse(dealData);
  if (deal.status !== 'created') {
    return c.json({ x402Status: 'SETTLEMENT_FAILED', reason: 'DEAL_ALREADY_PROCESSED' }, 409);
  }

  const { payer, payee, amount, validAfter, validBefore, nonce, v, r, s } = paymentPayload;
  if (
    payer.toLowerCase() !== deal.payer ||
    payee.toLowerCase() !== deal.payee ||
    amount !== deal.amountRaw
  ) {
    return c.json({ x402Status: 'SETTLEMENT_FAILED', reason: 'PAYMENT_PAYLOAD_TERMS_MISMATCH' }, 422);
  }

  const relayerId = c.env.RELAYER_QUEUE.idFromName('primary');
  const relayer = c.env.RELAYER_QUEUE.get(relayerId);

  if (deal.mode === 'instant') {
    const validate = ajv.compile(deal.expectedSchema);
    if (!validate(deliverablePayload)) {
      return c.json({ x402Status: 'SETTLEMENT_FAILED', reason: 'DELIVERABLE_SCHEMA_MISMATCH', errors: validate.errors }, 422);
    }

    const payload: RelayerRequest = {
      fn: 'fundAndSettle',
      params: {
        dealId,
        payer: payer as `0x${string}`,
        payee: payee as `0x${string}`,
        amount: deal.amountRaw,
        validAfter: String(validAfter),
        validBefore: String(validBefore),
        nonce: nonce as `0x${string}`,
        v: Number(v),
        r: r as `0x${string}`,
        s: s as `0x${string}`
      }
    };

    const res = await relayer.fetch('https://relayer.internal/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = (await res.json()) as { ok: boolean; txHash?: string; error?: string };

    if (!result.ok) {
      if (result.error === 'CONFIRMATION_TIMEOUT_PENDING_UNKNOWN') {
        deal.status = 'submitted_pending_confirmation';
        deal.pendingSince = Math.floor(Date.now() / 1000);
        deal.settlementTxHash = result.txHash;
        await c.env.DEALS_KV.put(kvKey, JSON.stringify(deal));
        return c.json({
          x402Status: 'PENDING_CONFIRMATION',
          dealId,
          txHash: result.txHash,
          message: 'Transaction submitted to mempool; awaiting Base L2 block confirmation.'
        }, 202);
      }
      return c.json({ x402Status: 'SETTLEMENT_FAILED', reason: 'ON_CHAIN_REVERT', details: result.error }, 500);
    }

    deal.status = 'released';
    deal.settlementTxHash = result.txHash;
    await c.env.DEALS_KV.put(kvKey, JSON.stringify(deal));
    return c.json({ x402Status: 'SETTLED', dealId, txHash: result.txHash });
  }

  const expiresAt = deal.createdAt + deal.expirySeconds;
  const payload: RelayerRequest = {
    fn: 'fund',
    params: {
      dealId,
      payer: payer as `0x${string}`,
      payee: payee as `0x${string}`,
      amount: deal.amountRaw,
      expiry: String(expiresAt),
      validAfter: String(validAfter),
      validBefore: String(validBefore),
      nonce: nonce as `0x${string}`,
      v: Number(v),
      r: r as `0x${string}`,
      s: s as `0x${string}`
    }
  };

  const res = await relayer.fetch('https://relayer.internal/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const result = (await res.json()) as { ok: boolean; txHash?: string; error?: string };
  if (!result.ok) {
    if (result.error === 'CONFIRMATION_TIMEOUT_PENDING_UNKNOWN') {
      deal.status = 'submitted_pending_confirmation';
      deal.pendingSince = Math.floor(Date.now() / 1000);
      deal.fundTxHash = result.txHash;
      await c.env.DEALS_KV.put(kvKey, JSON.stringify(deal));
      return c.json({
        x402Status: 'PENDING_CONFIRMATION',
        dealId,
        txHash: result.txHash,
        message: 'Transaction submitted to mempool; awaiting Base L2 block confirmation.'
      }, 202);
    }
    return c.json({ x402Status: 'SETTLEMENT_FAILED', reason: 'ON_CHAIN_REVERT', details: result.error }, 500);
  }

  deal.status = 'funded';
  deal.fundTxHash = result.txHash;
  await c.env.DEALS_KV.put(kvKey, JSON.stringify(deal));
  return c.json({ x402Status: 'FUNDED_PENDING_RELEASE', dealId, txHash: result.txHash, expiresAt });
});

app.post('/deals/:id/release', async (c) => {
  const dealId = c.req.param('id') as `0x${string}`;
  const { deliverablePayload } = await c.req.json();
  const kvKey = `deal:${dealId}`;

  const dealData = await c.env.DEALS_KV.get(kvKey);
  if (!dealData) return c.json({ error: 'UNKNOWN_DEAL' }, 404);

  const deal = JSON.parse(dealData);
  if (deal.mode !== 'held') return c.json({ error: 'NOT_A_HELD_DEAL' }, 400);
  if (deal.status !== 'funded') {
    return c.json({ error: 'DEAL_NOT_IN_FUNDED_STATE', currentStatus: deal.status }, 409);
  }

  const validate = ajv.compile(deal.expectedSchema);
  if (!validate(deliverablePayload)) {
    return c.json({ error: 'DELIVERABLE_SCHEMA_MISMATCH', errors: validate.errors }, 422);
  }

  const relayerId = c.env.RELAYER_QUEUE.idFromName('primary');
  const relayer = c.env.RELAYER_QUEUE.get(relayerId);

  const payload: RelayerRequest = {
    fn: 'release',
    params: { dealId }
  };

  const res = await relayer.fetch('https://relayer.internal/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const result = (await res.json()) as { ok: boolean; txHash?: string; error?: string };
  if (!result.ok) {
    return c.json({ error: 'ON_CHAIN_REVERT', details: result.error }, 500);
  }

  deal.status = 'released';
  deal.releaseTxHash = result.txHash;
  await c.env.DEALS_KV.put(kvKey, JSON.stringify(deal));
  return c.json({ status: 'RELEASED', dealId, txHash: result.txHash });
});

export default app;
