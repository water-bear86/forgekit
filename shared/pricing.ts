export type MintMode = "core" | "compressed" | "admin_free" | "offchain_preview";

export interface ForgeOffer {
  id: string;
  version: number;
  enabled: boolean;
  public: boolean;
  targetUsd: number;
  opsReserveUsd: number;
  minBurnUiAmount: number;
  maxBurnUiAmount: number;
  royaltyBasisPoints: number;
  mintMode: MintMode;
  rarity: {
    maxBoost: number;
    boostCurve: number;
  };
}

export interface PriceSnapshotInput {
  tokenUsd?: number;
  goblintownUsd?: number;
  solUsd: number;
}

export interface QuoteInput {
  offer: ForgeOffer;
  prices: PriceSnapshotInput;
  nowMs: number;
  ttlMs: number;
  treasuryWallet: string;
  tokenDecimals?: number;
}

export interface ForgeQuote {
  quoteIdSeed: string;
  offerId: string;
  offerVersion: number;
  targetUsd: number;
  opsReserveUsd: number;
  burnUsd: number;
  tokenUsd: number;
  solUsd: number;
  burnUiAmount: number;
  burnBaseUnits: string;
  reserveLamports: number;
  treasuryWallet: string;
  mintMode: MintMode;
  royaltyBasisPoints: number;
  issuedAt: number;
  expiresAt: number;
}

const DEFAULT_TOKEN_DECIMALS = 6;
const LAMPORTS_PER_SOL = 1_000_000_000;

export function quoteOffer(input: QuoteInput): ForgeQuote {
  const { offer, prices, nowMs, ttlMs, treasuryWallet } = input;
  const tokenUsd = normalizeTokenUsd(prices);
  const tokenDecimals = input.tokenDecimals ?? DEFAULT_TOKEN_DECIMALS;
  if (!offer.enabled) throw new Error(`Offer ${offer.id} is disabled.`);
  if (offer.targetUsd <= 0) throw new Error("Offer targetUsd must be positive.");
  if (offer.opsReserveUsd < 0 || offer.opsReserveUsd >= offer.targetUsd) {
    throw new Error("Offer opsReserveUsd must be non-negative and below targetUsd.");
  }
  if (tokenUsd <= 0 || prices.solUsd <= 0) {
    throw new Error("Price snapshot must include positive token and SOL prices.");
  }
  if (!Number.isSafeInteger(tokenDecimals) || tokenDecimals < 0 || tokenDecimals > 18) {
    throw new Error("tokenDecimals must be a safe integer between 0 and 18.");
  }

  const burnUsd = roundUsd(offer.targetUsd - offer.opsReserveUsd);
  const burnUiAmount = burnUsd / tokenUsd;
  if (burnUiAmount < offer.minBurnUiAmount || burnUiAmount > offer.maxBurnUiAmount) {
    throw new Error(`Burn amount ${burnUiAmount} is outside configured bounds.`);
  }

  const baseMultiplier = 10 ** tokenDecimals;
  const burnBaseUnits = BigInt(Math.ceil(burnUiAmount * baseMultiplier)).toString();
  const reserveLamports = Math.ceil((offer.opsReserveUsd / prices.solUsd) * LAMPORTS_PER_SOL);
  const issuedAt = nowMs;
  const expiresAt = nowMs + ttlMs;

  return {
    quoteIdSeed: [offer.id, offer.version, issuedAt, burnBaseUnits, reserveLamports, treasuryWallet].join(":"),
    offerId: offer.id,
    offerVersion: offer.version,
    targetUsd: offer.targetUsd,
    opsReserveUsd: offer.opsReserveUsd,
    burnUsd,
    tokenUsd,
    solUsd: prices.solUsd,
    burnUiAmount,
    burnBaseUnits,
    reserveLamports,
    treasuryWallet,
    mintMode: offer.mintMode,
    royaltyBasisPoints: offer.royaltyBasisPoints,
    issuedAt,
    expiresAt,
  };
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000_000) / 1_000_000_000;
}

function normalizeTokenUsd(prices: PriceSnapshotInput): number {
  return prices.tokenUsd ?? prices.goblintownUsd ?? Number.NaN;
}
