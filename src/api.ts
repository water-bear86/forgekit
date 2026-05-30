export type ForgeOfferId = "standard" | "degen";

export type ForgeQuote = {
  offerId: ForgeOfferId;
  label: string;
  usdTarget: string;
  burnAmount: number;
  expiresAt: string;
  quoteId?: string;
  burnBaseUnits?: string;
  reserveLamports?: number;
  treasuryWallet?: string;
};

export type VerifyPayload = {
  wallet: string;
  quoteId: string;
  signature: string;
};

export type FinalizePayload = {
  requestId: string;
};

export type VerifiedForgeRequest = {
  id?: string;
  requestId?: string;
  signature?: string;
  status?: string;
};

export type FinalizedLicense = {
  licenseId: string;
  assetAddress?: string;
  imagePath?: string;
  metadataPath?: string;
  rarityScore?: number;
  loot?: number;
  lootBoost?: number;
};

export type ReadyForgeQuote = ForgeQuote & {
  quoteId: string;
  burnBaseUnits: string;
  reserveLamports: number;
  treasuryWallet: string;
};

type BackendForgeQuote = Partial<ForgeQuote> & {
  offerId?: string;
  targetUsd?: number;
  burnUiAmount?: number;
  quoteId?: string;
  burnBaseUnits?: string;
  reserveLamports?: number;
  treasuryWallet?: string;
  expiresAt?: number | string;
};

type ApiPostOptions = {
  idToken?: string;
};

export async function apiPost<TResponse, TPayload extends Record<string, unknown>>(
  path: string,
  payload: TPayload,
  options: ApiPostOptions = {},
): Promise<TResponse> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (options.idToken) {
    headers.Authorization = `Bearer ${options.idToken}`;
  }

  const response = await fetch(path, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`ForgeKit API rejected ${path} (${response.status})`);
  }

  return (await response.json()) as TResponse;
}

export function simulatedQuote(offerId: ForgeOfferId): ForgeQuote {
  const isDegen = offerId === "degen";

  return {
    offerId,
    label: isDegen ? "Boosted Forge" : "Standard Forge",
    usdTarget: isDegen ? "~$2.50 target + rare-weight lift" : "~$2.50 target",
    burnAmount: isDegen ? 1_250_000 : 1_000_000,
    expiresAt: new Date(Date.now() + 8 * 60 * 1000).toISOString(),
  };
}

export async function requestQuote(wallet: string, offerId: ForgeOfferId, idToken?: string) {
  const quote = await apiPost<BackendForgeQuote, { wallet: string; offerId: ForgeOfferId }>(
    "/api/quote",
    { wallet, offerId },
    { idToken },
  );
  return normalizeForgeQuote(quote, offerId);
}

export function verifyForge(payload: VerifyPayload, idToken?: string) {
  return apiPost<VerifiedForgeRequest, VerifyPayload>("/api/forge/verify", payload, { idToken });
}

export function finalizeForge(payload: FinalizePayload, idToken?: string) {
  return apiPost<FinalizedLicense, FinalizePayload>("/api/forge/finalize", payload, { idToken });
}

export function isReadyForgeQuote(quote: ForgeQuote | null): quote is ReadyForgeQuote {
  return Boolean(
      quote?.quoteId &&
      quote.burnBaseUnits &&
      quote.reserveLamports !== undefined &&
      Number.isSafeInteger(quote.reserveLamports) &&
      quote.reserveLamports >= 0 &&
      quote.treasuryWallet,
  );
}

function normalizeForgeQuote(quote: BackendForgeQuote, fallbackOfferId: ForgeOfferId): ForgeQuote {
  const offerId = quote.offerId === "degen" || quote.offerId === "standard" ? quote.offerId : fallbackOfferId;
  const isDegen = offerId === "degen";
  const targetUsd = typeof quote.targetUsd === "number" ? `~$${quote.targetUsd.toFixed(2)} target` : quote.usdTarget;
  const expiresAt =
    typeof quote.expiresAt === "number"
      ? new Date(quote.expiresAt).toISOString()
      : quote.expiresAt ?? new Date(Date.now() + 8 * 60 * 1000).toISOString();

  return {
    offerId,
    label: quote.label ?? (isDegen ? "Boosted Forge" : "Standard Forge"),
    usdTarget: targetUsd ?? (isDegen ? "~$2.50 target + rare-weight lift" : "~$2.50 target"),
    burnAmount: quote.burnAmount ?? quote.burnUiAmount ?? 0,
    expiresAt,
    quoteId: quote.quoteId,
    burnBaseUnits: quote.burnBaseUnits,
    reserveLamports: quote.reserveLamports,
    treasuryWallet: quote.treasuryWallet,
  };
}
