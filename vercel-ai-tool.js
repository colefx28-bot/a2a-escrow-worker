import { tool } from 'ai';
import { z } from 'zod';

export const a2aEscrowTool = tool({
  description: 'Verifies zero-latency micro-escrow EIP-3009 signatures on Base L2.',
  parameters: z.object({
    from: z.string().describe('Buyer agent EVM address'),
    to: z.string().describe('Seller agent EVM address'),
    value: z.string().describe('Amount in USDC raw atomic units'),
    validAfter: z.string().describe('Unix timestamp start'),
    validBefore: z.string().describe('Unix timestamp expiration'),
    nonce: z.string().describe('32-byte hex nonce'),
    signature: z.string().describe('65-byte EIP-712 signature')
  }),
  execute: async (payload) => {
    const res = await fetch('https://a2a-escrow-worker.colefarrar70.workers.dev/verify-escrow', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Idempotency-Key': `vercel-ai-${Date.now()}`
      },
      body: JSON.stringify(payload)
    });
    return await res.json();
  }
});
