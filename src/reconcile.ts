import { createPublicClient, http, Address } from 'viem';
import { base } from 'viem/chains';

interface Env {
  DEALS_KV: KVNamespace;
  DEAL_EXPIRY: DurableObjectNamespace;
}

const publicClient = createPublicClient({
  chain: base,
  transport: http('https://mainnet.base.org')
});

const PENDING_DROP_THRESHOLD_SECONDS = 600;
const RETRY_EXPIRY_EXTENSION_SECONDS = 600;

async function rescheduleExpiry(env: Env, dealId: string, newExpiresAt: number): Promise<void> {
  const expiryDoId = env.DEAL_EXPIRY.idFromName(dealId);
  const expiryDo = env.DEAL_EXPIRY.get(expiryDoId);
  await expiryDo.fetch('https://expiry.internal/schedule', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dealId, expiresAt: newExpiresAt })
  });
}

export async function reconcilePendingConfirmations(env: Env): Promise<void> {
  let cursor: string | undefined;

  do {
    const listResult = await env.DEALS_KV.list({ prefix: 'deal:0x', cursor, limit: 1000 });
    cursor = listResult.list_complete ? undefined : listResult.cursor;

    for (const key of listResult.keys) {
      const raw = await env.DEALS_KV.get(key.name);
      if (!raw) continue;

      const deal = JSON.parse(raw);
      if (deal.status !== 'submitted_pending_confirmation') continue;

      const txHash = deal.settlementTxHash ?? deal.fundTxHash;
      if (!txHash) continue;

      const now = Math.floor(Date.now() / 1000);
      const originalExpiresAt = deal.createdAt + deal.expirySeconds;

      try {
        const receipt = await publicClient.getTransactionReceipt({ hash: txHash as `0x${string}` });

        if (receipt.status === 'success') {
          const resolvedToFunded = !!deal.fundTxHash && !deal.settlementTxHash;
          deal.status = resolvedToFunded ? 'funded' : 'released';
          deal.reconciledAt = now;

          let needsRescheduling = false;
          if (resolvedToFunded && now > originalExpiresAt) {
            const newExpiresAt = now + RETRY_EXPIRY_EXTENSION_SECONDS;
            deal.expirySeconds = newExpiresAt - deal.createdAt;
            needsRescheduling = true;
          }

          await env.DEALS_KV.put(key.name, JSON.stringify(deal));

          if (needsRescheduling) {
            try {
              await rescheduleExpiry(env, deal.dealId, deal.createdAt + deal.expirySeconds);
            } catch (rescheduleErr: any) {
              await env.DEALS_KV.put(
                `deadletter:${deal.dealId}`,
                JSON.stringify({
                  dealId: deal.dealId,
                  error: `ALARM_RESCHEDULE_FAILED: ${rescheduleErr.message}`,
                  occurredAt: now
                })
              );
            }
          }
        } else {
          deal.status = 'created';
          deal.lastRevertTxHash = txHash;
          deal.reconciledAt = now;

          let needsRescheduling = false;
          if (deal.mode === 'held' && now > originalExpiresAt) {
            const newExpiresAt = now + RETRY_EXPIRY_EXTENSION_SECONDS;
            deal.expirySeconds = newExpiresAt - deal.createdAt;
            needsRescheduling = true;
          }

          await env.DEALS_KV.put(key.name, JSON.stringify(deal));

          if (needsRescheduling) {
            try {
              await rescheduleExpiry(env, deal.dealId, deal.createdAt + deal.expirySeconds);
            } catch (rescheduleErr: any) {
              await env.DEALS_KV.put(
                `deadletter:${deal.dealId}`,
                JSON.stringify({
                  dealId: deal.dealId,
                  error: `ALARM_RESCHEDULE_FAILED: ${rescheduleErr.message}`,
                  occurredAt: now
                })
              );
            }
          }
        }
      } catch (err: any) {
        const isUnminedTx =
          err.name === 'TransactionReceiptNotFoundError' ||
          err.message?.includes('could not be found') ||
          err.message?.includes('TransactionReceiptNotFoundError');

        if (!isUnminedTx) {
          continue;
        }

        const submittedAt = deal.pendingSince ?? deal.createdAt;
        if (now - submittedAt > PENDING_DROP_THRESHOLD_SECONDS) {
          deal.status = 'created';
          deal.lastDroppedTxHash = txHash;
          deal.reconciledAt = now;

          let needsRescheduling = false;
          if (deal.mode === 'held' && now > originalExpiresAt) {
            const newExpiresAt = now + RETRY_EXPIRY_EXTENSION_SECONDS;
            deal.expirySeconds = newExpiresAt - deal.createdAt;
            needsRescheduling = true;
          }

          await env.DEALS_KV.put(key.name, JSON.stringify(deal));

          if (needsRescheduling) {
            try {
              await rescheduleExpiry(env, deal.dealId, deal.createdAt + deal.expirySeconds);
            } catch (rescheduleErr: any) {
              await env.DEALS_KV.put(
                `deadletter:${deal.dealId}`,
                JSON.stringify({
                  dealId: deal.dealId,
                  error: `ALARM_RESCHEDULE_FAILED: ${rescheduleErr.message}`,
                  occurredAt: now
                })
              );
            }
          }
        }
      }
    }
  } while (cursor);
}
