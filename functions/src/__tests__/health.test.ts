import { strict as assert } from "node:assert";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { describe, it } from "node:test";
import { createApp } from "../index.js";

describe("license forge function surface", () => {
  it("serves a healthy JSON response", async () => {
    const app = createApp();
    const server: Server = app.listen(0);

    try {
      await new Promise<void>((resolve) => server.once("listening", resolve));
      const address = server.address() as AddressInfo | null;
      assert.ok(address);

      const response = await fetch(`http://127.0.0.1:${address.port}/api/health`);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        ok: true,
        service: "forgekit-engine",
        projectId: "forgekit-genesis",
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  });

  it("serves the configured Metaplex Core mint settings", async () => {
    const app = createApp();
    const server: Server = app.listen(0);

    try {
      await new Promise<void>((resolve) => server.once("listening", resolve));
      const address = server.address() as AddressInfo | null;
      assert.ok(address);

      const response = await fetch(`http://127.0.0.1:${address.port}/api/core/config`);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        mintMode: "core",
        royaltyBasisPoints: 500,
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  });
});
