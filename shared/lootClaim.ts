export const LOOT_CLAIM_TYPE = "goblintown-forge-loot-claim-v1";

export interface LootClaimPayloadInput {
  uid: string;
  wallet: string;
  loot: number;
  warrenName: string;
  issuedAt: string;
  expiresAt: string;
  nonce: string;
}

export interface LootClaimBody {
  payload: string;
  signature: string;
  publicKeyPem: string;
}

export interface ParsedLootClaim {
  type: typeof LOOT_CLAIM_TYPE;
  uid: string;
  wallet: string;
  loot: number;
  warrenName: string;
  issuedAt: string;
  expiresAt: string;
  nonce: string;
}

export function buildLootClaimPayload(input: LootClaimPayloadInput): string {
  return JSON.stringify({
    type: LOOT_CLAIM_TYPE,
    uid: input.uid,
    wallet: input.wallet,
    loot: Math.max(0, Math.floor(input.loot)),
    warrenName: input.warrenName,
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
    nonce: input.nonce,
  });
}

export function parseLootClaimPayload(payload: string): ParsedLootClaim {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new Error("claim payload must be valid JSON");
  }
  if (!isRecord(parsed)) throw new Error("claim payload must be an object");
  if (parsed.type !== LOOT_CLAIM_TYPE) throw new Error("unsupported claim type");

  const uid = requiredString(parsed.uid, "uid");
  const wallet = requiredString(parsed.wallet, "wallet");
  const nonce = requiredString(parsed.nonce, "nonce");
  const warrenName = requiredString(parsed.warrenName, "warrenName");
  const issuedAt = requiredIsoDate(parsed.issuedAt, "issuedAt");
  const expiresAt = requiredIsoDate(parsed.expiresAt, "expiresAt");
  const loot = parsed.loot;
  if (typeof loot !== "number" || !Number.isInteger(loot) || loot < 0) {
    throw new Error("claim loot must be a non-negative integer");
  }

  const canonical = buildLootClaimPayload({
    uid,
    wallet,
    loot,
    warrenName,
    issuedAt,
    expiresAt,
    nonce,
  });
  if (canonical !== payload) throw new Error("claim payload is not canonical");

  return {
    type: LOOT_CLAIM_TYPE,
    uid,
    wallet,
    loot,
    warrenName,
    issuedAt,
    expiresAt,
    nonce,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`claim ${field} is required`);
  }
  return value;
}

function requiredIsoDate(value: unknown, field: string): string {
  const date = requiredString(value, field);
  const ms = Date.parse(date);
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== date) {
    throw new Error(`claim ${field} must be a strict ISO UTC timestamp`);
  }
  return date;
}
