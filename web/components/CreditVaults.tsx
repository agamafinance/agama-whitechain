'use client';

// Where the yield comes from. The same ABF partner sleeves the Stellar app lists; on Whitechain the senior one is
// wired end to end and the other two are the next to plug into the same receiver.
import { Space_Grotesk } from 'next/font/google';
import { ETHEREUM } from '@/lib/deployments';
import { ethAddress } from '@/lib/chains';
import { usd } from '@/lib/format';

const grotesk = Space_Grotesk({ subsets: ['latin'], weight: ['500', '600'] });

const SLEEVES = [
  {
    name: 'Flagship Vault',
    tranche: 'ABF Senior',
    apy: '8-9% target APY',
    fields: [['Redemption', 'Weekly'], ['Maximum Capacity', '$500M'], ['Lock-Up', '1 Month']],
    badge: 'Senior secured',
    live: true,
  },
  {
    name: 'High Yield Vault',
    tranche: 'ABF Mezz',
    apy: '15-20% target APY',
    fields: [['Redemption', 'Monthly'], ['Maximum Capacity', '$200M'], ['Lock-Up', '6 Months']],
    badge: 'Mezzanine',
    live: false,
  },
  {
    name: 'DealVaults',
    tranche: 'Deal-by-Deal',
    apy: '7-15% target APY',
    fields: [['Redemption', 'Per deal'], ['Maximum Capacity', '$300M'], ['Lock-Up', 'Deal term']],
    badge: 'Diversified',
    live: false,
  },
] as const;

export function CreditVaults({ deployed }: { deployed?: bigint }) {
  return (
    <div className="pt-6">
      <div className="flex flex-wrap items-center gap-3 pb-2">
        <h2 className="text-[13px] uppercase tracking-wider text-fg-muted">Where the yield comes from</h2>
        <span className="inline-flex items-center gap-1.5 text-[12px] text-fg-muted">
          curated by
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/abf-partner.svg" alt="" className="h-4 w-4" />
          <span className={`${grotesk.className} text-[13px] font-medium text-[#111318]`}>ABF partner</span>
        </span>
      </div>
      <p className="text-[13px] text-fg-muted max-w-[700px] mb-4">
        Asset-backed finance: pools of trade receivables, equipment leases and consumer instalments, originated and
        serviced off chain, held in an SPV and reported on a loan tape. The issuer on Ethereum is a simulation of the
        partner, who runs no testnet; its doors, its cash rule and its NAV are the partner&apos;s.
      </p>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {SLEEVES.map((v) => (
          <a
            key={v.name}
            href={v.live ? ethAddress(ETHEREUM.issuer) : undefined}
            target="_blank"
            rel="noreferrer"
            className={`flex flex-col rounded-2xl bg-[#fdfaf1] p-5 shadow-[0_1px_3px_rgba(20,50,35,0.06),0_10px_30px_rgba(20,50,35,0.09)] transition-shadow ${
              v.live ? 'hover:shadow-[0_1px_3px_rgba(20,50,35,0.08),0_16px_40px_rgba(20,50,35,0.14)]' : 'opacity-70'
            }`}
          >
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white ring-1 ring-[#254839]/10">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/abf-partner.svg" alt="" className="h-[22px] w-[22px] object-contain" />
              </span>
              <div className="min-w-0">
                <div className="text-[15px] text-fg font-medium leading-tight">{v.name}</div>
                <div className="text-[13px] text-fg-muted">{v.tranche}</div>
              </div>
              <span
                className={`ml-auto shrink-0 rounded-full px-2.5 py-1 text-[11px] ${
                  v.live ? 'bg-[#254839] text-[#fdf8ed]' : 'bg-[#254839]/[0.08] text-fg-muted'
                }`}
              >
                {v.live ? `Live · ${usd(deployed, 0)}` : 'Next'}
              </span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
              <Field label="Yield Range" value={v.apy} strong />
              {v.fields.map(([l, val]) => (
                <Field key={l} label={l} value={val} />
              ))}
            </div>
            <div className="mt-4 flex items-center justify-between border-t border-[#254839]/10 pt-3">
              <span className="text-[11px] uppercase tracking-wider text-fg-muted">
                {v.live ? 'Wired on Whitechain' : 'Same receiver, next sleeve'}
              </span>
              <span className="rounded-full bg-[#C97A40]/15 px-2.5 py-1 text-[11px] font-medium text-[#A85A2C]">
                {v.badge}
              </span>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}

function Field({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-fg-muted">{label}</div>
      <div className={strong ? 'text-[15px] text-fg font-semibold' : 'text-[14px] text-fg'}>{value}</div>
    </div>
  );
}
