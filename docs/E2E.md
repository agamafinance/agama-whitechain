# End to end on the live testnets

Run with `cd keeper && bun src/e2e.ts`. A fresh holder key, not the deployer, gets gas and test USDC, deposits, leaves instantly within the buffer, then asks for more than the buffer holds, which the keeper pays by bringing cash home from the issuer on Ethereum.

What the first runs found, and what changed because of them:

- **The keeper overshot the issuer's book cap by one unit.** It kept `floor(10%)` as cash while the contract caps the book at `floor(90%)`, so the wire was refused with `OffChainCap`. The contract was right; the keeper now keeps the ceiling.
- **Paying the queue drained the buffer to $1** and nothing refilled it, so the next instant exit would have queued. The keeper now brings cash home when the buffer is under 10%, back to 20%.
- **A preview read a block before its action is exact only in that block.** Profit unlocks by the second, so a deposit got a few micro-shares fewer than previewed and a queued exit was fixed a micro-dollar higher. The holder is paid exactly what the request recorded on chain; in-block exactness is pinned by the forge suite.

## The passing run, 29 October 2026

```
holder 0x347D7DCd83C2f1B0c3B330222dC8E5FC6159220c
1. gas
  ok   0.01 WBT https://explorer.testnet.whitechain.io/tx/0x6eda0a00d0c795e7bff410dab1f7e2c61d8ae44b798ab62307917c7f48955458
2. faucet
  ok   faucet https://explorer.testnet.whitechain.io/tx/0xda46d6592593d640fba1d5eb02a1b1c9914318869f2557814ecc20dd54331da5
  ok   10,000 USDC arrived
  ok   a second drip inside the hour is refused
3. deposit
  ok   approve https://explorer.testnet.whitechain.io/tx/0xd127fd38d74f1b56835cca6e6b6ff22b286bbdb7d3ee95e3e9a09204a42e68b3
  ok   deposit https://explorer.testnet.whitechain.io/tx/0x037fe82c1b0954a59707643c511898c1f323c0b2100445e05a0df52058359bde
  ok   minted 4999.999962 agUSD, the preview less what unlocked meanwhile
  ok   vault assets $14750.001898 -> $19750.001903
  ok   a deposit does not lower the price
4. instant exit
  ok   maxRedeem 4999.999962 reports the buffer
  ok   redeem https://explorer.testnet.whitechain.io/tx/0xb279931e0f73a59c301a0c6fdb5b34c8dab73e2acfe797b622c09d8ad2a1a8d1
  ok   received $250.000001, the preview or a hair more
5. keeper: allocate, relay, run the book, mark
  allocate           0xc155e40db542832d2ccae1bebac206e9c56f3372b8bd22169052dd1c90f785e5
  ok   the buffer above 30% was allocated
  relayed to Ethereum   0xc9f5d2d1c81e44f110ce682a3c34682e624ee4c777b71fd9000212a2f689187e
  reportNav          0xb92ff3f6b6e7104924c253f77d82f3137f762f449240636085fdb48ba9a3eb75
  offRamp            0xcbd847afdb34ab9cd1a32237632c0bcce97da8430bd66d46527127dc6f37eadc
  ok   buffer back near 20%: $3900.000381 of $19500.001944
  ok   price 1 -> 1
6. queued exit
  ok   holding 4749.999962 agUSD, only 3900.000343 instant
  ok   requestRedeem https://explorer.testnet.whitechain.io/tx/0x3a64f93716879de492622cfd56acc8cafcc606001676c842c49d0373a7c8383f
  ok   shares burned at request
  ok   queue owes $4750.000008, at least the $4750.000008 previewed
7. keeper: collections home over the messenger, settle the queue
  ok   short $849.999627 on Whitechain
  redeemAndSendHome  0x9f269b0ca98b24a979f0a677cda124b6fc24fee85204700e30f36f45ccfedeca
  settled on Whitechain 0x915141d9f781c3422579c619c9816bc0ba83c5dec3fe8cbc359b5b781d5a092f
  ok   holder paid $4750.000008, exactly what the request fixed
  ok   queue empty
ALL CHECKS PASSED
```
