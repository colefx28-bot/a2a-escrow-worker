import { Hono } from 'hono';
import { verifyTypedData } from 'viem';

type Bindings = {
  IDEMPOTENCY_KV: KVNamespace;
  FEE_RECIPIENT_ADDRESS: string;
};

const app = new Hono<{ Bindings: Bindings }>();

const BASE_USDC_DOMAIN = {
  name: 'USD Coin',
  version: '2',
  chainId: 8453,
  verifyingContract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const
} as const;

const EIP3009_TYPE = {
  ReceiveWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' }
  ]
} as const;

app.get('/health', (c) => {
  return c.json({
    status: 'active',
    protocol: 'Agentic Micro-Escrow (A2A-Escrow)',
    version: '2.0.0-cloudflare-worker',
    mode: 'zero-gas-active-ecosystem',
    targetDailyTx: 5000,
    projectedMonthlyNetUsdc: 2250,
    runtime: 'Cloudflare Workers (V8 Isolate)',
    organization: 'Low Level Logic Labs LLC'
  });
});

app.get('/.well-known/agent.json', (c) => {
  return c.json({
    schema_version: 'v1.0',
    name: 'A2A Micro-Escrow Oracle',
    description: 'Zero-latency micro-escrow signature verification & settlement protocol for AI agents on Base L2.',
    url: 'https://a2a-escrow-worker.colefarrar70.workers.dev',
    endpoints: {
      health: '/health',
      verifyEscrow: '/verify-escrow'
    },
    protocol_fee_bps: 100,
    supported_assets: [
      {
        symbol: 'USDC',
        chain: 'Base Mainnet',
        chainId: 8453,
        address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
      }
    ]
  });
});

app.post('/verify-escrow', async (c) => {
  const idempotencyKey = c.req.header('X-Idempotency-Key');
  if (!idempotencyKey) {
    return c.json({ error: 'Missing X-Idempotency-Key header' }, 400);
  }

  const existing = await c.env.IDEMPOTENCY_KV.get(idempotencyKey);
  if (existing) {
    return c.json({ error: 'Duplicate transaction detected.' }, 409);
  }

  const body = await c.req.json();
  const { from, to, value, validAfter, validBefore, nonce, signature } = body;

  try {
    const isValid = await verifyTypedData({
      address: from,
      domain: BASE_USDC_DOMAIN,
      types: EIP3009_TYPE,
      primaryType: 'ReceiveWithAuthorization',
      message: {
        from,
        to,
        value: BigInt(value || '0'),
        validAfter: BigInt(validAfter || '0'),
        validBefore: BigInt(validBefore || '0'),
        nonce
      },
      signature
    });

    if (!isValid) {
      return c.json({ error: 'Invalid EIP-3009 transfer authorization signature' }, 401);
    }

    const totalVal = BigInt(value || '0');
    const feeVal = (totalVal * BigInt(100)) / BigInt(10000);
    const sellerPayoutVal = totalVal - feeVal;

    const receipt = {
      status: 'VERIFIED_READY_FOR_SETTLEMENT',
      idempotencyKey,
      feeRecipient: c.env.FEE_RECIPIENT_ADDRESS || 'UNSET',
      grossValueUsdc: (Number(totalVal) / 1e6).toFixed(6),
      protocolFeeUsdc: (Number(feeVal) / 1e6).toFixed(6),
      sellerPayoutUsdc: (Number(sellerPayoutVal) / 1e6).toFixed(6),
      instructions: 'Recipient agent submits payload to Base USDC contract on-chain.',
      payload: { from, to, value, validAfter, validBefore, nonce, signature }
    };

    await c.env.IDEMPOTENCY_KV.put(idempotencyKey, JSON.stringify(receipt), { expirationTtl: 86400 });
    return c.json(receipt);
  } catch (err: any) {
    return c.json({ error: 'Verification failed', details: err.message }, 500);
  }
});

export default app;
