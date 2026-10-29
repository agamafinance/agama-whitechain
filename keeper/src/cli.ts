// bun src/cli.ts <status|tick|relay|allocate <usdc>|home <usdc>>
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
  console.log('book');
  await runBook();
  const short = (await shortfall()) + (await refill());
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

const [cmd, arg] = process.argv.slice(2);
const run: Record<string, () => Promise<unknown>> = {
  status,
  tick,
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
  console.error('usage: bun src/cli.ts <status|tick|relay|allocate <usdc>|home <usdc>>');
  process.exit(1);
}
await run[cmd]();
