// The relayer and the attester. Reads MessageSent off each messenger, signs the keccak256 of the message the
// way Circle's attestation service does, and executes it through the contract named as its destinationCaller.
import { decodeEventLog, keccak256, parseAbiItem, slice, type Hex, type PublicClient } from 'viem';
import { AgamaL1ReceiverAbi, AttestedMessengerAbi, CrossChainAllocatorAbi } from '../../abi';
import { attester, E, eth, W, wc } from './config';
import { load, save } from './state';

const MessageSent = parseAbiItem('event MessageSent(bytes message)');

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
  const out = await scan(wc.public as PublicClient, W.messenger, state.wcBlock, 20_000);
  for (const m of out.messages) {
    const used = await eth.public.readContract({ address: E.messenger, abi: AttestedMessengerAbi, functionName: 'usedNonces', args: [nonceOf(m)] });
    if (used) continue;
    const hash = await eth.wallet.writeContract({ address: E.receiver, abi: AgamaL1ReceiverAbi, functionName: 'relay', args: [m, await attest(m)] });
    await eth.public.waitForTransactionReceipt({ hash });
    console.log(`  relayed to Ethereum   ${hash}`);
    done++;
  }

  // Ethereum to Whitechain: returns, settled by the allocator into the vault.
  const back = await scan(eth.public as PublicClient, E.messenger, state.ethBlock, 2_000);
  for (const m of back.messages) {
    const used = await wc.public.readContract({ address: W.messenger, abi: AttestedMessengerAbi, functionName: 'usedNonces', args: [nonceOf(m)] });
    if (used) continue;
    const hash = await wc.wallet.writeContract({ address: W.allocator, abi: CrossChainAllocatorAbi, functionName: 'settleReturn', args: [m, await attest(m)] });
    await wc.public.waitForTransactionReceipt({ hash });
    console.log(`  settled on Whitechain ${hash}`);
    done++;
  }

  // Rewind a little on each side so a log the RPC had not indexed yet is read next time; nonces make it idempotent.
  save({ wcBlock: Math.max(out.head - 300, state.wcBlock), ethBlock: Math.max(back.head - 20, state.ethBlock) });
  return done;
}
