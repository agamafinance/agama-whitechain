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

Then the policy changed so that everything is reinvested as soon as possible. Running that live found two more problems:

- **An allocation sized to the reserve floor exactly was refused by seven micro-dollars.** Profit unlocks by the second, so the floor rises between the read and the block. The keeper now keeps a cent, or a basis point of the vault, above it.
- **A receipt that never came froze a run for forty minutes.** An endpoint accepted a transaction and never passed it on, so nothing was pending on chain, and the wait for its receipt had no limit. Waits are now capped at three minutes; the tick fails and the next one starts again.

The e2e itself also had a sizing bug. With 5,000 deposited into a vault that had grown past 20,000, the buffer covered the "queued" exit and paid it on the spot. It now deposits the whole drip, and stops before starting if the vault is large enough that the exit would still not queue.

## The passing run, 1 November 2026

```
holder 0x0d97859903d70337c0a4F83c3de117DC8B6aF0E3
1. gas
  ok   0.01 WBT https://explorer.testnet.whitechain.io/tx/0x6b76b2c76d07f740500ca2f16c9b276cc554bb4dbdd92b3abe5798054feddcf7
2. faucet
  ok   drip https://explorer.testnet.whitechain.io/tx/0x3c5f6ea99dc4a67c5a34fbe01cf9414455c2106324061191f5113b36046a5d8d
  ok   10,000 USDC arrived
  ok   drip https://explorer.testnet.whitechain.io/tx/0x16a3b02a8af85841bbec57bbf87cf3825213e427536ae3bc18771351a8fddd49
  ok   a second drip straight after is paid too
3. deposit
  ok   approve https://explorer.testnet.whitechain.io/tx/0x56cc4c35e9b2e514e3572e68c2e5a659aaf73d87bb3a1fea3aaad5a5536044bd
  ok   deposit https://explorer.testnet.whitechain.io/tx/0xc5bdf0b0a97295f7efa5e2892bfcbb7c5d37a29ca716b448c2adea6dc8924c5e
  ok   minted 9995.444061 agUSD, the preview less what unlocked meanwhile
  ok   vault assets $41109.892014 -> $51109.892213
  ok   a deposit does not lower the price
4. instant exit
  ok   maxRedeem 9995.444061 reports the buffer
  ok   redeem https://explorer.testnet.whitechain.io/tx/0xbb8ebb404fa2a1283fd19be77383b1b551e831bd341b3393ea161dc3a4f63441
  ok   received $250.11395, the preview or a hair more
5. keeper: allocate, relay, run the book, mark
  allocate           0x09b200b7b14d74003f19e7fc7a609363e9b9da6b1d05a597c383dd36c78c47e2
  ok   everything above the reserve floor was allocated
  relayed to Ethereum 0x14ade0d1a70fa17e443680bc3893e6b1114e1dc83ddf25b14762eff8bd4d0dc4
  offRamp            0xe0c65472004ceff9f81c150ae54b210b388b38154d8a4d9b4e1e164e41ea87d7
  reportNav          0xcc0b3d87501a584d26bcb4e2c3c4fa104d9899b4df5906f015d9532896b108d3
  ok   buffer down to the 10% floor: $5091.063816 of $50859.793094
  ok   the L1 receiver subscribed it: position $36995.674804 -> $45769.586352
  ok   the issuer wired it to custody: book $33296.107324 -> $41192.627717
  ok   price 1.000455 -> 1.000455
6. queued exit
  ok   holding 9745.444061 agUSD, only 5088.744251 instant
  ok   requestRedeem https://explorer.testnet.whitechain.io/tx/0x32553d44ce48488030dc7916f2828080495c744090359a0d30738c3fc25d0ab3
  ok   shares burned at request
  ok   queue owes $9749.88627, at least the $9749.886254 previewed
7. keeper: collections home over the messenger, settle the queue
  ok   short $4658.822454 on Whitechain
  onRamp             0x61418f56e18fcd5c0a3f80e1a407c9a739bf2539fa4d976dcc45f758dc18ef10
  redeemAndSendHome  0x0afadaef06f5c0abf9f151e74271211761d243ab950acf7dbc0967e6b213fa6c
  settled on Whitechain 0xee3162ba142d3bd7be46cdf1e4464de4e1d733fa90a6a44ec4515fb2c1178921
  ok   holder paid $9749.88627, exactly what the request fixed
  ok   queue empty
ALL CHECKS PASSED
```
