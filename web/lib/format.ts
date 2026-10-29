import { formatUnits, parseUnits } from 'viem';

export const DASH = '-';

/// A six decimal amount as a string with grouping, `dp` places.
export function fmt(v: bigint | undefined, dp = 2): string {
  if (v === undefined) return DASH;
  const n = Number(formatUnits(v, 6));
  return n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

export const usd = (v: bigint | undefined, dp = 2) => (v === undefined ? DASH : `$${fmt(v, dp)}`);

/// What a person typed, as base units, or zero when it is not a number yet.
export function parse(input: string): bigint {
  const clean = input.replace(/,/g, '').trim();
  if (!clean || !/^\d*\.?\d*$/.test(clean)) return 0n;
  try {
    return parseUnits(clean, 6);
  } catch {
    return 0n;
  }
}

/// The full balance as something an input will take back, for Max.
export const raw = (v: bigint) => formatUnits(v, 6);

export const short = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');

export function ago(ts: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
