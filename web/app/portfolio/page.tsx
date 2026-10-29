'use client';

import Link from 'next/link';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { card, primaryBtn, Status, Step } from '@/components/ui';
import { fmt, usd } from '@/lib/format';
import { wcAddress, wcTx } from '@/lib/chains';
import { useActions, useRequests, useUser, useVault } from '@/lib/protocol';
import { useState } from 'react';

export default function PortfolioPage() {
  const { openConnectModal } = useConnectModal();
  const user = useUser();
  const { vault } = useVault();
  const { data: requests } = useRequests();
  const act = useActions();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text?: string; error?: string }>();

  const price = vault?.sharePrice ?? 1_000_000n;
  const agValue = user.agusd !== undefined ? (user.agusd * price) / 1_000_000n : undefined;
  const queued = (requests ?? []).filter((r) => !r.settled).reduce((a, r) => a + r.assets, 0n);
  // Net worth counts what is on its way out: the agUSD is burned at request time and the claim lives in the
  // vault, so leaving it out made the money look like it had gone the moment somebody asked for it.
  const netWorth =
    user.usdc !== undefined && agValue !== undefined ? user.usdc + agValue + queued : undefined;

  async function settle() {
    setBusy(true);
    setStatus({ text: 'Settling the queue' });
    try {
      await act.settle();
      setStatus({ text: 'Settled what the cash covers.' });
    } catch (e) {
      setStatus({ error: e instanceof Error ? e.message : 'Failed' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="px-6 md:px-24 pt-10 md:pt-14 pb-24">
      <div className="max-w-[1400px] mx-auto">
        <h1 className="mt-2 text-[34px] text-fg font-semibold">Portfolio</h1>

        {!user.address ? (
          <div className={`mt-8 text-center ${card}`}>
            <p className="text-[15px] text-fg-muted">Connect your wallet to view your positions.</p>
            <div className="mx-auto mt-4 max-w-[260px]">
              <button type="button" onClick={openConnectModal} className={primaryBtn}>Connect Wallet</button>
            </div>
          </div>
        ) : (
          <>
            <div className={`mt-6 ${card}`}>
              <div className="text-[12px] uppercase tracking-wider text-fg-muted">Net worth</div>
              <div className="text-[34px] text-fg font-semibold tabular-nums">{usd(netWorth)}</div>
              {queued > 0n && <div className="text-[12px] text-fg-muted">Includes {usd(queued)} queued to come out.</div>}
              <a
                href={wcAddress(user.address)}
                target="_blank"
                rel="noreferrer"
                className="mt-1 block text-[12px] text-fg-muted break-all underline-offset-2 hover:text-fg hover:underline"
              >
                {user.address}
              </a>
            </div>

            <div className="mt-4 space-y-3">
              <Position logo="/logos/usdc.svg" symbol="USDC" name="USD Coin (test)" amount={fmt(user.usdc)} href="/faucet" />
              <Position
                logo="/logos/agusd.svg"
                symbol="agUSD"
                name="Agama USD, ERC-4626"
                amount={fmt(user.agusd, 4)}
                sub={agValue !== undefined ? `${usd(agValue)} at today’s price` : undefined}
                href="/"
              />
            </div>

            <div className={`mt-6 ${card}`}>
              <div className="flex items-center justify-between">
                <h2 className="text-[17px] font-semibold text-fg">Queued withdrawals</h2>
                {(requests ?? []).some((r) => !r.settled) && (
                  <button
                    type="button"
                    onClick={settle}
                    disabled={busy}
                    className="rounded-full bg-[#254839] px-4 py-2 text-[13px] font-medium text-[#fdf8ed] hover:bg-[#1F3D31] disabled:opacity-45"
                  >
                    {busy ? <Step text={status?.text} /> : 'Settle the queue'}
                  </button>
                )}
              </div>
              <p className="mt-1 text-[12px] text-fg-muted">
                Priced when you asked, paid first in first out as the book&apos;s collections come home. Anyone can
                settle the queue; the keeper does it on every tick.
              </p>
              {!busy && <Status text={status?.text} error={status?.error} />}
              {requests && requests.length > 0 ? (
                <ul className="mt-4 divide-y divide-[#254839]/10">
                  {requests.map((r) => (
                    <li key={String(r.id)} className="flex items-center justify-between py-3 text-[14px]">
                      <div>
                        <div className="font-medium text-fg tabular-nums">{usd(r.assets)}</div>
                        <a href={wcTx(r.tx)} target="_blank" rel="noreferrer" className="text-[12px] text-fg-muted hover:underline">
                          Request #{String(r.id)} · {fmt(r.shares, 4)} agUSD burned
                        </a>
                      </div>
                      <span
                        className={`rounded-full px-3 py-1 text-[12px] ${
                          r.settled ? 'bg-[#254839]/[0.08] text-fg' : 'bg-[#C97A40]/15 text-[#A85A2C]'
                        }`}
                      >
                        {r.settled ? 'Paid' : 'In the queue'}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-4 text-[14px] text-fg-muted">
                  None. Withdrawals within the buffer are instant and never queue.
                </p>
              )}
            </div>

            {user.usdc === 0n && user.agusd === 0n && (
              <p className="mt-4 rounded-2xl bg-[#fdfaf1] px-5 py-4 text-[14px] text-fg-muted shadow-[0_1px_3px_rgba(20,50,35,0.06)]">
                Nothing here yet. Get test USDC on the{' '}
                <Link href="/faucet" className="underline underline-offset-2">Faucet</Link>, then deposit it on{' '}
                <Link href="/" className="underline underline-offset-2">Earn</Link>.
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function Position({
  logo, symbol, name, amount, sub, href,
}: { logo: string; symbol: string; name: string; amount: string; sub?: string; href: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-4 rounded-2xl bg-[#fdfaf1] px-5 py-4 shadow-[0_1px_3px_rgba(20,50,35,0.06),0_10px_30px_rgba(20,50,35,0.06)] hover:shadow-[0_1px_3px_rgba(20,50,35,0.08),0_16px_40px_rgba(20,50,35,0.12)]"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={logo} alt="" className="h-9 w-9" />
      <div className="min-w-0">
        <div className="text-[15px] font-medium text-fg">{symbol}</div>
        <div className="text-[12px] text-fg-muted">{name}</div>
      </div>
      <div className="ml-auto text-right">
        <div className="text-[17px] font-semibold tabular-nums text-fg">{amount}</div>
        {sub && <div className="text-[12px] text-fg-muted">{sub}</div>}
      </div>
    </Link>
  );
}
