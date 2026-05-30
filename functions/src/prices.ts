export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

interface DexScreenerPair {
  chainId?: unknown;
  pairAddress?: unknown;
  priceUsd?: unknown;
  liquidity?: {
    usd?: unknown;
  };
}

export interface PriceFetchOptions {
  allowedPairAddress?: string;
  timeoutMs?: number;
}

export function normalizePriceNumber(raw: unknown, label: string): number {
  const value = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : Number.NaN;
  if (!Number.isFinite(value)) throw new Error(`${label} price must be valid.`);
  if (value <= 0) throw new Error(`${label} price must be positive.`);
  return value;
}

export async function fetchDexScreenerTokenPrice(
  mint: string,
  fetchImpl: FetchLike = fetch,
  options: PriceFetchOptions = {},
): Promise<number> {
  const res = await fetchWithTimeout(
    fetchImpl,
    `https://api.dexscreener.com/latest/dex/tokens/${mint}`,
    options.timeoutMs,
  );
  if (!res.ok) throw new Error(`DexScreener HTTP ${res.status}`);
  const body = (await res.json()) as { pairs?: DexScreenerPair[] };
  const pair = selectDexScreenerPair(body.pairs, options.allowedPairAddress);
  if (!pair) throw new Error("DexScreener returned no priced pairs.");
  return normalizePriceNumber(pair.priceUsd, "project token");
}

export async function fetchCoinGeckoSolPrice(
  fetchImpl: FetchLike = fetch,
  options: Pick<PriceFetchOptions, "timeoutMs"> = {},
): Promise<number> {
  const url = "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd";
  const res = await fetchWithTimeout(fetchImpl, url, options.timeoutMs);
  if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
  const body = (await res.json()) as { solana?: { usd?: number } };
  return normalizePriceNumber(body.solana?.usd, "SOL");
}

export function selectDexScreenerPair(
  pairs: DexScreenerPair[] | undefined,
  allowedPairAddress?: string,
): DexScreenerPair | undefined {
  const allowed = allowedPairAddress?.trim().toLowerCase();
  const validPairs = (pairs ?? [])
    .map((pair) => {
      const chainId = typeof pair.chainId === "string" ? pair.chainId.toLowerCase() : undefined;
      if (chainId && chainId !== "solana") return undefined;
      if (allowed && String(pair.pairAddress ?? "").toLowerCase() !== allowed) return undefined;

      try {
        normalizePriceNumber(pair.priceUsd, "project token");
      } catch {
        return undefined;
      }

      const liquidityUsd = liquidityScore(pair);
      if (liquidityUsd === undefined) return { pair, liquidityUsd: 0 };
      return liquidityUsd > 0 ? { pair, liquidityUsd } : undefined;
    })
    .filter((item): item is { pair: DexScreenerPair; liquidityUsd: number } => Boolean(item));

  validPairs.sort((left, right) => right.liquidityUsd - left.liquidityUsd);
  return validPairs[0]?.pair;
}

async function fetchWithTimeout(fetchImpl: FetchLike, input: string, timeoutMs?: number): Promise<Response> {
  if (!timeoutMs || timeoutMs <= 0) return fetchImpl(input);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetchImpl(input, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function liquidityScore(pair: DexScreenerPair): number | undefined {
  const raw = pair.liquidity?.usd;
  if (raw === undefined || raw === null) return undefined;
  try {
    return normalizePriceNumber(raw, "liquidity");
  } catch {
    return 0;
  }
}
