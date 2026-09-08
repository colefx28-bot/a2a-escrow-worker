import { Hono } from 'hono';
import x402App from './x402';
import { handleCronSweep } from './cron';
import { reconcilePendingConfirmations } from './reconcile';

export { IdempotencyDO } from './IdempotencyDO';
export { RelayerQueue } from './RelayerQueue';
export { DealExpiryDO } from './DealExpiryDO';

const app = new Hono();

app.route('/', x402App);

app.get('/health', (c) => {
  return c.json({
    status: 'active',
    protocol: 'A2A Escrow Monopoly Engine',
    version: '6.4.0-godmode-ssot-first',
    runtime: 'Cloudflare Workers (V8 Isolate)',
    organization: 'Low Level Logic Labs LLC'
  });
});

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: any, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(Promise.all([
      handleCronSweep(env),
      reconcilePendingConfirmations(env)
    ]));
  }
};
