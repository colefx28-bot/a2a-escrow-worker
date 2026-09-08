import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { randomBytes } from 'crypto';

const WORKER_URL = 'https://a2a-escrow-worker.colefarrar70.workers.dev';

const BASE_USDC_DOMAIN = {
  name: 'USD Coin',
  version: '2',
  chainId: 8453,
  verifyingContract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
};

const EIP3009_TYPE = {
  ReceiveWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' }
  ]
};

async function testValidVerification() {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);

  const from = account.address;
  const to = '0xd0Abea51c0144215412369D558334937A20658d1';
  const value = '1000000'; // 1.000000 USDC
  const validAfter = '0';
  const validBefore = String(Math.floor(Date.now() / 1000) + 3600);
  const nonce = '0x' + randomBytes(32).toString('hex');

  // Sign EIP-712 typed data matching Base Mainnet USDC spec
  const signature = await account.signTypedData({
    domain: BASE_USDC_DOMAIN,
    types: EIP3009_TYPE,
    primaryType: 'ReceiveWithAuthorization',
    message: {
      from,
      to,
      value: BigInt(value),
      validAfter: BigInt(validAfter),
      validBefore: BigInt(validBefore),
      nonce
    }
  });

  const body = { from, to, value, validAfter, validBefore, nonce, signature };

  const res = await fetch(`${WORKER_URL}/verify-escrow`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Idempotency-Key': 'valid-sig-test-' + Date.now()
    },
    body: JSON.stringify(body)
  });

  console.log(`HTTP Status: ${res.status}`);
  console.log(await res.json());
}

testValidVerification().catch(console.error);
