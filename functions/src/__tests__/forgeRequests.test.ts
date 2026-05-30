import { strict as assert } from "node:assert";
import { generateKeyPairSync, sign } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import { buildLootClaimPayload } from "../../../shared/lootClaim.js";
import { adminApp, parseBearerToken } from "../admin.js";
import { buildForgeRequestRecord, assertForgeRequestCanTransition } from "../forgeRequests.js";
import {
  createApp,
  lootClaimAuditPath,
  type PersistedLootClaimRecord,
  type PersistedWarrenPublicKeyRecord,
} from "../index.js";

describe("buildForgeRequestRecord", () => {
  it("stores deterministic request state from a verified transaction", () => {
    const record = buildForgeRequestRecord({
      quoteId: "quote-1",
      signature: "sig-1",
      wallet: "wallet-1",
      offerId: "standard",
      offerVersion: 1,
      burnBaseUnits: "14219576720",
      reserveLamports: 2058824,
      nowIso: "2026-05-27T00:00:00.000Z",
    });

    assert.equal(record.id, "sig-1");
    assert.equal(record.status, "verified");
    assert.equal(record.seedMaterial, "wallet-1:sig-1:standard:1");
  });
});

describe("assertForgeRequestCanTransition", () => {
  const verified = buildForgeRequestRecord({
    quoteId: "quote-1",
    signature: "sig-1",
    wallet: "wallet-1",
    offerId: "standard",
    offerVersion: 1,
    burnBaseUnits: "14219576720",
    reserveLamports: 2058824,
    nowIso: "2026-05-27T00:00:00.000Z",
  });

  it("allows duplicate verified writes as idempotent", () => {
    assert.doesNotThrow(() => assertForgeRequestCanTransition(verified, verified));
  });

  it("rejects verified replay with mismatched immutable identity fields", () => {
    for (const mismatch of [
      { quoteId: "quote-2" },
      { wallet: "wallet-2" },
      { burnBaseUnits: "14219576721" },
    ]) {
      assert.throws(
        () => assertForgeRequestCanTransition(verified, { ...verified, ...mismatch }),
        /Verified forge request replay mismatch/,
      );
    }
  });

  it("prevents generated or minted requests from regressing to verified", () => {
    for (const status of ["generated", "minted"] as const) {
      assert.throws(
        () => assertForgeRequestCanTransition({ ...verified, status }, verified),
        /Cannot transition forge request sig-1 from .* to verified/,
      );
    }
  });
});

describe("quote persistence", () => {
  it("persists served quotes through an injected writer", async () => {
    const persisted: Array<Record<string, unknown>> = [];
    const app = createApp({
      nowMs: () => 1_770_000_000_000,
      treasuryWallet: () => "Treasury111111111111111111111111111111111",
      nonce: () => "nonce-1",
      fetchTokenUsd: async () => 0.0001512,
      fetchSolUsd: async () => 170,
      persistQuote: async (quote) => {
        persisted.push(quote);
      },
    });

    const response = await postQuote(app, "11111111111111111111111111111111");

    assert.equal(response.status, 200);
    assert.equal(persisted.length, 1);
    assert.equal(persisted[0].quoteId, "61cb3b14cfa5a5e72c9bf8a266728736");
    assert.equal(persisted[0].wallet, "11111111111111111111111111111111");
    assert.equal(persisted[0].createdAt, "2026-02-02T02:40:00.000Z");
    assert.equal("quoteIdSeed" in persisted[0], false);
  });

  it("reports persistence failures as internal errors instead of upstream pricing failures", async () => {
    const app = createApp({
      nowMs: () => 1_770_000_000_000,
      treasuryWallet: () => "Treasury111111111111111111111111111111111",
      nonce: () => "nonce-1",
      fetchTokenUsd: async () => 0.0001512,
      fetchSolUsd: async () => 170,
      persistQuote: async () => {
        throw new Error("firestore unavailable");
      },
    });

    const response = await postQuote(app, "11111111111111111111111111111111");
    const body = (await response.json()) as Record<string, unknown>;

    assert.equal(response.status, 503);
    assert.equal(body.error, "quote persistence failed");
  });

  it("does not report quote math failures as persistence failures", async () => {
    const app = createApp({
      nowMs: () => 1_770_000_000_000,
      treasuryWallet: () => "Treasury111111111111111111111111111111111",
      nonce: () => "nonce-1",
      fetchTokenUsd: async () => 0.000001,
      fetchSolUsd: async () => 170,
      persistQuote: async () => {
        throw new Error("persistQuote should not run");
      },
    });

    const response = await postQuote(app, "11111111111111111111111111111111");
    const body = (await response.json()) as Record<string, unknown>;

    assert.equal(response.status, 502);
    assert.notEqual(body.error, "quote persistence failed");
    assert.match(String(body.error), /outside configured bounds/);
  });
});

describe("loot claim persistence", () => {
  it("verifies and persists signed loot claims with the registered Warren key", async () => {
    const trusted = generateKeyPairSync("ed25519");
    const untrusted = generateKeyPairSync("ed25519");
    const payload = buildLootClaimPayload({
      uid: "uid-1",
      wallet: "wallet-1",
      loot: 42,
      warrenName: "Angus Warren",
      issuedAt: "2026-05-27T00:00:00.000Z",
      expiresAt: "2026-05-27T00:05:00.000Z",
      nonce: "nonce-1",
    });
    const persisted: PersistedLootClaimRecord[] = [];
    const app = createApp({
      nowMs: () => Date.parse("2026-05-27T00:04:00.000Z"),
      authenticateUid: async (authHeader) => {
        assert.equal(authHeader, "Bearer token-1");
        return "uid-1";
      },
      readTrustedWarrenPublicKey: async (uid) => {
        assert.equal(uid, "uid-1");
        return trusted.publicKey.export({ type: "spki", format: "pem" }).toString();
      },
      persistLootClaim: async (record) => {
        persisted.push(record);
      },
    });

    const response = await postJson(app, "/api/forge/loot-claim", {
      uid: "uid-1",
      wallet: "wallet-1",
      nonce: "nonce-1",
      payload,
      signature: sign(null, Buffer.from(payload, "utf8"), trusted.privateKey).toString("base64"),
      publicKeyPem: untrusted.publicKey.export({ type: "spki", format: "pem" }).toString(),
    }, { authorization: "Bearer token-1" });
    const body = (await response.json()) as Record<string, unknown>;

    assert.equal(response.status, 200);
    assert.equal(body.loot, 42);
    assert.equal(body.warrenName, "Angus Warren");
    assert.equal(body.expiresAt, "2026-05-27T00:05:00.000Z");
    assert.equal(persisted.length, 1);
    assert.equal(persisted[0].uid, "uid-1");
    assert.match(String(persisted[0].claimId), /^[a-f0-9]{64}$/);
    assert.equal(persisted[0].auditPath, lootClaimAuditPath("uid-1", persisted[0].claimId));
    assert.equal(persisted[0].forgeLoot, 42);
    assert.equal(persisted[0].forgeLootUpdatedAt, "2026-05-27T00:04:00.000Z");
    assert.deepEqual(persisted[0].forgeLootClaim, {
      claimId: persisted[0].claimId,
      wallet: "wallet-1",
      nonce: "nonce-1",
      loot: 42,
      warrenName: "Angus Warren",
      issuedAt: "2026-05-27T00:00:00.000Z",
      expiresAt: "2026-05-27T00:05:00.000Z",
    });
    assert.ok(!JSON.stringify(persisted[0]).includes("PRIVATE KEY"));
  });

  it("rejects request-supplied public keys when no Warren key is registered", async () => {
    const selfSigned = generateKeyPairSync("ed25519");
    const persisted: PersistedLootClaimRecord[] = [];
    const app = createApp({
      nowMs: () => Date.parse("2026-05-27T00:04:00.000Z"),
      authenticateUid: async () => "uid-1",
      readTrustedWarrenPublicKey: async () => null,
      persistLootClaim: async (record) => {
        persisted.push(record);
      },
    });
    const payload = buildLootClaimPayload({
      uid: "uid-1",
      wallet: "wallet-1",
      loot: 999_999,
      warrenName: "Self Signed Warren",
      issuedAt: "2026-05-27T00:00:00.000Z",
      expiresAt: "2026-05-27T00:05:00.000Z",
      nonce: "nonce-1",
    });

    const response = await postJson(app, "/api/forge/loot-claim", {
      uid: "uid-1",
      wallet: "wallet-1",
      nonce: "nonce-1",
      payload,
      signature: sign(null, Buffer.from(payload, "utf8"), selfSigned.privateKey).toString("base64"),
      publicKeyPem: selfSigned.publicKey.export({ type: "spki", format: "pem" }).toString(),
    }, { authorization: "Bearer token-1" });
    const body = (await response.json()) as Record<string, unknown>;

    assert.equal(response.status, 403);
    assert.equal(body.error, "Warren public key is not registered for this user.");
    assert.equal(persisted.length, 0);
  });

  it("rejects loot claims whose body uid conflicts with the Firebase token uid", async () => {
    const trusted = generateKeyPairSync("ed25519");
    const app = createApp({
      nowMs: () => Date.parse("2026-05-27T00:04:00.000Z"),
      authenticateUid: async () => "uid-1",
      readTrustedWarrenPublicKey: async () => trusted.publicKey.export({ type: "spki", format: "pem" }).toString(),
    });
    const payload = buildLootClaimPayload({
      uid: "uid-1",
      wallet: "wallet-1",
      loot: 42,
      warrenName: "Angus Warren",
      issuedAt: "2026-05-27T00:00:00.000Z",
      expiresAt: "2026-05-27T00:05:00.000Z",
      nonce: "nonce-1",
    });

    const response = await postJson(app, "/api/forge/loot-claim", {
      uid: "uid-2",
      wallet: "wallet-1",
      nonce: "nonce-1",
      payload,
      signature: sign(null, Buffer.from(payload, "utf8"), trusted.privateKey).toString("base64"),
    }, { authorization: "Bearer token-1" });
    const body = (await response.json()) as Record<string, unknown>;

    assert.equal(response.status, 403);
    assert.equal(body.error, "request uid does not match authenticated user");
  });

  it("registers the Warren public key through an authenticated explicit route", async () => {
    const { publicKey } = generateKeyPairSync("ed25519");
    const registered: PersistedWarrenPublicKeyRecord[] = [];
    const app = createApp({
      nowMs: () => Date.parse("2026-05-27T00:04:00.000Z"),
      authenticateUid: async (authHeader) => {
        assert.equal(authHeader, "Bearer token-1");
        return "uid-1";
      },
      persistWarrenPublicKey: async (record) => {
        registered.push(record);
      },
    });
    const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();

    const response = await postJson(app, "/api/forge/warren-key", {
      publicKeyPem,
    }, { authorization: "Bearer token-1" });
    const body = (await response.json()) as Record<string, unknown>;

    assert.equal(response.status, 200);
    assert.equal(body.uid, "uid-1");
    assert.equal(body.publicKeyRegistered, true);
    assert.deepEqual(registered, [{
      uid: "uid-1",
      publicKeyPem: publicKeyPem.trim(),
      updatedAt: "2026-05-27T00:04:00.000Z",
    }]);
  });
});

describe("admin helpers", () => {
  it("parses bearer tokens case-insensitively and trims whitespace", () => {
    assert.equal(parseBearerToken("  bEaReR   token-1  "), "token-1");
  });

  it("wraps malformed service account JSON with an initialization error", () => {
    const previous = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = "{wat";

    try {
      assert.throws(() => adminApp(), /Failed to initialize Firebase Admin from FIREBASE_SERVICE_ACCOUNT_JSON/);
    } finally {
      if (previous === undefined) delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
      else process.env.FIREBASE_SERVICE_ACCOUNT_JSON = previous;
    }
  });
});

async function postQuote(app: ReturnType<typeof createApp>, wallet: string): Promise<Response> {
  return postJson(app, "/api/quote", { wallet });
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
