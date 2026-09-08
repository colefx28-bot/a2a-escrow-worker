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
    version: '3.1.0-god-mode',
    mode: 'zero-latency-optimistic-oracle',
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
    openapi_spec: 'https://a2a-escrow-worker.colefarrar70.workers.dev/openapi.json',
    endpoints: {
      health: '/health',
      openapi: '/openapi.json',
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

app.get('/openapi.json', (c) => {
  return c.json({
    openapi: '3.0.0',
    info: {
      title: 'A2A Micro-Escrow Protocol API',
      version: '3.1.0',
      description: 'Zero-latency off-chain EIP-712 micro-escrow verification oracle for autonomous AI agents on Base L2.'
    },
    servers: [{ url: 'https://a2a-escrow-worker.colefarrar70.workers.dev' }],
    paths: {
      '/verify-escrow': {
        post: {
          summary: 'Verify EIP-3009 Transfer Authorization and Issue Clearing Voucher',
          headers: {
            'X-Idempotency-Key': { required: true, schema: { type: 'string' } }
          },
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    from: { type: 'string', example: '0x4738463AFc32Cb7f74F0fcEd6B6819fa13387659' },
                    to: { type: 'string', example: '0xd0Abea51c0144215412369D558334937A20658d1' },
                    value: { type: 'string', example: '1000000' },
                    validAfter: { type: 'string', example: '0' },
                    validBefore: { type: 'string', example: '1893456000' },
                    nonce: { type: 'string', example: '0xbc593d0680f5c63a5e5856965f39b3e61bb5d' },
                    signature: { type: 'string', example: '0xfc2a865c7488d1d58c3ba1c356f708e68c' }
                  },
                  required: ['from', 'to', 'value', 'nonce', 'signature']
                }
              }
            }
          },
          responses: {
            '200': { description: 'Verified Ready for Settlement' },
            '401': { description: 'Invalid EIP-712 Signature' },
            '409': { description: 'Duplicate Idempotency Key' }
          }
        }
      }
    }
  });
});

app.post('/verify-escrow', async (c) => {
  const idempotencyKey = c.req.header('X-Idempotency-Key');
  if (!idempotencyKey) {
    return c.json({ error: 'Missing X-Idempotency-Key header' }, 400);
  }

  const existing = await c.env.IDEMPOTENCY_KV.get(idempotencyKey);
  if (existing) {
    return c.json({ error: 'Duplicate transaction / replay attempt detected.' }, 409);
  }

  const body = await c.req.json();
  const { from, to, value, validAfter, validBefore, nonce, signature } = body;

  const currentTime = Math.floor(Date.now() / 1000);
  const maxAllowedExpiration = currentTime + 86400;
  if (BigInt(validBefore || '0') > BigInt(maxAllowedExpiration)) {
    return c.json({ error: 'Security Violation: Authorization expiration window exceeds 24h limit.' }, 422);
  }

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
    const voucherId = `VOUCHER-A2A-${Date.now()}-${nonce.slice(2, 10)}`;

    const receipt = {
      status: 'OPTIMISTIC_CLEARING_VOUCHER_ISSUED',
      voucherId,
      idempotencyKey,
      clearingMode: 'SUB_10MS_INSTANT_AGREEMENT',
      securityCheck: 'PASSED_FIREWALL_FILTER',
      feeRecipient: c.env.FEE_RECIPIENT_ADDRESS || 'UNSET',
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
