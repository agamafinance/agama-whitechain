// bun src/cli.ts <status|tick|loop <minutes>|relay|allocate <usdc>|home <usdc>>
import { formatUnits, parseUnits } from 'viem';
import { AbfAssetIssuerAbi, CrossChainAllocatorAbi } from '../../abi';
import { E, eth, sendChecked, W, wc } from './config';
import { relayAll } from './relay';
import { bringHome, runBook } from './book';
import { navOfBook, rebalance, refill, report, settleQueue, shortfall, snapshot } from './vault';

const usd = (v: bigint) => `$${Number(formatUnits(v, 6)).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

async function status() {
  const s = await snapshot();
  const [cash, offChain] = await Promise.all([
    eth.public.readContract({ address: E.issuer, abi: AbfAssetIssuerAbi, functionName: 'cash' }),
    eth.public.readContract({ address: E.issuer, abi: AbfAssetIssuerAbi, functionName: 'offChainAssets' }),
  ]);
  console.log(`agUSD on Whitechain
  total assets   ${usd(s.totalAssets)}    supply ${formatUnits(s.totalSupply, 6)}    price ${formatUnits(s.sharePrice, 6)}
  idle           ${usd(s.idle)}    liquid ${usd(s.liquid)}    pending ${usd(s.pending)} (${s.queueLength} queued)
  deployed       ${usd(s.deployed)}    unvested ${usd(s.unvested)}
ABF issuer on Ethereum Sepolia
  cash           ${usd(cash)}    book ${usd(offChain)}
  book NAV seen from Whitechain ${usd(await navOfBook())}`);
}

async function tick() {
  console.log('relay');
  await relayAll();
  // What the vault needs home is known before the book runs, so the book keeps it as cash instead of wiring it out.
  const short = (await shortfall()) + (await refill());
  console.log('book');
  await runBook(short);
  if (short > 0n) {
    console.log(`short ${usd(short)} for the queue and the buffer, bringing it home`);
    await bringHome(short);
  }
  console.log('rebalance');
  if (await rebalance()) await relayAll();
  await relayAll();
  console.log('report');
  await report();
  await settleQueue();
  await status();
}

/// Ticks every two minutes for `minutes`. GitHub runs a scheduled workflow hours late when it runs it at all, so
/// the clock lives here and the schedule only has to start a run before the last one ends. A tick that fails is
/// logged and retried on the next one, since a public endpoint failing once is weather; failing several times in
/// a row is an outage, and that ends the run in error so somebody is told.
async function loop() {
  const until = Date.now() + Number(arg ?? 350) * 60_000;
  const EVERY = 120_000;
  const GIVE_UP = 4;
  let failedInARow = 0;
  while (Date.now() < until) {
    const started = Date.now();
    console.log(`\n== tick ${new Date(started).toISOString()}`);
    try {
      await tick();
      failedInARow = 0;
    } catch (e) {
      failedInARow++;
      console.log(`::warning::tick failed (${failedInARow} in a row): ${(e as Error).message.split('\n')[0]}`);
      if (failedInARow >= GIVE_UP) throw e;
    }
    await Bun.sleep(Math.max(0, Math.min(EVERY - (Date.now() - started), until - Date.now())));
  }
}

const [cmd, arg] = process.argv.slice(2);
const run: Record<string, () => Promise<unknown>> = {
  status,
  tick,
  loop,
  relay: relayAll,
  allocate: async () => {
    await sendChecked(wc, { address: W.allocator, abi: CrossChainAllocatorAbi, functionName: 'allocate', args: [parseUnits(arg, 6)] });
    await relayAll();
  },
  home: async () => {
    await bringHome(parseUnits(arg, 6));
    await relayAll();
  },
};
if (!run[cmd]) {
  console.error('usage: bun src/cli.ts <status|tick|loop <minutes>|relay|allocate <usdc>|home <usdc>>');
  process.exit(1);
}
await run[cmd]();
