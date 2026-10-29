'use client';

// The shared surfaces, the same ones app.agama.finance/stellar is composed from: one card, one pill button,
// one amount box, so this app reads as the same product on a different chain.
import { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { asset } from '@/lib/asset';

export const card =
  'rounded-2xl bg-[#fdfaf1] p-6 shadow-[0_1px_3px_rgba(20,50,35,0.06),0_10px_30px_rgba(20,50,35,0.09)]';
export const primaryBtn =
  'w-full rounded-full bg-[#254839] px-5 py-3.5 text-[15px] font-medium text-[#fdf8ed] transition-colors hover:bg-[#1F3D31] disabled:opacity-45';
export const secondaryBtn =
  'w-full rounded-full border border-[#254839]/25 px-5 py-3.5 text-[15px] font-medium text-fg transition-colors hover:bg-[#254839]/[0.06] disabled:opacity-45';

export function Hero({ title, children, art }: { title: ReactNode; children: ReactNode; art?: string }) {
  return (
    <section className="px-6 md:px-24 pt-10 md:pt-14 pb-8">
      <div className="max-w-[1400px] mx-auto relative">
        {art && (
          <div aria-hidden className="pointer-events-none absolute right-0 -top-2 z-20 hidden lg:block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={asset(art)} alt="" className="h-[300px] w-auto" />
          </div>
        )}
        <h1 className="mt-3 text-[34px] md:text-[44px] leading-[1.05] text-fg font-semibold">{title}</h1>
        {children}
      </div>
    </section>
  );
}

export function Panel({ children }: { children: ReactNode }) {
  return (
    <section className="vault-panel relative z-10 rounded-t-[20px] px-6 md:px-24 pt-10 md:pt-14 pb-24">
      <div className="max-w-[1400px] mx-auto space-y-5">{children}</div>
    </section>
  );
}

export function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-[12px] uppercase tracking-wider text-fg-muted">{label}</div>
      <div className="text-[26px] text-fg font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-[12px] text-fg-muted">{sub}</div>}
    </div>
  );
}

export function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="text-fg tabular-nums">{value}</dd>
    </div>
  );
}

/// A segmented control. Two or three choices, the chosen one filled.
export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="mt-4 flex items-center gap-1 rounded-full bg-[#254839]/[0.06] p-1 w-fit">
      {options.map(([key, label]) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className={
            key === value
              ? 'rounded-full bg-[#254839] px-4 py-1.5 text-[13px] font-medium text-[#fdf8ed]'
              : 'rounded-full px-4 py-1.5 text-[13px] text-fg-muted hover:text-fg'
          }
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function AmountBox({
  label,
  balanceLabel,
  onMax,
  canMax = true,
  value,
  onChange,
  unit,
  hint,
}: {
  label: string;
  balanceLabel: string;
  onMax: () => void;
  /** False when there is no balance to fill in, which hides the Max affordance
      rather than offering one that does nothing. */
  canMax?: boolean;
  value: string;
  onChange: (v: string) => void;
  unit: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="mt-4 rounded-2xl border border-[#254839]/12 bg-white/60 p-4">
      <div className="flex items-center justify-between text-[12px] text-fg-muted">
        <span>{label}</span>
        {canMax ? (
          <button type="button" onClick={onMax} className="hover:text-fg">
            Balance {balanceLabel} · Max
          </button>
        ) : (
          <span>Balance {balanceLabel}</span>
        )}
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-3">
        <input
          inputMode="decimal"
          placeholder="0.00"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-transparent text-[28px] font-semibold text-fg tabular-nums outline-none placeholder:text-fg-muted/40"
        />
        <span className="shrink-0 rounded-full bg-[#254839]/[0.06] px-3 py-1.5 text-[14px] font-medium text-fg">
          {unit}
        </span>
      </div>
      {hint && <div className="mt-1 text-[12px] text-fg-muted">{hint}</div>}
    </div>
  );
}

/// A result line under the button that was pressed. Errors are kept whole in
/// the title attribute: a wallet error is long and the useful part is often at the end.
export function Status({ text, error }: { text?: string; error?: string }) {
  if (!text && !error) return null;
  return (
    <p
      className={`mt-2 text-[12px] ${error ? 'text-[#b4571f]' : 'text-fg-muted'}`}
      title={error ?? text}
      role="status"
      aria-live="polite"
    >
      {error ? (error.length > 120 ? `${error.slice(0, 120)}…` : error) : text}
    </p>
  );
}

export function Step({ text }: { text?: string }) {
  return (
    <span className="inline-flex items-center justify-center gap-2">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      {text ?? 'Working'}
    </span>
  );
}
