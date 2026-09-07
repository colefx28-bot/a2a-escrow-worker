import { PrivateKeyAccount, parseSignature } from 'viem';

export interface CreateAuthorizationParams {
  buyerAccount: PrivateKeyAccount;
  sellerAddress: `0x${string}`;
  amountUsdc: number;
  validDurationSeconds?: number;
  isMainnet?: boolean;
}

export async function createEscrowAuthorization({
  buyerAccount,
  sellerAddress,
  amountUsdc,
  validDurationSeconds = 3600,
  isMainnet = false
}: CreateAuthorizationParams) {
  const usdcAddress = isMainnet
    ? '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
    : '0x036CbD53842c5426634e7929541eC2318f3dCF7e';

  const chainId = isMainnet ? 8453 : 84532;
  const value = BigInt(Math.round(amountUsdc * 1_000_000));
  const validAfter = 0;
  const validBefore = Math.floor(Date.now() / 1000) + validDurationSeconds;
  
  const nonceBytes = crypto.getRandomValues(new Uint8Array(32));
  const nonce = `0x${Array.from(nonceBytes).map(b => b.toString(16).padStart(2, '0')).join('')}` as `0x${string}`;

  const domain = {
    name: 'USD Coin',
    version: '2',
    chainId,
    verifyingContract: usdcAddress as `0x${string}`
  } as const;

  const types = {
    TransferWithAuthorization: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' }
    ]
  } as const;

  const signatureHex = await buyerAccount.signTypedData({
    domain,
    types,
    primaryType: 'TransferWithAuthorization',
    message: {
      from: buyerAccount.address,
      to: sellerAddress,
      value,
      validAfter: BigInt(validAfter),
      validBefore: BigInt(validBefore),
      nonce
    }
  });

  const parsedSig = parseSignature(signatureHex);

  return {
    from: buyerAccount.address,
    to: sellerAddress,
    value: value.toString(),
    validAfter,
    validBefore,
    nonce,
    v: Number(parsedSig.v ?? (parsedSig.yParity === 0 ? 27 : 28)),
    r: parsedSig.r,
    s: parsedSig.s
  };
}

export async function generateSignedHeaders(
  bodyString: string,
  apiKey: string,
  apiSecretKey: string
) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const idempotencyKey = crypto.randomUUID();
  const message = `${timestamp}.${idempotencyKey}.${bodyString}`;

  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(apiSecretKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const sigBuffer = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
  const signatureHex = Array.from(new Uint8Array(sigBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  return {
    'Content-Type': 'application/json',
    'X-Agent-API-Key': apiKey,
    'X-Timestamp': timestamp,
    'X-Signature': signatureHex,
    'X-Idempotency-Key': idempotencyKey
  };
}
