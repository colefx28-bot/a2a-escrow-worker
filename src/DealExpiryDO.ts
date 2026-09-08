import { Address } from 'viem';
import { RelayerRequest } from './types';

interface Env {
  DEALS_KV: KVNamespace;
  RELAYER_QUEUE: DurableObjectNamespace;
  VAULT_ADDRESS: Address;
}

export class DealExpiryDO implements DurableObject {
  constructor(private state: DurableObjectState, private env: Env) {}

  async fetch(request: Request): Promise<Response> {
    const { dealId, expiresAt } = (await request.json()) as { dealId: `0x${string}`; expiresAt: number };
    await this.state.storage.put('dealId', dealId);
    await this.state.storage.setAlarm(expiresAt * 1000);
    return new Response(JSON.stringify({ status: 'SCHEDULED', dealId, expiresAt }), { status: 200 });
  }

  async alarm(): Promise<void> {
    const dealId = await this.state.storage.get<`0x${string}`>('dealId');
    if (!dealId) return;

    const kvKey = `deal:${dealId}`;
    const rawData = await this.env.DEALS_KV.get(kvKey);
    if (!rawData) return;

    const deal = JSON.parse(rawData);
    if (deal.status !== 'funded') return;

    const relayerId = this.env.RELAYER_QUEUE.idFromName('primary');
    const relayer = this.env.RELAYER_QUEUE.get(relayerId);

    try {
      const payload: RelayerRequest = {
        fn: 'refund',
        params: { dealId }
      };

      const res = await relayer.fetch('https://relayer.internal/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const result = (await res.json()) as { ok: boolean; txHash?: string; error?: string };

      if (result.ok) {
        deal.status = 'refunded';
        deal.refundTxHash = result.txHash;
        await this.env.DEALS_KV.put(kvKey, JSON.stringify(deal));
      } else {
        if (result.error?.includes('INVALID_DEAL_STATUS') || result.error?.includes('DEAL_NOT_EXPIRED')) {
          return;
        }
        await this.env.DEALS_KV.put(
          `deadletter:${dealId}`,
          JSON.stringify({ dealId, error: result.error, failedAt: new Date().toISOString() })
        );
      }
    } catch (err: any) {
      await this.env.DEALS_KV.put(
        `deadletter:${dealId}`,
        JSON.stringify({ dealId, error: err.message, failedAt: new Date().toISOString() })
      );
    }
  }
}
