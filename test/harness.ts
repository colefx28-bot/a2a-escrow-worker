import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { createEscrowAuthorization, generateSignedHeaders } from '../src/sdk';

async function runHarness() {
  const PROXY_URL = 'http://localhost:8787';
  const API_KEY = 'agent_key_prod_01';
  const API_SECRET = 'secret_key_123456789_abcdef';

  const buyerAccount = privateKeyToAccount(generatePrivateKey());
  const sellerAccount = privateKeyToAccount(generatePrivateKey());

  console.log(`[+] Buyer Wallet: ${buyerAccount.address}`);
  console.log(`[+] Seller Wallet: ${sellerAccount.address}`);

  const authorization = await createEscrowAuthorization({
    buyerAccount,
    sellerAddress: sellerAccount.address,
    amountUsdc: 2.50,
    isMainnet: false
  });

  const validPayload = {
    expectedSchema: {
      type: 'object',
      properties: { taskStatus: { type: 'string' } },
      required: ['taskStatus']
    },
    payload: { taskStatus: 'COMPLETED' },
    authorization
  };

  const bodyStr = JSON.stringify(validPayload);
  const headers = await generateSignedHeaders(bodyStr, API_KEY, API_SECRET);

  console.log('\n--- TEST 1: Valid Signed Escrow Verification ---');
  const res1 = await fetch(`${PROXY_URL}/v1/escrow/verify`, {
    method: 'POST',
    headers,
    body: bodyStr
  });
  console.log(`Status: ${res1.status}`);
  console.log(await res1.json());

  console.log('\n--- TEST 2: Replay Rejection (Same Idempotency Key) ---');
  const res2 = await fetch(`${PROXY_URL}/v1/escrow/verify`, {
    method: 'POST',
    headers,
    body: bodyStr
  });
  console.log(`Status: ${res2.status}`);
  console.log(await res2.json());
}

runHarness().catch(console.error);
