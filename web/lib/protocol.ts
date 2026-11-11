'use client';

// Every read the app makes, and every write.
//
// Whitechain is read through wagmi, so the figures refresh with the wallet's chain state. Ethereum is read through
// a plain public client: nobody signs there from this app, so it has no business being in the wallet's config.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { parseAbiItem, type Address, type Hex } from 'viem';
import { useAccount, useConfig, usePublicClient, useReadContracts, useSwitchChain } from 'wagmi';
import { waitForTransactionReceipt, writeContract } from 'wagmi/actions';
import {
  AbfAssetIssuerAbi,
  AgamaL1ReceiverAbi,
  AgUSDAbi,
  CrossChainAllocatorAbi,
  TestUSDCAbi,
  UsdcFaucetAbi,
} from '@abi';
import { ETHEREUM, WHITECHAIN } from './deployments';
import { fmt } from './format';
import { useToasts } from '@/components/Toasts';
import { l1, whitechainSepolia } from './chains';

const chainId = whitechainSepolia.id;
const REFRESH = 8_000;

/// The book's target rate, the ABF partner's senior sleeve. Shown as a target because it is one: the realised
/// rate is the share price, which the chart reads off the chain.
export const BOOK_APR_BPS = 900;

export type VaultState = {
  totalAssets: bigint;
  totalSupply: bigint;
  sharePrice: bigint;
  idle: bigint;
  deployed: bigint;
  pending: bigint;
  unvested: bigint;
  liquid: bigint;
  depositCap: bigint;
  reserveBps: number;
  performanceFeeBps: number;
  lastReport: bigint;
  queueLength: bigint;
  paused: boolean;
};

export function useVault() {
  const q = useReadContracts({
    contracts: [
      { chainId, address: WHITECHAIN.agUSD, abi: AgUSDAbi, functionName: 'snapshot' },
      { chainId, address: WHITECHAIN.allocator, abi: CrossChainAllocatorAbi, functionName: 'totalSent' },
      { chainId, address: WHITECHAIN.allocator, abi: CrossChainAllocatorAbi, functionName: 'totalReturned' },
      { chainId, address: WHITECHAIN.agUSD, abi: AgUSDAbi, functionName: 'config' },
    ],
    allowFailure: false,
    query: { refetchInterval: REFRESH },
  });
  const [snap, totalSent, totalReturned, config] = q.data ?? [];
  return {
    ...q,
    vault: snap as VaultState | undefined,
    totalSent,
    totalReturned,
    config: config
      ? {
          depositCap: config[0],
          reserveBps: config[1],
          performanceFeeBps: config[2],
          maxNavChangeBps: config[3],
          minReportInterval: config[4],
          profitVestingPeriod: config[5],
          feeRecipient: config[6],
        }
      : undefined,
  };
}

/// The share price past its sixth decimal: assets over supply, both read on chain. sharePrice() rounds to the
/// USDC unit, and on a testnet a day of yield lives below it, so the rounded figure reads as a price that never moves.
export function precisePrice(v?: VaultState): number | undefined {
  if (!v) return undefined;
  if (v.totalSupply === 0n) return 1;
  return Number(v.totalAssets) / Number(v.totalSupply);
}

/// Net of the performance fee and of the buffer that earns nothing, so the figure is what a holder gets.
export function netApy(v?: VaultState): number | undefined {
  if (!v) return undefined;
  const working = v.totalAssets > 0n ? Number(v.deployed) / Number(v.totalAssets) : 0.8;
  return (BOOK_APR_BPS / 100) * Math.min(1, working) * (1 - v.performanceFeeBps / 10_000);
}

export function useUser() {
  const { address } = useAccount();
  const a = address ?? '0x0000000000000000000000000000000000000000';
  const q = useReadContracts({
    contracts: [
      { chainId, address: WHITECHAIN.usdc, abi: TestUSDCAbi, functionName: 'balanceOf', args: [a] },
      { chainId, address: WHITECHAIN.agUSD, abi: AgUSDAbi, functionName: 'balanceOf', args: [a] },
      { chainId, address: WHITECHAIN.usdc, abi: TestUSDCAbi, functionName: 'allowance', args: [a, WHITECHAIN.agUSD] },
      { chainId, address: WHITECHAIN.agUSD, abi: AgUSDAbi, functionName: 'maxWithdraw', args: [a] },
      { chainId, address: WHITECHAIN.agUSD, abi: AgUSDAbi, functionName: 'maxRedeem', args: [a] },
    ],
    allowFailure: false,
    query: { enabled: !!address, refetchInterval: REFRESH },
  });
  const [usdc, agusd, allowance, maxWithdraw, maxRedeem] = q.data ?? [];
  return { ...q, address, usdc, agusd, allowance, maxWithdraw, maxRedeem };
}

export type Book = {
  position: bigint;
  notes: bigint;
  received: bigint;
  sentHome: bigint;
  cash: bigint;
  offChain: bigint;
  issuerAssets: bigint;
  navUpdatedAt: bigint;
  maxOffChainBps: number;
};

/// The L1 side: the receiver's position and the issuer's book.
export function useBook() {
  return useQuery({
    queryKey: ['book'],
    refetchInterval: 15_000,
    queryFn: async (): Promise<Book> => {
      const r = { address: ETHEREUM.receiver, abi: AgamaL1ReceiverAbi } as const;
      const i = { address: ETHEREUM.issuer, abi: AbfAssetIssuerAbi } as const;
      const [position, notes, received, sentHome, cash, offChain, issuerAssets, navUpdatedAt, maxOffChainBps] =
        await l1.multicall({
          allowFailure: false,
          contracts: [
            { ...r, functionName: 'positionValue' },
            { ...r, functionName: 'noteBalance' },
            { ...r, functionName: 'totalReceived' },
            { ...r, functionName: 'totalSentHome' },
            { ...i, functionName: 'cash' },
            { ...i, functionName: 'offChainAssets' },
            { ...i, functionName: 'totalAssets' },
            { ...i, functionName: 'navUpdatedAt' },
            { ...i, functionName: 'maxOffChainBps' },
          ],
        });
      return { position, notes, received, sentHome, cash, offChain, issuerAssets, navUpdatedAt, maxOffChainBps };
    },
  });
}

// ---------------------------------------------------------------------------
// History, read off the logs
// ---------------------------------------------------------------------------

const NavReported = parseAbiItem(
  'event NavReported(uint256 previous, uint256 current, uint256 feeShares, uint256 totalAssets, uint256 sharePrice)',
);
const RedeemRequested = parseAbiItem(
  'event RedeemRequested(uint256 indexed id, address indexed owner, address indexed receiver, uint256 shares, uint256 assets)',
);
const Allocated = parseAbiItem('event Allocated(uint256 amount, bytes32 indexed remoteReceiver, uint256 totalSent)');
const ReturnSettled = parseAbiItem('event ReturnSettled(bytes32 indexed nonce, uint256 amount, uint256 totalReturned)');
const OffRamped = parseAbiItem('event OffRamped(uint256 amount, address indexed custody, bytes32 indexed wireRef)');
const OnRamped = parseAbiItem(
  'event OnRamped(uint256 amount, uint256 principal, address indexed custody, bytes32 indexed wireRef)',
);
const BookMarked = parseAbiItem(
  'event NavReported(uint256 previous, uint256 current, bytes32 indexed reportHash, uint256 totalAssets)',
);
const Subscribed = parseAbiItem('event Subscribed(uint256 assets, uint256 shares)');

/// getLogs over a range in the chunks the public endpoints accept, eight at a time. Whitechain's RPC caps a query
/// at 10,000 blocks, which at one block a second is under three hours, so a week of history is sixty queries and
/// reading them one after another is what makes a page sit on its loading line.
async function logsInChunks<T>(
  fetch: (from: bigint, to: bigint) => Promise<T[]>,
  from: bigint,
  head: bigint,
  chunk: bigint,
): Promise<T[]> {
  const ranges: [bigint, bigint][] = [];
  for (let start = from; start <= head; start += chunk) {
    ranges.push([start, start + chunk - 1n > head ? head : start + chunk - 1n]);
  }
  const out: T[] = [];
  for (let i = 0; i < ranges.length; i += 8) {
    const batch = await Promise.all(ranges.slice(i, i + 8).map(([f, t]) => fetch(f, t)));
    for (const logs of batch) out.push(...logs);
  }
  return out;
}

const WC_LOG_RANGE = 10_000n;

/// What each log query has already read, kept for the life of the tab. The activity feed refetches every 30 seconds
/// and used to read the whole history since deployment each time: over a million Whitechain blocks, so more than
/// 300 getLogs a minute from one open tab, which is what got the Whitechain RPC answering 429. A refetch now reads
/// only the blocks since the last one, with a small overlap for a log a node had not indexed yet, deduplicated.
const scanned = new Map<string, { to: bigint; logs: any[] }>();
const OVERLAP = 32n;

async function logsSince<T extends { transactionHash: Hex | null; logIndex: number | null }>(
  key: string,
  fetch: (from: bigint, to: bigint) => Promise<T[]>,
  from: bigint,
  head: bigint,
  chunk: bigint,
): Promise<T[]> {
  const seen = scanned.get(key);
  const start = seen ? (seen.to - OVERLAP > from ? seen.to - OVERLAP : from) : from;
  if (seen && start > head) return seen.logs;
  const fresh = await logsInChunks(fetch, start, head, chunk);
  const ids = new Set((seen?.logs ?? []).map((l: T) => `${l.transactionHash}:${l.logIndex}`));
  const logs = [...(seen?.logs ?? []), ...fresh.filter((l) => !ids.has(`${l.transactionHash}:${l.logIndex}`))];
  scanned.set(key, { to: head, logs });
  return logs;
}

export type Event = {
  chain: 'whitechain' | 'ethereum';
  kind: string;
  amount: bigint;
  block: bigint;
  tx: Hex;
  ts?: number;
  detail?: string;
};

/// The route as it actually ran: every crossing, subscription, wire, mark and collection, both chains, newest
/// first. The chart's LIVE range is drawn from its marks.
export function useActivity() {
  const wc = usePublicClient({ chainId });
  return useQuery({
    queryKey: ['activity'],
    enabled: !!wc && WHITECHAIN.deployedAtBlock > 0n,
    refetchInterval: 30_000,
    queryFn: async (): Promise<{ events: Event[]; navs: { ts: number; price: bigint; block: bigint }[] }> => {
      const wHead = await wc!.getBlockNumber();
      // Ethereum is optional here: without its head the feed still shows Whitechain's rows and the LIVE marks.
      const eHead = await l1.getBlockNumber().catch(() => null);
      const wLogs = (event: any, address: Address) =>
        logsSince(`wc:${address}:${event.name}`, (f, t) => wc!.getLogs({ address, event, fromBlock: f, toBlock: t }) as any, WHITECHAIN.deployedAtBlock, wHead, WC_LOG_RANGE);
      const eLogs = (event: any, address: Address) =>
        eHead === null ? Promise.resolve([] as any[]) : logsSince(`eth:${address}:${event.name}`, (f, t) => l1.getLogs({ address, event, fromBlock: f, toBlock: t }) as any, ETHEREUM.deployedAtBlock, eHead!, 5_000n);

      // Each source stands alone. The public Sepolia endpoints refuse old ranges or rate limit often enough that one
      // of these failing is routine, and with Promise.all that one failure threw away the Whitechain marks too, so
      // the LIVE chart said no mark had been recorded over hundreds of them. A source that fails shows nothing this
      // time, and since logsSince only keeps what succeeded, the next refetch tries it again.
      const orNone = (p: Promise<any[]>) => p.catch(() => [] as any[]);
      const [navs, allocs, returns, subs, offs, ons, marks] = await Promise.all([
        orNone(wLogs(NavReported, WHITECHAIN.agUSD)),
        orNone(wLogs(Allocated, WHITECHAIN.allocator)),
        orNone(wLogs(ReturnSettled, WHITECHAIN.allocator)),
        orNone(eLogs(Subscribed, ETHEREUM.receiver)),
        orNone(eLogs(OffRamped, ETHEREUM.issuer)),
        orNone(eLogs(OnRamped, ETHEREUM.issuer)),
        orNone(eLogs(BookMarked, ETHEREUM.issuer)),
      ]);

      // When each row happened, from one block per chain rather than one request per row. Whitechain is an OP
      // Stack chain with a block exactly every second, so its times are exact; Sepolia slots are twelve seconds,
      // missed slots aside, which is close enough for "4m ago". Fetching every block's header instead is what got
      // the public Sepolia endpoint to answer 429 to a single page load.
      const [wRef, eRef] = await Promise.all([
        wc!.getBlock({ blockNumber: wHead }),
        eHead === null ? null : l1.getBlock({ blockNumber: eHead }).catch(() => null),
      ]);
      const timeOf = (ref: { number: bigint | null; timestamp: bigint }, secs: number) => (n: bigint) =>
        Number(ref.timestamp) - Number((ref.number ?? 0n) - n) * secs;
      const wAt = timeOf(wRef, 1);
      const eAt = eRef ? timeOf(eRef, 12) : () => undefined;
      const wTimes = { get: (b: string) => wAt(BigInt(b)) };
      const eTimes = { get: (b: string) => eAt(BigInt(b)) };

      const row = (chain: Event['chain'], kind: string, l: any, amount: bigint, detail?: string): Event => ({
        chain,
        kind,
        amount,
        block: l.blockNumber,
        tx: l.transactionHash,
        ts: (chain === 'whitechain' ? wTimes : eTimes).get(String(l.blockNumber)),
        detail,
      });

      const events: Event[] = [
        ...allocs.map((l: any) => row('whitechain', 'Allocated to the L1', l, l.args.amount)),
        ...returns.map((l: any) => row('whitechain', 'Returned to the vault', l, l.args.amount)),
        ...navs.map((l: any) => row('whitechain', 'Vault marked', l, l.args.current, `price ${(Number(l.args.sharePrice) / 1e6).toFixed(6)}`)),
        ...subs.map((l: any) => row('ethereum', 'Subscribed to the issuer', l, l.args.assets)),
        ...offs.map((l: any) => row('ethereum', 'Wired to custody', l, l.args.amount)),
        ...ons.map((l: any) => row('ethereum', 'Collections on-ramped', l, l.args.amount)),
        ...marks.map((l: any) => row('ethereum', 'Book marked', l, l.args.current, `tape ${String(l.args.reportHash).slice(0, 10)}…`)),
      ].sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));

      return {
        events,
        navs: navs.map((l: any) => ({ ts: wTimes.get(String(l.blockNumber)) ?? 0, price: l.args.sharePrice, block: l.blockNumber })),
      };
    },
  });
}

export type Request = { id: bigint; shares: bigint; assets: bigint; ts?: number; settled: boolean; tx: Hex };

/// This wallet's queued exits, and which of them have been paid.
export function useRequests() {
  const { address } = useAccount();
  const wc = usePublicClient({ chainId });
  return useQuery({
    queryKey: ['requests', address],
    enabled: !!address && !!wc && WHITECHAIN.deployedAtBlock > 0n,
    refetchInterval: REFRESH,
    queryFn: async (): Promise<Request[]> => {
      const head = await wc!.getBlockNumber();
      const logs = await logsSince(
        `wc:requests:${address}`,
        (f, t) => wc!.getLogs({ address: WHITECHAIN.agUSD, event: RedeemRequested, args: { owner: address }, fromBlock: f, toBlock: t }) as any,
        WHITECHAIN.deployedAtBlock,
        head,
        WC_LOG_RANGE,
      );
      const next = (await wc!.readContract({ address: WHITECHAIN.agUSD, abi: AgUSDAbi, functionName: 'nextToSettle' })) as bigint;
      return logs
        .map((l: any) => ({
          id: l.args.id as bigint,
          shares: l.args.shares as bigint,
          assets: l.args.assets as bigint,
          settled: (l.args.id as bigint) < next,
          tx: l.transactionHash as Hex,
        }))
        .reverse();
    },
  });
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/// A wallet error, trimmed to the sentence a person can act on.
export function reason(e: unknown): string {
  const err = e as { shortMessage?: string; message?: string; name?: string };
  if (err?.name === 'UserRejectedRequestError' || /rejected|denied/i.test(err?.message ?? '')) {
    return 'You declined it in the wallet.';
  }
  return err?.shortMessage ?? err?.message ?? 'The transaction failed.';
}

export function useActions() {
  const config = useConfig();
  const qc = useQueryClient();
  const toast = useToasts();
  const { chainId: walletChain } = useAccount();
  const { switchChainAsync } = useSwitchChain();

  async function send(title: string, done: string, req: Parameters<typeof writeContract>[1]) {
    const id = toast.start(title);
    try {
      if (walletChain !== chainId) await switchChainAsync({ chainId });
      const hash = await writeContract(config, { ...req, chainId } as any);
      toast.hash(id, hash);
      const receipt = await waitForTransactionReceipt(config, { hash, chainId });
      if (receipt.status !== 'success') throw new Error('The transaction reverted.');
      toast.done(id, done);
      await qc.invalidateQueries();
      return hash;
    } catch (e) {
      toast.fail(id, reason(e));
      throw new Error(reason(e));
    }
  }

  return {
    faucet: () =>
      send('Mock USDC from the faucet', '10,000 mock USDC is in your wallet.', {
        address: WHITECHAIN.usdcFaucet, abi: UsdcFaucetAbi, functionName: 'drip',
      } as any),
    approve: (amount: bigint) =>
      send('Approve USDC for agUSD', 'The vault can take your deposit.', {
        address: WHITECHAIN.usdc, abi: TestUSDCAbi, functionName: 'approve', args: [WHITECHAIN.agUSD, amount],
      } as any),
    deposit: (amount: bigint, receiver: Address) =>
      send(`Deposit ${fmt(amount)} USDC`, 'agUSD minted. It is earning from this block.', {
        address: WHITECHAIN.agUSD, abi: AgUSDAbi, functionName: 'deposit', args: [amount, receiver],
      } as any),
    redeem: (shares: bigint, owner: Address) =>
      send(`Withdraw ${fmt(shares)} agUSD`, 'USDC is in your wallet.', {
        address: WHITECHAIN.agUSD, abi: AgUSDAbi, functionName: 'redeem', args: [shares, owner, owner],
      } as any),
    requestRedeem: (shares: bigint, owner: Address) =>
      send(`Queue ${fmt(shares)} agUSD`, 'Priced now, paid as cash comes home. See Portfolio.', {
        address: WHITECHAIN.agUSD, abi: AgUSDAbi, functionName: 'requestRedeem', args: [shares, owner, owner],
      } as any),
    settle: () =>
      send('Settle the queue', 'Paid what the cash covers.', {
        address: WHITECHAIN.agUSD, abi: AgUSDAbi, functionName: 'settleRedemptions', args: [16n],
      } as any),
  };
}
