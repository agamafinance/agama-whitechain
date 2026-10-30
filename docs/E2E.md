# End to end on the live testnets

Run with `cd keeper && bun src/e2e.ts`. A fresh holder key, not the deployer, gets gas and test USDC, deposits, leaves instantly within the buffer, then asks for more than the buffer holds, which the keeper pays by bringing cash home from the issuer on Ethereum.

What the first runs found, and what changed because of them:

- **The keeper overshot the issuer's book cap by one unit.** It kept `floor(10%)` as cash while the contract caps the book at `floor(90%)`, so the wire was refused with `OffChainCap`. The contract was right; the keeper now keeps the ceiling.
- **Paying the queue drained the buffer to $1** and nothing refilled it, so the next instant exit would have queued. The keeper now brings cash home when the buffer is under 10%, back to 20%.
- **A preview read a block before its action is exact only in that block.** Profit unlocks by the second, so a deposit got a few micro-shares fewer than previewed and a queued exit was fixed a micro-dollar higher. The holder is paid exactly what the request recorded on chain; in-block exactness is pinned by the forge suite.

Then the keeper ran on its own for a day, and failed every scheduled tick from the evening of 29 October:

- **thirdweb lowered its Sepolia getLogs cap from 2,000 blocks to 1,000.** The relayer read in 2,000 block pages, so every tick failed on its first request. It now reads 1,000 at a time, across three public endpoints with thirdweb last, and saves each side's progress as soon as that side is read.
- **The book wired cash out and on-ramped it straight back in the same tick.** It ran before the keeper worked out what the vault needed home, so it sent to custody the cash the next step called back. The keeper now computes the vault's need first, and the book keeps that much as cash.
- **A node a block behind refused transactions that were valid.** Public endpoints are load balanced. A redeem was simulated before the on-ramp it depended on, and a wire before the subscription that funded it, and both came back as reverts. A send whose simulation reverts is now retried a block later, up to four times. Nothing is broadcast on a simulated revert, so a retry cannot send twice.
- **GitHub ran the fifteen minute schedule every three to seven hours.** A run now loops for just under six hours with a tick every two minutes. The hourly schedule only has to queue the next run.

The e2e itself also had a sizing bug. With 5,000 deposited into a vault that had grown past 20,000, the buffer covered the "queued" exit and paid it on the spot. It now deposits the whole drip, and stops before starting if the vault is large enough that the exit would still not queue.

## The passing run, 30 October 2026

```
holder 0x051150e806C32333D64303E2aafa09A79bf51EcD
1. gas
  ok   0.01 WBT https://explorer.testnet.whitechain.io/tx/0xd5ce80a195080681d23fba5afed2731a598ee327a9e6bba9389835bbbb66343e
2. faucet
  ok   faucet https://explorer.testnet.whitechain.io/tx/0x4652803665f4d8c1823a80e7ba0166880033258e61f1e4c21fcd661c8e8cfbc7
  ok   10,000 USDC arrived
  ok   a second drip inside the hour is refused
3. deposit
  ok   approve https://explorer.testnet.whitechain.io/tx/0x29e47244731eef0b4eab1c1edbebe2540be4dcf58561c373db99ea9fa0e23ee7
  ok   deposit https://explorer.testnet.whitechain.io/tx/0xf2576306871264a60b465c29209223a884631e7475ed69f79b0c9ec7d6cbe75b
  ok   minted 9999.911939 agUSD, the preview less what unlocked meanwhile
  ok   vault assets $19500.542225 -> $29500.542885
  ok   a deposit does not lower the price
4. instant exit
  ok   maxRedeem 9999.911939 reports the buffer
  ok   redeem https://explorer.testnet.whitechain.io/tx/0x1c7f91c5db86e42e7a9b49c16899f12bee56b05936de802d74748350ae12d3cb
  ok   received $250.002204, the preview or a hair more
5. keeper: allocate, relay, run the book, mark
  allocate           0xac362e9d2c88c48fb7b6c4a5737b692dd0440d623df3479c18f9dc2ad582b4af
  ok   the buffer above 30% was allocated
  relayed to Ethereum 0x389fecb4b83012eb3da053219467829ca9cfabf773ca4ccca1df63662e9facb0
  offRamp            0xfd119a64b0d773698a3c3de7ece380fff69d9b65cd32499de9e3245319124158
  ok   buffer back near 20%: $5850.108235 of $29250.544477
  ok   price 1.000008 -> 1.000008
6. queued exit
  ok   holding 9749.911939 agUSD, only 5850.055959 instant
  ok   requestRedeem https://explorer.testnet.whitechain.io/tx/0x399f30343211ad903a6f4f2d8df9be30e15c5f15061c39c342017cc407219129
  ok   shares burned at request
  ok   queue owes $9749.999227, at least the $9749.999062 previewed
7. keeper: collections home over the messenger, settle the queue
  ok   short $3899.890992 on Whitechain
  onRamp             0xc76a07283b12b557896f098dd3e1f07a5e196b6dc083747875dd7770b56f5737
  redeemAndSendHome  0x44cd57b47dabdff220308fd8fb711f0824ca4eb0ad323542e83bdb5cae7442f5
  settled on Whitechain 0xd4d95cc733f4848e08fa3441acdc0f0f401619ec2840aa54b08aa71212726a66
  ok   holder paid $9749.999227, exactly what the request fixed
  ok   queue empty
ALL CHECKS PASSED
```
