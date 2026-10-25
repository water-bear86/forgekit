import { strict as assert } from "node:assert";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { describe, it } from "node:test";
import { createApp } from "../index.js";
import { fetchDexScreenerTokenPrice, normalizePriceNumber } from "../prices.js";
import { createQuote } from "../quotes.js";

describe("function pricing helpers", () => {
  it("normalizes positive decimal strings", () => {
    assert.equal(normalizePriceNumber("0.0001512", "token"), 0.0001512);
    assert.throws(() => normalizePriceNumber("0", "token"), /positive/);
    assert.throws(() => normalizePriceNumber("wat", "token"), /valid/);
  });

  it("reads the first DexScreener pair price from a fetch implementation", async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ pairs: [{ chainId: "solana", baseToken: { address: "So11111111111111111111111111111111111111112" }, priceUsd: "0.0001512", liquidity: { usd: 1000 } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    const price = await fetchDexScreenerTokenPrice("So11111111111111111111111111111111111111112", fetchImpl);
    assert.equal(price, 0.0001512);
  });

  it("chooses the highest-liquidity valid Solana DexScreener pair", async () => {
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          pairs: [
            { chainId: "ethereum", priceUsd: "9", liquidity: { usd: 1_000_000 } },
            { chainId: "solana", baseToken: { address: "So11111111111111111111111111111111111111112" }, priceUsd: "0.0000001", liquidity: { usd: 0 } },
            { chainId: "solana", baseToken: { address: "So11111111111111111111111111111111111111112" }, priceUsd: "wat", liquidity: { usd: 10_000 } },
            { chainId: "solana", baseToken: { address: "So11111111111111111111111111111111111111112" }, priceUsd: "0.0001", liquidity: { usd: 100 } },
            { chainId: "solana", baseToken: { address: "So11111111111111111111111111111111111111112" }, priceUsd: "0.0001512", liquidity: { usd: 25_000 } },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );

    const price = await fetchDexScreenerTokenPrice("So11111111111111111111111111111111111111112", fetchImpl);

    assert.equal(price, 0.0001512);
  });

  it("uses an allowed DexScreener pair address when configured", async () => {
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          pairs: [
            { chainId: "solana", baseToken: { address: "So11111111111111111111111111111111111111112" }, pairAddress: "lower", priceUsd: "0.0002", liquidity: { usd: 50_000 } },
            { chainId: "solana", baseToken: { address: "So11111111111111111111111111111111111111112" }, pairAddress: "allowed", priceUsd: "0.0001512", liquidity: { usd: 1_000 } },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );

    const price = await fetchDexScreenerTokenPrice("So11111111111111111111111111111111111111112", fetchImpl, { allowedPairAddress: "allowed" });

    assert.equal(price, 0.0001512);
  });

  it("creates a deterministic standard offer quote", () => {
    const quote = createQuote({
      prices: { tokenUsd: 0.0001512, solUsd: 170 },
      nowMs: 1_770_000_000_000,
      treasuryWallet: "Treasury111111111111111111111111111111111",
      wallet: "11111111111111111111111111111111",
      nonce: "nonce-1",
    });

    assert.equal(quote.offerId, "standard");
    assert.equal(quote.targetUsd, 2.5);
    assert.equal(quote.opsReserveUsd, 0.35);
    assert.equal(quote.burnBaseUnits, "14219576720");
    assert.equal(quote.reserveLamports, 2058824);
    assert.match(quote.quoteId, /^[0-9a-f]{32}$/);
  });

  it("derives distinct quote IDs from nonce and wallet", () => {
    const base = {
      prices: { tokenUsd: 0.0001512, solUsd: 170 },
      nowMs: 1_770_000_000_000,
      treasuryWallet: "Treasury111111111111111111111111111111111",
    };

    const first = createQuote({ ...base, wallet: "11111111111111111111111111111111", nonce: "nonce-1" });
    const second = createQuote({ ...base, wallet: "11111111111111111111111111111111", nonce: "nonce-2" });
    const third = createQuote({ ...base, wallet: "So11111111111111111111111111111111111111112", nonce: "nonce-1" });

    assert.notEqual(first.quoteId, second.quoteId);
    assert.notEqual(first.quoteId, third.quoteId);
  });

  it("serves quotes from injected route dependencies", async () => {
    const app = createApp({
      nowMs: () => 1_770_000_000_000,
      treasuryWallet: () => "Treasury111111111111111111111111111111111",
      nonce: () => "nonce-1",
      fetchTokenUsd: async () => 0.0001512,
      fetchSolUsd: async () => 170,
      persistQuote: async () => undefined,
    });
    const server: Server = app.listen(0);

    try {
      await new Promise<void>((resolve) => server.once("listening", resolve));
      const address = server.address() as AddressInfo | null;
      assert.ok(address);

      const response = await fetch(`http://127.0.0.1:${address.port}/api/quote`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet: "11111111111111111111111111111111" }),
      });

      assert.equal(response.status, 200);
      const body = (await response.json()) as Record<string, unknown>;
      assert.equal(body.wallet, "11111111111111111111111111111111");
      assert.equal(body.targetUsd, 2.5);
      assert.equal(body.burnBaseUnits, "14219576720");
      assert.equal(body.reserveLamports, 2058824);
      assert.equal("quoteIdSeed" in body, false);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  });

  it("rejects invalid quote wallets before pricing", async () => {
    let fetchedPrices = false;
    const app = createApp({
      treasuryWallet: () => "Treasury111111111111111111111111111111111",
      fetchTokenUsd: async () => {
        fetchedPrices = true;
        return 0.0001512;
      },
      fetchSolUsd: async () => 170,
      persistQuote: async () => undefined,
    });
    const server: Server = app.listen(0);

    try {
      await new Promise<void>((resolve) => server.once("listening", resolve));
      const address = server.address() as AddressInfo | null;
      assert.ok(address);

      const response = await fetch(`http://127.0.0.1:${address.port}/api/quote`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet: "not-a-wallet" }),
      });

      assert.equal(response.status, 400);
      assert.equal(fetchedPrices, false);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  });

  it("returns distinct statuses for missing config and upstream pricing failures", async () => {
    const missingConfigApp = createApp({
      treasuryWallet: () => "",
      fetchTokenUsd: async () => 0.0001512,
      fetchSolUsd: async () => 170,
      persistQuote: async () => undefined,
    });
    const missingConfigResponse = await postQuote(missingConfigApp, "11111111111111111111111111111111");
    assert.equal(missingConfigResponse.status, 500);

    const upstreamApp = createApp({
      treasuryWallet: () => "Treasury111111111111111111111111111111111",
      fetchTokenUsd: async () => {
        throw new Error("DexScreener HTTP 503");
      },
      fetchSolUsd: async () => 170,
      persistQuote: async () => undefined,
    });
    const upstreamResponse = await postQuote(upstreamApp, "11111111111111111111111111111111");
    assert.equal(upstreamResponse.status, 502);
  });

  it("caches default route prices for a short window", async () => {
    let tokenFetches = 0;
    let solFetches = 0;
    const app = createApp({
      nowMs: () => 1_770_000_000_000,
      treasuryWallet: () => "Treasury111111111111111111111111111111111",
      nonce: () => `nonce-${tokenFetches + solFetches}`,
      fetchTokenUsd: async () => {
        tokenFetches += 1;
        return 0.0001512;
      },
      fetchSolUsd: async () => {
        solFetches += 1;
        return 170;
      },
      priceCacheTtlMs: 30_000,
      persistQuote: async () => undefined,
    });

    const first = await postQuote(app, "11111111111111111111111111111111");
    const second = await postQuote(app, "So11111111111111111111111111111111111111112");

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(tokenFetches, 1);
    assert.equal(solFetches, 1);
  });
});

async function postQuote(app: ReturnType<typeof createApp>, wallet: string): Promise<Response> {
  const server: Server = app.listen(0);

  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address() as AddressInfo | null;
    assert.ok(address);

    return await fetch(`http://127.0.0.1:${address.port}/api/quote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wallet }),
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}
