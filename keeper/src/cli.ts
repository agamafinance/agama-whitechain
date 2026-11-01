// bun src/cli.ts <status|tick|loop <minutes>|relay|allocate <usdc>|home <usdc>>
import { formatUnits, parseUnits } from 'viem';
import { AbfAssetIssuerAbi, CrossChainAllocatorAbi } from '../../abi';
import { E, eth, sendChecked, W, wc } from './config';
import { relayAll } from './relay';
import { bringHome, runBook } from './book';
import { navOfBook, rebalance, refill, report, settleQueue, shortfall, snapshot, vaultNeedsWork, inbound } from './vault';

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
  // Less whatever is already crossing back, so a refill whose relay is still pending is not asked for twice.
  const need = (await shortfall()) + (await refill());
  const coming = await inbound();
  const short = need > coming ? need - coming : 0n;
  console.log('book');
  await runBook(short);
  if (short > 0n) {
    console.log(`short ${usd(short)} for the queue and the buffer, bringing it home`);
    await bringHome(short);
  }
  console.log('rebalance');
  if (await rebalance()) {
    // Straight through: relay the allocation so the receiver subscribes it, then let the book wire it to custody
    // in the same tick rather than leaving it as issuer cash until the next one.
    await relayAll();
    await runBook();
  }
  await relayAll();
  console.log('report');
  await report();
  await settleQueue();
  await status();
}

/// Ticks for `minutes`: every two minutes, and at once whenever the vault has something to do. Between ticks it
/// reads the vault every five seconds, so a deposit is on its way to the book within seconds of landing rather
/// than at the next round number. GitHub runs a scheduled workflow hours late when it runs it at all, so the
/// clock lives here and the schedule only has to start a run before the last one ends. A tick that fails is
/// logged and retried on the next one, since a public endpoint failing once is weather; failing several times in
/// a row is an outage, and that ends the run in error so somebody is told.
async function loop() {
  const until = Date.now() + Number(arg ?? 350) * 60_000;
  const EVERY = 120_000;
  const WATCH = 5_000;
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
    // A failed tick waits the full interval rather than retrying on the next watch, so a fault that the vault's
    // state keeps triggering cannot spin.
    while (Date.now() < Math.min(started + EVERY, until)) {
      await Bun.sleep(WATCH);
      if (failedInARow > 0) continue;
      const busy = await vaultNeedsWork().catch(() => false);
      if (busy) {
        console.log('vault has work, ticking now');
        break;
      }
    }
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
