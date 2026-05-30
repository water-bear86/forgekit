import { strict as assert } from "node:assert";
import { generateKeyPairSync, sign } from "node:crypto";
import { describe, it } from "node:test";
import { buildLootClaimPayload, parseLootClaimPayload } from "../../../shared/lootClaim.js";
import { verifySignedLootClaim } from "../lootClaims.js";

describe("verifySignedLootClaim", () => {
  it("verifies a signed loot claim for the expected uid, wallet, and nonce", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const payload = buildLootClaimPayload({
      uid: "uid-1",
      wallet: "wallet-1",
      loot: 42,
      warrenName: "Angus Warren",
      issuedAt: "2026-05-27T00:00:00.000Z",
      expiresAt: "2026-05-27T00:05:00.000Z",
      nonce: "nonce-1",
    });
    const signature = sign(null, Buffer.from(payload, "utf8"), privateKey).toString("base64");

    const parsed = verifySignedLootClaim({
      uid: "uid-1",
      wallet: "wallet-1",
      nonce: "nonce-1",
      payload,
      signature,
      publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
      nowMs: Date.parse("2026-05-27T00:04:00.000Z"),
    });

    assert.equal(parsed.loot, 42);
    assert.equal(parsed.warrenName, "Angus Warren");
  });

  it("fails closed on mismatches, expiry, invalid signatures, and invalid claim fields", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
    const base = buildLootClaimPayload({
      uid: "uid-1",
      wallet: "wallet-1",
      loot: 42,
      warrenName: "Angus Warren",
      issuedAt: "2026-05-27T00:00:00.000Z",
      expiresAt: "2026-05-27T00:05:00.000Z",
      nonce: "nonce-1",
    });
    const signature = sign(null, Buffer.from(base, "utf8"), privateKey).toString("base64");
    const valid = {
      uid: "uid-1",
      wallet: "wallet-1",
      nonce: "nonce-1",
      payload: base,
      signature,
      publicKeyPem,
      nowMs: Date.parse("2026-05-27T00:04:00.000Z"),
    };

    assert.throws(() => verifySignedLootClaim({ ...valid, uid: "uid-2" }), /claim uid mismatch/);
    assert.throws(() => verifySignedLootClaim({ ...valid, wallet: "wallet-2" }), /claim wallet mismatch/);
    assert.throws(() => verifySignedLootClaim({ ...valid, nonce: "nonce-2" }), /claim nonce mismatch/);
    assert.throws(
      () => verifySignedLootClaim({ ...valid, nowMs: Date.parse("2026-05-27T00:06:00.000Z") }),
      /claim expired/,
    );
    assert.throws(() => verifySignedLootClaim({ ...valid, signature: "bad" }), /claim signature invalid/);
    assert.throws(
      () => verifySignedLootClaim({ ...valid, payload: base.replace('"loot":42', '"loot":-1') }),
      /claim loot must be a non-negative integer/,
    );
    assert.throws(
      () => verifySignedLootClaim({ ...valid, payload: base.replace('"expiresAt":"2026-05-27T00:05:00.000Z"', '"expiresAt":"wat"') }),
      /claim expiresAt must be a strict ISO UTC timestamp/,
    );
  });

  it("rejects future-issued, backwards, overlong, and non-canonical claims", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
    const nowMs = Date.parse("2026-05-27T00:04:00.000Z");
    const baseInput = {
      uid: "uid-1",
      wallet: "wallet-1",
      loot: 42,
      warrenName: "Angus Warren",
      issuedAt: "2026-05-27T00:00:00.000Z",
      expiresAt: "2026-05-27T00:05:00.000Z",
      nonce: "nonce-1",
    };
    const signed = (payload: string) => ({
      uid: "uid-1",
      wallet: "wallet-1",
      nonce: "nonce-1",
      payload,
      signature: sign(null, Buffer.from(payload, "utf8"), privateKey).toString("base64"),
      publicKeyPem,
      nowMs,
    });

    assert.throws(
      () => verifySignedLootClaim(signed(buildLootClaimPayload({
        ...baseInput,
        issuedAt: "2026-05-27T00:04:06.000Z",
        expiresAt: "2026-05-27T00:05:00.000Z",
      }))),
      /claim issuedAt is in the future/,
    );
    assert.throws(
      () => verifySignedLootClaim(signed(buildLootClaimPayload({
        ...baseInput,
        expiresAt: "2026-05-26T23:59:59.000Z",
      }))),
      /claim expiresAt must be after issuedAt/,
    );
    assert.throws(
      () => verifySignedLootClaim(signed(buildLootClaimPayload({
        ...baseInput,
        expiresAt: "2026-05-27T00:05:01.000Z",
      }))),
      /claim lifetime exceeds 5 minutes/,
    );
    assert.throws(
      () => parseLootClaimPayload('{"uid":"uid-1","type":"goblintown-forge-loot-claim-v1","wallet":"wallet-1","loot":42,"warrenName":"Angus Warren","issuedAt":"2026-05-27T00:00:00.000Z","expiresAt":"2026-05-27T00:05:00.000Z","nonce":"nonce-1"}'),
      /claim payload is not canonical/,
    );
    assert.throws(
      () => parseLootClaimPayload(buildLootClaimPayload({
        ...baseInput,
        issuedAt: "2026-05-27T00:00:00Z",
      })),
      /claim issuedAt must be a strict ISO UTC timestamp/,
    );
  });
});
