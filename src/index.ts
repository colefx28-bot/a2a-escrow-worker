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

app.post('/verify-escrow', async (c) => {
  const idempotencyKey = c.req.header('X-Idempotency-Key');
  if (!idempotencyKey) return c.json({ error: 'Missing X-Idempotency-Key header' }, 400);

  const existing = await c.env.IDEMPOTENCY_KV.get(idempotencyKey);
  if (existing) return c.json({ error: 'Duplicate transaction detected.' }, 409);

  const body = await c.req.json();
  const { from, to, value, validAfter, validBefore, nonce, signature } = body;

  try {
    const isValid = await verifyTypedData({
      address: from,
      domain: BASE_USDC_DOMAIN,
      types: EIP3009_TYPE,
      primaryType: 'ReceiveWithAuthorization',
      message: { from, to, value: BigInt(value || '0'), validAfter: BigInt(validAfter || '0'), validBefore: BigInt(validBefore || '0'), nonce },
      signature
    });

    if (!isValid) return c.json({ error: 'Invalid EIP-3009 signature' }, 401);

    const totalVal = BigInt(value || '0');
    
    // Dynamic Fee: 2.5% (250 BPS) under $10 USDC (10,000,000 atomic units), 1.0% (100 BPS) for $10+
    const feeBps = totalVal < BigInt(10000000) ? BigInt(250) : BigInt(100);
    const feeVal = (totalVal * feeBps) / BigInt(10000);
    const sellerPayoutVal = totalVal - feeVal;

    const receipt = {
      status: 'OPTIMISTIC_CLEARING_VOUCHER_ISSUED',
      voucherId: `VOUCHER-A2A-${Date.now()}-${nonce.slice(2, 10)}`,
      appliedFeePercent: feeBps === BigInt(250) ? '2.5%' : '1.0%',
      feeRecipient: c.env.FEE_RECIPIENT_ADDRESS,
      grossValueUsdc: (Number(totalVal) / 1e6).toFixed(6),
      protocolFeeUsdc: (Number(feeVal) / 1e6).toFixed(6),
      sellerPayoutUsdc: (Number(sellerPayoutVal) / 1e6).toFixed(6),
      payload: { from, to, value, validAfter, validBefore, nonce, signature }
    };

    await c.env.IDEMPOTENCY_KV.put(idempotencyKey, JSON.stringify(receipt), { expirationTtl: 86400 });
    return c.json(receipt);
  } catch (err: any) {
    return c.json({ error: 'Verification failed', details: err.message }, 500);
  }
});

export default app;
