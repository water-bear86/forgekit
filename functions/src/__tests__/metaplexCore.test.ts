import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { Keypair } from "@solana/web3.js";
import {
  assertCollectionRoyalties,
  buildMetaplexRoyaltyPlugin,
  buildRoyaltyPlugin,
  createCoreCollectionWithRoyalties,
  mintCoreLicense,
  normalizeRoyaltyBasisPoints,
  parseMinterKeypairJson,
} from "../metaplexCore.js";

describe("Metaplex Core adapter helpers", () => {
  it("normalizes 5 percent royalties as 500 basis points", () => {
    assert.equal(normalizeRoyaltyBasisPoints(500), 500);
    assert.throws(() => normalizeRoyaltyBasisPoints(10_001), /between 0 and 10000/);
  });

  it("builds a Core royalties plugin with no transfer allowlist", () => {
    const plugin = buildRoyaltyPlugin("11111111111111111111111111111112", 500);
    assert.equal(plugin.type, "Royalties");
    assert.equal(plugin.basisPoints, 500);
    assert.deepEqual(plugin.creators, [{ address: "11111111111111111111111111111112", percentage: 100 }]);
    assert.equal(plugin.ruleSet, "None");
  });

  it("maps royalties to the Metaplex Core collection plugin shape", () => {
    const plugin = buildMetaplexRoyaltyPlugin("11111111111111111111111111111112", 500);

    assert.equal(plugin.type, "Royalties");
    assert.equal(plugin.basisPoints, 500);
    assert.equal(plugin.creators.length, 1);
    assert.equal(plugin.creators[0].address.toString(), "11111111111111111111111111111112");
    assert.equal(plugin.creators[0].percentage, 100);
    assert.deepEqual(plugin.ruleSet, { type: "None" });
  });

  it("rejects non-standard royalties for Core collection creation before RPC work", async () => {
    const minter = Keypair.generate();
    const baseInput = {
      rpcUrl: "not-a-url",
      minterKeypairJson: JSON.stringify(Array.from(minter.secretKey)),
      name: "ForgeKit Genesis Collection",
      uri: "https://example.test/collection.json",
      creatorAddress: "11111111111111111111111111111112",
    };

    await assert.rejects(
      createCoreCollectionWithRoyalties({ ...baseInput, royaltyBasisPoints: 0 }),
      /royaltyBasisPoints must be 500/,
    );
    await assert.rejects(
      createCoreCollectionWithRoyalties({ ...baseInput, royaltyBasisPoints: 250 }),
      /royaltyBasisPoints must be 500/,
    );
  });

  it("accepts exact fetched collection royalties in common Core collection shapes", () => {
    const royaltyPlugin = {
      basisPoints: 500,
      creators: [{ address: "11111111111111111111111111111112", percentage: 100 }],
      ruleSet: { type: "None" },
    };

    assert.doesNotThrow(() =>
      assertCollectionRoyalties({ royalties: royaltyPlugin }, "11111111111111111111111111111112"),
    );
    assert.doesNotThrow(() =>
      assertCollectionRoyalties({ plugins: { royalties: royaltyPlugin } }, "11111111111111111111111111111112"),
    );
    assert.doesNotThrow(() =>
      assertCollectionRoyalties(
        { plugins: [{ type: "Royalties", data: { ...royaltyPlugin, ruleSet: { __kind: "None" } } }] },
        "11111111111111111111111111111112",
      ),
    );
  });

  it("rejects fetched collections without exact 5 percent None-rule royalties", () => {
    const creatorAddress = "11111111111111111111111111111112";
    const validRoyaltyPlugin = {
      basisPoints: 500,
      creators: [{ address: creatorAddress, percentage: 100 }],
      ruleSet: { type: "None" },
    };
    const invalidCollections = [
      { collection: {}, pattern: /missing royalties/ },
      { collection: { royalties: { ...validRoyaltyPlugin, basisPoints: 250 } }, pattern: /500 basis points/ },
      { collection: { royalties: { ...validRoyaltyPlugin, creators: [] } }, pattern: /creator/ },
      {
        collection: {
          royalties: { ...validRoyaltyPlugin, creators: [{ address: creatorAddress, percentage: 50 }] },
        },
        pattern: /100 percent/,
      },
      {
        collection: {
          royalties: {
            ...validRoyaltyPlugin,
            creators: [
              { address: creatorAddress, percentage: 100 },
              { address: "11111111111111111111111111111113", percentage: 0 },
            ],
          },
        },
        pattern: /single 100 percent creator/,
      },
      {
        collection: {
          royalties: {
            ...validRoyaltyPlugin,
            creators: [{ address: "11111111111111111111111111111113", percentage: 100 }],
          },
        },
        pattern: /creator/,
      },
      {
        collection: { royalties: { ...validRoyaltyPlugin, ruleSet: { type: "ProgramAllowList", addresses: [] } } },
        pattern: /None ruleSet/,
      },
    ];

    for (const { collection, pattern } of invalidCollections) {
      assert.throws(() => assertCollectionRoyalties(collection, creatorAddress), pattern);
    }
  });

  it("parses a Solana keypair JSON array for Umi signing", () => {
    const minter = Keypair.generate();
    const parsed = parseMinterKeypairJson(JSON.stringify(Array.from(minter.secretKey)));

    assert.equal(parsed.publicKey.toString(), minter.publicKey.toBase58());
  });

  it("rejects malformed minter keypair JSON", () => {
    assert.throws(() => parseMinterKeypairJson("not-json"), /valid Solana keypair array/);
    assert.throws(() => parseMinterKeypairJson(JSON.stringify({ secretKey: [] })), /array/);
  });

  it("rejects minter keypair arrays with invalid byte values before coercion", () => {
    const validSecret = Array.from(Keypair.generate().secretKey);
    const invalidCases = [
      { secret: validSecret.slice(0, 63), pattern: /exactly 64/ },
      { secret: [...validSecret.slice(0, 63), 1.5], pattern: /integer byte/ },
      { secret: [...validSecret.slice(0, 63), "1"], pattern: /integer byte/ },
      { secret: [...validSecret.slice(0, 63), 256], pattern: /integer byte/ },
      { secret: [...validSecret.slice(0, 63), -1], pattern: /integer byte/ },
    ];

    for (const { secret, pattern } of invalidCases) {
      assert.throws(() => parseMinterKeypairJson(JSON.stringify(secret)), pattern);
    }
  });

  it("rejects license mints without a royalty collection before RPC work", async () => {
    const minter = Keypair.generate();
    const owner = Keypair.generate();
    const inputWithoutCollection = {
      rpcUrl: "not-a-url",
      minterKeypairJson: JSON.stringify(Array.from(minter.secretKey)),
      owner: owner.publicKey.toBase58(),
      name: "ForgeKit Genesis Pass #1",
      uri: "https://example.test/license.json",
    } as Omit<Parameters<typeof mintCoreLicense>[0], "collectionAddress">;

    await assert.rejects(
      mintCoreLicense(inputWithoutCollection as Parameters<typeof mintCoreLicense>[0]),
      /collectionAddress is required/,
    );
  });

  it("rejects license mints without an expected royalty creator before RPC work", async () => {
    const minter = Keypair.generate();
    const owner = Keypair.generate();
    const inputWithoutCreator = {
      rpcUrl: "not-a-url",
      minterKeypairJson: JSON.stringify(Array.from(minter.secretKey)),
      owner: owner.publicKey.toBase58(),
      name: "ForgeKit Genesis Pass #1",
      uri: "https://example.test/license.json",
      collectionAddress: "11111111111111111111111111111112",
    } as Omit<Parameters<typeof mintCoreLicense>[0], "royaltyCreatorAddress">;

    await assert.rejects(
      mintCoreLicense(inputWithoutCreator as Parameters<typeof mintCoreLicense>[0]),
      /royaltyCreatorAddress is required/,
    );
  });
});
