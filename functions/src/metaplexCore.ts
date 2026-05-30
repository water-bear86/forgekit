import { create, createCollection, fetchCollection, mplCore } from "@metaplex-foundation/mpl-core";
import {
  createSignerFromKeypair,
  generateSigner,
  publicKey,
  signerIdentity,
  type Keypair as UmiKeypair,
  type PublicKey as UmiPublicKey,
  type Umi,
} from "@metaplex-foundation/umi";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { fromWeb3JsKeypair } from "@metaplex-foundation/umi-web3js-adapters";
import { Keypair } from "@solana/web3.js";

export const CORE_ROYALTY_BASIS_POINTS = 500;

export interface CoreMintInput {
  rpcUrl: string;
  minterKeypairJson: string;
  owner: string;
  name: string;
  uri: string;
  collectionAddress: string;
  royaltyCreatorAddress: string;
}

export interface CoreRoyaltyPlugin {
  type: "Royalties";
  basisPoints: number;
  creators: [{ address: string; percentage: 100 }];
  ruleSet: "None";
}

export interface CoreCollectionInput {
  rpcUrl: string;
  minterKeypairJson: string;
  name: string;
  uri: string;
  creatorAddress: string;
  royaltyBasisPoints?: number;
}

export interface MetaplexRoyaltyPlugin {
  type: "Royalties";
  basisPoints: number;
  creators: [{ address: UmiPublicKey; percentage: 100 }];
  ruleSet: { type: "None" };
}

type CollectionLike = {
  royalties?: unknown;
  plugins?: unknown;
};

export function normalizeRoyaltyBasisPoints(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 10_000) {
    throw new Error("royalty basis points must be between 0 and 10000");
  }
  return value;
}

export function buildRoyaltyPlugin(creatorAddress: string, basisPoints = CORE_ROYALTY_BASIS_POINTS): CoreRoyaltyPlugin {
  return {
    type: "Royalties",
    basisPoints: normalizeRoyaltyBasisPoints(basisPoints),
    creators: [{ address: creatorAddress, percentage: 100 }],
    ruleSet: "None",
  };
}

export function buildMetaplexRoyaltyPlugin(
  creatorAddress: string,
  basisPoints = CORE_ROYALTY_BASIS_POINTS,
): MetaplexRoyaltyPlugin {
  const plugin = buildRoyaltyPlugin(creatorAddress, basisPoints);
  return {
    type: plugin.type,
    basisPoints: plugin.basisPoints,
    creators: [
      {
        address: publicKey(plugin.creators[0].address),
        percentage: plugin.creators[0].percentage,
      },
    ],
    ruleSet: { type: plugin.ruleSet },
  };
}

export function parseMinterKeypairJson(minterKeypairJson: string): UmiKeypair {
  let parsed: unknown;
  try {
    parsed = JSON.parse(minterKeypairJson);
  } catch (err) {
    throw new Error(
      `minter keypair JSON must be a valid Solana keypair array: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!Array.isArray(parsed)) {
    throw new Error("minter keypair JSON must be an array");
  }
  if (parsed.length !== 64) {
    throw new Error("minter keypair JSON must contain exactly 64 integer bytes");
  }
  for (const value of parsed) {
    if (!Number.isInteger(value) || value < 0 || value > 255) {
      throw new Error("minter keypair JSON must contain exactly 64 integer bytes");
    }
  }

  try {
    const secret = Uint8Array.from(parsed);
    return fromWeb3JsKeypair(Keypair.fromSecretKey(secret));
  } catch (err) {
    throw new Error(
      `minter keypair JSON must be a valid Solana keypair: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export function assertCollectionRoyalties(
  collection: CollectionLike,
  expectedCreatorAddress: string,
  expectedBasisPoints = CORE_ROYALTY_BASIS_POINTS,
): void {
  const royalties = findCollectionRoyalties(collection);
  if (!royalties) {
    throw new Error("Core collection is missing royalties");
  }

  if (royalties.basisPoints !== expectedBasisPoints) {
    throw new Error(`Core collection royalties must be ${expectedBasisPoints} basis points`);
  }

  if (royalties.creators.length !== 1) {
    throw new Error("Core collection royalties must include a single 100 percent creator");
  }
  const creator = royalties.creators.find((entry) => entry.address === expectedCreatorAddress);
  if (!creator) {
    throw new Error("Core collection royalties must include the expected creator");
  }
  if (creator.percentage !== 100) {
    throw new Error("Core collection royalty creator must receive 100 percent");
  }

  if (getRuleSetKind(royalties.ruleSet) !== "None") {
    throw new Error("Core collection royalties must use a None ruleSet");
  }
}

export async function mintCoreLicense(input: CoreMintInput): Promise<{ assetAddress: string; signature: string }> {
  if (!input.collectionAddress?.trim()) {
    throw new Error("collectionAddress is required for Core license mints so royalties are enforced");
  }
  if (!input.royaltyCreatorAddress?.trim()) {
    throw new Error("royaltyCreatorAddress is required for Core license mints so royalties can be verified");
  }

  const umi = createMetaplexCoreUmi(input.rpcUrl, input.minterKeypairJson);
  const asset = generateSigner(umi);
  const args: Parameters<typeof create>[1] = {
    asset,
    name: input.name,
    uri: input.uri,
    owner: publicKey(input.owner),
  };

  const collection = await fetchCollection(umi, publicKey(input.collectionAddress));
  assertCollectionRoyalties(collection as CollectionLike, input.royaltyCreatorAddress);
  args.collection = collection;

  const result = await create(umi, args).sendAndConfirm(umi);
  return {
    assetAddress: asset.publicKey.toString(),
    signature: Buffer.from(result.signature).toString("base64"),
  };
}

export async function createCoreCollectionWithRoyalties(
  input: CoreCollectionInput,
): Promise<{ collectionAddress: string; signature: string }> {
  if (
    input.royaltyBasisPoints !== undefined &&
    input.royaltyBasisPoints !== CORE_ROYALTY_BASIS_POINTS
  ) {
    throw new Error(`royaltyBasisPoints must be ${CORE_ROYALTY_BASIS_POINTS}`);
  }

  const umi = createMetaplexCoreUmi(input.rpcUrl, input.minterKeypairJson);
  const collection = generateSigner(umi);
  const plugin = buildMetaplexRoyaltyPlugin(
    input.creatorAddress,
    input.royaltyBasisPoints ?? CORE_ROYALTY_BASIS_POINTS,
  );
  const result = await createCollection(umi, {
    collection,
    name: input.name,
    uri: input.uri,
    plugins: [plugin],
  }).sendAndConfirm(umi);

  return {
    collectionAddress: collection.publicKey.toString(),
    signature: Buffer.from(result.signature).toString("base64"),
  };
}

function createMetaplexCoreUmi(rpcUrl: string, minterKeypairJson: string): Umi {
  const umi = createUmi(rpcUrl).use(mplCore());
  const minter = createSignerFromKeypair(umi, parseMinterKeypairJson(minterKeypairJson));
  return umi.use(signerIdentity(minter));
}

function findCollectionRoyalties(collection: CollectionLike): NormalizedCollectionRoyalties | undefined {
  return normalizeCollectionRoyalties(
    collection.royalties ??
      readObjectProperty(collection.plugins, "royalties") ??
      findRoyaltiesInPluginList(collection.plugins),
  );
}

type NormalizedCollectionRoyalties = {
  basisPoints: number;
  creators: Array<{ address: string; percentage: number }>;
  ruleSet: unknown;
};

function normalizeCollectionRoyalties(candidate: unknown): NormalizedCollectionRoyalties | undefined {
  const royaltyObject = asRecord(candidate);
  if (!royaltyObject) return undefined;
  const data = asRecord(royaltyObject.data) ?? royaltyObject;
  const basisPoints = data.basisPoints;
  const creators = data.creators;
  if (typeof basisPoints !== "number" || !Array.isArray(creators)) return undefined;

  return {
    basisPoints,
    creators: creators
      .map((entry) => asRecord(entry))
      .filter((entry): entry is Record<string, unknown> => Boolean(entry))
      .map((entry) => ({
        address: String(entry.address),
        percentage: typeof entry.percentage === "number" ? entry.percentage : Number.NaN,
      })),
    ruleSet: data.ruleSet,
  };
}

function findRoyaltiesInPluginList(plugins: unknown): unknown {
  if (!Array.isArray(plugins)) return undefined;
  return plugins.find((plugin) => readObjectProperty(plugin, "type") === "Royalties");
}

function readObjectProperty(value: unknown, property: string): unknown {
  return asRecord(value)?.[property];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function getRuleSetKind(ruleSet: unknown): string | undefined {
  if (typeof ruleSet === "string") return ruleSet;
  const ruleSetObject = asRecord(ruleSet);
  const kind = ruleSetObject?.type ?? ruleSetObject?.__kind;
  return typeof kind === "string" ? kind : undefined;
}
