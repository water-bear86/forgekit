import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_FIREBASE_CLIENT_CONFIG,
  DEFAULT_PROJECT_TOKEN_MINT,
  firebaseClientConfig,
  forgeBrandConfig,
  forgeProjectConfig,
  forgeTokenConfig,
  TOKEN_2022_PROGRAM_ID_STRING,
} from "../../shared/config";

describe("ForgeKit config", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("ships ForgeKit defaults with the existing Firebase setup and Token-2022 mint", () => {
    expect(DEFAULT_FIREBASE_CLIENT_CONFIG.projectId).toBe("goblintown-88fd6");
    expect(DEFAULT_PROJECT_TOKEN_MINT).toBe("DJ15QJxVPFGv6kYhT6LvDGqG9b4aBFWQzavA7dGxpump");
    expect(TOKEN_2022_PROGRAM_ID_STRING).toBe("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
    expect(forgeBrandConfig().engineName).toBe("ForgeKit");
    expect(forgeProjectConfig().projectId).toBe("forgekit-genesis");
  });

  it("uses Vite Firebase env overrides while preserving defaults", () => {
    vi.stubEnv("VITE_FIREBASE_PROJECT_ID", "override-project");
    vi.stubEnv("VITE_FIREBASE_AUTH_DOMAIN", "  ");
    vi.stubEnv("VITE_FIREBASE_APP_ID", "override-app-id");

    expect(firebaseClientConfig()).toMatchObject({
      apiKey: DEFAULT_FIREBASE_CLIENT_CONFIG.apiKey,
      authDomain: DEFAULT_FIREBASE_CLIENT_CONFIG.authDomain,
      projectId: "override-project",
      appId: "override-app-id",
      storageBucket: DEFAULT_FIREBASE_CLIENT_CONFIG.storageBucket,
    });
  });

  it("prefers ForgeKit token env names", () => {
    vi.stubEnv("VITE_FORGEKIT_TOKEN_MINT", "TokenMint11111111111111111111111111111111");
    vi.stubEnv("VITE_FORGEKIT_TOKEN_SYMBOL", "$TEST");
    vi.stubEnv("VITE_FORGEKIT_TOKEN_DECIMALS", "9");
    vi.stubEnv("VITE_FORGEKIT_PROJECT_NAME", "Test Engine Pass");

    expect(forgeTokenConfig()).toMatchObject({
      mint: "TokenMint11111111111111111111111111111111",
      symbol: "$TEST",
      decimals: 9,
    });
    expect(forgeProjectConfig().brand.displayName).toBe("Test Engine Pass");
  });

  it("keeps legacy forge env aliases for existing deployments", () => {
    vi.stubEnv("FORGE_TOKEN_MINT", "LegacyMint111111111111111111111111111111");
    vi.stubEnv("FORGE_TOKEN_DECIMALS", "7");

    expect(forgeTokenConfig()).toMatchObject({
      mint: "LegacyMint111111111111111111111111111111",
      decimals: 7,
    });
  });
});
