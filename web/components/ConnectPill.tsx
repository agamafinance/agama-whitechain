'use client';

import { ConnectButton } from '@rainbow-me/rainbowkit';
import { short } from '@/lib/format';

const pill =
  'pill-outline flex h-10 items-center gap-2 rounded-full px-[14px] sm:px-[17px] text-[14px] font-medium whitespace-nowrap text-white';

/// RainbowKit's state machine in the app's own pill. A wallet on another chain is offered the switch rather than a
/// red badge, because the only thing it can do here is be on Whitechain.
export function ConnectPill() {
  return (
    <ConnectButton.Custom>
      {({ account, chain, mounted, openAccountModal, openChainModal, openConnectModal }) => {
        if (!mounted) return <span className={`${pill} opacity-0`} aria-hidden>Connect</span>;
        if (!account) {
          return (
            <button type="button" onClick={openConnectModal} className={pill}>
              <span>Connect<span className="hidden sm:inline"> Wallet</span></span>
            </button>
          );
        }
        if (chain?.unsupported) {
          return (
            <button type="button" onClick={openChainModal} className={`${pill} !bg-[#b4571f]/80`}>
              <span>Switch<span className="hidden sm:inline"> to Whitechain</span></span>
            </button>
          );
        }
        return (
          <button type="button" onClick={openAccountModal} className={pill}>
            <span className="h-2 w-2 rounded-full bg-[#70B19E]" aria-hidden />
            {account.ensName ?? short(account.address)}
          </button>
        );
      }}
    </ConnectButton.Custom>
  );
}
