import { createWalletClient, createPublicClient, http, parseAbi } from 'viem';
import { baseSepolia, base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { EIP3009Authorization, Env } from '../types';

const USDC_ABI = parseAbi([
  'function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s) external'
]);

const USDC_BASE_SEPOLIA = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';

export async function submitEIP3009Relay(
  auth: EIP3009Authorization,
  env: Env,
  isMainnet = false
): Promise<string> {
  if (env.MOCK_MODE === 'true') {
    return `0x_MOCK_TX_${crypto.randomUUID().replace(/-/g, '')}`;
  }

  if (!env.RELAYER_PRIVATE_KEY || !env.RELAYER_PRIVATE_KEY.startsWith('0x')) {
    throw new Error('RELAYER_PRIVATE_KEY not bound or invalid — refusing to process live settlement');
  }

  const account = privateKeyToAccount(env.RELAYER_PRIVATE_KEY as `0x${string}`);
  const targetChain = isMainnet ? base : baseSepolia;
  const transport = http(env.BASE_RPC_URL || 'https://sepolia.base.org');

  const walletClient = createWalletClient({ account, chain: targetChain, transport });

  const txHash = await walletClient.writeContract({
    address: isMainnet ? '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' : USDC_BASE_SEPOLIA,
    abi: USDC_ABI,
    functionName: 'transferWithAuthorization',
    args: [
      auth.from,
      auth.to,
      BigInt(auth.value),
      BigInt(auth.validAfter),
      BigInt(auth.validBefore),
      auth.nonce,
      auth.v,
      auth.r,
      auth.s
    ]
  });

  return txHash;
}
