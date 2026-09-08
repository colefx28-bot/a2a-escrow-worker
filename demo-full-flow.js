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

async function runFullSimulation() {
  console.log('=== A2A MICRO-ESCROW END-TO-END DEMO ===\n');

  // Step 1: Buyer Agent signs EIP-3009 authorization
  const buyerPrivateKey = generatePrivateKey();
  const buyerAccount = privateKeyToAccount(buyerPrivateKey);
  const sellerAddress = '0xd0Abea51c0144215412369D558334937A20658d1';
  const amountUsdc = '1.00';
  const value = '1000000'; // 6 decimals
  const validAfter = '0';
  const validBefore = String(Math.floor(Date.now() / 1000) + 3600);
  const nonce = '0x' + randomBytes(32).toString('hex');

  console.log(`1. Buyer Agent (${buyerAccount.address}) signing $${amountUsdc} USDC escrow for Seller (${sellerAddress})...`);

  const signature = await buyerAccount.signTypedData({
    domain: BASE_USDC_DOMAIN,
    types: EIP3009_TYPE,
    primaryType: 'ReceiveWithAuthorization',
    message: {
      from: buyerAccount.address,
      to: sellerAddress,
      value: BigInt(value),
      validAfter: BigInt(validAfter),
      validBefore: BigInt(validBefore),
      nonce
    }
  });

  // Step 2: Send payload to Worker Oracle
  console.log('2. Transmitting EIP-712 payload to Cloudflare Worker Oracle...');
  const idempotencyKey = `demo-flow-${Date.now()}`;
  
  const response = await fetch(`${WORKER_URL}/verify-escrow`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Idempotency-Key': idempotencyKey
    },
    body: JSON.stringify({
      from: buyerAccount.address,
      to: sellerAddress,
      value,
      validAfter,
      validBefore,
      nonce,
      signature
    })
  });

  const receipt = await response.json();
  console.log('\n=== VERIFICATION RECEIPT RETURNED TO AGENT ===');
  console.log(receipt);

  console.log('\n3. Execution Summary:');
  console.log(`   - Status           : ${receipt.status}`);
  console.log(`   - Gross Value      : $${receipt.grossValueUsdc} USDC`);
  console.log(`   - Protocol Fee 1%  : $${receipt.protocolFeeUsdc} USDC -> Wallet ${receipt.feeRecipient}`);
  console.log(`   - Net Seller Payout: $${receipt.sellerPayoutUsdc} USDC`);
}

runFullSimulation().catch(console.error);
