// The issuer's side of the trade, simulated: wire the cash to custody, accrue the receivables, mark the book,
// and bring collections home when the vault needs them. In production each of these is the ABF partner's
// operations team; here it is a key and a clock.
import { keccak256, toHex, type Hex } from 'viem';
import { AbfAssetIssuerAbi, AgamaL1ReceiverAbi, TestUSDCAbi } from '../../abi';
import { BOOK, E, eth } from './config';

const YEAR = 365n * 24n * 3600n;
const read = <T>(functionName: string, args: unknown[] = [], address: Hex = E.issuer, abi: any = AbfAssetIssuerAbi) =>
  eth.public.readContract({ address, abi, functionName, args } as any) as Promise<T>;

async function send(address: Hex, abi: any, functionName: string, args: unknown[]) {
  const hash = await eth.wallet.writeContract({ address, abi, functionName, args } as any);
  await eth.public.waitForTransactionReceipt({ hash });
  console.log(`  ${functionName.padEnd(18)} ${hash}`);
  return hash;
}

const ref = (label: string) => keccak256(toHex(`${label}:${Date.now()}`));

/// A loan tape for the period: the receivables the book holds, as the administrator would send them. Only its
/// hash goes on chain, which is the point: the figure on chain names the document that justifies it.
function loanTape(book: bigint, at: number) {
  const lines = ['Trade receivables, EU SMEs', 'Equipment leases, Benelux', 'Consumer instalments, DACH'];
  const weights = [50n, 30n, 20n];
  return JSON.stringify({
    asOf: new Date(at * 1000).toISOString(),
    aprBps: BOOK.aprBps,
    pools: lines.map((name, i) => ({ name, outstanding: ((book * weights[i]) / 100n).toString() })),
  });
}

export async function runBook() {
  const [cash, offChain, totalAssets, navAt] = await Promise.all([
    read<bigint>('cash'),
    read<bigint>('offChainAssets'),
    read<bigint>('totalAssets'),
    read<bigint>('navUpdatedAt'),
  ]);
  const now = BigInt(Math.floor(Date.now() / 1000));

  // 1. Accrue what the book earned since it was last marked.
  if (offChain > 0n && navAt > 0n && now > navAt) {
    const accrued = (offChain * BigInt(BOOK.aprBps) * (now - navAt)) / (10_000n * YEAR);
    if (accrued > 0n) {
      const next = offChain + accrued;
      await send(E.issuer, AbfAssetIssuerAbi, 'reportNav', [next, keccak256(toHex(loanTape(next, Number(now))))]);
    }
  }

  // 2. Wire the cash above the issuer's own buffer to custody.
  // Rounded up: the contract caps the book at floor(90%) of its assets, so the cash kept has to be the ceiling of
  // the other 10% or the wire overshoots the cap by one unit and is refused.
  const keep = (totalAssets * BigInt(BOOK.cashBps) + 9_999n) / 10_000n;
  if (cash > keep + 1_000_000n) {
    await send(E.issuer, AbfAssetIssuerAbi, 'offRamp', [cash - keep, ref('wire')]);
    if (navAt === 0n || offChain === 0n) {
      // Start the clock on a fresh book.
      const book = await read<bigint>('offChainAssets');
      await send(E.issuer, AbfAssetIssuerAbi, 'reportNav', [book, keccak256(toHex(loanTape(book, Number(now))))]);
    }
  }
}

/// Brings `amount` home: custody on-ramps it (the interest part minted, standing in for borrowers' payments),
/// the receiver redeems that much of its notes and burns the cash back to Whitechain.
export async function bringHome(amount: bigint) {
  const cash = await read<bigint>('cash');
  if (cash < amount) {
    const need = amount - cash + 1_000_000n;
    const custodyBal = await read<bigint>('balanceOf', [E.custody], E.usdc, TestUSDCAbi);
    if (custodyBal < need) await send(E.usdc, TestUSDCAbi, 'mint', [E.custody, need - custodyBal]);
    await send(E.issuer, AbfAssetIssuerAbi, 'onRamp', [need, ref('collections')]);
  }
  const shares = await read<bigint>('previewWithdraw', [amount]);
  const held = await read<bigint>('noteBalance', [], E.receiver, AgamaL1ReceiverAbi);
  await send(E.receiver, AgamaL1ReceiverAbi, 'redeemAndSendHome', [shares > held ? held : shares]);
}
