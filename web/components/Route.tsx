'use client';

// The route the capital takes, with what is at each stop right now. The point of drawing it is that every box
// has a live number under it: nothing on this diagram is a promise.
import { ArrowRight } from 'lucide-react';
import type { Book, VaultState } from '@/lib/protocol';
import { usd } from '@/lib/format';
import { card } from './ui';
import { asset } from '@/lib/asset';

type Stop = { chain: string; logo: string; title: string; what: string; value?: bigint; note: string };

export function Route({ vault, book, inflight }: { vault?: VaultState; book?: Book; inflight?: bigint }) {
  const stops: Stop[] = [
    {
      chain: 'Whitechain',
      logo: '/whitechain.svg',
      title: 'agUSD vault',
      what: 'ERC-4626 · buffer and queue',
      value: vault?.liquid,
      note: 'liquid for instant exits',
    },
    {
      chain: 'CCTP V2',
      logo: '/logos/usdc.svg',
      title: 'Burn and mint',
      what: 'Circle’s message format',
      value: inflight,
      note: 'in flight between chains',
    },
    {
      chain: 'Ethereum',
      logo: '/logos/eth.svg',
      title: 'L1 receiver',
      what: 'Subscribes on arrival',
      value: book?.position,
      note: 'position at the issuer’s NAV',
    },
    {
      chain: 'Ethereum',
      logo: '/abf-partner.svg',
      title: 'ABF issuer',
      what: 'Closed ERC-4626 · allowlist',
      value: book?.cash,
      note: 'cash held for redemptions',
    },
    {
      chain: 'Off chain',
      logo: '/logos/book.svg',
      title: 'Receivables book',
      what: 'SPV custody · loan tape',
      value: book?.offChain,
      note: 'funded, marked to the tape',
    },
  ];

  return (
    <div className="pt-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3 pb-2">
        <h2 className="text-[13px] uppercase tracking-wider text-fg-muted">The route, live</h2>
        <span className="text-[12px] text-fg-muted">Collections come back the same way and lift the agUSD price.</span>
      </div>
      <div className={`${card} !p-4 md:!p-5`}>
        <ol className="grid gap-3 md:grid-cols-5 md:gap-0">
          {stops.map((s, i) => (
            <li key={s.title} className="relative flex md:block items-center gap-3 md:px-3">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white ring-1 ring-[#254839]/10">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={asset(s.logo)} alt="" className="h-[18px] w-[18px] object-contain" />
                </span>
                <span className="text-[11px] uppercase tracking-wider text-fg-muted">{s.chain}</span>
              </div>
              <div className="md:mt-3 min-w-0">
                <div className="text-[15px] font-medium text-fg leading-tight">{s.title}</div>
                <div className="text-[12px] text-fg-muted">{s.what}</div>
                <div className="mt-2 text-[20px] font-semibold tabular-nums text-fg">{usd(s.value, 0)}</div>
                <div className="text-[11px] text-fg-muted">{s.note}</div>
              </div>
              {i < stops.length - 1 && (
                <ArrowRight
                  className="hidden md:block absolute right-[-9px] top-[10px] h-[18px] w-[18px] text-[#70B19E]"
                  aria-hidden
                />
              )}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
