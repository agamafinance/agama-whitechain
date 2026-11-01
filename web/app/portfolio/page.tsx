'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { card, primaryBtn } from '@/components/ui';
import { fmt, usd } from '@/lib/format';
import { wcAddress, wcTx } from '@/lib/chains';
import { useActions, useRequests, useUser, useVault } from '@/lib/protocol';
import { asset } from '@/lib/asset';

export default function PortfolioPage() {
  const { openConnectModal } = useConnectModal();
  const user = useUser();
  const { vault } = useVault();
  const { data: requests } = useRequests();
  const act = useActions();
  const [busy, setBusy] = useState<string | null>(null);

  const price = vault?.sharePrice ?? 1_000_000n;
  const agValue = user.agusd !== undefined ? (user.agusd * price) / 1_000_000n : undefined;
  const open = (requests ?? []).filter((r) => !r.settled);
  // Everything the wallet owns, including what it owns while leaving. The agUSD is burned when an exit queues and
  // the claim on it lives in the vault, so counting only the balances made the money look like it had gone.
  const leaving = open.reduce((a, r) => a + r.assets, 0n);
  const loaded = user.usdc !== undefined && agValue !== undefined;
  const netWorth = loaded ? user.usdc! + agValue! + leaving : 0n;

  return (
    <section className="px-6 md:px-24 pt-10 md:pt-14 pb-24">
      <div className="max-w-[1400px] mx-auto">
        <h1 className="mt-2 text-[34px] text-fg font-semibold">Portfolio</h1>

        {!user.address ? (
          <div className={`mt-8 text-center ${card}`}>
            <p className="text-[15px] text-fg-muted">Connect your wallet to view your positions.</p>
            <div className="mx-auto mt-4 max-w-[260px]">
              <button type="button" onClick={openConnectModal} className={primaryBtn}>
                Connect Wallet
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className={`mt-6 ${card}`}>
              <div className="text-[12px] uppercase tracking-wider text-fg-muted">Net worth</div>
              <div className="text-[34px] text-fg font-semibold tabular-nums">
                {loaded ? usd(netWorth) : <span className="text-fg-muted/40">$0.00</span>}
              </div>
              {leaving > 0n && (
                <div className="text-[12px] text-fg-muted">Includes {usd(leaving)} on its way out.</div>
              )}
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
              <Position logo="/logos/usdc.svg" symbol="USDC" name="Mock USDC" amount={loaded ? fmt(user.usdc) : '-'} href="/faucet" />
              <Position
                logo="/logos/agusd.svg"
                symbol="agUSD"
                name="Agama USD"
                amount={loaded ? fmt(user.agusd) : '-'}
                sub={agValue !== undefined ? `${fmt(agValue)} USDC at today's price` : undefined}
                href="/"
              />
              {user.usdc === 0n && user.agusd === 0n && open.length === 0 && (
                <p className="rounded-2xl bg-[#fdfaf1] px-5 py-4 text-[14px] text-fg-muted shadow-[0_1px_3px_rgba(20,50,35,0.06)]">
                  Nothing here yet. Get mock USDC on the{' '}
                  <Link href="/faucet" className="underline underline-offset-2">Faucet</Link>, then deposit
                  it on <Link href="/" className="underline underline-offset-2">Earn</Link> and the share
                  price does the rest.
                </p>
              )}
            </div>

            {open.length > 0 && (
              <div className="mt-8">
                <h2 className="text-[15px] font-semibold">Withdrawal queue</h2>
                <p className="mt-1 text-[12.5px] leading-snug text-fg-muted">
                  Your agUSD is already burned for each of these, priced when you asked. The queue is paid strictly
                  in order as the book&apos;s collections come home from Ethereum. Nobody can jump it and nobody can
                  hold it up: anyone may push it along, and each claim pays its own owner.
                </p>
                <div className="mt-3 space-y-2">
                  {open.map((r) => (
                    <div
                      key={String(r.id)}
                      className="flex items-center justify-between rounded-xl border border-black/10 px-3.5 py-2.5"
                    >
                      <div>
                        <div className="text-[13.5px] font-medium">{usd(r.assets)} USDC</div>
                        <a
                          href={wcTx(r.tx)}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[12px] text-fg-muted hover:underline"
                        >
                          Claim #{String(r.id)} · waiting for collections
                        </a>
                      </div>
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={async () => {
                          setBusy(String(r.id));
                          try {
                            await act.settle();
                          } catch {
                            // The toast carries the reason.
                          } finally {
                            setBusy(null);
                          }
                        }}
                        className="rounded-lg bg-[#254839] px-3 py-1.5 text-[12.5px] font-medium text-[#fdf8ed] disabled:opacity-50"
                      >
                        {busy === String(r.id) ? 'Submitting' : 'Push the queue'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function Position({
  logo,
  symbol,
  name,
  amount,
  sub,
  href,
}: {
  logo: string;
  symbol: string;
  name: string;
  amount: string;
  sub?: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-4 rounded-2xl bg-[#fdfaf1] px-5 py-4 shadow-[0_1px_3px_rgba(20,50,35,0.06)]"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={asset(logo)} alt="" width={36} height={36} className="h-9 w-9" />
      <div>
        <div className="text-[15px] text-fg font-medium">{symbol}</div>
        <div className="text-[13px] text-fg-muted">{name}</div>
      </div>
      <div className="ml-auto text-right">
        <div className="text-[16px] text-fg font-semibold tabular-nums">{amount}</div>
        {sub && <div className="text-[12px] text-fg-muted">{sub}</div>}
      </div>
    </Link>
  );
}
