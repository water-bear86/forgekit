import { describe, expect, it } from "vitest";
import { quoteOffer } from "../../shared/pricing";

describe("quoteOffer", () => {
  it("subtracts ops reserve and burns the rest of the target value", () => {
    const quote = quoteOffer({
      offer: {
        id: "standard",
        version: 3,
        enabled: true,
        public: true,
        targetUsd: 2.5,
        opsReserveUsd: 0.35,
        minBurnUiAmount: 1,
        maxBurnUiAmount: 100_000,
        royaltyBasisPoints: 500,
        mintMode: "core",
        rarity: { maxBoost: 0.8, boostCurve: 0.22 },
      },
      prices: { tokenUsd: 0.0001512, solUsd: 170 },
      nowMs: 1_770_000_000_000,
      ttlMs: 180_000,
      treasuryWallet: "Treasury111111111111111111111111111111111",
      tokenDecimals: 6,
    });

    expect(quote.targetUsd).toBe(2.5);
    expect(quote.opsReserveUsd).toBe(0.35);
    expect(quote.burnUsd).toBeCloseTo(2.15, 8);
    expect(quote.burnUiAmount).toBeCloseTo(14219.57671957672, 8);
    expect(quote.burnBaseUnits).toBe("14219576720");
    expect(quote.reserveLamports).toBe(2058824);
    expect(quote.royaltyBasisPoints).toBe(500);
    expect(quote.expiresAt).toBe(1_770_000_180_000);
  });

  it("fails closed when token price would exceed the max burn clamp", () => {
    expect(() =>
      quoteOffer({
        offer: {
          id: "standard",
          version: 1,
          enabled: true,
          public: true,
          targetUsd: 2.5,
          opsReserveUsd: 0.1,
          minBurnUiAmount: 1,
          maxBurnUiAmount: 10,
          royaltyBasisPoints: 500,
          mintMode: "core",
          rarity: { maxBoost: 0.8, boostCurve: 0.22 },
        },
        prices: { tokenUsd: 0.000001, solUsd: 170 },
        nowMs: 1000,
        ttlMs: 60_000,
        treasuryWallet: "Treasury111111111111111111111111111111111",
        tokenDecimals: 6,
      }),
    ).toThrow(/outside configured bounds/);
  });

  it("uses configured token decimals for base units", () => {
    const quote = quoteOffer({
      offer: {
        id: "standard",
        version: 1,
        enabled: true,
        public: true,
        targetUsd: 2.5,
        opsReserveUsd: 0.5,
        minBurnUiAmount: 1,
        maxBurnUiAmount: 100_000,
        royaltyBasisPoints: 500,
        mintMode: "core",
        rarity: { maxBoost: 0.8, boostCurve: 0.22 },
      },
      prices: { tokenUsd: 0.25, solUsd: 200 },
      nowMs: 1000,
      ttlMs: 60_000,
      treasuryWallet: "Treasury111111111111111111111111111111111",
      tokenDecimals: 2,
    });

    expect(quote.burnUiAmount).toBe(8);
    expect(quote.burnBaseUnits).toBe("800");
    expect(quote.tokenUsd).toBe(0.25);
  });
});
