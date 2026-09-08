import { Hono } from 'hono';
import { createWalletClient, http, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';

type Bindings = {
  IDEMPOTENCY_KV: KVNamespace;
  API_SECRET_KEY: string;
  RELAYER_PRIVATE_KEY: string;
};

const app = new Hono<{ Bindings: Bindings }>();

const EIP3009_ABI = parseAbi([
  'function receiveWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s) external'
]);

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
  const idempotencyKey = c.req.header('X-Idempotency-Key');
  if (!idempotencyKey) {
    return c.json({ error: 'Missing X-Idempotency-Key header' }, 400);
  }

  const existing = await c.env.IDEMPOTENCY_KV.get(idempotencyKey);
  if (existing) {
    return c.json({ error: 'Duplicate request detected.' }, 409);
  }

  const body = await c.req.json();
  const { from, to, value, validAfter, validBefore, nonce, v, r, s, usdcAddress } = body;

  await c.env.IDEMPOTENCY_KV.put(idempotencyKey, 'PENDING', { expirationTtl: 86400 });

  try {
    if (c.env.RELAYER_PRIVATE_KEY && c.env.RELAYER_PRIVATE_KEY.startsWith('0x')) {
      const account = privateKeyToAccount(c.env.RELAYER_PRIVATE_KEY as `0x${string}`);
      const client = createWalletClient({
        account,
        chain: base,
        transport: http()
      });

      const hash = await client.writeContract({
        address: usdcAddress,
        abi: EIP3009_ABI,
        functionName: 'receiveWithAuthorization',
        args: [from, to, BigInt(value), BigInt(validAfter), BigInt(validBefore), nonce, v, r, s]
      });

      await c.env.IDEMPOTENCY_KV.put(idempotencyKey, JSON.stringify({ status: 'SETTLED', txHash: hash }), { expirationTtl: 86400 });
      return c.json({ status: 'SETTLED', txHash: hash, idempotencyKey });
    }

    await c.env.IDEMPOTENCY_KV.put(idempotencyKey, 'SETTLED_SIMULATED', { expirationTtl: 86400 });
    return c.json({ status: 'SETTLED_SIMULATED', idempotencyKey });
  } catch (err: any) {
    await c.env.IDEMPOTENCY_KV.delete(idempotencyKey);
    return c.json({ error: 'On-chain settlement failed', details: err.message }, 500);
  }
});

export default app;
