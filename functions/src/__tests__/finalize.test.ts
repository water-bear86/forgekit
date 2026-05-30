import { strict as assert } from "node:assert";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import { DEFAULT_PROJECT_TOKEN_MINT } from "../../../shared/config.js";
import type { TraitEntry, TraitPack } from "../../../shared/traits.js";
import { buildStarterTraitLayers, deriveLicenseId, nextRequestStatus } from "../finalize.js";
import type { ForgeRequestRecord } from "../forgeRequests.js";
import { createApp, type PersistedForgeQuote } from "../index.js";
import type { LicenseRecord } from "../metadata.js";

type FinalizedForgeRequest = Omit<ForgeRequestRecord, "status"> & {
  status: ForgeRequestRecord["status"] | "generating";
  uid?: string;
  licenseId?: string;
  assetAddress?: string;
  finalizationStartedAt?: string;
};

const wallet = "11111111111111111111111111111111";
const otherWallet = "BPFLoader1111111111111111111111111111111111";
const treasuryWallet = "Treasury111111111111111111111111111111111";
const signature = "5wM3p8Z8h1qYQBnV8z4tX8YjvM9v2zNt93s8JomKk9SNMRL6mZppAn6YqPnxVqRmxkHoLJk27WvHgcFbU41SKqfH";

describe("finalize helpers", () => {
  it("derives a stable license id for the same signature", () => {
    assert.equal(deriveLicenseId(signature), deriveLicenseId(signature));
    assert.match(deriveLicenseId(signature), /^[a-f0-9]{24}$/);
  });

  it("derives different license ids for different signatures", () => {
    assert.notEqual(deriveLicenseId(signature), deriveLicenseId(`${signature}2`));
  });

  it("does not regress generated or minted statuses", () => {
    assert.equal(nextRequestStatus("generated", "verified"), "generated");
    assert.equal(nextRequestStatus("minted", "generated"), "minted");
    assert.equal(nextRequestStatus("verified", "generated"), "generated");
  });

  it("rejects empty signatures", () => {
    assert.throws(() => deriveLicenseId(" "), /signature is required/);
  });

  it("rejects starter trait path traversal before reading files", async () => {
    await assert.rejects(
      () => buildStarterTraitLayers([traitEntry({ imagePath: "../secret.svg" })]),
      /trait asset path must stay inside starter-traits/,
    );
  });

  it("rejects absolute starter trait asset paths and unsupported extensions", async () => {
    await assert.rejects(
      () => buildStarterTraitLayers([traitEntry({ imagePath: "/tmp/secret.svg" })]),
      /trait asset path must be relative/,
    );
    await assert.rejects(
      () => buildStarterTraitLayers([traitEntry({ imagePath: "eyes-dot.txt" })]),
      /trait asset path must end with .svg or .png/,
    );
    await assert.rejects(
      () => buildStarterTraitLayers([traitEntry()], "../base-head.svg"),
      /base asset path must stay inside starter-traits/,
    );
  });
});

describe("/api/forge/verify", () => {
  it("verifies a finalized burn transaction and persists a forge request", async () => {
    const persisted: ForgeRequestRecord[] = [];
    const app = createApp({
      nowMs: () => Date.parse("2026-05-27T12:00:00.000Z"),
      readForgeQuote: async (quoteId) => {
        assert.equal(quoteId, "quote-1");
        return forgeQuote();
      },
      fetchParsedTransaction: async (rpcUrl, txSignature) => {
        assert.equal(rpcUrl, "https://rpc.test");
        assert.equal(txSignature, signature);
        return parsedForgeTransaction();
      },
      solanaRpcUrl: () => "https://rpc.test",
      readForgeRequest: async () => undefined,
      persistForgeRequest: async (record) => {
        persisted.push(record);
      },
    });

    const response = await postJson(app, "/api/forge/verify", { quoteId: "quote-1", signature, wallet });
    const body = (await response.json()) as ForgeRequestRecord;

    assert.equal(response.status, 200);
    assert.equal(body.id, signature);
    assert.equal(body.status, "verified");
    assert.equal(body.quoteId, "quote-1");
    assert.equal(body.wallet, wallet);
    assert.equal(body.offerId, "standard");
    assert.equal(body.offerVersion, 1);
    assert.equal(body.burnBaseUnits, "14219576720");
    assert.equal(body.reserveLamports, 2058824);
    assert.equal(body.createdAt, "2026-05-27T12:00:00.000Z");
    assert.deepEqual(persisted, [body]);
  });

  it("binds signed-in Warren uid to the verified forge request", async () => {
    const persisted: ForgeRequestRecord[] = [];
    const app = createApp({
      nowMs: () => Date.parse("2026-05-27T12:00:00.000Z"),
      authenticateUid: async (authHeader) => {
        assert.equal(authHeader, "Bearer id-token-1");
        return "uid-1";
      },
      readForgeQuote: async () => forgeQuote(),
      fetchParsedTransaction: async () => parsedForgeTransaction(),
      solanaRpcUrl: () => "https://rpc.test",
      readForgeRequest: async () => undefined,
      persistForgeRequest: async (record) => {
        persisted.push(record);
      },
    });

    const response = await postJson(
      app,
      "/api/forge/verify",
      { quoteId: "quote-1", signature, wallet },
      { authorization: "Bearer id-token-1" },
    );
    const body = (await response.json()) as ForgeRequestRecord;

    assert.equal(response.status, 200);
    assert.equal(body.uid, "uid-1");
    assert.equal(persisted[0].uid, "uid-1");
  });

  it("requires quoteId, signature, and wallet", async () => {
    const app = createApp();

    const response = await postJson(app, "/api/forge/verify", { quoteId: "quote-1", wallet });
    const body = (await response.json()) as Record<string, unknown>;

    assert.equal(response.status, 400);
    assert.equal(body.error, "quoteId, signature, and wallet are required");
  });

  it("rejects wallet mismatches without persisting", async () => {
    const persisted: ForgeRequestRecord[] = [];
    const app = createApp({
      nowMs: () => Date.parse("2026-05-27T12:00:00.000Z"),
      readForgeQuote: async () => forgeQuote({ wallet: otherWallet }),
      persistForgeRequest: async (record) => {
        persisted.push(record);
      },
    });

    const response = await postJson(app, "/api/forge/verify", { quoteId: "quote-1", signature, wallet });
    const body = (await response.json()) as Record<string, unknown>;

    assert.equal(response.status, 403);
    assert.equal(body.error, "quote wallet does not match request wallet");
    assert.equal(persisted.length, 0);
  });

  it("rejects expired quotes before transaction verification", async () => {
    let fetched = false;
    const app = createApp({
      nowMs: () => Date.parse("2026-05-27T12:00:01.000Z"),
      readForgeQuote: async () => forgeQuote({ expiresAt: Date.parse("2026-05-27T12:00:00.000Z") }),
      fetchParsedTransaction: async () => {
        fetched = true;
        return parsedForgeTransaction();
      },
    });

    const response = await postJson(app, "/api/forge/verify", { quoteId: "quote-1", signature, wallet });
    const body = (await response.json()) as Record<string, unknown>;

    assert.equal(response.status, 400);
    assert.equal(body.error, "quote has expired");
    assert.equal(fetched, false);
  });

  it("returns verification errors and does not persist failed parsed transactions", async () => {
    const persisted: ForgeRequestRecord[] = [];
    const app = createApp({
      nowMs: () => Date.parse("2026-05-27T12:00:00.000Z"),
      solanaRpcUrl: () => "https://rpc.test",
      readForgeQuote: async () => forgeQuote(),
      fetchParsedTransaction: async () => parsedForgeTransaction({ includeTransfer: false }),
      persistForgeRequest: async (record) => {
        persisted.push(record);
      },
    });

    const response = await postJson(app, "/api/forge/verify", { quoteId: "quote-1", signature, wallet });
    const body = (await response.json()) as { errors?: string[] };

    assert.equal(response.status, 400);
    assert.match((body.errors ?? []).join("\n"), /reserve transfer/);
    assert.equal(persisted.length, 0);
  });

  it("requires RPC configuration before transaction lookup", async () => {
    let fetched = false;
    const persisted: ForgeRequestRecord[] = [];
    const app = createApp({
      nowMs: () => Date.parse("2026-05-27T12:00:00.000Z"),
      solanaRpcUrl: () => "",
      readForgeQuote: async () => forgeQuote(),
      fetchParsedTransaction: async () => {
        fetched = true;
        return parsedForgeTransaction();
      },
      persistForgeRequest: async (record) => {
        persisted.push(record);
      },
    });

    const response = await postJson(app, "/api/forge/verify", { quoteId: "quote-1", signature, wallet });
    const body = (await response.json()) as Record<string, unknown>;

    assert.equal(response.status, 500);
    assert.equal(body.error, "FORGEKIT_SOLANA_RPC_URL is not configured.");
    assert.equal(fetched, false);
    assert.equal(persisted.length, 0);
  });

  it("treats verified replay as idempotent and returns the existing record", async () => {
    const existing: ForgeRequestRecord = {
      id: signature,
      quoteId: "quote-1",
      signature,
      wallet,
      offerId: "standard",
      offerVersion: 1,
      burnBaseUnits: "14219576720",
      reserveLamports: 2058824,
      seedMaterial: `${wallet}:${signature}:standard:1`,
      status: "verified",
      createdAt: "2026-05-27T11:59:00.000Z",
      updatedAt: "2026-05-27T11:59:00.000Z",
    };
    const persisted: ForgeRequestRecord[] = [];
    const app = createApp({
      nowMs: () => Date.parse("2026-05-27T12:00:00.000Z"),
      solanaRpcUrl: () => "https://rpc.test",
      readForgeQuote: async () => forgeQuote(),
      fetchParsedTransaction: async () => parsedForgeTransaction(),
      readForgeRequest: async () => existing,
      persistForgeRequest: async (record) => {
        persisted.push(record);
      },
    });

    const response = await postJson(app, "/api/forge/verify", { quoteId: "quote-1", signature, wallet });
    const body = (await response.json()) as ForgeRequestRecord;

    assert.equal(response.status, 200);
    assert.deepEqual(body, existing);
    assert.equal(persisted.length, 0);
  });

  it("rejects verified replay mismatches without persisting", async () => {
    const existing: ForgeRequestRecord = {
      id: signature,
      quoteId: "quote-2",
      signature,
      wallet,
      offerId: "standard",
      offerVersion: 1,
      burnBaseUnits: "14219576720",
      reserveLamports: 2058824,
      seedMaterial: `${wallet}:${signature}:standard:1`,
      status: "verified",
      createdAt: "2026-05-27T11:59:00.000Z",
      updatedAt: "2026-05-27T11:59:00.000Z",
    };
    const persisted: ForgeRequestRecord[] = [];
    const app = createApp({
      nowMs: () => Date.parse("2026-05-27T12:00:00.000Z"),
      solanaRpcUrl: () => "https://rpc.test",
      readForgeQuote: async () => forgeQuote(),
      fetchParsedTransaction: async () => parsedForgeTransaction(),
      readForgeRequest: async () => existing,
      persistForgeRequest: async (record) => {
        persisted.push(record);
      },
    });

    const response = await postJson(app, "/api/forge/verify", { quoteId: "quote-1", signature, wallet });
    const body = (await response.json()) as Record<string, unknown>;

    assert.equal(response.status, 409);
    assert.equal(body.error, "forge request persistence failed");
    assert.match(String(body.detail), /Verified forge request replay mismatch/);
    assert.equal(persisted.length, 0);
  });

  it("leaves generated requests untouched on replay", async () => {
    const existing = {
      id: signature,
      quoteId: "quote-1",
      signature,
      wallet,
      offerId: "standard",
      offerVersion: 1,
      burnBaseUnits: "14219576720",
      reserveLamports: 2058824,
      seedMaterial: `${wallet}:${signature}:standard:1`,
      status: "generated",
      createdAt: "2026-05-27T11:59:00.000Z",
      updatedAt: "2026-05-27T11:59:00.000Z",
    } satisfies ForgeRequestRecord;
    const persisted: ForgeRequestRecord[] = [];
    const app = createApp({
      nowMs: () => Date.parse("2026-05-27T12:00:00.000Z"),
      solanaRpcUrl: () => "https://rpc.test",
      readForgeQuote: async () => forgeQuote(),
      fetchParsedTransaction: async () => parsedForgeTransaction(),
      readForgeRequest: async () => existing,
      persistForgeRequest: async (record) => {
        persisted.push(record);
      },
    });

    const response = await postJson(app, "/api/forge/verify", { quoteId: "quote-1", signature, wallet });
    const body = (await response.json()) as ForgeRequestRecord;

    assert.equal(response.status, 200);
    assert.deepEqual(body, existing);
    assert.equal(persisted.length, 0);
  });

  it("requires a request id for finalize", async () => {
    const app = createApp();

    const response = await postJson(app, "/api/forge/finalize", { requestId: " " });
    const body = (await response.json()) as Record<string, unknown>;

    assert.equal(response.status, 400);
    assert.equal(body.error, "requestId is required");
  });

  it("returns 404 for a missing forge request", async () => {
    const app = createApp({
      claimForgeFinalization: async () => ({ status: "not_found" }),
    });

    const response = await postJson(app, "/api/forge/finalize", { requestId: "request-1" });
    const body = (await response.json()) as Record<string, unknown>;

    assert.equal(response.status, 404);
    assert.equal(body.error, "forge request not found");
  });

  it("returns the existing license for already minted requests", async () => {
    const request = forgeRequest({ status: "minted", licenseId: "license-1", assetAddress: "asset-1" });
    const existing = licenseRecord({ licenseId: "license-1", assetAddress: "asset-1" });
    let minted = false;
    const app = createApp({
      claimForgeFinalization: async () => ({ status: "minted", license: existing, request }),
      mintCoreLicense: async () => {
        minted = true;
        return { assetAddress: "new-asset", signature: "mint-sig" };
      },
    });

    const response = await postJson(app, "/api/forge/finalize", { requestId: signature });
    const body = (await response.json()) as LicenseRecord;

    assert.equal(response.status, 200);
    assert.deepEqual(body, existing);
    assert.equal(minted, false);
  });

  it("guards mainnet mints until explicitly enabled", async () => {
    let claimed = false;
    let minted = false;
    const app = createApp({
      forgeCluster: () => "mainnet-beta",
      enableMainnetMint: () => false,
      claimForgeFinalization: async () => {
        claimed = true;
        return { status: "claimed", request: forgeRequest({ status: "generating" }) };
      },
      mintCoreLicense: async () => {
        minted = true;
        return { assetAddress: "asset-1", signature: "mint-sig" };
      },
    });

    const response = await postJson(app, "/api/forge/finalize", { requestId: signature });
    const body = (await response.json()) as Record<string, unknown>;

    assert.equal(response.status, 403);
    assert.equal(body.error, "mainnet minting is disabled");
    assert.equal(claimed, false);
    assert.equal(minted, false);
  });

  it("claims finalization before uploads, minting, and persistence", async () => {
    const persisted: Array<{ license: LicenseRecord; request: FinalizedForgeRequest }> = [];
    const uploads: Array<{ path: string; value: unknown }> = [];
    const calls: string[] = [];
    const png = Buffer.from("png");
    const app = createApp({
      nowMs: () => Date.parse("2026-05-27T12:00:00.000Z"),
      forgeRpcUrl: () => "https://rpc.forge.test",
      minterKeypairJson: () => "[1]",
      coreCollection: () => "collection-1",
      royaltyCreatorAddress: () => "royalty-1",
      claimForgeFinalization: async ({ requestId, licenseId, nowIso }) => {
        calls.push("claim");
        assert.equal(requestId, signature);
        assert.equal(licenseId, deriveLicenseId(signature));
        assert.equal(nowIso, "2026-05-27T12:00:00.000Z");
        return {
          status: "claimed",
          request: forgeRequest({
            status: "generating",
            licenseId,
            finalizationStartedAt: nowIso,
          }),
        };
      },
      readUserForgeLoot: async ({ wallet: lookupWallet }) => {
        assert.equal(lookupWallet, wallet);
        return 42;
      },
      loadTraitPack: async () => starterPack(),
      composeLicenseImage: async (input) => {
        assert.equal(input.text.idNumber, deriveLicenseId(signature));
        assert.equal(input.layers.length, 3);
        return png;
      },
      uploadPng: async (path, value) => {
        calls.push("uploadPng");
        assert.equal(value, png);
        uploads.push({ path, value });
        return `https://storage.test/${path}`;
      },
      uploadJson: async (path, value) => {
        calls.push("uploadJson");
        uploads.push({ path, value });
        return `https://storage.test/${path}`;
      },
      mintCoreLicense: async (input) => {
        calls.push("mint");
        assert.equal(input.rpcUrl, "https://rpc.forge.test");
        assert.equal(input.owner, wallet);
        assert.equal(input.uri, `https://storage.test/licenses/${deriveLicenseId(signature)}/metadata.json`);
        assert.equal(input.collectionAddress, "collection-1");
        assert.equal(input.royaltyCreatorAddress, "royalty-1");
        return { assetAddress: "asset-1", signature: "mint-sig" };
      },
      persistFinalizedLicense: async ({ license, request }) => {
        calls.push("persist");
        persisted.push({ license, request });
      },
    });

    const response = await postJson(app, "/api/forge/finalize", { requestId: signature });
    const body = (await response.json()) as LicenseRecord;

    assert.equal(response.status, 200);
    assert.equal(body.licenseId, deriveLicenseId(signature));
    assert.equal(body.wallet, wallet);
    assert.equal(body.ownerAtMint, wallet);
    assert.equal(body.assetAddress, "asset-1");
    assert.equal(body.loot, 42);
    assert.equal(body.lootBoost > 0, true);
    assert.equal(uploads[0].path, `licenses/${deriveLicenseId(signature)}/image.png`);
    assert.equal(uploads[1].path, `licenses/${deriveLicenseId(signature)}/metadata.json`);
    assert.equal(persisted.length, 1);
    assert.equal(persisted[0].request.status, "minted");
    assert.equal(persisted[0].request.assetAddress, "asset-1");
    assert.equal(persisted[0].request.licenseId, deriveLicenseId(signature));
    assert.deepEqual(calls, ["claim", "uploadPng", "uploadJson", "mint", "persist"]);
  });

  it("uses the verified request uid when reading Warren loot", async () => {
    let lookup: { uid?: string; wallet: string } | undefined;
    const app = createApp({
      nowMs: () => Date.parse("2026-05-27T12:00:00.000Z"),
      forgeRpcUrl: () => "https://rpc.forge.test",
      minterKeypairJson: () => "[1]",
      coreCollection: () => "collection-1",
      royaltyCreatorAddress: () => "royalty-1",
      claimForgeFinalization: async ({ licenseId, nowIso }) => ({
        status: "claimed",
        request: forgeRequest({
          status: "generating",
          uid: "uid-1",
          licenseId,
          finalizationStartedAt: nowIso,
        }),
      }),
      readUserForgeLoot: async (input) => {
        lookup = input;
        return 77;
      },
      loadTraitPack: async () => starterPack(),
      composeLicenseImage: async () => Buffer.from("png"),
      uploadPng: async (path) => `https://storage.test/${path}`,
      uploadJson: async (path) => `https://storage.test/${path}`,
      mintCoreLicense: async () => ({ assetAddress: "asset-1", signature: "mint-sig" }),
      persistFinalizedLicense: async () => undefined,
    });

    const response = await postJson(app, "/api/forge/finalize", { requestId: signature });
    const body = (await response.json()) as LicenseRecord;

    assert.equal(response.status, 200);
    assert.deepEqual(lookup, { uid: "uid-1", wallet });
    assert.equal(body.loot, 77);
  });

  it("does not mint when finalization is already in progress", async () => {
    let uploaded = false;
    let minted = false;
    const app = createApp({
      claimForgeFinalization: async () => ({
        status: "in_progress",
        licenseId: deriveLicenseId(signature),
      }),
      uploadPng: async () => {
        uploaded = true;
        return "https://storage.test/image.png";
      },
      mintCoreLicense: async () => {
        minted = true;
        return { assetAddress: "asset-1", signature: "mint-sig" };
      },
    });

    const response = await postJson(app, "/api/forge/finalize", { requestId: signature });
    const body = (await response.json()) as Record<string, unknown>;

    assert.equal(response.status, 409);
    assert.equal(body.error, "forge finalization already in progress");
    assert.equal(uploaded, false);
    assert.equal(minted, false);
  });

  it("rejects post-mint persistence mismatches without overwriting the stored asset", async () => {
    const licenseId = deriveLicenseId(signature);
    const stored = forgeRequest({
      status: "generating",
      licenseId,
      assetAddress: "different-asset",
    });
    const app = createApp({
      nowMs: () => Date.parse("2026-05-27T12:00:00.000Z"),
      forgeRpcUrl: () => "https://rpc.forge.test",
      minterKeypairJson: () => "[1]",
      coreCollection: () => "collection-1",
      royaltyCreatorAddress: () => "royalty-1",
      claimForgeFinalization: async () => ({ status: "claimed", request: stored }),
      readUserForgeLoot: async () => 0,
      loadTraitPack: async () => starterPack(),
      composeLicenseImage: async () => Buffer.from("png"),
      uploadPng: async (path) => `https://storage.test/${path}`,
      uploadJson: async (path) => `https://storage.test/${path}`,
      mintCoreLicense: async () => ({ assetAddress: "asset-1", signature: "mint-sig" }),
      persistFinalizedLicense: async ({ license }) => {
        if (stored.assetAddress && stored.assetAddress !== license.assetAddress) {
          throw new Error("Finalization assetAddress mismatch.");
        }
        stored.assetAddress = license.assetAddress;
      },
    });

    const response = await postJson(app, "/api/forge/finalize", { requestId: signature });
    const body = (await response.json()) as Record<string, unknown>;

    assert.equal(response.status, 503);
    assert.equal(body.error, "forge finalization failed");
    assert.match(String(body.detail), /assetAddress mismatch/);
    assert.equal(stored.assetAddress, "different-asset");
  });

  it("does not trust client-provided loot during finalization", async () => {
    let metadataLoot: unknown;
    const app = createApp({
      nowMs: () => Date.parse("2026-05-27T12:00:00.000Z"),
      forgeRpcUrl: () => "https://rpc.forge.test",
      minterKeypairJson: () => "[1]",
      coreCollection: () => "collection-1",
      royaltyCreatorAddress: () => "royalty-1",
      claimForgeFinalization: async () => ({
        status: "claimed",
        request: forgeRequest({ status: "generating", licenseId: deriveLicenseId(signature) }),
      }),
      readUserForgeLoot: async () => 0,
      loadTraitPack: async () => starterPack(),
      composeLicenseImage: async () => Buffer.from("png"),
      uploadPng: async (path) => `https://storage.test/${path}`,
      uploadJson: async (path, value) => {
        metadataLoot = (value as { properties?: { loot?: unknown } }).properties?.loot;
        return `https://storage.test/${path}`;
      },
      mintCoreLicense: async () => ({ assetAddress: "asset-1", signature: "mint-sig" }),
      persistFinalizedLicense: async () => {},
    });

    const response = await postJson(app, "/api/forge/finalize", { requestId: signature, loot: 999_999 });
    const body = (await response.json()) as LicenseRecord;

    assert.equal(response.status, 200);
    assert.equal(body.loot, 0);
    assert.equal(metadataLoot, 0);
  });
});

function forgeRequest(
  overrides: Partial<FinalizedForgeRequest> = {},
): FinalizedForgeRequest {
  return {
    id: signature,
    quoteId: "quote-1",
    signature,
    wallet,
    offerId: "standard",
    offerVersion: 1,
    burnBaseUnits: "14219576720",
    reserveLamports: 2058824,
    seedMaterial: `${wallet}:${signature}:standard:1`,
    status: "verified",
    createdAt: "2026-05-27T11:59:00.000Z",
    updatedAt: "2026-05-27T11:59:00.000Z",
    ...overrides,
  };
}

function traitEntry(overrides: Partial<TraitEntry> = {}): TraitEntry {
  return {
    id: "eyes-dot",
    name: "Dot Eyes",
    rarity_weight: 100,
    imagePath: "eyes-dot.svg",
    category: "eyes",
    zIndex: 10,
    anchorX: 0,
    anchorY: 0,
    colorOverlayAllowed: false,
    incompatibleTraits: [],
    rare: false,
    ...overrides,
  };
}

function licenseRecord(overrides: Partial<LicenseRecord> = {}): LicenseRecord {
  return {
    licenseId: "license-1",
    wallet,
    ownerAtMint: wallet,
    assetAddress: "asset-1",
    imagePath: "licenses/license-1/image.png",
    metadataPath: "licenses/license-1/metadata.json",
    rarityScore: 1001,
    traits: [{ trait_type: "eyes", value: "Dot Eyes" }],
    loot: 0,
    lootBoost: 0,
    pricingSnapshot: { targetUsd: 2.5 },
    createdAt: "2026-05-27T12:00:00.000Z",
    updatedAt: "2026-05-27T12:00:00.000Z",
    ...overrides,
  };
}

function starterPack(): TraitPack {
  return {
    id: "starter",
    version: 1,
    baseImagePath: "base-head.svg",
    categories: ["background", "eyes"],
    traits: [
      {
        id: "background-dmv",
        name: "Condemned DMV Counter",
        rarity_weight: 100,
        imagePath: "background-dmv.svg",
        category: "background",
        zIndex: 0,
        anchorX: 0,
        anchorY: 0,
        colorOverlayAllowed: false,
        incompatibleTraits: [],
        rare: false,
      },
      {
        id: "eyes-dot",
        name: "Dot Eyes",
        rarity_weight: 100,
        imagePath: "eyes-dot.svg",
        category: "eyes",
        zIndex: 10,
        anchorX: 0,
        anchorY: 0,
        colorOverlayAllowed: false,
        incompatibleTraits: [],
        rare: false,
      },
    ],
  } as TraitPack & { baseImagePath: string };
}

function forgeQuote(overrides: Partial<PersistedForgeQuote> = {}): PersistedForgeQuote {
  return {
    quoteId: "quote-1",
    wallet,
    offerId: "standard",
    offerVersion: 1,
    targetUsd: 2.5,
    opsReserveUsd: 0.35,
    burnUsd: 2.15,
    tokenUsd: 0.0001512,
    solUsd: 170,
    burnBaseUnits: "14219576720",
    burnUiAmount: 14219.57672,
    reserveLamports: 2058824,
    treasuryWallet,
    mintMode: "core",
    royaltyBasisPoints: 500,
    issuedAt: Date.parse("2026-05-27T11:59:00.000Z"),
    expiresAt: Date.parse("2026-05-27T12:03:00.000Z"),
    createdAt: "2026-05-27T11:59:00.000Z",
    ...overrides,
  };
}

function parsedForgeTransaction(
  overrides: {
    includeTransfer?: boolean;
  } = {},
) {
  return {
    meta: { err: null },
    transaction: {
      message: {
        accountKeys: [{ pubkey: wallet, signer: true }],
        instructions: [
          {
            programId: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
            parsed: {
              type: "burnChecked",
              info: {
                mint: DEFAULT_PROJECT_TOKEN_MINT,
                authority: wallet,
                tokenAmount: { amount: "14219576720", decimals: 6 },
              },
            },
          },
          ...(overrides.includeTransfer === false
            ? []
            : [
                {
                  programId: "11111111111111111111111111111111",
                  parsed: {
                    type: "transfer",
                    info: {
                      source: wallet,
                      destination: treasuryWallet,
                      lamports: 2058824,
                    },
                  },
                },
              ]),
        ],
      },
    },
  };
}

async function postJson(
  app: ReturnType<typeof createApp>,
  path: string,
  payload: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<Response> {
  const server: Server = app.listen(0);

  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address() as AddressInfo | null;
    assert.ok(address);

    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(payload),
    });
    const body = await response.text();

    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}
