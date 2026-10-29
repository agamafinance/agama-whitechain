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
  transports: { [whitechainSepolia.id]: http() },
  ssr: true,
});
