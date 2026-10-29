// The Whitechain side: rebalance the buffer, mark the vault to the L1 position, and settle the queue.
import type { Hex } from 'viem';
import { AgamaL1ReceiverAbi, AgUSDAbi, CrossChainAllocatorAbi } from '../../abi';
import { BUFFER, E, eth, sendChecked, W, wc } from './config';

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

export async function rebalance() {
  const s = await snapshot();
  const target = (s.totalAssets * BigInt(BUFFER.targetBps)) / 10_000n;
  const trigger = (s.totalAssets * BigInt(BUFFER.triggerBps)) / 10_000n;
  if (s.liquid > trigger && s.liquid - target > 1_000_000n) {
    await send(W.allocator, CrossChainAllocatorAbi, 'allocate', [s.liquid - target]);
    return true;
  }
  return false;
}

/// How much the buffer needs to be whole again, once it has fallen under the refill line. Paying the queue can
/// drain it to nothing, and an empty buffer turns the next instant exit into a queued one.
export async function refill() {
  const s = await snapshot();
  const line = (s.totalAssets * BigInt(BUFFER.refillBps)) / 10_000n;
  const target = (s.totalAssets * BigInt(BUFFER.targetBps)) / 10_000n;
  return s.liquid < line && s.deployed > 0n ? target - s.liquid : 0n;
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
  if (s.lastReport !== 0n && now < s.lastReport + BigInt(minReportInterval)) return;
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
