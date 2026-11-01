// bun src/e2e.ts
//
// The product end to end on the live testnets, as a holder who is not the deployer: a fresh key gets gas and test
// USDC, deposits, leaves instantly within the buffer, then asks for more than the buffer holds. The keeper has to
// bring cash home from the issuer on Ethereum over the messenger to pay it. Every step asserts what it expects
// and prints the transaction it rests on, so a run is evidence and not a log.
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { formatUnits, parseEther, parseUnits, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createWalletClient, http } from 'viem';
import { AbfAssetIssuerAbi, AgamaL1ReceiverAbi, AgUSDAbi, TestUSDCAbi, UsdcFaucetAbi } from '../../abi';
import { E, eth, W, wc } from './config';
import { relayAll } from './relay';
import { bringHome, runBook } from './book';
import { rebalance, report, settleQueue, shortfall, snapshot } from './vault';

const EXPLORER = 'https://explorer.testnet.whitechain.io/tx/';
const usd = (v: bigint) => `$${formatUnits(v, 6)}`;
let failures = 0;

function check(ok: boolean, what: string) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures++;
}

// The holder's key is written down before anything is sent to it, so a run that dies halfway leaves funds a
// person can still withdraw rather than a balance on a key nobody has. Two runs did, before this.
const key = generatePrivateKey();
const holder = privateKeyToAccount(key);
appendFileSync(resolve(import.meta.dir, '../e2e-holders.txt'), `${new Date().toISOString()} ${holder.address} ${key}\n`, { mode: 0o600 });
const me = createWalletClient({ chain: wc.public.chain, transport: http(), account: holder });

async function as(fn: string, args: unknown[], address: Hex = W.agUSD, abi: any = AgUSDAbi) {
  const hash = await me.writeContract({ address, abi, functionName: fn, args } as any);
  const r = await wc.public.waitForTransactionReceipt({ hash });
  check(r.status === 'success', `${fn} ${EXPLORER}${hash}`);
  return hash;
}
const read = <T>(fn: string, args: unknown[] = [], address: Hex = W.agUSD, abi: any = AgUSDAbi) =>
  wc.public.readContract({ address, abi, functionName: fn, args } as any) as Promise<T>;
const ethRead = <T>(fn: string, address: Hex, abi: any) =>
  eth.public.readContract({ address, abi, functionName: fn } as any) as Promise<T>;

console.log(`holder ${holder.address}\n`);

// 1. Gas, from the deployer, the way somebody would get it from the faucet.
console.log('1. gas');
const gas = await wc.wallet.sendTransaction({ to: holder.address, value: parseEther('0.01') });
await wc.public.waitForTransactionReceipt({ hash: gas });
check((await wc.public.getBalance({ address: holder.address })) === parseEther('0.01'), `0.01 WBT ${EXPLORER}${gas}`);

// 2. Mock USDC from the faucet, twice in a row: the faucet the app uses has no cooldown.
console.log('2. faucet');
await as('drip', [], W.usdcFaucet, UsdcFaucetAbi);
check((await read<bigint>('balanceOf', [holder.address], W.usdc, TestUSDCAbi)) === 10_000_000_000n, '10,000 USDC arrived');
await as('drip', [], W.usdcFaucet, UsdcFaucetAbi);
check((await read<bigint>('balanceOf', [holder.address], W.usdc, TestUSDCAbi)) === 20_000_000_000n, 'a second drip straight after is paid too');

// 3. Deposit the whole drip at the live price. The queued exit in step 6 needs the holder's stake to be more than
// the buffer, which is a tenth of the vault, so the stake is sized against the vault rather than fixed: with
// 5,000 into a vault that had grown past 20,000, a larger buffer covered the "queued" exit and paid it on the spot.
console.log('3. deposit');
const s0 = await snapshot();
const amount = parseUnits('10000', 6);
if ((s0.totalAssets + amount) / 10n >= amount - parseUnits('250', 6)) {
  console.log(`  the vault holds ${usd(s0.totalAssets)}; a 10,000 stake would fit in its buffer, so step 6 cannot queue`);
  process.exit(1);
}
const preview = await read<bigint>('previewDeposit', [amount]);
await as('approve', [W.agUSD, amount], W.usdc, TestUSDCAbi);
await as('deposit', [amount, holder.address]);
const shares = await read<bigint>('balanceOf', [holder.address]);
// Profit unlocks by the second, so a preview read a block earlier is exact only up to what unlocked in between:
// the shares can be a hair fewer, never more. In-block exactness is what the forge suite pins.
check(shares <= preview && preview - shares <= preview / 100_000n, `minted ${formatUnits(shares, 6)} agUSD, the preview less what unlocked meanwhile`);
const s1 = await snapshot();
const grew = s1.totalAssets - s0.totalAssets;
check(grew >= amount && grew - amount < parseUnits('0.1', 6), `vault assets ${usd(s0.totalAssets)} -> ${usd(s1.totalAssets)}`);
check(s1.sharePrice >= s0.sharePrice, 'a deposit does not lower the price');

// 4. Out instantly, within the buffer.
console.log('4. instant exit');
const maxR = await read<bigint>('maxRedeem', [holder.address]);
check(maxR > 0n && maxR <= shares, `maxRedeem ${formatUnits(maxR, 6)} reports the buffer`);
const small = parseUnits('250', 6);
const outPreview = await read<bigint>('previewRedeem', [small]);
const before = await read<bigint>('balanceOf', [holder.address], W.usdc, TestUSDCAbi);
await as('redeem', [small, holder.address, holder.address]);
const got = (await read<bigint>('balanceOf', [holder.address], W.usdc, TestUSDCAbi)) - before;
check(got >= outPreview && got - outPreview < parseUnits('0.01', 6), `received ${usd(got)}, the preview or a hair more`);

// 5. The keeper sends everything above the 10% reserve floor to the book: over the messenger to Ethereum, into
// the issuer, and out to custody as receivables, in one pass.
console.log('5. keeper: allocate, relay, run the book, mark');
const bookBefore = await ethRead<bigint>('offChainAssets', E.issuer, AbfAssetIssuerAbi);
const positionBefore = await ethRead<bigint>('positionValue', E.receiver, AgamaL1ReceiverAbi);
const liquidBefore = (await snapshot()).liquid;
await relayAll();
const moved = await rebalance();
check(moved, 'everything above the reserve floor was allocated');
await relayAll();
await runBook();
await report();
const s2 = await snapshot();
const sent = liquidBefore - s2.liquid;
// The keeper keeps a basis point over the floor so an allocation is never refused on a second of unlocking.
check(s2.liquid * 10_000n <= s2.totalAssets * 1_002n + parseUnits('1', 6) * 10_000n, `buffer down to the 10% floor: ${usd(s2.liquid)} of ${usd(s2.totalAssets)}`);
const positionAfter = await ethRead<bigint>('positionValue', E.receiver, AgamaL1ReceiverAbi);
check(positionAfter - positionBefore >= sent - parseUnits('1', 6), `the L1 receiver subscribed it: position ${usd(positionBefore)} -> ${usd(positionAfter)}`);
const bookAfter = await ethRead<bigint>('offChainAssets', E.issuer, AbfAssetIssuerAbi);
check(bookAfter > bookBefore, `the issuer wired it to custody: book ${usd(bookBefore)} -> ${usd(bookAfter)}`);
check(s2.sharePrice >= s1.sharePrice, `price ${formatUnits(s1.sharePrice, 6)} -> ${formatUnits(s2.sharePrice, 6)}`);

// 6. Ask for more than the buffer holds: it queues at today's price.
console.log('6. queued exit');
const rest = await read<bigint>('balanceOf', [holder.address]);
const maxNow = await read<bigint>('maxRedeem', [holder.address]);
check(rest > maxNow, `holding ${formatUnits(rest, 6)} agUSD, only ${formatUnits(maxNow, 6)} instant`);
const preview2 = await read<bigint>('previewRedeem', [rest]);
const pendingBefore = (await snapshot()).pending;
const usdcBefore = await read<bigint>('balanceOf', [holder.address], W.usdc, TestUSDCAbi);
await as('requestRedeem', [rest, holder.address, holder.address]);
check((await read<bigint>('balanceOf', [holder.address])) === 0n, 'shares burned at request');
const s3 = await snapshot();
// The price is fixed in the request's own block, and profit unlocks by the second, so it can sit a hair above the
// preview read a block earlier. What the holder is owed is what the vault recorded, not what was previewed.
const owed = s3.pending - pendingBefore;
check(owed >= preview2, `queue owes ${usd(owed)}, at least the ${usd(preview2)} previewed`);

// 7. The keeper brings cash home from Ethereum and the queue pays.
console.log('7. keeper: collections home over the messenger, settle the queue');
const short = await shortfall();
check(short > 0n, `short ${usd(short)} on Whitechain`);
await bringHome(short + parseUnits('1', 6));
await relayAll();
await settleQueue();
const paid = (await read<bigint>('balanceOf', [holder.address], W.usdc, TestUSDCAbi)) - usdcBefore;
check(paid === owed, `holder paid ${usd(paid)}, exactly what the request fixed`);
const s4 = await snapshot();
check(s4.pending === 0n && s4.queueLength === 0n, 'queue empty');

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
