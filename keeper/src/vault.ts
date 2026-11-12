// The Whitechain side: rebalance the buffer, mark the vault to the L1 position, and settle the queue.
import type { Hex } from 'viem';
import { AgamaL1ReceiverAbi, AgUSDAbi, CrossChainAllocatorAbi } from '../../abi';
import { BUFFER, E, eth, REPORT, sendChecked, W, wc } from './config';

const send = (address: Hex, abi: any, functionName: string, args: unknown[]) =>
  sendChecked(wc, { address, abi, functionName, args });

export const snapshot = () => wc.public.readContract({ address: W.agUSD, abi: AgUSDAbi, functionName: 'snapshot' });

/// What the vault's deployed capital is worth: the L1 position plus whatever is still crossing in either
/// direction, because a burn that has not been minted yet is in flight, not lost.
export async function navOfBook() {
  const [position, received, sentHome] = await Promise.all([
    eth.public.readContract({ address: E.receiver, abi: AgamaL1ReceiverAbi, functionName: 'positionValue' }),
    eth.public.readContract({ address: E.receiver, abi: AgamaL1ReceiverAbi, functionName: 'totalReceived' }),
    eth.public.readContract({ address: E.receiver, abi: AgamaL1ReceiverAbi, functionName: 'totalSentHome' }),
  ]);
  const [sent, returned] = await Promise.all([
    wc.public.readContract({ address: W.allocator, abi: CrossChainAllocatorAbi, functionName: 'totalSent' }),
    wc.public.readContract({ address: W.allocator, abi: CrossChainAllocatorAbi, functionName: 'totalReturned' }),
  ]);
  return position + (sent - received) + (sentHome - returned);
}

/// The buffer the vault must keep: its reserve floor, rounded up the way `pushToStrategy` rounds it, plus a margin.
/// Profit unlocks by the second, so total assets, and the floor with them, rise between the read here and the
/// block the allocation lands in: sized to the floor exactly, one was refused by seven micro-dollars. A cent, or
/// a basis point of the vault when that is more, covers far more than a block of unlocking.
async function floor(totalAssets: bigint) {
  const cfg = await wc.public.readContract({ address: W.agUSD, abi: AgUSDAbi, functionName: 'config' });
  const reserveBps = BigInt(cfg[1]);
  const margin = totalAssets / 10_000n > 10_000n ? totalAssets / 10_000n : 10_000n;
  return (totalAssets * reserveBps + 9_999n) / 10_000n + margin;
}

/// Sends everything above the reserve floor to the book.
export async function rebalance() {
  const s = await snapshot();
  const target = await floor(s.totalAssets);
  if (s.liquid > target && s.liquid - target >= BUFFER.minMove) {
    await send(W.allocator, CrossChainAllocatorAbi, 'allocate', [s.liquid - target]);
    return true;
  }
  return false;
}

/// How much the buffer needs to be back at the floor, once it has fallen under half of it. Paying the queue can
/// drain it to nothing, and an empty buffer turns the next instant exit into a queued one.
export async function refill() {
  const s = await snapshot();
  const target = await floor(s.totalAssets);
  return s.liquid < target / 2n && s.deployed > 0n ? target - s.liquid : 0n;
}

/// Cash already burned on Ethereum on its way back to the vault and not yet settled there. Counted against what
/// the vault needs, so a refill whose relay is still pending is not asked for a second time.
export async function inbound() {
  const [sentHome, returned] = await Promise.all([
    eth.public.readContract({ address: E.receiver, abi: AgamaL1ReceiverAbi, functionName: 'totalSentHome' }),
    wc.public.readContract({ address: W.allocator, abi: CrossChainAllocatorAbi, functionName: 'totalReturned' }),
  ]);
  return sentHome > returned ? sentHome - returned : 0n;
}

/// Whether the vault has something for the keeper right now: cash above the floor to send, a queue the idle cash
/// does not cover, or a buffer under half the floor. One read on Whitechain, cheap enough to ask every few seconds;
/// Ethereum is read only when the vault is short, to see whether the cash is already on its way.
export async function vaultNeedsWork() {
  const s = await snapshot();
  const target = await floor(s.totalAssets);
  if (s.liquid > target && s.liquid - target >= BUFFER.minMove) return true;
  const short = s.pending > s.idle || (s.liquid < target / 2n && s.deployed > 0n);
  return short && (await inbound()) === 0n;
}

/// How much the queue needs from the book: what is owed beyond the cash already here, plus the buffer target.
export async function shortfall() {
  const s = await snapshot();
  const idle = s.idle;
  return s.pending > idle ? s.pending - idle : 0n;
}

export async function report() {
  const [s, cfg, nav] = await Promise.all([
    snapshot(),
    wc.public.readContract({ address: W.agUSD, abi: AgUSDAbi, functionName: 'config' }),
    navOfBook(),
  ]);
  const [, , , maxNavChangeBps, minReportInterval] = cfg;
  const now = BigInt(Math.floor(Date.now() / 1000));
  const every = BigInt(minReportInterval) > REPORT.everySec ? BigInt(minReportInterval) : REPORT.everySec;
  if (s.lastReport !== 0n && now < s.lastReport + every) return;
  if (s.deployed === 0n) return;
  // A move larger than the guard is walked there in steps rather than refused.
  const max = (s.deployed * BigInt(maxNavChangeBps)) / 10_000n;
  let next = nav;
  if (nav > s.deployed + max) next = s.deployed + max;
  if (nav + max < s.deployed) next = s.deployed - max;
  if (next === s.deployed) return;
  await send(W.agUSD, AgUSDAbi, 'reportNav', [next]);
}

export async function settleQueue() {
  const s = await snapshot();
  if (s.queueLength > 0n && s.idle > 0n) await send(W.agUSD, AgUSDAbi, 'settleRedemptions', [16n]);
}
