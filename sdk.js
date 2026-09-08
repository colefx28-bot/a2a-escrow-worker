import { verifyTypedData } from 'viem';

export class A2AEscrowClient {
  constructor(workerUrl = 'https://a2a-escrow-worker.colefarrar70.workers.dev') {
    this.workerUrl = workerUrl;
  }

  async verifyEscrow(payload, idempotencyKey) {
    const res = await fetch(`${this.workerUrl}/verify-escrow`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Idempotency-Key': idempotencyKey || `a2a-${Date.now()}-${Math.random().toString(36).substring(7)}`
      },
      body: JSON.stringify(payload)
    });
    return await res.json();
  }
}
