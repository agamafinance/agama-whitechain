// Everything the keeper needs to know, read from the two deployment records and the contracts' .env.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  fallback,
  http,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia, whitechainSepolia } from 'viem/chains';

const root = resolve(import.meta.dir, '../..');

function loadEnv(path: string) {
  try {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
    }
  } catch {
    // CI passes secrets through the environment instead.
  }
}
loadEnv(resolve(root, 'contracts/.env'));

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

const json = (f: string) => JSON.parse(readFileSync(resolve(root, 'contracts/deployments', f), 'utf8'));

export const W = json('whitechain-sepolia.json') as {
  chainId: number; domain: number; deployedAtBlock: number;
  usdc: Address; messenger: Address; agUSD: Address; allocator: Address; attester: Address; admin: Address;
};
export const E = json('ethereum-sepolia.json') as {
  chainId: number; domain: number; deployedAtBlock: number;
  usdc: Address; messenger: Address; issuer: Address; receiver: Address; custody: Address; admin: Address;
};

export const operator = privateKeyToAccount(need('DEPLOYER_KEY') as Hex);
export const attester = privateKeyToAccount(need('ATTESTER_KEY') as Hex);

// Reads fall back across public Sepolia endpoints, since any one of them rate limits or changes its caps at
// will; SEPOLIA_RPC_URL, when set, is tried first. Every endpoint listed answers getLogs over 1,000 blocks.
const sepoliaRpcs = [
  process.env.SEPOLIA_RPC_URL,
  'https://ethereum-sepolia-rpc.publicnode.com',
  'https://eth-sepolia.api.onfinality.io/public',
  'https://sepolia.rpc.thirdweb.com',
].filter((u, i, all): u is string => !!u && all.indexOf(u) === i);
const sepoliaTransport = fallback(sepoliaRpcs.map((u) => http(u)));

export const wc = {
  public: createPublicClient({ chain: whitechainSepolia, transport: http() }),
  wallet: createWalletClient({ chain: whitechainSepolia, transport: http(), account: operator }),
};
export const eth = {
  public: createPublicClient({ chain: sepolia, transport: sepoliaTransport }),
  wallet: createWalletClient({ chain: sepolia, transport: sepoliaTransport, account: operator }),
};

/// The ABF book's simulated economics. Senior ABF paper, the partner's Flagship sleeve: 8 to 9% target. How much
/// of the issuer is wired out is the contract's `maxOffChainBps`, not a keeper setting.
export const BOOK = {
  aprBps: 900,
  // How often the administrator re-marks the book.
  markEverySec: 600n,
};

/// The vault's buffer policy: aim for 20% liquid. Allocate the excess once it is above 30%, and bring cash home
/// once it is under 10%, so neither a single deposit nor a single exit triggers a crossing.
export const BUFFER = { targetBps: 2_000, triggerBps: 3_000, refillBps: 1_000 };

export const STATE_FILE = resolve(import.meta.dir, '../state.json');

/// Sends and waits, and refuses to call a reverted transaction done. A receipt comes back for a revert too, and
/// treating its arrival as success is how a refused wire was once reported as sent.
///
/// A send whose simulation reverts is tried again a block later, up to four times. Public endpoints are load
/// balanced, and the node that simulates a call can be a block behind the one that just returned the previous
/// receipt: a redeem simulated before the on-ramp it depends on, or a wire before the subscription that funds
/// it. Nothing is broadcast when the simulation reverts, so trying again cannot send anything twice. A revert
/// that survives every retry is real and is thrown.
export async function sendChecked(
  chain: typeof wc | typeof eth,
  req: { address: `0x${string}`; abi: any; functionName: string; args?: unknown[] },
  label = req.functionName,
) {
  const RETRIES = 4;
  let hash: Hex | undefined;
  for (let attempt = 0; !hash; attempt++) {
    try {
      hash = await (chain.wallet as any).writeContract(req);
    } catch (e) {
      const reverted = e instanceof BaseError && e.walk((c) => c instanceof ContractFunctionRevertedError);
      if (!reverted || attempt === RETRIES) throw e;
      console.log(`  ${label} refused by a node that may be behind, retrying in a block`);
      await Bun.sleep(chain === eth ? 12_000 : 2_000);
    }
  }
  const receipt = await chain.public.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`${label} reverted on chain: ${hash}`);
  console.log(`  ${label.padEnd(18)} ${hash}`);
  return hash as `0x${string}`;
}
