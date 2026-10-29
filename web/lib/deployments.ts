// The live addresses, copied from contracts/deployments/*.json by hand after each deploy so a redeploy is a
// reviewed diff here rather than something the app picks up on its own.
import type { Address } from 'viem';

export const WHITECHAIN = {
  chainId: 1874,
  deployedAtBlock: 11680057n,
  usdc: '0x5b00EAc2E4359b818314E7F42c2805e29d587658' as Address,
  messenger: '0x6436CAC378FA46b2Cd4ff455Ff0fd07E99eb699b' as Address,
  agUSD: '0x4F78D5Ba2242F77CfD75b7B2a1BD8EEf82DA67d8' as Address,
  allocator: '0x04477d606b751A7CBC6De478c749d0ffC726416f' as Address,
};

export const ETHEREUM = {
  chainId: 11155111,
  deployedAtBlock: 12019480n,
  usdc: '0x0A950Ec189d4470a527a142929cD9C395a91FFe6' as Address,
  messenger: '0x1439F556A55DD3dc72b6b24a2Dd8B09dD080BF7F' as Address,
  issuer: '0xe23f65c7159ffa68D6b7eeeEDF4FB275a68d4Acd' as Address,
  receiver: '0xB398Ecc57D7842aB701310f868349f1f2E2D2746' as Address,
};
