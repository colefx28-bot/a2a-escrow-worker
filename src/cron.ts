import { createPublicClient, http, parseAbi, Address } from 'viem';
import { base } from 'viem/chains';
import { RelayerRequest } from './types';

interface Env {
  DEALS_KV: KVNamespace;
  RELAYER_QUEUE: DurableObjectNamespace;
  VAULT_ADDRESS: Address;
}

const VAULT_ABI = parseAbi([
  'function deals(bytes32 dealId) external view returns (address payer, address payee, uint256 amount, uint64 expiry, uint8 status)'
]);

const publicClient = createPublicClient({
  chain: base,
  transport: http('https://mainnet.base.org')
});

export async function handleCronSweep(env: Env): Promise<void> {
  let cursor: string | undefined = undefined;
  const now = Math.floor(Date.now() / 1000);
  const relayerId = env.RELAYER_QUEUE.idFromName('primary');
  const relayer = env.RELAYER_QUEUE.get(relayerId);

  do {
    const listResult = await env.DEALS_KV.list({ prefix: 'deal:0x', cursor, limit: 1000 });
    cursor = listResult.list_complete ? undefined : listResult.cursor;

    for (const key of listResult.keys) {
      const rawData = await env.DEALS_KV.get(key.name);
      if (!rawData) continue;

      const deal = JSON.parse(rawData);

      if (deal.mode === 'held' && deal.status === 'funded') {
        const expiresAt = deal.createdAt + deal.expirySeconds;

        if (now > expiresAt) {
          try {
            const onChainDeal = await publicClient.readContract({
              address: env.VAULT_ADDRESS,
              abi: VAULT_ABI,
              functionName: 'deals',
              args: [deal.dealId as `0x${string}`]
            });

            if (onChainDeal[4] === 0) {
              const payload: RelayerRequest = {
                fn: 'refund',
                params: { dealId: deal.dealId as `0x${string}` }
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
                await env.DEALS_KV.put(key.name, JSON.stringify(deal));
              } else if (!result.error?.includes('INVALID_DEAL_STATUS')) {
                await env.DEALS_KV.put(
                  `deadletter:${deal.dealId}`,
                  JSON.stringify({ dealId: deal.dealId, error: result.error, loggedBy: 'CRON_RECONCILIATION' })
                );
              }
            }
          } catch (err: any) {
            await env.DEALS_KV.put(
              `deadletter:${deal.dealId}`,
              JSON.stringify({ dealId: deal.dealId, error: err.message, loggedBy: 'CRON_RECONCILIATION' })
            );
          }
        }
      }
    }
  } while (cursor);
}
