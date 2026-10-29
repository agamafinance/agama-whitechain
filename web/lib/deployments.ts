// The live addresses, copied from contracts/deployments/*.json by hand after each deploy so a redeploy is a
// reviewed diff here rather than something the app picks up on its own.
import type { Address } from 'viem';

export const WHITECHAIN = {
  chainId: 1874,
  deployedAtBlock: 0n,
  usdc: '0x0000000000000000000000000000000000000000' as Address,
  messenger: '0x0000000000000000000000000000000000000000' as Address,
  agUSD: '0x0000000000000000000000000000000000000000' as Address,
  allocator: '0x0000000000000000000000000000000000000000' as Address,
};

export const ETHEREUM = {
  chainId: 11155111,
  deployedAtBlock: 0n,
  usdc: '0x0000000000000000000000000000000000000000' as Address,
  messenger: '0x0000000000000000000000000000000000000000' as Address,
  issuer: '0x0000000000000000000000000000000000000000' as Address,
  receiver: '0x0000000000000000000000000000000000000000' as Address,
};
