export interface Env {
  IDEMPOTENCY_KV: KVNamespace;
  RELAYER_PRIVATE_KEY: string;
  BASE_RPC_URL: string;
  API_SECRET_KEY: string;
  MOCK_MODE?: string;
}

export interface EIP3009Authorization {
  from: `0x${string}`;
  to: `0x${string}`;
  value: string;
  validAfter: number;
  validBefore: number;
  nonce: `0x${string}`;
  v: number;
  r: `0x${string}`;
  s: `0x${string}`;
}

export interface EscrowVerificationPayload {
  expectedSchema: Record<string, any>;
  payload: Record<string, any>;
  authorization: EIP3009Authorization;
  maxLatencyMs?: number;
}
