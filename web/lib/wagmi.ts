import { connectorsForWallets } from '@rainbow-me/rainbowkit';
import { injectedWallet, metaMaskWallet, okxWallet, rabbyWallet } from '@rainbow-me/rainbowkit/wallets';
import { createConfig, http } from 'wagmi';
import { whitechainSepolia } from './chains';

// Injected wallets only. WalletConnect's SDK touches indexedDB during SSR, which stalls wagmi's state init under
// Next; Whitechain's own docs note the same with Reown. MetaMask, Rabby and OKX all add a custom EVM chain fine.
//
// Built in the browser only. One of the wallet SDKs opens indexedDB when its connector is created, which throws
// during the server render; there is nothing to connect on the server, so it gets none.
const connectors =
  typeof window === 'undefined'
    ? []
    : connectorsForWallets(
        [{ groupName: 'Recommended', wallets: [metaMaskWallet, rabbyWallet, okxWallet, injectedWallet] }],
        { appName: 'Agama on Whitechain', projectId: 'agama-whitechain' },
      );

export const wagmiConfig = createConfig({
  connectors,
  chains: [whitechainSepolia],
  // Batched, eight calls to an HTTP request, so a page of getLogs is one request rather than eight, and one retry
  // rather than viem's three, so a 429 is not answered with three more requests.
  transports: { [whitechainSepolia.id]: http(undefined, { batch: { batchSize: 8 }, retryCount: 1 }) },
  ssr: true,
});
