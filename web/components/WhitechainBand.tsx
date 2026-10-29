// Built on Whitechain: the four facts about the chain that matter to a dollar that earns, each one checked
// against Whitechain's docs and the live RPC, not lifted from a deck.
const FACTS = [
  { k: '1s', v: 'blocks', d: 'A deposit confirms before the page repaints.' },
  { k: '<$0.01', v: 'per deposit', d: '5 gwei floor, L1 data posted to Ethereum as blobs.' },
  { k: 'Ethereum', v: 'settlement', d: 'OP Stack rollup, one hop from the issuer on L1.' },
  { k: '10M+', v: 'WhiteBIT clients', d: 'WBT withdraws straight from the exchange to the chain.' },
];

export function WhitechainBand() {
  return (
    <div className="pt-6">
      <div className="overflow-hidden rounded-2xl bg-[#1F3D31] p-5 md:p-6 text-[#fdf8ed]">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-white">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/whitechain.svg" alt="" className="h-5 w-5" />
          </span>
          <h2 className="text-[17px] font-semibold">Built on Whitechain</h2>
          <span className="text-[13px] text-[#fdf8ed]/65">The onchain economy layer, from WhiteBIT</span>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FACTS.map((f) => (
            <div key={f.v} className="rounded-xl bg-white/[0.06] p-4 ring-1 ring-white/10">
              <div className="flex items-baseline gap-1.5">
                <span className="text-[26px] font-semibold tabular-nums">{f.k}</span>
                <span className="text-[13px] text-[#fdf8ed]/70">{f.v}</span>
              </div>
              <div className="mt-1 text-[12px] leading-snug text-[#fdf8ed]/65">{f.d}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
