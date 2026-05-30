import { strict as assert } from "node:assert";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import { isUidAllowed, normalizeOfferPatch, normalizeTraitPackManifest } from "../adminRoutes.js";
import { createApp, type AdminAuditRecord, type AdminMintRequestRecord } from "../index.js";

describe("admin route helpers", () => {
  it("matches admin UIDs exactly after trimming comma-separated allowlists", () => {
    assert.equal(isUidAllowed("uid-1", " uid-1, uid-2 ,, "), true);
    assert.equal(isUidAllowed("uid", "uid-1,uid-2"), false);
    assert.equal(isUidAllowed("uid-2 ", "uid-1,uid-2"), false);
  });

  it("normalizes safe offer patches and stamps updatedAt", () => {
    assert.deepEqual(
      normalizeOfferPatch(
        {
          enabled: true,
          public: false,
          targetUsd: 3.25,
          opsReserveUsd: 0,
          royaltyBasisPoints: 500,
          mintMode: "core",
          rarity: { maxBoost: 0.7, boostCurve: 0.2 },
        },
        "2026-05-27T12:00:00.000Z",
      ),
      {
        enabled: true,
        public: false,
        targetUsd: 3.25,
        opsReserveUsd: 0,
        royaltyBasisPoints: 500,
        mintMode: "core",
        rarity: { maxBoost: 0.7, boostCurve: 0.2 },
        updatedAt: "2026-05-27T12:00:00.000Z",
      },
    );
  });

  it("rejects empty, unsafe, and invalid offer patches with clear errors", () => {
    assert.throws(() => normalizeOfferPatch({}), /offer patch must include at least one supported field/);
    assert.throws(() => normalizeOfferPatch({ targetUsd: 0 }), /targetUsd must be greater than 0/);
    assert.throws(() => normalizeOfferPatch({ opsReserveUsd: -1 }), /opsReserveUsd must be greater than or equal to 0/);
    assert.throws(() => normalizeOfferPatch({ royaltyBasisPoints: 250 }), /royaltyBasisPoints must remain 500/);
    assert.throws(() => normalizeOfferPatch({ mintMode: "compressed" }), /mintMode must be core or offchain_preview/);
    assert.throws(() => normalizeOfferPatch({ rarity: { maxBoost: 2, boostCurve: 0.2 } }), /rarity.maxBoost/);
    assert.throws(
      () => normalizeOfferPatch({ targetUsd: 2.5, opsReserveUsd: 2.5 }),
      /opsReserveUsd must be below targetUsd/,
    );
  });

  it("normalizes strict trait pack manifests before active writes", () => {
    assert.deepEqual(
      normalizeTraitPackManifest(validTraitPack(), "2026-05-27T12:00:00.000Z"),
      {
        ...validTraitPack(),
        updatedAt: "2026-05-27T12:00:00.000Z",
      },
    );
  });

  it("rejects invalid trait manifests at the admin boundary", () => {
    assert.throws(() => normalizeTraitPackManifest({ ...validTraitPack(), id: "bad/id" }), /manifest id cannot contain slashes/);
    assert.throws(() => normalizeTraitPackManifest({ ...validTraitPack(), categories: ["paperwork"] }), /categories\[0\] must be a valid trait category/);
    assert.throws(() => normalizeTraitPackManifest({ ...validTraitPack(), traits: [] }), /traits must be a non-empty array/);
    assert.throws(
      () => normalizeTraitPackManifest({
        ...validTraitPack(),
        traits: [{ ...validTrait(), imagePath: "../secrets.png" }],
      }),
      /traits\[0\]\.imagePath cannot contain path traversal/,
    );
    assert.throws(
      () => normalizeTraitPackManifest({
        ...validTraitPack(),
        traits: [{ ...validTrait(), category: "eyes" }],
      }),
      /traits\[0\]\.category must be listed in categories/,
    );
    assert.throws(
      () => normalizeTraitPackManifest({
        ...validTraitPack(),
        categories: ["background", "eyes"],
      }),
      /category eyes must include at least one trait/,
    );
    assert.throws(
      () => normalizeTraitPackManifest({
        ...validTraitPack(),
        safeDefaultTraitIds: { background: "missing-trait" },
      }),
      /safeDefaultTraitIds\.background must reference an existing trait id/,
    );
    assert.throws(
      () => normalizeTraitPackManifest({ ...validTraitPack(), baseImagePath: "/tmp/base.png" }),
      /baseImagePath must be a relative path/,
    );
  });
});

describe("admin routes", () => {
  it("rejects unauthenticated admin offer writes", async () => {
    const app = createApp({
      authenticateAdminUid: async () => {
        throw new Error("Firebase bearer token is required.");
      },
    });

    const response = await postJson(app, "/api/admin/offers", {
      offerId: "standard",
      patch: { enabled: true },
    });
    const body = (await response.json()) as Record<string, unknown>;

    assert.equal(response.status, 401);
    assert.equal(body.error, "Firebase bearer token is required.");
  });

  it("writes offer patches and admin audit records through injected persistence", async () => {
    const offers: Array<{ offerId: string; patch: Record<string, unknown> }> = [];
    const audits: AdminAuditRecord[] = [];
    const app = createApp({
      nowMs: () => Date.parse("2026-05-27T12:00:00.000Z"),
      authenticateAdminUid: async (authHeader) => {
        assert.equal(authHeader, "Bearer admin-token");
        return "admin-1";
      },
      persistAdminOffer: async (offerId, patch) => {
        offers.push({ offerId, patch });
      },
      persistAdminAudit: async (record) => {
        audits.push(record);
      },
    });

    const response = await postJson(
      app,
      "/api/admin/offers",
      { offerId: "standard", patch: { enabled: false, targetUsd: 4.5 } },
      { authorization: "Bearer admin-token" },
    );
    const body = (await response.json()) as Record<string, unknown>;

    assert.equal(response.status, 200);
    assert.deepEqual(body, { ok: true, adminUid: "admin-1" });
    assert.deepEqual(offers, [{
      offerId: "standard",
      patch: {
        enabled: false,
        targetUsd: 4.5,
        updatedAt: "2026-05-27T12:00:00.000Z",
      },
    }]);
    assert.equal(audits.length, 1);
    assert.equal(audits[0].adminUid, "admin-1");
    assert.equal(audits[0].action, "offer.update");
    assert.equal(audits[0].targetPath, "forgeOffers/standard");
    assert.ok(!JSON.stringify(audits[0]).includes("admin-token"));
  });

  it("rejects unauthenticated trait and mint routes", async () => {
    const app = createApp({
      authenticateAdminUid: async () => {
        throw new Error("Firebase bearer token is required.");
      },
    });

    const traitResponse = await postJson(app, "/api/admin/traits", { manifest: validTraitPack() });
    const traitBody = (await traitResponse.json()) as Record<string, unknown>;
    const mintResponse = await postJson(app, "/api/admin/mint", {
      wallet: "11111111111111111111111111111111",
    });
    const mintBody = (await mintResponse.json()) as Record<string, unknown>;

    assert.equal(traitResponse.status, 401);
    assert.equal(traitBody.error, "Firebase bearer token is required.");
    assert.equal(mintResponse.status, 401);
    assert.equal(mintBody.error, "Firebase bearer token is required.");
  });

  it("rejects slash-bearing manifest ids before trait pack persistence", async () => {
    const persisted: Array<{ packId: string; manifest: Record<string, unknown> }> = [];
    const app = createApp({
      authenticateAdminUid: async () => "admin-1",
      persistTraitPack: async (packId, manifest) => {
        persisted.push({ packId, manifest });
      },
    });

    const response = await postJson(
      app,
      "/api/admin/traits",
      { manifest: { ...validTraitPack(), id: "active/escape" } },
      { authorization: "Bearer admin-token" },
    );
    const body = (await response.json()) as Record<string, unknown>;

    assert.equal(response.status, 400);
    assert.match(String(body.error), /manifest id cannot contain slashes/);
    assert.equal(persisted.length, 0);
  });

  it("persists strict trait manifests to the normalized manifest id when packId is omitted", async () => {
    const persisted: Array<{ packId: string; manifest: Record<string, unknown> }> = [];
    const audits: AdminAuditRecord[] = [];
    const app = createApp({
      nowMs: () => Date.parse("2026-05-27T12:00:00.000Z"),
      authenticateAdminUid: async () => "admin-1",
      persistTraitPack: async (packId, manifest) => {
        persisted.push({ packId, manifest });
      },
      persistAdminAudit: async (record) => {
        audits.push(record);
      },
    });

    const response = await postJson(
      app,
      "/api/admin/traits",
      { manifest: validTraitPack("active") },
      { authorization: "Bearer admin-token" },
    );

    assert.equal(response.status, 200);
    assert.equal(persisted[0].packId, "active");
    assert.equal(persisted[0].manifest.id, "active");
    assert.equal(persisted[0].manifest.updatedAt, "2026-05-27T12:00:00.000Z");
    assert.equal(audits[0].targetPath, "traitPacks/active");
  });

  it("creates no-burn admin mint requests without finalizing on-chain", async () => {
    const requests: AdminMintRequestRecord[] = [];
    const audits: AdminAuditRecord[] = [];
    const app = createApp({
      nowMs: () => Date.parse("2026-05-27T12:00:00.000Z"),
      nonce: () => "admin-request-1",
      authenticateAdminUid: async () => "admin-1",
      persistAdminMintRequest: async (record) => {
        requests.push(record);
      },
      persistAdminAudit: async (record) => {
        audits.push(record);
      },
    });

    const response = await postJson(
      app,
      "/api/admin/mint",
      { wallet: "11111111111111111111111111111111", offerId: "standard" },
      { authorization: "Bearer admin-token" },
    );
    const body = (await response.json()) as Record<string, unknown>;

    assert.equal(response.status, 200);
    assert.deepEqual(body, {
      ok: true,
      adminUid: "admin-1",
      requestId: "admin-request-1",
      mintMode: "admin_free",
      noBurn: true,
    });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].id, "admin-request-1");
    assert.equal(requests[0].wallet, "11111111111111111111111111111111");
    assert.equal(requests[0].burnBaseUnits, "0");
    assert.equal(requests[0].reserveLamports, 0);
    assert.equal(requests[0].mintMode, "admin_free");
    assert.equal(requests[0].noBurn, true);
    assert.equal(requests[0].status, "verified");
    assert.equal(audits[0].action, "mint.admin_free.create");
  });

  it("rejects invalid admin mint wallets before persistence", async () => {
    const requests: AdminMintRequestRecord[] = [];
    const app = createApp({
      authenticateAdminUid: async () => "admin-1",
      persistAdminMintRequest: async (record) => {
        requests.push(record);
      },
    });

    const response = await postJson(
      app,
      "/api/admin/mint",
      { wallet: "not-a-wallet" },
      { authorization: "Bearer admin-token" },
    );
    const body = (await response.json()) as Record<string, unknown>;

    assert.equal(response.status, 400);
    assert.equal(body.error, "wallet must be a valid Solana public key");
    assert.equal(requests.length, 0);
  });
});

function validTraitPack(id = "starter-pack"): Record<string, unknown> {
  return {
    id,
    version: 1,
    baseImagePath: "base.svg",
    categories: ["background"],
    traits: [validTrait()],
    safeDefaultTraitIds: { background: "bg-green" },
  };
}

function validTrait(): Record<string, unknown> {
  return {
    id: "bg-green",
    name: "Green Counter",
    imagePath: "bg-green.svg",
    category: "background",
    zIndex: 0,
    anchorX: 0,
    anchorY: 0,
    colorOverlayAllowed: false,
    incompatibleTraits: [],
    rare: false,
    rarity_weight: 10,
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
