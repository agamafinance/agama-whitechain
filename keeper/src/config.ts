// Everything the keeper needs to know, read from the two deployment records and the contracts' .env.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPublicClient, createWalletClient, http, type Address, type Hex } from 'viem';
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

const sepoliaRpc = process.env.SEPOLIA_RPC_URL ?? 'https://sepolia.rpc.thirdweb.com';

export const wc = {
  public: createPublicClient({ chain: whitechainSepolia, transport: http() }),
  wallet: createWalletClient({ chain: whitechainSepolia, transport: http(), account: operator }),
};
export const eth = {
  public: createPublicClient({ chain: sepolia, transport: http(sepoliaRpc) }),
  wallet: createWalletClient({ chain: sepolia, transport: http(sepoliaRpc), account: operator }),
};

/// The ABF book's simulated economics. Senior ABF paper, the partner's Flagship sleeve: 8 to 9% target.
export const BOOK = {
  aprBps: 900,
  // The issuer keeps a tenth of its assets as cash for redemptions and wires the rest.
  cashBps: 1_000,
};

/// The vault's buffer policy: allocate down to 20% liquid, and only once it is above 30%, so a single deposit does
/// not trigger a crossing.
export const BUFFER = { targetBps: 2_000, triggerBps: 3_000 };

export const STATE_FILE = resolve(import.meta.dir, '../state.json');
