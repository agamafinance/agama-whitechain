import { createPublicClient, defineChain, fallback, http } from 'viem';
import { sepolia } from 'viem/chains';
import { chainConfig } from 'viem/op-stack';

/// Whitechain Sepolia, the OP Stack testnet Whitechain moved to on 26 October 2026. Declared here rather than
/// taken from viem, whose pinned version predates it; the values are the ones in Whitechain's network reference.
export const whitechainSepolia = defineChain({
  ...chainConfig,
  id: 1874,
  name: 'Whitechain Sepolia',
  nativeCurrency: { name: 'WBT', symbol: 'WBT', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.testnet.whitechain.io'], webSocket: ['wss://rpc.testnet.whitechain.io/ws'] } },
  blockExplorers: { default: { name: 'Whitechain Testnet Explorer', url: 'https://explorer.testnet.whitechain.io' } },
  contracts: { ...chainConfig.contracts, multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' } },
  sourceId: 11_155_111,
  testnet: true,
});

export { sepolia };

export const WC_EXPLORER = 'https://explorer.testnet.whitechain.io';
export const ETH_EXPLORER = 'https://sepolia.etherscan.io';
export const WBT_FAUCET = 'https://faucet.testnet.whitechain.io';

export const wcAddress = (a: string) => `${WC_EXPLORER}/address/${a}`;
export const wcTx = (h: string) => `${WC_EXPLORER}/tx/${h}`;
export const ethAddress = (a: string) => `${ETH_EXPLORER}/address/${a}`;
export const ethTx = (h: string) => `${ETH_EXPLORER}/tx/${h}`;

/// Ethereum is only ever read: nobody signs on the L1 from this app, the keeper does. Two public endpoints,
/// because a single free one going quiet would blank half the transparency page.
export const l1 = createPublicClient({
  chain: sepolia,
  // Batched, so a multicall and a page of getLogs go out as one request each, and three endpoints deep so a
  // rate limit on one is a slower answer rather than an empty page.
  batch: { multicall: true },
  transport: fallback([
    http('https://sepolia.rpc.thirdweb.com', { batch: true }),
    http('https://eth-sepolia.api.onfinality.io/public', { batch: true }),
    http('https://ethereum-sepolia-rpc.publicnode.com', { batch: true }),
  ]),
});
