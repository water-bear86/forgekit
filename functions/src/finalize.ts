import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import type { LicenseAttribute } from "../../shared/licenseMetadata.js";
import type { TraitEntry, TraitPack } from "../../shared/traits.js";
import type { LicenseLayer } from "./compositor.js";
import type { ForgeRequestRecord } from "./forgeRequests.js";

export type ForgeStatus = "verified" | "generated" | "generating" | "minted" | "failed";

const STATUS_RANK: Record<ForgeStatus, number> = {
  failed: 0,
  verified: 1,
  generated: 2,
  generating: 3,
  minted: 4,
};

export function deriveLicenseId(signature: string): string {
  const normalized = signature.trim();
  if (!normalized) throw new Error("signature is required");
  return createHash("sha256")
    .update(`forgekit-asset:${normalized}`)
    .digest("hex")
    .slice(0, 24);
}

export function nextRequestStatus(current: ForgeStatus, proposed: ForgeStatus): ForgeStatus {
  return STATUS_RANK[current] >= STATUS_RANK[proposed] ? current : proposed;
}

export async function loadStarterTraitPack(): Promise<TraitPack> {
  const manifestPath = join(starterTraitsDir(), "manifest.json");
  return JSON.parse(await readFile(manifestPath, "utf8")) as TraitPack;
}

export async function buildStarterTraitLayers(traits: TraitEntry[], baseImagePath?: string): Promise<LicenseLayer[]> {
  const baseLayer = baseImagePath
    ? [{
        input: await readFile(resolveStarterAssetPath(baseImagePath, "base")),
        zIndex: 1,
        anchorX: 0,
        anchorY: 0,
      }]
    : [];
  const layers = await Promise.all(
    traits.map(async (trait) => ({
      input: await readFile(resolveStarterAssetPath(trait.imagePath, "trait")),
      zIndex: trait.zIndex,
      anchorX: trait.anchorX,
      anchorY: trait.anchorY,
    })),
  );
  return [...baseLayer, ...layers];
}

export function buildTraitAttributes(traits: TraitEntry[], rarityScore: number): LicenseAttribute[] {
  return [
    ...traits.map((trait) => ({
      trait_type: trait.category,
      value: trait.name,
    })),
    { trait_type: "rarity_score", value: rarityScore },
  ];
}

export function licenseNumberFromId(licenseId: string): number {
  const parsed = Number.parseInt(licenseId.slice(0, 12), 16);
  if (!Number.isSafeInteger(parsed)) return 1;
  return (parsed % 999_999) + 1;
}

export function pricingSnapshotFromRequest(request: ForgeRequestRecord): Record<string, unknown> {
  return {
    quoteId: request.quoteId,
    offerId: request.offerId,
    offerVersion: request.offerVersion,
    burnBaseUnits: request.burnBaseUnits,
    reserveLamports: request.reserveLamports,
  };
}

function starterTraitsDir(): string {
  return resolve(process.cwd(), "assets", "starter-traits");
}

function resolveStarterAssetPath(assetPath: string, label: "base" | "trait"): string {
  const trimmed = assetPath.trim();
  if (!trimmed) throw new Error(`${label} asset path is required`);
  if (isAbsolute(trimmed)) throw new Error(`${label} asset path must be relative`);

  const extension = extname(trimmed).toLowerCase();
  if (extension !== ".svg" && extension !== ".png") {
    throw new Error(`${label} asset path must end with .svg or .png`);
  }

  const root = starterTraitsDir();
  const resolved = resolve(root, trimmed);
  const pathFromRoot = relative(root, resolved);
  if (pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)) {
    throw new Error(`${label} asset path must stay inside starter-traits`);
  }

  return resolved;
}
