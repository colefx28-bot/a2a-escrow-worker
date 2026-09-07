import 'dotenv/config';
import { serve } from '@hono/node-server';
import app from './index';

const memoryKV = new Map<string, string>();
const mockKV = {
  get: async (key: string) => memoryKV.get(key) || null,
  put: async (key: string, val: string) => { memoryKV.set(key, val); }
};

const PORT = 8787;
console.log(`[+] Termux Proxy Server running on http://localhost:${PORT}`);

serve({
  fetch: (req) => {
    return app.fetch(req, {
      IDEMPOTENCY_KV: mockKV as any,
      API_SECRET_KEY: process.env.API_SECRET_KEY || 'secret_key_123456789_abcdef',
      MOCK_MODE: process.env.MOCK_MODE || 'true',
      RELAYER_PRIVATE_KEY: process.env.RELAYER_PRIVATE_KEY || '',
      BASE_RPC_URL: 'https://sepolia.base.org'
    });
  },
  port: PORT
});
