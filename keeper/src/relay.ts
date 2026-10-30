// The relayer and the attester. Reads MessageSent off each messenger, signs the keccak256 of the message the
// way Circle's attestation service does, and executes it through the contract named as its destinationCaller.
import { decodeEventLog, keccak256, parseAbiItem, slice, type Hex, type PublicClient } from 'viem';
import { AgamaL1ReceiverAbi, AttestedMessengerAbi, CrossChainAllocatorAbi } from '../../abi';
import { attester, E, eth, sendChecked, W, wc } from './config';
import { load, save } from './state';

const MessageSent = parseAbiItem('event MessageSent(bytes message)');

// The widest getLogs range each side's public endpoints answer: Whitechain's caps at 10,000 blocks, and the
// Sepolia ones at 1,000 (thirdweb lowered its cap from 2,000 without notice, which stalled every tick).
const WC_LOG_RANGE = 10_000;
const ETH_LOG_RANGE = 1_000;

async function scan(client: PublicClient, address: Hex, from: number, chunk: number) {
  const head = Number(await client.getBlockNumber());
  const messages: Hex[] = [];
  for (let start = from; start <= head; start += chunk) {
    const end = Math.min(start + chunk - 1, head);
    const logs = await client.getLogs({ address, event: MessageSent, fromBlock: BigInt(start), toBlock: BigInt(end) });
    for (const l of logs) messages.push(decodeEventLog({ abi: [MessageSent], data: l.data, topics: l.topics }).args.message);
  }
  return { messages, head };
}

const nonceOf = (m: Hex) => slice(m, 12, 44);

export async function attest(message: Hex): Promise<Hex> {
  return attester.sign({ hash: keccak256(message) });
}

export async function relayAll(): Promise<number> {
  const state = load();
  let done = 0;

  // Whitechain to Ethereum: allocations, executed by the receiver, which subscribes them.
  const out = await scan(wc.public as PublicClient, W.messenger, state.wcBlock, WC_LOG_RANGE);
  for (const m of out.messages) {
    const used = await eth.public.readContract({ address: E.messenger, abi: AttestedMessengerAbi, functionName: 'usedNonces', args: [nonceOf(m)] });
    if (used) continue;
    await sendChecked(eth, { address: E.receiver, abi: AgamaL1ReceiverAbi, functionName: 'relay', args: [m, await attest(m)] }, 'relayed to Ethereum');
    done++;
  }
  // Each side's progress is kept as soon as it is read, so a failure on the other side does not rescan it.
  // Rewind a little so a log the RPC had not indexed yet is read next time; nonces make that idempotent.
  save({ ...state, wcBlock: Math.max(out.head - 300, state.wcBlock) });

  // Ethereum to Whitechain: returns, settled by the allocator into the vault.
  const back = await scan(eth.public as PublicClient, E.messenger, state.ethBlock, ETH_LOG_RANGE);
  for (const m of back.messages) {
    const used = await wc.public.readContract({ address: W.messenger, abi: AttestedMessengerAbi, functionName: 'usedNonces', args: [nonceOf(m)] });
    if (used) continue;
    await sendChecked(wc, { address: W.allocator, abi: CrossChainAllocatorAbi, functionName: 'settleReturn', args: [m, await attest(m)] }, 'settled on Whitechain');
    done++;
  }

  save({ ...load(), ethBlock: Math.max(back.head - 20, state.ethBlock) });
  return done;
}
