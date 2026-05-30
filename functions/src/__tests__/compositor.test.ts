import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import sharp from "sharp";
import { composeLicensePng, type LicenseLayer } from "../compositor.js";
import { buildLicenseMetadataRecord } from "../metadata.js";

const starterAsset = (name: string) => join(process.cwd(), "assets", "starter-traits", name);

describe("composeLicensePng", () => {
  it("emits a non-empty PNG with escaped code-native license text", async () => {
    const png = await composeLicensePng({
      width: 600,
      height: 380,
      layers: [],
      text: {
        goblinName: "MOLDY & <PERMIT>",
        idNumber: "GT-000001",
        issueDate: "2026-05-27",
        expiryDate: "2027-05-27",
        rarityScore: "1001",
        flavor: "\"VALID\" FOR ONE TRIP",
      },
    });

    const meta = await sharp(png).metadata();

    assert.equal(meta.format, "png");
    assert.equal(meta.width, 600);
    assert.equal(meta.height, 380);
    assert.ok(png.length > 1000);
  });

  it("composites layers by z-index without mutating input order", async () => {
    const bottom = await sharp({
      create: { width: 20, height: 20, channels: 4, background: "#ff0000ff" },
    })
      .png()
      .toBuffer();
    const top = await sharp({
      create: { width: 20, height: 20, channels: 4, background: "#0000ffff" },
    })
      .png()
      .toBuffer();
    const layers: LicenseLayer[] = [
      { input: top, zIndex: 20, left: 460, top: 140 },
      { input: bottom, zIndex: 10, left: 460, top: 140 },
    ];
    const before = layers.map((layer) => layer.zIndex);

    const png = await composeLicensePng({
      width: 600,
      height: 380,
      layers,
      text: {
        goblinName: "MOLDY PERMIT",
        idNumber: "GT-000001",
        issueDate: "2026-05-27",
        expiryDate: "2027-05-27",
        rarityScore: "1001",
        flavor: "FORGEKIT VERIFIED",
      },
    });
    const pixel = await sharp(png).extract({ left: 470, top: 150, width: 1, height: 1 }).raw().toBuffer();

    assert.deepEqual(layers.map((layer) => layer.zIndex), before);
    assert.deepEqual([...pixel], [0, 0, 255, 255]);
  });

  it("uses trait-style anchors as layer coordinates", async () => {
    const marker = await sharp({
      create: { width: 16, height: 16, channels: 4, background: "#00ff00ff" },
    })
      .png()
      .toBuffer();

    const png = await composeLicensePng({
      width: 600,
      height: 380,
      layers: [{ input: marker, zIndex: 10, anchorX: 470, anchorY: 150 }],
      text: {
        goblinName: "MOLDY PERMIT",
        idNumber: "GT-000001",
        issueDate: "2026-05-27",
        expiryDate: "2027-05-27",
        rarityScore: "1001",
        flavor: "FORGEKIT VERIFIED",
      },
    });
    const pixel = await sharp(png).extract({ left: 475, top: 155, width: 1, height: 1 }).raw().toBuffer();

    assert.deepEqual([...pixel], [0, 255, 0, 255]);
  });

  it("scales full-canvas starter SVG layers into smaller output dimensions", async () => {
    const background = await readFile(starterAsset("background-dmv.svg"));
    const baseHead = await readFile(starterAsset("base-head.svg"));

    const png = await composeLicensePng({
      width: 600,
      height: 380,
      layers: [
        { input: background, zIndex: 0, anchorX: 0, anchorY: 0 },
        { input: baseHead, zIndex: 1, anchorX: 0, anchorY: 0 },
      ],
      text: {
        goblinName: "MOLDY PERMIT",
        idNumber: "GT-000001",
        issueDate: "2026-05-27",
        expiryDate: "2027-05-27",
        rarityScore: "1001",
        flavor: "FORGEKIT VERIFIED",
      },
    });

    const meta = await sharp(png).metadata();
    const scaledHeadPixel = await sharp(png).extract({ left: 300, top: 120, width: 1, height: 1 }).raw().toBuffer();

    assert.equal(meta.width, 600);
    assert.equal(meta.height, 380);
    assert.ok(
      scaledHeadPixel[1] > scaledHeadPixel[0],
      `expected scaled green starter art, got ${[...scaledHeadPixel]}`,
    );
  });

  it("rejects invalid dimensions, empty layer buffers, and invalid coordinates", async () => {
    const marker = await sharp({
      create: { width: 16, height: 16, channels: 4, background: "#00ff00ff" },
    })
      .png()
      .toBuffer();
    const valid = {
      width: 600,
      height: 380,
      layers: [] as LicenseLayer[],
      text: {
        goblinName: "MOLDY PERMIT",
        idNumber: "GT-000001",
        issueDate: "2026-05-27",
        expiryDate: "2027-05-27",
        rarityScore: "1001",
        flavor: "FORGEKIT VERIFIED",
      },
    };

    await assert.rejects(() => composeLicensePng({ ...valid, width: 0 }), /width must be a positive integer/);
    await assert.rejects(() => composeLicensePng({ ...valid, height: 9001 }), /height must be at most/);
    await assert.rejects(
      () => composeLicensePng({ ...valid, layers: [{ input: Buffer.alloc(0), zIndex: 1, left: 0, top: 0 }] }),
      /layer input must be a non-empty buffer/,
    );
    await assert.rejects(
      () => composeLicensePng({ ...valid, layers: [{ input: marker, zIndex: 1, left: 1.5, top: 0 }] }),
      /layer left must be a finite integer/,
    );
  });
});

describe("buildLicenseMetadataRecord", () => {
  it("assembles a deterministic license name and marketplace metadata", () => {
    const record = buildLicenseMetadataRecord({
      licenseNumber: 1,
      wallet: "wallet",
      seed: "seed",
      image: "https://storage.example/license.png",
      externalUrl: "https://forgekit.example/asset/1",
      projectName: "ForgeKit Genesis Pass",
      offerId: "standard",
      traitPackId: "starter",
      loot: 42,
      lootBoost: 0.357,
      pricingSnapshot: { targetUsd: 2.5 },
      traits: [
        { trait_type: "eyes", value: "Eyeballs Made Of Galaxies" },
        { trait_type: "rarity_score", value: 1001 },
      ],
    });

    assert.equal(record.name, "ForgeKit Genesis Pass #000001");
    assert.equal(record.properties.seed, "seed");
    assert.equal(record.properties.lootBoost, 0.357);
    assert.deepEqual(record.properties.files, [{ uri: "https://storage.example/license.png", type: "image/png" }]);
  });

  it("rejects non-positive or unsafe license numbers", () => {
    const valid = {
      licenseNumber: 1,
      wallet: "wallet",
      seed: "seed",
      image: "https://storage.example/license.png",
      externalUrl: "https://forgekit.example/asset/1",
      offerId: "standard",
      traitPackId: "starter",
      loot: 42,
      lootBoost: 0.357,
      pricingSnapshot: { targetUsd: 2.5 },
      traits: [],
    };

    assert.throws(() => buildLicenseMetadataRecord({ ...valid, licenseNumber: 0 }), /positive safe integer/);
    assert.throws(
      () => buildLicenseMetadataRecord({ ...valid, licenseNumber: Number.MAX_SAFE_INTEGER + 1 }),
      /positive safe integer/,
    );
  });
});
