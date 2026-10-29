'use client';

import { RainbowKitProvider, lightTheme } from '@rainbow-me/rainbowkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactNode, useState } from 'react';
import { WagmiProvider } from 'wagmi';
import { wagmiConfig } from '@/lib/wagmi';
import { whitechainSepolia } from '@/lib/chains';

import '@rainbow-me/rainbowkit/styles.css';

export function Providers({ children }: { children: ReactNode }) {
  // networkMode 'always': navigator.onLine is a guess about a network adapter, not about whether an RPC answers,
  // and a query react-query pauses on that guess is a page frozen on its loading line.
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { networkMode: 'always', staleTime: 4_000 } } }),
  );
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={lightTheme({
            accentColor: '#254839',
            accentColorForeground: '#fdf8ed',
            borderRadius: 'medium',
            fontStack: 'system',
            overlayBlur: 'small',
          })}
          initialChain={whitechainSepolia}
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
