export const DEFAULT_PROJECT_TOKEN_MINT = "DJ15QJxVPFGv6kYhT6LvDGqG9b4aBFWQzavA7dGxpump";
export const DEFAULT_PROJECT_TOKEN_SYMBOL = "$GOBLINTOWN";
export const DEFAULT_PROJECT_TOKEN_DECIMALS = 6;
export const TOKEN_2022_PROGRAM_ID_STRING = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const DEFAULT_SOLANA_RPC_URL = "https://api.mainnet-beta.solana.com";
export const DEFAULT_FORGEKIT_EXTERNAL_BASE_URL = "https://forgekit.app";

export const DEFAULT_FIREBASE_CLIENT_CONFIG = {
  apiKey: "AIzaSyD2px9fRoSh6bwOBDIk2dGioYbxROQ6Leo",
  authDomain: "goblintown-88fd6.firebaseapp.com",
  projectId: "goblintown-88fd6",
  storageBucket: "goblintown-88fd6.firebasestorage.app",
  messagingSenderId: "904412921746",
  appId: "1:904412921746:web:a92c6ba51e292b0d858b4b",
  measurementId: "G-C1TSNGHXYG",
} as const;

export interface ForgeBrandConfig {
  engineName: string;
  displayName: string;
  issuerName: string;
  tagline: string;
  projectPackLabel: string;
  modifierLabel: string;
}

export interface ForgeTokenConfig {
  mint: string;
  symbol: string;
  decimals: number;
  tokenProgramId: string;
  dexScreenerPair?: string;
}

export interface ForgeProjectConfig {
  projectId: string;
  brand: ForgeBrandConfig;
  token: ForgeTokenConfig;
  solanaRpcUrl: string;
  externalBaseUrl: string;
}

export function envOrDefault(name: string, fallback: string): string {
  return envFirst([name], fallback);
}

export function envFirst(names: string[], fallback: string): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  const processEnv = (globalThis as typeof globalThis & { process?: { env?: Record<string, string | undefined> } })
    .process?.env;
  for (const name of names) {
    const value = env?.[name] ?? processEnv?.[name];
    if (value && value.trim().length > 0) return value.trim();
  }
  return fallback;
}

export function firebaseClientConfig() {
  return {
    apiKey: envOrDefault("VITE_FIREBASE_API_KEY", DEFAULT_FIREBASE_CLIENT_CONFIG.apiKey),
    authDomain: envOrDefault("VITE_FIREBASE_AUTH_DOMAIN", DEFAULT_FIREBASE_CLIENT_CONFIG.authDomain),
    projectId: envOrDefault("VITE_FIREBASE_PROJECT_ID", DEFAULT_FIREBASE_CLIENT_CONFIG.projectId),
    storageBucket: envOrDefault("VITE_FIREBASE_STORAGE_BUCKET", DEFAULT_FIREBASE_CLIENT_CONFIG.storageBucket),
    messagingSenderId: envOrDefault(
      "VITE_FIREBASE_MESSAGING_SENDER_ID",
      DEFAULT_FIREBASE_CLIENT_CONFIG.messagingSenderId,
    ),
    appId: envOrDefault("VITE_FIREBASE_APP_ID", DEFAULT_FIREBASE_CLIENT_CONFIG.appId),
    measurementId: envOrDefault("VITE_FIREBASE_MEASUREMENT_ID", DEFAULT_FIREBASE_CLIENT_CONFIG.measurementId),
  };
}

export function forgeBrandConfig(): ForgeBrandConfig {
  return {
    engineName: envFirst(["VITE_FORGEKIT_ENGINE_NAME", "FORGEKIT_ENGINE_NAME"], "ForgeKit"),
    displayName: envFirst(["VITE_FORGEKIT_PROJECT_NAME", "FORGEKIT_PROJECT_NAME"], "ForgeKit Genesis Pass"),
    issuerName: envFirst(["VITE_FORGEKIT_ISSUER_NAME", "FORGEKIT_ISSUER_NAME"], "ForgeKit Procedure Lab"),
    tagline: envFirst(
      ["VITE_FORGEKIT_TAGLINE", "FORGEKIT_TAGLINE"],
      "Procedural NFT engine with live-chain seasoning.",
    ),
    projectPackLabel: envFirst(["VITE_FORGEKIT_PROJECT_PACK_LABEL", "FORGEKIT_PROJECT_PACK_LABEL"], "Genesis Pack"),
    modifierLabel: envFirst(["VITE_FORGEKIT_MODIFIER_LABEL", "FORGEKIT_MODIFIER_LABEL"], "Modifier Score"),
  };
}

export function forgeTokenConfig(): ForgeTokenConfig {
  return {
    mint: envFirst(
      ["VITE_FORGEKIT_TOKEN_MINT", "FORGEKIT_TOKEN_MINT", "VITE_FORGE_TOKEN_MINT", "FORGE_TOKEN_MINT"],
      DEFAULT_PROJECT_TOKEN_MINT,
    ),
    symbol: envFirst(
      ["VITE_FORGEKIT_TOKEN_SYMBOL", "FORGEKIT_TOKEN_SYMBOL", "VITE_FORGE_TOKEN_SYMBOL", "FORGE_TOKEN_SYMBOL"],
      DEFAULT_PROJECT_TOKEN_SYMBOL,
    ),
    decimals: envInteger(
      ["VITE_FORGEKIT_TOKEN_DECIMALS", "FORGEKIT_TOKEN_DECIMALS", "VITE_FORGE_TOKEN_DECIMALS", "FORGE_TOKEN_DECIMALS"],
      DEFAULT_PROJECT_TOKEN_DECIMALS,
    ),
    tokenProgramId: envFirst(
      [
        "VITE_FORGEKIT_TOKEN_PROGRAM_ID",
        "FORGEKIT_TOKEN_PROGRAM_ID",
        "VITE_FORGE_TOKEN_PROGRAM_ID",
        "FORGE_TOKEN_PROGRAM_ID",
      ],
      TOKEN_2022_PROGRAM_ID_STRING,
    ),
    dexScreenerPair: envOptional([
      "VITE_FORGEKIT_DEXSCREENER_PAIR",
      "FORGEKIT_DEXSCREENER_PAIR",
      "VITE_FORGE_DEXSCREENER_PAIR",
      "FORGE_DEXSCREENER_PAIR",
      "FORGE_GOBLINTOWN_DEXSCREENER_PAIR",
    ]),
  };
}

export function forgeProjectConfig(): ForgeProjectConfig {
  return {
    projectId: envFirst(["VITE_FORGEKIT_ACTIVE_PROJECT", "FORGEKIT_ACTIVE_PROJECT"], "forgekit-genesis"),
    brand: forgeBrandConfig(),
    token: forgeTokenConfig(),
    solanaRpcUrl: publicSolanaRpcUrl(),
    externalBaseUrl: envFirst(
      ["VITE_FORGEKIT_EXTERNAL_BASE_URL", "FORGEKIT_EXTERNAL_BASE_URL", "VITE_FORGE_EXTERNAL_BASE_URL", "FORGE_EXTERNAL_BASE_URL"],
      DEFAULT_FORGEKIT_EXTERNAL_BASE_URL,
    ),
  };
}

export function publicSolanaRpcUrl(): string {
  return envFirst(
    ["VITE_FORGEKIT_SOLANA_RPC_URL", "FORGEKIT_SOLANA_RPC_URL", "VITE_SOLANA_RPC_URL", "SOLANA_RPC_URL"],
    DEFAULT_SOLANA_RPC_URL,
  );
}

function envOptional(names: string[]): string | undefined {
  const value = envFirst(names, "");
  return value || undefined;
}

function envInteger(names: string[], fallback: number): number {
  const raw = envFirst(names, String(fallback));
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}
