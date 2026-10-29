'use client';

// The agUSD share price, in the house chart style. Ported from the Stellar app.
//
// The line is modelled, not measured, and the caption under it says so. The
// measured one came off the indexer and ran 1.0000 to 1.5867 in three weeks,
// because a testnet vault is a handful of deposits and a yield distribution
// pushed through by hand: the steps are real events and the slope they draw is
// not the product. Reading it as a return, it claims about fifty percent in a
// month against a vault whose own weighted rate is twelve percent a year.
//
// So the slope here is the rate the vaults actually carry, and the right hand
// end is the share price read on chain a moment ago. What is invented is the
// path between them, which on testnet is the only part that was never real.
import { useMemo, useRef, useState } from 'react';
import { fmt } from '@/lib/format';

const GREEN = '#254839';
const LINE = '#2f5d49';
const AXIS = '#70B19E';
const DAY = 86400;
const YEAR = 365 * DAY;

/// Deterministic hash of an integer into [0, 1). No seed state, so the same
/// day always produces the same value and the chart does not crawl between
/// renders.
function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/// Value noise in [-1, 1], smooth across whole numbers of x.
function noise(x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return (hash(i) * (1 - u) + hash(i + 1) * u) * 2 - 1;
}

/**
 * How far the realised rate sits from the headline one, on a given day.
 *
 * Three octaves: a slow one that carries a book through good and bad quarters,
 * a monthly one, and a fast one for the week to week. Keyed on the absolute day
 * number rather than on the window, so switching range zooms the same path
 * instead of drawing a different one.
 */
function drift(days: number): number {
  return (
    0.46 * noise(days / 34) +
    0.25 * noise(days / 11) +
    0.18 * noise(days / 3.4) +
    0.11 * noise(days / 1.3)
  );
}

/// How often the book is marked. A vault's share price does not creep, it steps:
/// yield is booked when a repayment lands or a NAV is written, and sits still in
/// between. One a day reads as a staircase at a month and as a line at a year,
/// which is what the same chart does on any vault dashboard.
const ACCRUAL = DAY;

type Range = 'LIVE' | '1M' | '3M' | 'YTD' | '1Y';
const RANGES: Range[] = ['LIVE', '1M', '3M', 'YTD', '1Y'];

function niceNum(range: number, round: boolean): number {
  const exp = Math.floor(Math.log10(range || 1));
  const f = (range || 1) / Math.pow(10, exp);
  const nf = round
    ? f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10
    : f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nf * Math.pow(10, exp);
}

function niceTicks(min: number, max: number, count = 5) {
  if (max - min < 1e-12) {
    const c = min || 1;
    return { ticks: [c], lo: c * 0.999, hi: c * 1.001, dp: 4 };
  }
  const step = niceNum((max - min) / (count - 1), true);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toFixed(10)));
  const dp = Math.max(2, Math.min(8, -Math.floor(Math.log10(step)) + 1));
  return { ticks, lo, hi, dp };
}

const fmtTime = (ts: number) =>
  new Date(ts * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const fmtDay = (ts: number) =>
  new Date(ts * 1000).toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
const fmtFull = (ts: number) =>
  new Date(ts * 1000).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });

/** Seconds back from `now` that each range covers. YTD is the calendar one. */
function spanOf(range: Range, now: number): number {
  if (range === '1M') return 30 * DAY;
  if (range === '3M') return 90 * DAY;
  if (range === '1Y') return YEAR;
  const jan1 = Math.floor(new Date(new Date(now * 1000).getFullYear(), 0, 1).getTime() / 1000);
  // Early January leaves almost nothing to draw, so YTD falls back to a month.
  return Math.max(now - jan1, 30 * DAY);
}

const shell =
  'rounded-2xl bg-[#fdfaf1] p-6 shadow-[0_1px_3px_rgba(20,50,35,0.06),0_10px_30px_rgba(20,50,35,0.09)]';

export function NavChart({
  price,
  nav,
  apy,
  failed,
  retrying,
  onRetry,
  marks,
}: {
  /** The marks the vault recorded on chain, oldest first. The LIVE range draws these and nothing else. */
  marks?: { ts: number; price: number }[];
  /** Share price read on chain, in USDC per agUSD. The curve ends here. */
  price: number | undefined;
  /** Vault NAV, base units, for the line under the headline figure. */
  nav: bigint | undefined;
  /** Weighted net APY of the vaults, in percent. The curve's slope. */
  apy: number | undefined;
  /** Why the numbers are not here, when they are not coming. Null while loading. */
  failed?: string | null;
  /** A read is in flight, so the retry button says so rather than looking dead. */
  retrying?: boolean;
  onRetry?: () => void;
}) {
  // The modelled range by default: on a testnet a day of marks moves the price below its sixth decimal and LIVE
  // draws a flat line. It is one click away, and it is the one to read once the book has run for a while.
  const [range, setRange] = useState<Range>('YTD');
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const W = 560, H = 300, L = 74, R = 546, T = 16, B = 250;
  const N = 220;

  const series = useMemo(() => {
    if (price === undefined || apy === undefined) return null;
    const now = Math.floor(Date.now() / 1000);

    // LIVE is measured, not modelled: every step is a NavReported the vault emitted, and the last point is the
    // price read a moment ago, which differs from the last mark by whatever profit has unlocked since.
    if (range === 'LIVE') {
      const pts = (marks ?? []).filter((m) => m.ts > 0 && m.ts < now);
      const start = pts.length ? pts[0].ts - 600 : now - 3600;
      const times = [start, ...pts.map((m) => m.ts), now];
      const raw = [pts.length ? pts[0].price : price, ...pts.map((m) => m.price), price];
      // Drawn as steps: a share price sits still between marks and moves at them.
      const t2: number[] = [];
      const v2: number[] = [];
      for (let i = 0; i < times.length; i++) {
        if (i > 0) { t2.push(times[i]); v2.push(raw[i - 1]); }
        t2.push(times[i]); v2.push(raw[i]);
      }
      return { vals: v2, times: t2, now, live: true as const, count: pts.length };
    }

    const span = spanOf(range, now);
    const base = apy / 100;

    // The rate a credit book earns is not the rate on its front page. It moves
    // with what is drawn, what repays early and what sits in reserve, so the
    // line it draws bends: steeper for a month, flat for a fortnight, and
    // upward throughout, because a share price that falls is a loss and not a
    // slow week. 0.5 keeps the realised rate inside roughly half to one and a
    // half times the headline, and never at or below zero.
    const rateOn = (t: number) => base * (1 + 0.62 * drift(t / DAY));

    // Integrate the rate forward in log space, one accrual at a time, then
    // slide the whole path so the last mark lands exactly on the price the
    // chain reports. The shape is modelled; the right hand end is measured.
    const firstSlot = Math.floor((now - span) / ACCRUAL);
    const lastSlot = Math.floor(now / ACCRUAL);
    const growth: number[] = [0];
    for (let d = firstSlot; d < lastSlot; d++) {
      growth.push(growth[growth.length - 1] + Math.log(1 + rateOn(d * ACCRUAL)) * (ACCRUAL / YEAR));
    }
    const end = growth[growth.length - 1];

    const times: number[] = [];
    const vals: number[] = [];
    for (let k = 0; k <= N; k++) {
      const t = Math.round(now - span + (k * span) / N);
      times.push(t);
      // The value as of the last mark, not as of the instant: between marks a
      // share price is flat, and drawing the slope through them is the part
      // that makes a yield chart look like a price feed.
      const i = Math.max(0, Math.min(growth.length - 1, Math.floor(t / ACCRUAL) - firstSlot));
      vals.push(price * Math.exp(growth[i] - end));
    }
    return { vals, times, now, live: false as const, count: 0 };
  }, [price, apy, range, marks]);

  if (!series) {
    // Holds the card's height while it waits, so the column does not collapse
    // to one line of text and then jump when the numbers land.
    //
    // A failed read says so and offers the retry. The same sentence for both
    // states is what turns a dropped request into a page that looks frozen:
    // nothing on screen distinguishes "any moment now" from "never".
    return (
      <div className={`${shell} flex min-h-[440px] flex-col items-center justify-center gap-3 px-6 text-center`}>
        <p className="text-[13px] text-fg-muted">
          {failed ? 'The protocol could not be read.' : 'Reading the protocol.'}
        </p>
        {failed && (
          <>
            <p className="max-w-[360px] text-[12px] leading-snug text-fg-muted/80">{failed}</p>
            <button
              type="button"
              onClick={onRetry}
              disabled={retrying}
              className="rounded-full bg-[#254839] px-5 h-9 text-[13px] font-medium text-[#fdf8ed] hover:bg-[#1F3D31] disabled:opacity-40"
            >
              {retrying ? 'Reading…' : 'Try again'}
            </button>
          </>
        )}
      </div>
    );
  }

  const { vals, times } = series;
  const { ticks, lo, hi, dp } = niceTicks(Math.min(...vals), Math.max(...vals), 5);
  const t0 = times[0];
  const tN = times[times.length - 1];
  const xAt = (i: number) =>
    series.live ? L + ((times[i] - t0) / (tN - t0 || 1)) * (R - L) : L + (i / (vals.length - 1)) * (R - L);
  const yAt = (v: number) => B - ((v - lo) / (hi - lo || 1)) * (B - T);

  let line = `M ${xAt(0).toFixed(2)} ${yAt(vals[0]).toFixed(2)}`;
  for (let i = 1; i < vals.length; i++) line += ` L ${xAt(i).toFixed(2)} ${yAt(vals[i]).toFixed(2)}`;
  const area = `${line} L ${xAt(vals.length - 1).toFixed(2)} ${B} L ${xAt(0).toFixed(2)} ${B} Z`;

  const last = vals.length - 1;
  const at = hover === null ? last : hover;
  const shownPrice = vals[at];
  const change = (vals[last] / vals[0] - 1) * 100;

  const text = shownPrice.toFixed(7);
  const head = text.slice(0, text.length - 4);
  const dim = text.slice(text.length - 4);

  // LIVE is spaced by time, so the middle labels of an index split can land on top of each other.
  const xIdx = series.live ? [0, last] : [0, Math.round(last / 3), Math.round((2 * last) / 3), last];
  const xLabels = xIdx.map((i, k) => ({
    x: xAt(i),
    text: series.live ? fmtTime(times[i]) : fmtDay(times[i]),
    anchor: (k === 0 ? 'start' : k === xIdx.length - 1 ? 'end' : 'middle') as 'start' | 'middle' | 'end',
  }));

  /// Map a pointer anywhere over the card onto the nearest sample. The svg is
  /// scaled to its container, so the viewBox coordinate has to come back out of
  /// the rendered width rather than from the event's offset.
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box) return;
    const vx = ((e.clientX - box.left) / box.width) * W;
    const i = Math.round(((vx - L) / (R - L)) * last);
    setHover(Math.max(0, Math.min(last, i)));
  };

  return (
    <div className={shell}>
      <div className="flex items-center justify-between">
        <span className="rounded-full bg-[#254839]/[0.06] px-3 py-1.5 text-[13px] font-medium text-fg">
          Price per share
        </span>
        <div className="flex items-center gap-1 rounded-full bg-[#254839]/[0.06] p-1">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => { setRange(r); setHover(null); }}
              className={
                r === range
                  ? 'rounded-full bg-[#254839] px-3 py-1 text-[12px] font-medium text-[#fdf8ed]'
                  : 'rounded-full px-3 py-1 text-[12px] text-fg-muted hover:text-fg'
              }
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5">
        <div className="text-[12px] uppercase tracking-wider text-fg-muted">1 agUSD</div>
        <div className="mt-1 flex flex-wrap items-baseline gap-3">
          <div className="text-[40px] leading-none font-semibold tabular-nums text-fg">
            {head}
            <span className="text-fg-muted/45">{dim}</span>
            <span className="ml-2 text-[16px] font-medium text-fg-muted">USDC</span>
          </div>
          <span className="rounded-full bg-[#254839]/[0.08] px-2.5 py-1 text-[12px] font-medium text-fg tabular-nums">
            +{change.toFixed(series.live ? 4 : 2)}% {range === 'LIVE' ? 'since the first mark' : range}
          </span>
        </div>
        <div className="mt-2 text-[13px] text-fg-muted">
          {hover === null ? (
            <>
              NAV ${nav !== undefined ? fmt(nav) : '-'}
              {apy !== undefined ? ` · ${apy.toFixed(2)}% APY` : ''} · live
            </>
          ) : (
            series.live ? `${fmtFull(times[at])}, ${fmtTime(times[at])}` : fmtFull(times[at])
          )}
        </div>
      </div>

      <svg
        ref={svgRef}
        className="mt-4 w-full"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="wcnavfill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={GREEN} stopOpacity="0.16" />
            <stop offset="100%" stopColor={GREEN} stopOpacity="0.01" />
          </linearGradient>
        </defs>

        {ticks.map((tk, i) => {
          const y = yAt(tk);
          if (y < T - 1 || y > B + 1) return null;
          return (
            <g key={i}>
              <line
                x1={L} y1={y} x2={R} y2={y}
                stroke={GREEN} strokeOpacity="0.12" strokeDasharray="3 4" strokeWidth="1"
              />
              <text x={L - 8} y={y + 3.5} fill={AXIS} fontSize="10" textAnchor="end">
                {tk.toFixed(dp)}
              </text>
            </g>
          );
        })}

        {xLabels.map((xl, i) => (
          <text key={i} x={xl.x} y={B + 20} fill={AXIS} fontSize="10" textAnchor={xl.anchor}>
            {xl.text}
          </text>
        ))}

        <path d={area} fill="url(#wcnavfill)" />
        <path
          d={line}
          fill="none"
          stroke={LINE}
          strokeWidth={2}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />

        {hover !== null && (
          <line
            x1={xAt(at)} y1={T} x2={xAt(at)} y2={B}
            stroke={GREEN} strokeOpacity="0.3" strokeWidth="1" strokeDasharray="3 3"
          />
        )}

        {hover === null && (
          <circle cx={xAt(last)} cy={yAt(vals[last])} r={6} fill={LINE} opacity={0.25}>
            <animate attributeName="r" values="4;9;4" dur="1.8s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.4;0;0.4" dur="1.8s" repeatCount="indefinite" />
          </circle>
        )}
        <circle cx={xAt(at)} cy={yAt(vals[at])} r={3.5} fill={LINE} stroke="#fdfaf1" strokeWidth={1.5} />
      </svg>

      {series.live ? (
        <p className="mt-2 text-[12px] leading-snug text-fg-muted">
          Measured. {series.count === 0
            ? 'No mark has been recorded yet; the line is the price read on chain.'
            : `Each step is one of the ${series.count} marks the vault recorded on Whitechain, and the right hand end is the price read a moment ago, which includes the profit unlocked since.`}
        </p>
      ) : (
      <p className="mt-2 text-[12px] leading-snug text-fg-muted">
        Testnet. The right hand end is the share price read on chain; the path to it is drawn
        around {apy !== undefined ? `${apy.toFixed(2)}%` : 'the vaults\u2019 rate'} a year rather
        than from recorded history, which on a testnet is a handful of deposits and draws a line no
        vault would produce.
      </p>
      )}
    </div>
  );
}
