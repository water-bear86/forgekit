import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { buildLicenseRecord } from "../metadata.js";

describe("buildLicenseRecord", () => {
  const validInput = {
    licenseId: "license-1",
    wallet: "11111111111111111111111111111111",
    ownerAtMint: "11111111111111111111111111111111",
    assetAddress: "asset-1",
    imagePath: "licenses/license-1/image.png",
    metadataPath: "licenses/license-1/metadata.json",
    rarityScore: 1001.25,
    traits: [{ trait_type: "eyes", value: "Dot Eyes" }],
    loot: 42,
    lootBoost: 0.357,
    pricingSnapshot: { targetUsd: 2.5 },
    nowIso: "2026-05-27T12:00:00.000Z",
  };

  it("assembles the persisted license record", () => {
    const record = buildLicenseRecord(validInput);

    assert.deepEqual(record, {
      licenseId: "license-1",
      wallet: "11111111111111111111111111111111",
      ownerAtMint: "11111111111111111111111111111111",
      assetAddress: "asset-1",
      imagePath: "licenses/license-1/image.png",
      metadataPath: "licenses/license-1/metadata.json",
      rarityScore: 1001.25,
      traits: [{ trait_type: "eyes", value: "Dot Eyes" }],
      loot: 42,
      lootBoost: 0.357,
      pricingSnapshot: { targetUsd: 2.5 },
      createdAt: "2026-05-27T12:00:00.000Z",
      updatedAt: "2026-05-27T12:00:00.000Z",
    });
  });

  it("rejects missing identity and storage fields", () => {
    assert.throws(() => buildLicenseRecord({ ...validInput, licenseId: " " }), /licenseId is required/);
    assert.throws(() => buildLicenseRecord({ ...validInput, wallet: "" }), /wallet is required/);
    assert.throws(() => buildLicenseRecord({ ...validInput, ownerAtMint: "" }), /ownerAtMint is required/);
    assert.throws(() => buildLicenseRecord({ ...validInput, assetAddress: "" }), /assetAddress is required/);
    assert.throws(() => buildLicenseRecord({ ...validInput, imagePath: "" }), /imagePath is required/);
    assert.throws(() => buildLicenseRecord({ ...validInput, metadataPath: "" }), /metadataPath is required/);
  });

  it("rejects unsafe numeric fields", () => {
    assert.throws(() => buildLicenseRecord({ ...validInput, rarityScore: -1 }), /rarityScore must be non-negative/);
    assert.throws(() => buildLicenseRecord({ ...validInput, loot: -1 }), /loot must be a non-negative integer/);
    assert.throws(() => buildLicenseRecord({ ...validInput, loot: 1.5 }), /loot must be a non-negative integer/);
    assert.throws(() => buildLicenseRecord({ ...validInput, lootBoost: -0.1 }), /lootBoost must be non-negative/);
  });
});
