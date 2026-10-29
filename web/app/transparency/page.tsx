'use client';

// Transparency: both legs read live, and the route's history read off the logs of both chains.
//
// Every figure on the Earn page traces to one here, and every row here links to the transaction that made it.
import { card } from '@/components/ui';
import { ETHEREUM, WHITECHAIN } from '@/lib/deployments';
import { ethAddress, ethTx, wcAddress, wcTx } from '@/lib/chains';
import { ago, fmt, short, usd } from '@/lib/format';
import { useActivity, useBook, useVault } from '@/lib/protocol';

export default function TransparencyPage() {
  const { vault, totalSent, totalReturned, config } = useVault();
  const { data: book } = useBook();
  const { data: activity, isLoading } = useActivity();

  const outbound = book && totalSent !== undefined ? totalSent - book.received : undefined;
  const inbound = book && totalReturned !== undefined ? book.sentHome - totalReturned : undefined;
  const seen = book && outbound !== undefined && inbound !== undefined ? book.position + outbound + inbound : undefined;

  return (
    <section className="px-6 md:px-24 pt-10 md:pt-14 pb-24">
      <div className="max-w-[1400px] mx-auto">
        <h1 className="mt-2 text-[34px] text-fg font-semibold">Transparency</h1>
        <p className="mt-2 max-w-[720px] text-[15px] text-fg-muted">
          agUSD&apos;s price is the vault&apos;s assets over its supply, and its assets are mostly on another chain.
          This page reads both, so the number the vault was last marked at can be checked against the position it
          claims to be.
        </p>

        <div className="mt-6 grid gap-5 lg:grid-cols-3">
          <Column title="Whitechain · agUSD vault" logo="/whitechain.svg">
            <Line k="Total assets" v={usd(vault?.totalAssets)} />
            <Line k="Supply" v={`${fmt(vault?.totalSupply, 2)} agUSD`} />
            <Line k="Share price" v={vault ? (Number(vault.sharePrice) / 1e6).toFixed(6) : '-'} />
            <Line k="Idle, in the vault" v={usd(vault?.idle)} />
            <Line k="Owed to the queue" v={usd(vault?.pending)} />
            <Line k="Deployed, as last marked" v={usd(vault?.deployed)} />
            <Line k="Profit still unlocking" v={usd(vault?.unvested)} />
            <Line k="Last marked" v={vault && vault.lastReport > 0n ? ago(Number(vault.lastReport)) : 'not yet'} />
          </Column>

          <Column title="The crossing · CCTP V2" logo="/logos/usdc.svg">
            <Line k="Sent to Ethereum" v={usd(totalSent)} />
            <Line k="Received on Ethereum" v={usd(book?.received)} />
            <Line k="In flight, outbound" v={usd(outbound)} />
            <Line k="Sent home" v={usd(book?.sentHome)} />
            <Line k="Settled on Whitechain" v={usd(totalReturned)} />
            <Line k="In flight, inbound" v={usd(inbound)} />
            <div className="mt-3 rounded-xl bg-[#254839]/[0.05] p-3 text-[12px] text-fg-muted">
              Every burn names the contract on the far side as its only executor, so a message cannot be run by
              somebody who would skip the subscription or the settlement that follows it.
            </div>
          </Column>

          <Column title="Ethereum · L1 receiver and issuer" logo="/logos/eth.svg">
            <Line k="Receiver position" v={usd(book?.position)} />
            <Line k="Notes held" v={`${fmt(book?.notes, 2)} abfUSD-T`} />
            <Line k="Issuer cash" v={usd(book?.cash)} />
            <Line k="Funded off chain" v={usd(book?.offChain)} />
            <Line k="Book cap" v={book ? `${book.maxOffChainBps / 100}% of the issuer` : '-'} />
            <Line k="Book last marked" v={book && book.navUpdatedAt > 0n ? ago(Number(book.navUpdatedAt)) : 'not yet'} />
            <div className="mt-3 rounded-xl bg-[#254839]/[0.05] p-3 text-[12px] text-fg-muted">
              The vault&apos;s deployed figure should match this side plus what is in flight:{' '}
              <span className="text-fg tabular-nums">{usd(seen)}</span> against{' '}
              <span className="text-fg tabular-nums">{usd(vault?.deployed)}</span> as last marked.
            </div>
          </Column>
        </div>

        <div className={`mt-6 ${card}`}>
          <h2 className="text-[17px] font-semibold text-fg">The route, as it ran</h2>
          <p className="mt-1 text-[12px] text-fg-muted">Both chains&apos; logs, newest first. Each row opens its transaction.</p>
          {isLoading ? (
            <p className="mt-4 text-[14px] text-fg-muted">Reading the logs of both chains.</p>
          ) : !activity || activity.events.length === 0 ? (
            <p className="mt-4 text-[14px] text-fg-muted">Nothing has crossed yet.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[640px] text-[13px]">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-fg-muted">
                    <th className="pb-2 font-normal">When</th>
                    <th className="pb-2 font-normal">Chain</th>
                    <th className="pb-2 font-normal">What</th>
                    <th className="pb-2 font-normal text-right">Amount</th>
                    <th className="pb-2 font-normal text-right">Transaction</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#254839]/10">
                  {activity.events.slice(0, 60).map((e) => (
                    <tr key={`${e.tx}-${e.kind}`}>
                      <td className="py-2.5 text-fg-muted whitespace-nowrap">{e.ts ? ago(e.ts) : '-'}</td>
                      <td className="py-2.5">
                        <span className="inline-flex items-center gap-1.5">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={e.chain === 'whitechain' ? '/whitechain.svg' : '/logos/eth.svg'} alt="" className="h-3.5 w-3.5" />
                          {e.chain === 'whitechain' ? 'Whitechain' : 'Ethereum'}
                        </span>
                      </td>
                      <td className="py-2.5 text-fg">
                        {e.kind}
                        {e.detail && <span className="ml-2 text-fg-muted">{e.detail}</span>}
                      </td>
                      <td className="py-2.5 text-right tabular-nums text-fg">{usd(e.amount)}</td>
                      <td className="py-2.5 text-right">
                        <a
                          href={e.chain === 'whitechain' ? wcTx(e.tx) : ethTx(e.tx)}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-[12px] text-fg-muted hover:text-fg hover:underline"
                        >
                          {short(e.tx)}
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="mt-6 grid gap-5 lg:grid-cols-[1.2fr_1fr]">
          <div className={card}>
            <h2 className="text-[17px] font-semibold text-fg">Contracts</h2>
            <div className="mt-3 grid gap-x-6 sm:grid-cols-2">
              <div>
                <div className="pt-2 text-[11px] uppercase tracking-wider text-fg-muted">Whitechain Sepolia · 1874</div>
                <Addr k="agUSD vault" a={WHITECHAIN.agUSD} href={wcAddress} />
                <Addr k="Allocator" a={WHITECHAIN.allocator} href={wcAddress} />
                <Addr k="Messenger" a={WHITECHAIN.messenger} href={wcAddress} />
                <Addr k="Test USDC" a={WHITECHAIN.usdc} href={wcAddress} />
              </div>
              <div>
                <div className="pt-2 text-[11px] uppercase tracking-wider text-fg-muted">Ethereum Sepolia · 11155111</div>
                <Addr k="L1 receiver" a={ETHEREUM.receiver} href={ethAddress} />
                <Addr k="ABF issuer" a={ETHEREUM.issuer} href={ethAddress} />
                <Addr k="Messenger" a={ETHEREUM.messenger} href={ethAddress} />
                <Addr k="Test USDC" a={ETHEREUM.usdc} href={ethAddress} />
              </div>
            </div>
            {config && (
              <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 border-t border-[#254839]/10 pt-3 text-[12px] sm:grid-cols-3">
                <Line k="Reserve floor" v={`${config.reserveBps / 100}%`} />
                <Line k="Performance fee" v={`${config.performanceFeeBps / 100}%`} />
                <Line k="Max move per mark" v={`${config.maxNavChangeBps / 100}%`} />
                <Line k="Min between marks" v={`${Math.round(Number(config.minReportInterval) / 60)} min`} />
                <Line k="Profit unlock" v={`${Math.round(Number(config.profitVestingPeriod) / 3600)} h`} />
                <Line k="Deposit cap" v={usd(config.depositCap, 0)} />
              </div>
            )}
          </div>

          <div className={card}>
            <h2 className="text-[17px] font-semibold text-fg">Why Whitechain</h2>
            <ul className="mt-3 space-y-3 text-[13px] text-fg-muted">
              <li>
                <span className="text-fg">An OP Stack rollup that settles on Ethereum.</span>{' '}The credit book&apos;s
                issuer lives on Ethereum, so agUSD sits one hop from its collateral on the same security root.
              </li>
              <li>
                <span className="text-fg">One second blocks, cents of gas.</span>{' '}Deposits and instant exits confirm
                before the page repaints, which is what a dollar product needs to feel like cash.
              </li>
              <li>
                <span className="text-fg">WhiteBIT behind it.</span>{' '}A European exchange with 10M+ clients and WBT
                withdrawable straight to the chain: the shortest path from a retail account to a yielding dollar.
              </li>
              <li>
                <span className="text-fg">Built for asset-backed businesses.</span>{' '}Whitechain pitches itself to
                fintechs, banks and tokenization desks, which are the originators an ABF book is made of.
              </li>
              <li>
                <span className="text-fg">CCTP ready on day one.</span>{' '}Circle has not given Whitechain a domain yet.
                The contracts speak CCTP V2 byte for byte, so the day it does, the messenger address is the only
                thing that changes.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

function Column({ title, logo, children }: { title: string; logo: string; children: React.ReactNode }) {
  return (
    <div className={card}>
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white ring-1 ring-[#254839]/10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logo} alt="" className="h-4 w-4 object-contain" />
        </span>
        <h2 className="text-[15px] font-semibold text-fg">{title}</h2>
      </div>
      <dl className="mt-3 space-y-1.5 text-[13px]">{children}</dl>
    </div>
  );
}

function Line({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-fg-muted">{k}</dt>
      <dd className="text-fg tabular-nums text-right">{v}</dd>
    </div>
  );
}

function Addr({ k, a, href }: { k: string; a: string; href: (a: string) => string }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-[13px]">
      <span className="text-fg-muted">{k}</span>
      <a href={href(a)} target="_blank" rel="noreferrer" className="font-mono text-[12px] text-fg hover:underline">
        {short(a)}
      </a>
    </div>
  );
}
