import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { uploadPublicJson, uploadPublicPng } from "../storage.js";

describe("storage upload helpers", () => {
  it("uploads public immutable JSON and returns the storage URL", async () => {
    const writes: Array<{ path: string; data: Buffer; options: Record<string, unknown> }> = [];
    const bucket = fakeBucket("bucket.test", writes);

    const url = await uploadPublicJson("licenses/license-1/metadata.json", { ok: true }, bucket);

    assert.equal(url, "https://storage.googleapis.com/bucket.test/licenses/license-1/metadata.json");
    assert.equal(writes[0].path, "licenses/license-1/metadata.json");
    assert.deepEqual(JSON.parse(writes[0].data.toString("utf8")), { ok: true });
    assert.equal(writes[0].options.contentType, "application/json");
    assert.equal(writes[0].options.public, true);
    assert.match(String(writes[0].options.cacheControl), /immutable/);
  });

  it("uploads public immutable PNG buffers", async () => {
    const writes: Array<{ path: string; data: Buffer; options: Record<string, unknown> }> = [];
    const bucket = fakeBucket("bucket.test", writes);
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

    const url = await uploadPublicPng("licenses/license-1/image.png", png, bucket);

    assert.equal(url, "https://storage.googleapis.com/bucket.test/licenses/license-1/image.png");
    assert.equal(writes[0].data, png);
    assert.equal(writes[0].options.contentType, "image/png");
    assert.equal(writes[0].options.public, true);
    assert.match(String(writes[0].options.cacheControl), /immutable/);
  });

  it("rejects empty paths and empty PNG buffers", async () => {
    const bucket = fakeBucket("bucket.test", []);

    await assert.rejects(() => uploadPublicJson(" ", { ok: true }, bucket), /path is required/);
    await assert.rejects(() => uploadPublicPng("licenses/license-1/image.png", Buffer.alloc(0), bucket), /png must be/);
  });
});

function fakeBucket(
  name: string,
  writes: Array<{ path: string; data: Buffer; options: Record<string, unknown> }>,
) {
  return {
    name,
    file(path: string) {
      return {
        async save(data: Buffer, options: Record<string, unknown>) {
          writes.push({ path, data, options });
        },
      };
    },
  };
}
