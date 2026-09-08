import { createWalletClient, createPublicClient, http, Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import { RelayerRequest } from './types';

interface Env {
  RELAYER_PRIVATE_KEY: `0x${string}`;
  VAULT_ADDRESS: Address;
}

const VAULT_ABI = [
  {
    type: 'function',
    name: 'fundAndSettle',
    inputs: [
      { name: 'dealId', type: 'bytes32' },
      { name: 'payer', type: 'address' },
      { name: 'payee', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
      { name: 'v', type: 'uint8' },
      { name: 'r', type: 'bytes32' },
      { name: 's', type: 'bytes32' }
    ],
    outputs: [],
    stateMutability: 'nonpayable'
  },
  {
    type: 'function',
    name: 'fund',
    inputs: [
      { name: 'dealId', type: 'bytes32' },
      { name: 'payer', type: 'address' },
      { name: 'payee', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'expiry', type: 'uint64' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
      { name: 'v', type: 'uint8' },
      { name: 'r', type: 'bytes32' },
      { name: 's', type: 'bytes32' }
    ],
    outputs: [],
    stateMutability: 'nonpayable'
  },
  {
    type: 'function',
    name: 'release',
    inputs: [{ name: 'dealId', type: 'bytes32' }],
    outputs: [],
    stateMutability: 'nonpayable'
  },
  {
    type: 'function',
    name: 'refund',
    inputs: [{ name: 'dealId', type: 'bytes32' }],
    outputs: [],
    stateMutability: 'nonpayable'
  }
] as const;

export class RelayerQueue implements DurableObject {
  private queue: Promise<Response> = Promise.resolve(new Response());
  private account;
  private walletClient;
  private publicClient;
  private cachedNonce: number | null = null;

  constructor(private state: DurableObjectState, private env: Env) {
    this.account = privateKeyToAccount(env.RELAYER_PRIVATE_KEY);
    this.publicClient = createPublicClient({ chain: base, transport: http('https://mainnet.base.org') });
    this.walletClient = createWalletClient({ account: this.account, chain: base, transport: http('https://mainnet.base.org') });
  }

  async fetch(request: Request): Promise<Response> {
    this.queue = this.queue.then(() => this.handle(request), () => this.handle(request));
    return this.queue;
  }

  private buildArgs(req: RelayerRequest): readonly unknown[] {
    switch (req.fn) {
      case 'fundAndSettle': {
        const p = req.params;
        return [
          p.dealId,
          p.payer,
          p.payee,
          BigInt(p.amount),
          BigInt(p.validAfter),
          BigInt(p.validBefore),
          p.nonce,
          p.v,
          p.r,
          p.s
        ];
      }
      case 'fund': {
        const p = req.params;
        return [
          p.dealId,
          p.payer,
          p.payee,
          BigInt(p.amount),
          BigInt(p.expiry),
          BigInt(p.validAfter),
          BigInt(p.validBefore),
          p.nonce,
          p.v,
          p.r,
          p.s
        ];
      }
      case 'release':
        return [req.params.dealId];
      case 'refund':
        return [req.params.dealId];
    }
  }

  private async handle(request: Request): Promise<Response> {
    const req = (await request.json()) as RelayerRequest;
    const args = this.buildArgs(req);

    if (this.cachedNonce === null) {
      this.cachedNonce = await this.publicClient.getTransactionCount({
        address: this.account.address,
        blockTag: 'pending'
      });
    }
    const nonce = this.cachedNonce;

    try {
      const feeData = await this.publicClient.estimateFeesPerGas();
      const maxFeePerGas = (feeData.maxFeePerGas * 120n) / 100n;
      const maxPriorityFeePerGas = (feeData.maxPriorityFeePerGas * 120n) / 100n;

      const txHash = await this.walletClient.writeContract({
        address: this.env.VAULT_ADDRESS,
        abi: VAULT_ABI,
        functionName: req.fn,
        args: args as any,
        nonce,
        maxFeePerGas,
        maxPriorityFeePerGas
      });

      this.cachedNonce = nonce + 1;

      const receipt = await this.publicClient
        .waitForTransactionReceipt({
          hash: txHash,
          confirmations: 1,
          timeout: 30_000,
          pollingInterval: 1_000
        })
        .catch((err) => {
          if (err.name === 'WaitForTransactionReceiptTimeoutError' || err.message?.includes('timed out')) {
            return null;
          }
          throw err;
        });

      if (receipt === null) {
        return new Response(
          JSON.stringify({ ok: false, txHash, nonce, error: 'CONFIRMATION_TIMEOUT_PENDING_UNKNOWN' }),
          { status: 202 }
        );
      }

      if (receipt.status !== 'success') {
        return new Response(
          JSON.stringify({ ok: false, txHash, error: 'TX_REVERTED_ON_CHAIN' }),
          { status: 200 }
        );
      }

      return new Response(JSON.stringify({ ok: true, txHash, nonce }), { status: 200 });
    } catch (err: any) {
      this.cachedNonce = null;
      return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500 });
    }
  }
}
