import { verify } from "node:crypto";
import { parseLootClaimPayload } from "../../shared/lootClaim.js";

const MAX_CLAIM_LIFETIME_MS = 5 * 60_000;
const CLAIM_CLOCK_SKEW_MS = 5_000;

export function verifySignedLootClaim(input: {
  uid: string;
  wallet: string;
  nonce: string;
  payload: string;
  signature: string;
  publicKeyPem: string;
  nowMs: number;
}) {
  const parsed = parseLootClaimPayload(input.payload);
  if (parsed.uid !== input.uid) throw new Error("claim uid mismatch");
  if (parsed.wallet !== input.wallet) throw new Error("claim wallet mismatch");
  if (parsed.nonce !== input.nonce) throw new Error("claim nonce mismatch");
  const issuedAtMs = Date.parse(parsed.issuedAt);
  const expiresAtMs = Date.parse(parsed.expiresAt);
  if (issuedAtMs > input.nowMs + CLAIM_CLOCK_SKEW_MS) throw new Error("claim issuedAt is in the future");
  if (expiresAtMs <= issuedAtMs) throw new Error("claim expiresAt must be after issuedAt");
  if (expiresAtMs < input.nowMs) throw new Error("claim expired");
  if (expiresAtMs - issuedAtMs > MAX_CLAIM_LIFETIME_MS) throw new Error("claim lifetime exceeds 5 minutes");

  let ok = false;
  try {
    ok = verify(
      null,
      Buffer.from(input.payload, "utf8"),
      input.publicKeyPem,
      Buffer.from(input.signature, "base64"),
    );
  } catch {
    ok = false;
  }
  if (!ok) throw new Error("claim signature invalid");
  return parsed;
}
