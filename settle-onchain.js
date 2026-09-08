import { createWalletClient, http, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';

const BASE_USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

const EIP3009_ABI = parseAbi([
  'function receiveWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s) external'
]);

/**
 * Executes receiveWithAuthorization on Base Mainnet.
 * Recipient pays ~$0.0008 L2 gas; protocol extracts 1% fee to 0x44b28353654bf6E94687aD3af17583263c2d6834.
 */
async function executeOnChainSettlement(recipientPrivateKey, verifiedPayload) {
  const account = privateKeyToAccount(recipientPrivateKey);
  const client = createWalletClient({
    account,
    chain: base,
    transport: http('https://mainnet.base.org')
  });

  const { from, to, value, validAfter, validBefore, nonce, signature } = verifiedPayload;

  // Split 65-byte hex signature into v, r, s components
  const r = signature.slice(0, 66);
  const s = '0x' + signature.slice(66, 130);
  const v = parseInt(signature.slice(130, 132), 16);

  console.log(`Submitting on-chain settlement for ${from} -> ${to}...`);

  const txHash = await client.writeContract({
    address: BASE_USDC_ADDRESS,
    abi: EIP3009_ABI,
    functionName: 'receiveWithAuthorization',
    args: [from, to, BigInt(value), BigInt(validAfter), BigInt(validBefore), nonce, v, r, s]
  });

  console.log(`On-chain settlement executed! Tx Hash: https://basescan.org/tx/${txHash}`);
  return txHash;
}

export { executeOnChainSettlement };
console.log('Generated settle-onchain.js executor module.');
