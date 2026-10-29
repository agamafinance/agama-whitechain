'use client';

import { useEffect, useState } from 'react';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { useBalance } from 'wagmi';
import { card, primaryBtn, Status, Step } from '@/components/ui';
import { fmt } from '@/lib/format';
import { WBT_FAUCET, whitechainSepolia, wcAddress } from '@/lib/chains';
import { WHITECHAIN } from '@/lib/deployments';
import { useActions, useUser } from '@/lib/protocol';
import { asset } from '@/lib/asset';

const COOLDOWN = 3600;

export default function FaucetPage() {
  const { openConnectModal } = useConnectModal();
  const user = useUser();
  const wbt = useBalance({ address: user.address, chainId: whitechainSepolia.id, query: { enabled: !!user.address } });
  const act = useActions();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text?: string; error?: string }>();
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  const last = user.lastDrip !== undefined ? Number(user.lastDrip) : 0;
  const wait = last ? Math.max(0, last + COOLDOWN - now) : 0;
  const noGas = wbt.data !== undefined && wbt.data.value === 0n;

  async function drip() {
    setBusy(true);
    setStatus({ text: 'Minting 10,000 USDC' });
    try {
      await act.faucet();
      setStatus({ text: 'Done. 10,000 test USDC is in your wallet.' });
    } catch (e) {
      setStatus({ error: e instanceof Error ? (e as { shortMessage?: string }).shortMessage ?? e.message : 'Failed' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="px-6 md:px-24 pt-10 md:pt-14 pb-24">
      <div className="max-w-[1400px] mx-auto">
        <h1 className="mt-2 text-[34px] text-fg font-semibold">Faucet</h1>
        <p className="mt-2 max-w-[640px] text-[15px] text-fg-muted">
          Two things to try the vault: WBT, Whitechain&apos;s gas token, and test USDC. Whitechain has no native USDC
          yet, only USDC.e through WhiteBIT&apos;s Portal, so this test dollar stands in for it and burns and mints
          across to Ethereum the way CCTP moves USDC.
        </p>

        <div className="mt-6 grid gap-5 md:grid-cols-2">
          <div className={card}>
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={asset('/logos/wbt.svg')} alt="" className="h-9 w-9" />
              <div>
                <div className="text-[17px] font-semibold text-fg">WBT for gas</div>
                <div className="text-[12px] text-fg-muted">0.5 WBT a day, sign in with GitHub</div>
              </div>
            </div>
            <div className="mt-4 text-[13px] text-fg-muted">
              Your balance <span className="text-fg tabular-nums">{wbt.data ? Number(wbt.data.formatted).toFixed(4) : '-'} WBT</span>.
              A deposit costs a fraction of a cent: one second blocks, a 5 gwei floor, and the L1 data fee posted to
              Ethereum as blobs.
            </div>
            <a href={WBT_FAUCET} target="_blank" rel="noreferrer" className={`mt-4 block text-center ${primaryBtn}`}>
              Open the Whitechain faucet
            </a>
          </div>

          <div className={card}>
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={asset('/logos/usdc.svg')} alt="" className="h-9 w-9" />
              <div>
                <div className="text-[17px] font-semibold text-fg">Test USDC</div>
                <div className="text-[12px] text-fg-muted">10,000 an hour, straight from the contract</div>
              </div>
            </div>
            <div className="mt-4 text-[13px] text-fg-muted">
              Your balance <span className="text-fg tabular-nums">{fmt(user.usdc)} USDC</span>.{' '}
              <a href={wcAddress(WHITECHAIN.usdc)} target="_blank" rel="noreferrer" className="underline hover:text-fg">
                The token on the explorer
              </a>
              .
            </div>
            <button
              type="button"
              onClick={user.address ? drip : openConnectModal}
              disabled={busy || (!!user.address && (wait > 0 || noGas))}
              className={`mt-4 ${primaryBtn}`}
            >
              {busy ? (
                <Step text={status?.text} />
              ) : !user.address ? (
                'Connect Wallet'
              ) : noGas ? (
                'Get WBT first, for gas'
              ) : wait > 0 ? (
                `Again in ${Math.ceil(wait / 60)} min`
              ) : (
                'Get 10,000 USDC'
              )}
            </button>
            {!busy && <Status text={status?.text} error={status?.error} />}
          </div>
        </div>
      </div>
    </section>
  );
}
