import { createHash } from "node:crypto";
import type { ForgeOffer, ForgeQuote, PriceSnapshotInput } from "../../shared/pricing.js";
import { quoteOffer } from "../../shared/pricing.js";

export const DEFAULT_STANDARD_OFFER: ForgeOffer = {
  id: "standard",
  version: 1,
  enabled: true,
  public: true,
  targetUsd: 2.5,
  opsReserveUsd: 0.35,
  minBurnUiAmount: 1,
  maxBurnUiAmount: 100_000,
  royaltyBasisPoints: 500,
  mintMode: "core",
  rarity: { maxBoost: 0.8, boostCurve: 0.22 },
};

export function createQuote(params: {
  offer?: ForgeOffer;
  prices: PriceSnapshotInput;
  nowMs: number;
  treasuryWallet: string;
  wallet: string;
  nonce: string;
  tokenDecimals?: number;
}): Omit<ForgeQuote, "quoteIdSeed"> & { quoteId: string } {
  const quote = quoteOffer({
    offer: params.offer ?? DEFAULT_STANDARD_OFFER,
    prices: params.prices,
    nowMs: params.nowMs,
    ttlMs: 180_000,
    treasuryWallet: params.treasuryWallet,
    tokenDecimals: params.tokenDecimals,
  });
  const quoteIdSeed = [quote.quoteIdSeed, params.wallet, params.nonce].join(":");
  const quoteId = createHash("sha256").update(quoteIdSeed).digest("hex").slice(0, 32);
  const { quoteIdSeed: _quoteIdSeed, ...publicQuote } = quote;
  return { ...publicQuote, quoteId };
}
