import { createPublicClient, http, parseAbi, formatUnits } from 'viem';
import { base } from 'viem/chains';

const FEE_WALLET = '0x44b28353654bf6E94687aD3af17583263c2d6834';
const BASE_USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

const ERC20_ABI = parseAbi([
  'function balanceOf(address account) external view returns (uint256)'
]);

async function checkRevenue() {
  const client = createPublicClient({
    chain: base,
    transport: http('https://mainnet.base.org')
  });

  const rawBalance = await client.readContract({
    address: BASE_USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [FEE_WALLET]
  });

  const usdcBalance = formatUnits(rawBalance, 6);

  console.log('====================================================');
  console.log('   LOW LEVEL LOGIC LABS LLC - REVENUE MONITOR       ');
  console.log('====================================================');
  console.log(`Fee Recipient Wallet : ${FEE_WALLET}`);
  console.log(`Network               : Base Mainnet (Chain ID 8453)`);
  console.log(`Current USDC Balance : $${usdcBalance} USDC`);
  console.log(`BaseScan Explorer     : https://basescan.org/address/${FEE_WALLET}#tokentxns`);
  console.log('====================================================');
}

checkRevenue().catch(console.error);
