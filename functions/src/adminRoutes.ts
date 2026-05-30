import { randomUUID } from "node:crypto";
import type { Express } from "express";
import { PublicKey } from "@solana/web3.js";
import type { TraitCategory, TraitEntry, TraitPack } from "../../shared/traits.js";
import { firestore, requireAdminUid } from "./admin.js";
import { CORE_ROYALTY_BASIS_POINTS } from "./metaplexCore.js";
import type { ForgeRequestRecord } from "./forgeRequests.js";

const VALID_TRAIT_CATEGORIES = new Set<TraitCategory>([
  "eyes",
  "nose",
  "ears",
  "mouth",
  "hat_hair",
  "shirt",
  "extras",
  "background",
  "rare_mutations",
]);

export type AdminAuditAction = "offer.update" | "traits.update" | "mint.admin_free.create";

export interface AdminAuditRecord {
  id: string;
  action: AdminAuditAction;
  adminUid: string;
  targetPath: string;
  targetId: string;
  createdAt: string;
  payload: Record<string, unknown>;
}

export type AdminMintRequestRecord = ForgeRequestRecord & {
  adminUid: string;
  mintMode: "admin_free";
  noBurn: true;
};

export interface AdminRouteDependencies {
  nowMs?: () => number;
  nonce?: () => string;
  authenticateAdminUid?: (authHeader: string | undefined) => Promise<string>;
  persistAdminOffer?: (offerId: string, patch: Record<string, unknown>) => Promise<void>;
  persistTraitPack?: (packId: string, manifest: Record<string, unknown>) => Promise<void>;
  persistAdminAudit?: (record: AdminAuditRecord) => Promise<void>;
  persistAdminMintRequest?: (record: AdminMintRequestRecord) => Promise<void>;
}

export function isUidAllowed(uid: string, allowlist: string): boolean {
  if (!uid) return false;
  return allowlist
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .includes(uid);
}

export function normalizeOfferPatch(raw: unknown, nowIso = new Date().toISOString()): Record<string, unknown> {
  const input = requirePlainObject(raw, "offer patch");
  const patch: Record<string, unknown> = {};

  if ("enabled" in input) patch.enabled = requireBoolean(input.enabled, "enabled");
  if ("public" in input) patch.public = requireBoolean(input.public, "public");
  if ("targetUsd" in input) patch.targetUsd = requireFiniteNumber(input.targetUsd, "targetUsd", { minExclusive: 0 });
  if ("opsReserveUsd" in input) {
    patch.opsReserveUsd = requireFiniteNumber(input.opsReserveUsd, "opsReserveUsd", { minInclusive: 0 });
  }
  if ("royaltyBasisPoints" in input) {
    const royaltyBasisPoints = requireFiniteNumber(input.royaltyBasisPoints, "royaltyBasisPoints");
    if (royaltyBasisPoints !== CORE_ROYALTY_BASIS_POINTS) {
      throw new Error(`royaltyBasisPoints must remain ${CORE_ROYALTY_BASIS_POINTS}`);
    }
    patch.royaltyBasisPoints = CORE_ROYALTY_BASIS_POINTS;
  }
  if ("mintMode" in input) {
    if (input.mintMode !== "core" && input.mintMode !== "offchain_preview") {
      throw new Error("mintMode must be core or offchain_preview");
    }
    patch.mintMode = input.mintMode;
  }
  if ("rarity" in input) {
    const rarity = requirePlainObject(input.rarity, "rarity");
    patch.rarity = {
      maxBoost: requireFiniteNumber(rarity.maxBoost, "rarity.maxBoost", { minInclusive: 0, maxInclusive: 1 }),
      boostCurve: requireFiniteNumber(rarity.boostCurve, "rarity.boostCurve", { minExclusive: 0, maxInclusive: 1 }),
    };
  }
  if (
    typeof patch.targetUsd === "number" &&
    typeof patch.opsReserveUsd === "number" &&
    patch.opsReserveUsd >= patch.targetUsd
  ) {
    throw new Error("opsReserveUsd must be below targetUsd");
  }

  if (Object.keys(patch).length === 0) {
    throw new Error("offer patch must include at least one supported field");
  }
  patch.updatedAt = nowIso;
  return patch;
}

export function normalizeTraitPackManifest(raw: unknown, nowIso = new Date().toISOString()): Record<string, unknown> {
  const manifest = typeof raw === "string"
    ? parseJsonObject(raw, "trait pack manifest")
    : requirePlainObject(raw, "trait pack manifest");
  const id = readRequiredDocumentId(manifest.id, "manifest id");
  if (!Number.isInteger(manifest.version) || Number(manifest.version) <= 0) {
    throw new Error("trait pack manifest version must be a positive integer");
  }
  if (!Array.isArray(manifest.categories) || manifest.categories.length === 0) {
    throw new Error("trait pack manifest categories must be a non-empty array");
  }
  const categories = manifest.categories.map((category, index) => requireTraitCategory(category, `categories[${index}]`));
  if (new Set(categories).size !== categories.length) {
    throw new Error("trait pack manifest categories must not contain duplicates");
  }
  const categorySet = new Set(categories);

  if (!Array.isArray(manifest.traits) || manifest.traits.length === 0) {
    throw new Error("trait pack manifest traits must be a non-empty array");
  }
  const traits = manifest.traits.map((trait, index) => normalizeTraitEntry(trait, index, categorySet));
  const traitIds = new Set<string>();
  for (const trait of traits) {
    if (traitIds.has(trait.id)) throw new Error(`trait id ${trait.id} must be unique`);
    traitIds.add(trait.id);
  }
  for (const category of categories) {
    if (!traits.some((trait) => trait.category === category)) {
      throw new Error(`category ${category} must include at least one trait`);
    }
  }

  const normalized: Record<string, unknown> = {
    id,
    version: manifest.version,
    categories,
    traits,
    updatedAt: nowIso,
  };

  if ("baseImagePath" in manifest) {
    normalized.baseImagePath = validateAssetPath(manifest.baseImagePath, "baseImagePath");
  }
  if ("safeDefaultTraitIds" in manifest) {
    normalized.safeDefaultTraitIds = normalizeSafeDefaultTraitIds(
      manifest.safeDefaultTraitIds,
      categorySet,
      new Map(traits.map((trait) => [trait.id, trait.category])),
    );
  }

  return normalized;
}

export function registerAdminRoutes(app: Express, dependencies: AdminRouteDependencies = {}): void {
  const authenticateAdminUid = dependencies.authenticateAdminUid ?? requireAdminUid;
  const persistAdminOffer = dependencies.persistAdminOffer ?? persistAdminOfferToFirestore;
  const persistTraitPack = dependencies.persistTraitPack ?? persistTraitPackToFirestore;
  const persistAdminAudit = dependencies.persistAdminAudit ?? persistAdminAuditToFirestore;
  const persistAdminMintRequest = dependencies.persistAdminMintRequest ?? persistAdminMintRequestToFirestore;

  app.post("/api/admin/offers", async (req, res) => {
    const adminUid = await authenticateAdminRequest(authenticateAdminUid, req.header("authorization"), res);
    if (!adminUid) return;

    const body = (req.body ?? {}) as Record<string, unknown>;
    let offerId: string;
    try {
      offerId = readDocumentId(body.offerId, "offerId");
    } catch (err) {
      res.status(400).json({ error: messageFromError(err) });
      return;
    }
    if (!offerId) {
      res.status(400).json({ error: "offerId is required" });
      return;
    }

    const nowIso = new Date(dependencies.nowMs?.() ?? Date.now()).toISOString();
    let patch: Record<string, unknown>;
    try {
      patch = normalizeOfferPatch(body.patch ?? body, nowIso);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
      return;
    }

    try {
      await persistAdminOffer(offerId, patch);
      await persistAdminAudit(buildAuditRecord({
        action: "offer.update",
        adminUid,
        targetPath: `forgeOffers/${offerId}`,
        targetId: offerId,
        payload: { patch },
        nowIso,
        idSeed: dependencies.nonce?.(),
      }));
      res.json({ ok: true, adminUid });
    } catch (err) {
      res.status(503).json({ error: "admin offer persistence failed", detail: messageFromError(err) });
    }
  });

  app.post("/api/admin/traits", async (req, res) => {
    const adminUid = await authenticateAdminRequest(authenticateAdminUid, req.header("authorization"), res);
    if (!adminUid) return;

    const body = (req.body ?? {}) as Record<string, unknown>;
    const nowIso = new Date(dependencies.nowMs?.() ?? Date.now()).toISOString();
    let manifest: Record<string, unknown>;
    try {
      manifest = normalizeTraitPackManifest(body.manifest ?? body.traitPack ?? body, nowIso);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
      return;
    }

    let packId: string;
    try {
      packId = readDocumentId(body.packId ?? body.id ?? manifest.id, "packId");
    } catch (err) {
      res.status(400).json({ error: messageFromError(err) });
      return;
    }
    try {
      await persistTraitPack(packId, manifest);
      await persistAdminAudit(buildAuditRecord({
        action: "traits.update",
        adminUid,
        targetPath: `traitPacks/${packId}`,
        targetId: packId,
        payload: { traitPackId: manifest.id, version: manifest.version },
        nowIso,
        idSeed: dependencies.nonce?.(),
      }));
      res.json({ ok: true, adminUid });
    } catch (err) {
      res.status(503).json({ error: "admin trait pack persistence failed", detail: messageFromError(err) });
    }
  });

  app.post("/api/admin/mint", async (req, res) => {
    const adminUid = await authenticateAdminRequest(authenticateAdminUid, req.header("authorization"), res);
    if (!adminUid) return;

    const body = (req.body ?? {}) as Record<string, unknown>;
    const wallet = typeof body.wallet === "string" ? body.wallet.trim() : "";
    if (!wallet) {
      res.status(400).json({ error: "wallet is required" });
      return;
    }

    let ownerWallet: string;
    try {
      ownerWallet = new PublicKey(wallet).toBase58();
    } catch {
      res.status(400).json({ error: "wallet must be a valid Solana public key" });
      return;
    }

    let offerId: string;
    let requestId: string;
    try {
      offerId = readDocumentId(body.offerId, "offerId") || "admin_free";
      requestId = readDocumentId(body.requestId, "requestId") || dependencies.nonce?.() || randomUUID();
    } catch (err) {
      res.status(400).json({ error: messageFromError(err) });
      return;
    }
    const nowIso = new Date(dependencies.nowMs?.() ?? Date.now()).toISOString();
    const record: AdminMintRequestRecord = {
      id: requestId,
      quoteId: `admin:${requestId}`,
      signature: requestId,
      wallet: ownerWallet,
      offerId,
      offerVersion: 0,
      burnBaseUnits: "0",
      reserveLamports: 0,
      seedMaterial: `${ownerWallet}:${requestId}:admin_free:${adminUid}`,
      status: "verified",
      createdAt: nowIso,
      updatedAt: nowIso,
      adminUid,
      mintMode: "admin_free",
      noBurn: true,
    };

    try {
      await persistAdminMintRequest(record);
      await persistAdminAudit(buildAuditRecord({
        action: "mint.admin_free.create",
        adminUid,
        targetPath: `forgeRequests/${requestId}`,
        targetId: requestId,
        payload: { requestId, wallet: ownerWallet, offerId, mintMode: "admin_free", noBurn: true },
        nowIso,
        idSeed: dependencies.nonce?.(),
      }));
      res.json({ ok: true, adminUid, requestId, mintMode: "admin_free", noBurn: true });
    } catch (err) {
      res.status(503).json({ error: "admin mint request persistence failed", detail: messageFromError(err) });
    }
  });
}

function buildAuditRecord(input: {
  action: AdminAuditAction;
  adminUid: string;
  targetPath: string;
  targetId: string;
  payload: Record<string, unknown>;
  nowIso: string;
  idSeed?: string;
}): AdminAuditRecord {
  const id = input.idSeed || randomUUID();
  return {
    id,
    action: input.action,
    adminUid: input.adminUid,
    targetPath: input.targetPath,
    targetId: input.targetId,
    createdAt: input.nowIso,
    payload: input.payload,
  };
}

async function authenticateAdminRequest(
  authenticateAdminUid: (authHeader: string | undefined) => Promise<string>,
  authHeader: string | undefined,
  res: { status: (code: number) => { json: (body: Record<string, unknown>) => void } },
): Promise<string | null> {
  try {
    return await authenticateAdminUid(authHeader);
  } catch (err) {
    res.status(401).json({ error: messageFromError(err) });
    return null;
  }
}

function requirePlainObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} is required`);
  return trimmed;
}

function parseJsonObject(value: string, label: string): Record<string, unknown> {
  try {
    return requirePlainObject(JSON.parse(value), label);
  } catch (err) {
    if (err instanceof SyntaxError) throw new Error(`${label} must be valid JSON`);
    throw err;
  }
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${field} must be a boolean`);
  return value;
}

function requireFiniteNumber(
  value: unknown,
  field: string,
  bounds: { minExclusive?: number; minInclusive?: number; maxInclusive?: number } = {},
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${field} must be a finite number`);
  }
  if (bounds.minExclusive !== undefined && value <= bounds.minExclusive) {
    throw new Error(`${field} must be greater than ${bounds.minExclusive}`);
  }
  if (bounds.minInclusive !== undefined && value < bounds.minInclusive) {
    throw new Error(`${field} must be greater than or equal to ${bounds.minInclusive}`);
  }
  if (bounds.maxInclusive !== undefined && value > bounds.maxInclusive) {
    throw new Error(`${field} must be less than or equal to ${bounds.maxInclusive}`);
  }
  return value;
}

function readDocumentId(value: unknown, field: string): string {
  if (value === undefined || value === null) return "";
  const id = requireString(value, field);
  if (id.includes("/")) throw new Error(`${field} cannot contain slashes`);
  return id;
}

function readRequiredDocumentId(value: unknown, field: string): string {
  const id = readDocumentId(value, field);
  if (!id) throw new Error(`${field} is required`);
  return id;
}

function requireTraitCategory(value: unknown, field: string): TraitCategory {
  if (typeof value !== "string" || !VALID_TRAIT_CATEGORIES.has(value as TraitCategory)) {
    throw new Error(`${field} must be a valid trait category`);
  }
  return value as TraitCategory;
}

function normalizeTraitEntry(value: unknown, index: number, categorySet: Set<TraitCategory>): TraitEntry {
  const field = `traits[${index}]`;
  const trait = requirePlainObject(value, field);
  const category = requireTraitCategory(trait.category, `${field}.category`);
  if (!categorySet.has(category)) throw new Error(`${field}.category must be listed in categories`);

  return {
    id: requireString(trait.id, `${field}.id`),
    name: requireString(trait.name, `${field}.name`),
    imagePath: validateAssetPath(trait.imagePath, `${field}.imagePath`),
    category,
    zIndex: requireInteger(trait.zIndex, `${field}.zIndex`),
    anchorX: requireInteger(trait.anchorX, `${field}.anchorX`),
    anchorY: requireInteger(trait.anchorY, `${field}.anchorY`),
    colorOverlayAllowed: requireBoolean(trait.colorOverlayAllowed, `${field}.colorOverlayAllowed`),
    incompatibleTraits: requireStringArray(trait.incompatibleTraits, `${field}.incompatibleTraits`),
    rare: requireBoolean(trait.rare, `${field}.rare`),
    rarity_weight: requireFiniteNumber(trait.rarity_weight, `${field}.rarity_weight`, { minExclusive: 0 }),
  };
}

function requireInteger(value: unknown, field: string): number {
  const number = requireFiniteNumber(value, field);
  if (!Number.isInteger(number)) throw new Error(`${field} must be an integer`);
  return number;
}

function requireStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array of strings`);
  return value.map((item, index) => requireString(item, `${field}[${index}]`));
}

function validateAssetPath(value: unknown, field: string): string {
  const path = requireString(value, field);
  if (path.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(path)) {
    throw new Error(`${field} must be a relative path`);
  }
  if (path.split(/[\\/]/).includes("..")) {
    throw new Error(`${field} cannot contain path traversal`);
  }
  if (path.includes("/") || path.includes("\\")) {
    throw new Error(`${field} must be a flat asset filename`);
  }
  if (!/\.(svg|png)$/i.test(path)) {
    throw new Error(`${field} must end in .svg or .png`);
  }
  return path;
}

function normalizeSafeDefaultTraitIds(
  value: unknown,
  categorySet: Set<TraitCategory>,
  traitCategories: Map<string, TraitCategory>,
): Partial<Record<TraitCategory, string>> {
  const safeDefaults = requirePlainObject(value, "safeDefaultTraitIds");
  const normalized: Partial<Record<TraitCategory, string>> = {};
  for (const [rawCategory, rawTraitId] of Object.entries(safeDefaults)) {
    const category = requireTraitCategory(rawCategory, `safeDefaultTraitIds.${rawCategory}`);
    if (!categorySet.has(category)) {
      throw new Error(`safeDefaultTraitIds.${category} must reference a listed category`);
    }
    const traitId = requireString(rawTraitId, `safeDefaultTraitIds.${category}`);
    if (!traitCategories.has(traitId)) {
      throw new Error(`safeDefaultTraitIds.${category} must reference an existing trait id`);
    }
    if (traitCategories.get(traitId) !== category) {
      throw new Error(`safeDefaultTraitIds.${category} must reference a trait in the same category`);
    }
    normalized[category] = traitId;
  }
  return normalized;
}

function messageFromError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function persistAdminOfferToFirestore(offerId: string, patch: Record<string, unknown>): Promise<void> {
  await firestore().collection("forgeOffers").doc(offerId).set(patch, { merge: true });
}

async function persistTraitPackToFirestore(packId: string, manifest: Record<string, unknown>): Promise<void> {
  await firestore().collection("traitPacks").doc(packId).set(manifest as unknown as TraitPack, { merge: true });
}

async function persistAdminAuditToFirestore(record: AdminAuditRecord): Promise<void> {
  await firestore().collection("adminAudit").doc(record.id).set(record, { merge: false });
}

async function persistAdminMintRequestToFirestore(record: AdminMintRequestRecord): Promise<void> {
  await firestore().collection("forgeRequests").doc(record.id).set(record, { merge: false });
}
