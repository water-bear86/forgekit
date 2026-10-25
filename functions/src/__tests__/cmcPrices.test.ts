import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { fetchCoinMarketCapSolPrice, fetchDexScreenerTokenPrice } from "../prices.js";
const prior = process.env.CMC_PRO_API_KEY;
afterEach(() => { if (prior === undefined) delete process.env.CMC_PRO_API_KEY; else process.env.CMC_PRO_API_KEY = prior; });
const mint = "So11111111111111111111111111111111111111112";
const answer = (id = 5426, at = Date.now(), price = 100) => ({ status: { error_code: "0" }, data: [{ id, symbol: "SOL", quote: [{ id: 2781, symbol: "USD", price, last_updated: new Date(at).toISOString() }] }] });
test("CMC quote identity, freshness and private header are verified", async () => {
  process.env.CMC_PRO_API_KEY = "fixture-key";
  assert.equal(await fetchCoinMarketCapSolPrice(async (input, init) => {
    assert.equal(new URL(String(input)).hostname, "pro-api.coinmarketcap.com");
    assert.equal(String(input).includes("fixture-key"), false);
    assert.equal(new Headers(init?.headers).get("X-CMC_PRO_API_KEY"), "fixture-key");
    assert.equal(init?.redirect, "error");
    return Response.json(answer());
  }), 100);
  for (const body of [answer(1), answer(5426, Date.now() - 181000), answer(5426, Date.now() + 31000), answer(5426, Date.now(), 0)]) {
    await assert.rejects(fetchCoinMarketCapSolPrice(async () => Response.json(body)));
  }
});
test("a quote-side or case-altered Solana asset never supplies a project token price", async () => {
  for (const base of ["other", mint.toLowerCase()]) {
    await assert.rejects(fetchDexScreenerTokenPrice(mint, async () => Response.json({ pairs: [{ chainId: "solana", baseToken: { address: base }, quoteToken: { address: mint }, priceUsd: "999", liquidity: { usd: 1000000 } }] })));
  }
  await assert.rejects(fetchDexScreenerTokenPrice("invalid", async () => { throw new Error("must not fetch"); }));
});
