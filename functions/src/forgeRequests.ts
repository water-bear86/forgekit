export interface BuildForgeRequestInput {
  quoteId: string;
  signature: string;
  wallet: string;
  uid?: string;
  offerId: string;
  offerVersion: number;
  burnBaseUnits: string;
  reserveLamports: number;
  nowIso: string;
}

export interface ForgeRequestRecord {
  id: string;
  quoteId: string;
  signature: string;
  wallet: string;
  uid?: string;
  offerId: string;
  offerVersion: number;
  burnBaseUnits: string;
  reserveLamports: number;
  seedMaterial: string;
  status: "verified" | "generated" | "minted" | "failed";
  createdAt: string;
  updatedAt: string;
}

export function buildForgeRequestRecord(input: BuildForgeRequestInput): ForgeRequestRecord {
  const record: ForgeRequestRecord = {
    id: input.signature,
    quoteId: input.quoteId,
    signature: input.signature,
    wallet: input.wallet,
    offerId: input.offerId,
    offerVersion: input.offerVersion,
    burnBaseUnits: input.burnBaseUnits,
    reserveLamports: input.reserveLamports,
    seedMaterial: `${input.wallet}:${input.signature}:${input.offerId}:${input.offerVersion}`,
    status: "verified",
    createdAt: input.nowIso,
    updatedAt: input.nowIso,
  };
  if (input.uid) record.uid = input.uid;
  return record;
}

export function assertForgeRequestCanTransition(
  existing: ForgeRequestRecord | undefined,
  next: ForgeRequestRecord,
): void {
  if (!existing) return;
  if (existing.status === "verified" && next.status === "verified") {
    assertVerifiedReplayMatches(existing, next);
    return;
  }

  if ((existing.status === "generated" || existing.status === "minted") && next.status === "verified") {
    throw new Error(`Cannot transition forge request ${next.id} from ${existing.status} to verified.`);
  }
}

function assertVerifiedReplayMatches(existing: ForgeRequestRecord, next: ForgeRequestRecord): void {
  for (const field of VERIFIED_REPLAY_IDENTITY_FIELDS) {
    if (existing[field] !== next[field]) {
      throw new Error(`Verified forge request replay mismatch for ${next.id}: ${field} differs.`);
    }
  }
}

const VERIFIED_REPLAY_IDENTITY_FIELDS = [
  "id",
  "quoteId",
  "signature",
  "wallet",
  "uid",
  "offerId",
  "offerVersion",
  "burnBaseUnits",
  "reserveLamports",
  "seedMaterial",
] as const satisfies ReadonlyArray<keyof ForgeRequestRecord>;
