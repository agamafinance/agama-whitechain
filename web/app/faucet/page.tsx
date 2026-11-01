'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Check, Copy, ExternalLink } from 'lucide-react';
import { useBalance } from 'wagmi';
import { TxButton } from '@/components/TxButton';
import { fmt } from '@/lib/format';
import { WBT_FAUCET, whitechainSepolia } from '@/lib/chains';
import { useActions, useUser } from '@/lib/protocol';
import { asset } from '@/lib/asset';

const COOLDOWN = 3600;

export default function FaucetPage() {
  const user = useUser();
  const address = user.address;
  const wbt = useBalance({ address, chainId: whitechainSepolia.id, query: { enabled: !!address } });
  const act = useActions();
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  const usdc = user.usdc;
  const last = user.lastDrip !== undefined ? Number(user.lastDrip) : 0;
  const wait = last ? Math.max(0, last + COOLDOWN - now) : 0;
  // Both faucets stay on the page whatever the wallet holds: gas and mock dollars run out and get topped up
  // again, so neither row is a step that is ever done. Minting only waits on gas when there is none.
  const noGas = !!address && wbt.data !== undefined && wbt.data.value === 0n;

  const copyAddress = async () => {
    if (!address) return;
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <>
      {/* Hero, same language as the Earn page */}
      <section className="px-6 md:px-24 pt-10 md:pt-14 pb-8">
        <div className="max-w-[1400px] mx-auto relative">
          <div aria-hidden className="pointer-events-none absolute right-4 top-2 z-20 hidden lg:block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={asset('/logos/usdc.svg')}
              alt=""
              className="h-[170px] w-[170px] drop-shadow-[0_18px_30px_rgba(20,50,35,0.25)]"
            />
          </div>

          <h1 className="mt-3 text-[34px] md:text-[44px] leading-[1.05] text-fg font-semibold">
            Get USDC
          </h1>
          <p className="mt-4 max-w-[640px] text-[15px] text-fg-muted">
            Whitechain has no native USDC yet, so this POC runs on a mock USDC that crosses to Ethereum the way
            CCTP moves USDC. WBT pays the gas.
          </p>

          <div className="mt-7 flex flex-wrap gap-8">
            <Stat label="Asset" value="Mock USDC" />
            <Stat label="Your USDC" value={usdc !== undefined ? fmt(usdc) : '-'} />
            <Stat label="Your WBT" value={wbt.data ? Number(wbt.data.formatted).toFixed(4) : '-'} />
          </div>
        </div>
      </section>

      {/* The two faucets, row style, like the vault list */}
      <section className="vault-panel relative z-10 rounded-t-[20px] px-6 md:px-24 pt-10 md:pt-14 pb-24">
        <div className="max-w-[1400px] mx-auto space-y-3">
          <h2 className="text-[13px] uppercase tracking-wider text-fg-muted mb-2">Faucets</h2>

          <StepRow
              icon="/logos/wbt.png"
              title="Get WBT for gas"
              blurb="Sign in with GitHub on Whitechain's faucet, paste your address. 0.5 WBT a day."
            >
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={copyAddress}
                  disabled={!address}
                  className="inline-flex h-11 items-center gap-2 rounded-full bg-[#254839]/[0.08] px-4 text-[13px] text-[#254839] hover:bg-[#254839]/[0.16] disabled:opacity-40 whitespace-nowrap"
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copied ? 'Copied!' : 'Copy address'}
                </button>
                <a
                  href={WBT_FAUCET}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-11 items-center gap-2 rounded-full bg-[#254839] px-5 text-[14px] font-medium text-[#fdf8ed] hover:bg-[#1F3D31] whitespace-nowrap"
                >
                  faucet.testnet.whitechain.io
                  <ExternalLink className="h-4 w-4" />
                </a>
              </div>
            </StepRow>

          <StepRow
            icon="/logos/usdc.svg"
            title="Mint mock USDC"
            blurb={
              !address
                ? 'Connect your wallet first. 10,000 mock USDC an hour, straight from the contract.'
                : noGas
                  ? 'Get WBT above first: minting is a transaction. 10,000 mock USDC an hour.'
                  : '10,000 mock USDC an hour, straight from the contract.'
            }
          >
            <TxButton
              fit
              label={wait > 0 ? `Again in ${Math.ceil(wait / 60)} min` : 'Get 10,000 USDC'}
              disabled={!address || noGas || wait > 0}
              action={act.faucet}
            />
          </StepRow>

          {/* Next step */}
          <Link href="/" className="group mt-6 flex items-center gap-4 rounded-2xl bg-[#254839] px-5 py-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={asset('/logos/agusd.svg')} alt="" className="h-10 w-10" />
            <div>
              <div className="text-[15px] font-medium text-[#fdf8ed]">Funded? Mint agUSD</div>
              <div className="text-[13px] text-[#fdf8ed]/70">Deposit your USDC into the dollar that earns</div>
            </div>
            <ArrowRight className="ml-auto h-5 w-5 text-[#fdf8ed]/80 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      </section>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[12px] uppercase tracking-wider text-fg-muted">{label}</div>
      <div className="text-[26px] text-fg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function StepRow({
  icon,
  title,
  blurb,
  children,
}: {
  /** Every step has a mark of its own. None of them is numbered: the order is the order they are in, and the
      list changes length as steps fall away. */
  icon: string;
  title: string;
  blurb: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-2xl bg-[#fdfaf1] px-5 py-4 shadow-[0_1px_3px_rgba(20,50,35,0.06),0_10px_30px_rgba(20,50,35,0.09)] md:flex-row md:items-center">
      <span className="relative h-10 w-10 shrink-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={asset(icon)} alt="" className="h-10 w-10" />
      </span>
      <div className="min-w-0">
        <div className="text-[15px] text-fg font-medium">{title}</div>
        <div className="text-[13px] text-fg-muted break-words">{blurb}</div>
      </div>
      <div className="md:ml-auto shrink-0">{children}</div>
    </div>
  );
}
