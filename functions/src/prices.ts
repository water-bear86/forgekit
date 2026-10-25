import { PublicKey } from "@solana/web3.js";
export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

interface DexScreenerPair {
  chainId?: unknown;
  pairAddress?: unknown;
  priceUsd?: unknown;
  baseToken?: { address?: unknown };
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
  if (new PublicKey(mint).toBase58() !== mint) throw new Error("Invalid canonical Solana mint.");
  const res = await fetchWithTimeout(
    fetchImpl,
    `https://api.dexscreener.com/latest/dex/tokens/${mint}`,
    options.timeoutMs,
  );
  if (!res.ok) throw new Error(`DexScreener HTTP ${res.status}`);
  const body = (await res.json()) as { pairs?: DexScreenerPair[] };
  const pair = selectDexScreenerPair(body.pairs, options.allowedPairAddress, mint);
  if (!pair) throw new Error("DexScreener returned no priced pairs.");
  return normalizePriceNumber(pair.priceUsd, "project token");
}

export async function fetchCoinMarketCapSolPrice(
  fetchImpl: FetchLike = fetch,
  options: Pick<PriceFetchOptions, "timeoutMs"> = {},
): Promise<number> {
  const key = (process.env.CMC_PRO_API_KEY ?? process.env.CMC_API_KEY)?.trim();
  const url = `https://pro-api.coinmarketcap.com/${key ? "" : "public-api/"}v3/cryptocurrency/quotes/latest?id=5426&convert=USD`;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (key) headers["X-CMC_PRO_API_KEY"] = key;
  const res = await fetchWithTimeout(fetchImpl, url, options.timeoutMs, { headers });
  if (!res.ok) throw new Error(`SOL price provider HTTP ${res.status}`);
  const body = await res.json() as { status?: { error_code?: unknown }; data?: Array<{ id?: unknown; symbol?: unknown; quote?: Array<{ id?: unknown; symbol?: unknown; price?: unknown; last_updated?: unknown }> }> };
  if (String(body.status?.error_code) !== "0" || !Array.isArray(body.data)) throw new Error("SOL quote unavailable");
  const asset = body.data.find(row => row.id === 5426 && row.symbol === "SOL");
  const quote = Array.isArray(asset?.quote) ? asset.quote.find(row => row.id === 2781 && row.symbol === "USD") : undefined;
  const observed = typeof quote?.last_updated === "string" ? Date.parse(quote.last_updated) : NaN;
  if (!Number.isFinite(observed) || Date.now() - observed > 180_000 || observed > Date.now() + 30_000) throw new Error("SOL quote is stale or invalid");
  return normalizePriceNumber(quote?.price, "SOL");
}

export function selectDexScreenerPair(
  pairs: DexScreenerPair[] | undefined,
  allowedPairAddress?: string,
  mint?: string,
): DexScreenerPair | undefined {
  const allowed = allowedPairAddress?.trim();
  const validPairs = (pairs ?? [])
    .map((pair) => {
      const chainId = typeof pair.chainId === "string" ? pair.chainId.toLowerCase() : undefined;
      if (chainId !== "solana") return undefined;
      if (mint && pair.baseToken?.address !== mint) return undefined;
      if (allowed && pair.pairAddress !== allowed) return undefined;

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

async function fetchWithTimeout(fetchImpl: FetchLike, input: string, timeoutMs = 8000, init: RequestInit = {}): Promise<Response> {

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetchImpl(input, { ...init, redirect: "error", signal: controller.signal });
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
