import { createHash, createPublicKey, randomUUID } from "node:crypto";
import express from "express";
import { onRequest } from "firebase-functions/v2/https";
import { Keypair, PublicKey } from "@solana/web3.js";
import { forgeProjectConfig, forgeTokenConfig } from "../../shared/config.js";
import type { TraitPack } from "../../shared/traits.js";
import { calculateLootBoost, rollTraits } from "../../shared/traits.js";
import { firestore, requireFirebaseUid } from "./admin.js";
import { composeLicensePng, type ComposeLicenseInput } from "./compositor.js";
import type { ParsedLootClaim } from "../../shared/lootClaim.js";
import { CORE_ROYALTY_BASIS_POINTS } from "./metaplexCore.js";
import { mintCoreLicense as mintCoreLicenseOnChain, type CoreMintInput } from "./metaplexCore.js";
import { verifySignedLootClaim } from "./lootClaims.js";
import { fetchCoinGeckoSolPrice, fetchDexScreenerTokenPrice } from "./prices.js";
import { createQuote } from "./quotes.js";
import type { PriceSnapshotInput } from "../../shared/pricing.js";
import {
  buildStarterTraitLayers,
  buildTraitAttributes,
  deriveLicenseId,
  licenseNumberFromId,
  loadStarterTraitPack,
  nextRequestStatus,
  pricingSnapshotFromRequest,
} from "./finalize.js";
import {
  buildForgeRequestRecord,
  assertForgeRequestCanTransition,
  type ForgeRequestRecord,
} from "./forgeRequests.js";
import { registerAdminRoutes, type AdminRouteDependencies } from "./adminRoutes.js";
import { buildLicenseMetadataRecord, buildLicenseRecord, type LicenseRecord } from "./metadata.js";
import { uploadPublicJson, uploadPublicPng } from "./storage.js";
import {
  fetchParsedFinalizedTransaction,
  verifyParsedForgeTransaction,
  type VerifyParsedInput,
} from "./solanaVerify.js";

export type PersistedForgeQuote = ReturnType<typeof createQuote> & {
  wallet: string;
  createdAt: string;
};

export interface PersistedLootClaimRecord {
  claimId: string;
  auditPath: string;
  uid: string;
  wallet: string;
  nonce: string;
  forgeLoot: number;
  forgeLootUpdatedAt: string;
  forgeLootClaim: {
    claimId: string;
    wallet: string;
    nonce: string;
    loot: number;
    warrenName: string;
    issuedAt: string;
    expiresAt: string;
  };
  audit: {
    claimId: string;
    uid: string;
    wallet: string;
    nonce: string;
    loot: number;
    warrenName: string;
    issuedAt: string;
    expiresAt: string;
    payload: string;
    signature: string;
    publicKeyPem: string;
    createdAt: string;
  };
}

export interface PersistedWarrenPublicKeyRecord {
  uid: string;
  publicKeyPem: string;
  updatedAt: string;
}

export type FinalizableForgeRequest = Omit<ForgeRequestRecord, "status"> & {
  status: ForgeRequestRecord["status"] | "generating";
  uid?: string;
  licenseId?: string;
  assetAddress?: string;
  finalizationStartedAt?: string;
};

export type ForgeFinalizationClaim =
  | { status: "claimed"; request: FinalizableForgeRequest }
  | { status: "minted"; request: FinalizableForgeRequest; license: LicenseRecord }
  | { status: "in_progress"; licenseId: string }
  | { status: "not_found" }
  | { status: "invalid"; error: string; httpStatus?: number };

export type { AdminAuditRecord, AdminMintRequestRecord } from "./adminRoutes.js";

export interface QuoteRouteDependencies extends AdminRouteDependencies {
  nowMs?: () => number;
  treasuryWallet?: () => string;
  solanaRpcUrl?: () => string;
  nonce?: () => string;
  fetchTokenUsd?: () => Promise<number>;
  fetchGoblintownUsd?: () => Promise<number>;
  fetchSolUsd?: () => Promise<number>;
  priceCacheTtlMs?: number;
  persistQuote?: (quote: PersistedForgeQuote) => Promise<void>;
  readForgeQuote?: (quoteId: string) => Promise<PersistedForgeQuote | null>;
  fetchParsedTransaction?: (rpcUrl: string, signature: string) => Promise<VerifyParsedInput["transaction"]>;
  readForgeRequest?: (signature: string) => Promise<ForgeRequestRecord | undefined>;
  persistForgeRequest?: (record: ForgeRequestRecord) => Promise<void>;
  readLicense?: (licenseId: string) => Promise<LicenseRecord | null>;
  claimForgeFinalization?: (input: {
    requestId: string;
    licenseId: string;
    nowIso: string;
  }) => Promise<ForgeFinalizationClaim>;
  readUserForgeLoot?: (input: { uid?: string; wallet: string }) => Promise<number>;
  loadTraitPack?: () => Promise<TraitPack>;
  composeLicenseImage?: (input: ComposeLicenseInput) => Promise<Buffer>;
  uploadPng?: (path: string, png: Buffer) => Promise<string>;
  uploadJson?: (path: string, value: unknown) => Promise<string>;
  mintCoreLicense?: (input: CoreMintInput) => Promise<{ assetAddress: string; signature: string }>;
  persistFinalizedLicense?: (input: {
    requestId: string;
    license: LicenseRecord;
    request: FinalizableForgeRequest;
  }) => Promise<void>;
  forgeCluster?: () => string;
  enableMainnetMint?: () => boolean;
  forgeRpcUrl?: () => string;
  minterKeypairJson?: () => string;
  coreCollection?: () => string;
  royaltyCreatorAddress?: (minterPublicKey: string) => string;
  authenticateUid?: (authHeader: string | undefined) => Promise<string>;
  readTrustedWarrenPublicKey?: (uid: string) => Promise<string | null>;
  persistLootClaim?: (record: PersistedLootClaimRecord) => Promise<void>;
  persistWarrenPublicKey?: (record: PersistedWarrenPublicKeyRecord) => Promise<void>;
}

export function createApp(dependencies: QuoteRouteDependencies = {}) {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  const projectConfig = forgeProjectConfig();
  const tokenConfig = forgeTokenConfig();
  let cachedPrices: { prices: PriceSnapshotInput; expiresAt: number } | undefined;
  const persistQuote = dependencies.persistQuote ?? persistQuoteToFirestore;
  const readForgeQuote = dependencies.readForgeQuote ?? readForgeQuoteFromFirestore;
  const fetchParsedTransaction = dependencies.fetchParsedTransaction ?? fetchParsedFinalizedTransaction;
  const readForgeRequest = dependencies.readForgeRequest ?? readForgeRequestFromFirestore;
  const persistForgeRequest = dependencies.persistForgeRequest ?? persistForgeRequestToFirestore;
  const readLicense = dependencies.readLicense ?? readLicenseFromFirestore;
  const claimForgeFinalization = dependencies.claimForgeFinalization ?? claimForgeFinalizationInFirestore;
  const readUserForgeLoot = dependencies.readUserForgeLoot ?? readUserForgeLootFromFirestore;
  const loadTraitPack = dependencies.loadTraitPack ?? loadActiveTraitPackFromFirestore;
  const composeLicenseImage = dependencies.composeLicenseImage ?? composeLicensePng;
  const uploadPng = dependencies.uploadPng ?? uploadPublicPng;
  const uploadJson = dependencies.uploadJson ?? uploadPublicJson;
  const mintCoreLicense = dependencies.mintCoreLicense ?? mintCoreLicenseOnChain;
  const persistFinalizedLicense = dependencies.persistFinalizedLicense ?? persistFinalizedLicenseToFirestore;
  const authenticateUid = dependencies.authenticateUid ?? requireFirebaseUid;
  const readTrustedWarrenPublicKey =
    dependencies.readTrustedWarrenPublicKey ?? readTrustedWarrenPublicKeyFromFirestore;
  const persistLootClaim = dependencies.persistLootClaim ?? persistLootClaimToFirestore;
  const persistWarrenPublicKey = dependencies.persistWarrenPublicKey ?? persistWarrenPublicKeyToFirestore;

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, service: "forgekit-engine", projectId: projectConfig.projectId });
  });

  app.get("/api/core/config", (_req, res) => {
    res.json({
      mintMode: "core",
      royaltyBasisPoints: CORE_ROYALTY_BASIS_POINTS,
    });
  });

  registerAdminRoutes(app, dependencies);

  app.post("/api/quote", async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const wallet = typeof body.wallet === "string" ? body.wallet.trim() : "";
    if (!wallet) {
      res.status(400).json({ error: "wallet is required" });
      return;
    }

    let buyerWallet: string;
    try {
      buyerWallet = new PublicKey(wallet).toBase58();
    } catch {
      res.status(400).json({ error: "wallet must be a valid Solana public key" });
      return;
    }

    const issuedAt = dependencies.nowMs?.() ?? Date.now();

    const treasuryWallet =
      dependencies.treasuryWallet?.() ??
      process.env.FORGEKIT_TREASURY_WALLET ??
      process.env.FORGE_TREASURY_WALLET ??
      "";
    if (!treasuryWallet) {
      res.status(500).json({ error: "FORGEKIT_TREASURY_WALLET is not configured." });
      return;
    }

    let prices: PriceSnapshotInput;
    try {
      prices = await getPrices(issuedAt);
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
      return;
    }

    let persistedQuote: PersistedForgeQuote | undefined;
    try {
      const quote = createQuote({
        prices,
        nowMs: issuedAt,
        treasuryWallet,
        wallet: buyerWallet,
        nonce: dependencies.nonce?.() ?? randomUUID(),
        tokenDecimals: tokenConfig.decimals,
      });
      persistedQuote = {
        ...quote,
        wallet: buyerWallet,
        createdAt: new Date(quote.issuedAt).toISOString(),
      };
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
      return;
    }
    if (!persistedQuote) return;

    try {
      await persistQuote(persistedQuote);

      res.json(persistedQuote);
    } catch (err) {
      res.status(503).json({
        error: "quote persistence failed",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  });

  app.post("/api/forge/verify", async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const quoteId = typeof body.quoteId === "string" ? body.quoteId.trim() : "";
    const signature = typeof body.signature === "string" ? body.signature.trim() : "";
    const wallet = typeof body.wallet === "string" ? body.wallet.trim() : "";
    if (!quoteId || !signature || !wallet) {
      res.status(400).json({ error: "quoteId, signature, and wallet are required" });
      return;
    }

    let buyerWallet: string;
    try {
      buyerWallet = new PublicKey(wallet).toBase58();
    } catch {
      res.status(400).json({ error: "wallet must be a valid Solana public key" });
      return;
    }

    let uid: string | undefined;
    const authHeader = req.header("authorization");
    if (authHeader?.trim()) {
      try {
        uid = await authenticateUid(authHeader);
      } catch (err) {
        res.status(401).json({ error: err instanceof Error ? err.message : String(err) });
        return;
      }
    }

    let quote: PersistedForgeQuote | null;
    try {
      quote = await readForgeQuote(quoteId);
    } catch (err) {
      res.status(503).json({
        error: "quote lookup failed",
        detail: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    if (!quote) {
      res.status(404).json({ error: "quote not found" });
      return;
    }
    if (quote.wallet !== buyerWallet) {
      res.status(403).json({ error: "quote wallet does not match request wallet" });
      return;
    }

    const nowMs = dependencies.nowMs?.() ?? Date.now();
    if (!Number.isFinite(quote.expiresAt) || quote.expiresAt <= nowMs) {
      res.status(400).json({ error: "quote has expired" });
      return;
    }

    const rpcUrl =
      dependencies.solanaRpcUrl?.() ??
      process.env.FORGEKIT_SOLANA_RPC_URL ??
      process.env.FORGEKIT_RPC_URL ??
      process.env.SOLANA_RPC_URL ??
      "";
    if (!rpcUrl.trim()) {
      res.status(500).json({ error: "FORGEKIT_SOLANA_RPC_URL is not configured." });
      return;
    }

    let transaction: VerifyParsedInput["transaction"];
    try {
      transaction = await fetchParsedTransaction(rpcUrl, signature);
    } catch (err) {
      res.status(502).json({
        error: "transaction lookup failed",
        detail: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    const verification = verifyParsedForgeTransaction({
      wallet: buyerWallet,
      mint: tokenConfig.mint,
      tokenDecimals: tokenConfig.decimals,
      treasuryWallet: quote.treasuryWallet,
      burnBaseUnits: quote.burnBaseUnits,
      reserveLamports: quote.reserveLamports,
      transaction,
    });
    if (!verification.ok) {
      res.status(400).json({ error: "forge transaction verification failed", errors: verification.errors });
      return;
    }

    const nextRecord = buildForgeRequestRecord({
      quoteId,
      signature,
      wallet: buyerWallet,
      uid,
      offerId: quote.offerId,
      offerVersion: quote.offerVersion,
      burnBaseUnits: quote.burnBaseUnits,
      reserveLamports: quote.reserveLamports,
      nowIso: new Date(nowMs).toISOString(),
    });

    try {
      const existing = await readForgeRequest(signature);
      if (existing) {
        if (existing.status === "verified") {
          assertForgeRequestCanTransition(existing, nextRecord);
          res.json(existing);
          return;
        }
        if (nextRequestStatus(existing.status, nextRecord.status) === existing.status) {
          res.json(existing);
          return;
        }
        assertForgeRequestCanTransition(existing, nextRecord);
      }

      await persistForgeRequest(nextRecord);
      res.json(nextRecord);
    } catch (err) {
      res.status(409).json({
        error: "forge request persistence failed",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  });

  app.post("/api/forge/finalize", async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const requestId = typeof body.requestId === "string" ? body.requestId.trim() : "";
    if (!requestId) {
      res.status(400).json({ error: "requestId is required" });
      return;
    }

    const cluster = dependencies.forgeCluster?.() ?? process.env.FORGEKIT_CLUSTER ?? process.env.FORGE_CLUSTER ?? "devnet";
    const configuredMainnetFlag = process.env.FORGEKIT_ENABLE_MAINNET_MINT ?? process.env.FORGE_ENABLE_MAINNET_MINT;
    const mainnetEnabled = dependencies.enableMainnetMint?.() ?? configuredMainnetFlag === "1";
    if (cluster === "mainnet-beta" && !mainnetEnabled) {
      res.status(403).json({ error: "mainnet minting is disabled" });
      return;
    }

    const nowIso = new Date(dependencies.nowMs?.() ?? Date.now()).toISOString();
    const initialLicenseId = deriveLicenseId(requestId);
    let claim: ForgeFinalizationClaim;
    try {
      claim = await claimForgeFinalization({ requestId, licenseId: initialLicenseId, nowIso });
    } catch (err) {
      res.status(503).json({
        error: "forge finalization claim failed",
        detail: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    if (claim.status === "not_found") {
      res.status(404).json({ error: "forge request not found" });
      return;
    }
    if (claim.status === "minted") {
      res.json(claim.license);
      return;
    }
    if (claim.status === "in_progress") {
      res.status(409).json({
        error: "forge finalization already in progress",
        licenseId: claim.licenseId,
      });
      return;
    }
    if (claim.status === "invalid") {
      res.status(claim.httpStatus ?? 409).json({ error: claim.error });
      return;
    }

    const finalizableRequest = claim.request;
    const licenseId = finalizableRequest.licenseId ?? initialLicenseId;

    try {
      const rpcUrl =
        dependencies.forgeRpcUrl?.() ??
        process.env.FORGEKIT_RPC_URL ??
        process.env.FORGE_RPC_URL ??
        process.env.SOLANA_RPC_URL ??
        "";
      const minterKeypairJson =
        dependencies.minterKeypairJson?.() ??
        process.env.FORGEKIT_MINTER_KEYPAIR_JSON ??
        process.env.FORGE_MINTER_KEYPAIR_JSON ??
        "";
      const collectionAddress =
        dependencies.coreCollection?.() ??
        process.env.FORGEKIT_CORE_COLLECTION ??
        process.env.FORGE_CORE_COLLECTION ??
        "";
      if (!rpcUrl.trim()) throw new Error("FORGEKIT_RPC_URL or SOLANA_RPC_URL is required.");
      if (!minterKeypairJson.trim()) throw new Error("FORGEKIT_MINTER_KEYPAIR_JSON is required.");
      if (!collectionAddress.trim()) throw new Error("FORGEKIT_CORE_COLLECTION is required.");

      const configuredRoyaltyCreator = process.env.FORGEKIT_ROYALTY_CREATOR ?? process.env.FORGE_ROYALTY_CREATOR;
      const royaltyCreatorAddress =
        dependencies.royaltyCreatorAddress?.(configuredRoyaltyCreator ?? "") ??
        configuredRoyaltyCreator ??
        readMinterPublicKey(minterKeypairJson);

      const traitPack = await loadTraitPack();
      const loot = await readUserForgeLoot({ uid: finalizableRequest.uid, wallet: finalizableRequest.wallet });
      const lootBoost = calculateLootBoost(loot, { maxBoost: 0.8, boostCurve: 0.22 });
      const rolled = rollTraits({ pack: traitPack, seed: finalizableRequest.seedMaterial, lootBoost });
      const traits = buildTraitAttributes(rolled.traits, rolled.rarityScore);
      const imagePath = `licenses/${licenseId}/image.png`;
      const metadataPath = `licenses/${licenseId}/metadata.json`;
      const licenseNumber = licenseNumberFromId(licenseId);
      const layers = await buildStarterTraitLayers(
        rolled.traits,
        (traitPack as TraitPack & { baseImagePath?: string }).baseImagePath,
      );
      const png = await composeLicenseImage({
        width: 512,
        height: 320,
        layers,
        text: {
          goblinName: `License #${licenseNumber.toString().padStart(6, "0")}`,
          idNumber: licenseId,
          issueDate: nowIso.slice(0, 10),
          expiryDate: "NEVER",
          rarityScore: rolled.rarityScore.toString(),
          flavor: "FORGEKIT VERIFIED",
        },
      });
      const imageUri = await uploadPng(imagePath, png);
      const pricingSnapshot = pricingSnapshotFromRequest(finalizableRequest as ForgeRequestRecord);
      const metadata = buildLicenseMetadataRecord({
        licenseNumber,
        wallet: finalizableRequest.wallet,
        seed: finalizableRequest.seedMaterial,
        image: imageUri,
        externalUrl: `${projectConfig.externalBaseUrl.replace(/\/+$/, "")}/asset/${licenseId}`,
        projectName: projectConfig.brand.displayName,
        description: `${projectConfig.brand.displayName} generated by ${projectConfig.brand.engineName}.`,
        offerId: finalizableRequest.offerId,
        traitPackId: traitPack.id,
        loot,
        lootBoost,
        pricingSnapshot,
        traits,
      });
      const metadataUri = await uploadJson(metadataPath, metadata);
      const mintResult = await mintCoreLicense({
        rpcUrl,
        minterKeypairJson,
        owner: finalizableRequest.wallet,
        name: metadata.name,
        uri: metadataUri,
        collectionAddress,
        royaltyCreatorAddress,
      });
      const license = buildLicenseRecord({
        licenseId,
        wallet: finalizableRequest.wallet,
        ownerAtMint: finalizableRequest.wallet,
        assetAddress: mintResult.assetAddress,
        imagePath,
        metadataPath,
        rarityScore: rolled.rarityScore,
        traits,
        loot,
        lootBoost,
        pricingSnapshot,
        nowIso,
      });
      const mintedRequest: FinalizableForgeRequest = {
        ...finalizableRequest,
        status: "minted",
        licenseId,
        assetAddress: mintResult.assetAddress,
        updatedAt: nowIso,
      };

      await persistFinalizedLicense({ requestId, license, request: mintedRequest });
      res.json(license);
    } catch (err) {
      res.status(503).json({
        error: "forge finalization failed",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  });

  app.post("/api/forge/warren-key", async (req, res) => {
    let uid: string;
    try {
      uid = await authenticateUid(req.header("authorization"));
    } catch (err) {
      res.status(401).json({ error: err instanceof Error ? err.message : String(err) });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const publicKeyPem = typeof body.publicKeyPem === "string" ? body.publicKeyPem.trim() : "";
    if (!publicKeyPem) {
      res.status(400).json({ error: "publicKeyPem is required" });
      return;
    }
    try {
      assertEd25519PublicKey(publicKeyPem);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
      return;
    }

    try {
      await persistWarrenPublicKey({
        uid,
        publicKeyPem,
        updatedAt: new Date(dependencies.nowMs?.() ?? Date.now()).toISOString(),
      });
    } catch (err) {
      res.status(503).json({
        error: "warren public key persistence failed",
        detail: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    res.json({ uid, publicKeyRegistered: true });
  });

  app.post("/api/forge/loot-claim", async (req, res) => {
    let uid: string;
    try {
      uid = await authenticateUid(req.header("authorization"));
    } catch (err) {
      res.status(401).json({ error: err instanceof Error ? err.message : String(err) });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const bodyUid = typeof body.uid === "string" ? body.uid.trim() : "";
    const wallet = typeof body.wallet === "string" ? body.wallet.trim() : "";
    const nonce = typeof body.nonce === "string" ? body.nonce.trim() : "";
    const payload = typeof body.payload === "string" ? body.payload : "";
    const signature = typeof body.signature === "string" ? body.signature.trim() : "";
    if (bodyUid && bodyUid !== uid) {
      res.status(403).json({ error: "request uid does not match authenticated user" });
      return;
    }
    if (!wallet || !nonce || !payload || !signature) {
      res.status(400).json({ error: "wallet, nonce, payload, and signature are required" });
      return;
    }

    const nowMs = dependencies.nowMs?.() ?? Date.now();
    let publicKeyPem: string;
    try {
      publicKeyPem = await readTrustedWarrenPublicKey(uid) ?? "";
    } catch (err) {
      res.status(503).json({
        error: "warren public key lookup failed",
        detail: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    if (!publicKeyPem) {
      res.status(403).json({ error: "Warren public key is not registered for this user." });
      return;
    }

    let parsed: ParsedLootClaim;
    try {
      parsed = verifySignedLootClaim({
        uid,
        wallet,
        nonce,
        payload,
        signature,
        publicKeyPem,
        nowMs,
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
      return;
    }

    const claimRecord = buildPersistedLootClaim({
      parsed,
      payload,
      signature,
      publicKeyPem,
      nowIso: new Date(nowMs).toISOString(),
    });
    try {
      await persistLootClaim(claimRecord);
    } catch (err) {
      res.status(503).json({
        error: "loot claim persistence failed",
        detail: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    res.json({
      uid: parsed.uid,
      wallet: parsed.wallet,
      nonce: parsed.nonce,
      loot: parsed.loot,
      warrenName: parsed.warrenName,
      issuedAt: parsed.issuedAt,
      expiresAt: parsed.expiresAt,
      claimId: claimRecord.claimId,
    });
  });

  async function getPrices(nowMs: number): Promise<PriceSnapshotInput> {
    if (cachedPrices && cachedPrices.expiresAt > nowMs) return cachedPrices.prices;

    const [tokenUsd, solUsd] = await Promise.all([
      dependencies.fetchTokenUsd?.() ??
        dependencies.fetchGoblintownUsd?.() ??
        fetchDexScreenerTokenPrice(tokenConfig.mint, fetch, {
          allowedPairAddress: tokenConfig.dexScreenerPair,
          timeoutMs: 2500,
        }),
      dependencies.fetchSolUsd?.() ?? fetchCoinGeckoSolPrice(fetch, { timeoutMs: 2500 }),
    ]);

    const prices = { tokenUsd, solUsd };
    const cacheTtlMs = dependencies.priceCacheTtlMs ?? 15_000;
    if (cacheTtlMs > 0) cachedPrices = { prices, expiresAt: nowMs + cacheTtlMs };
    return prices;
  }

  return app;
}

async function persistQuoteToFirestore(quote: PersistedForgeQuote): Promise<void> {
  await firestore().collection("forgeQuotes").doc(quote.quoteId).set(quote, { merge: false });
}

async function readForgeQuoteFromFirestore(quoteId: string): Promise<PersistedForgeQuote | null> {
  const snap = await firestore().collection("forgeQuotes").doc(quoteId).get();
  if (!snap.exists) return null;
  return snap.data() as PersistedForgeQuote;
}

async function readForgeRequestFromFirestore(signature: string): Promise<ForgeRequestRecord | undefined> {
  const snap = await firestore().collection("forgeRequests").doc(signature).get();
  if (!snap.exists) return undefined;
  return snap.data() as ForgeRequestRecord;
}

async function persistForgeRequestToFirestore(record: ForgeRequestRecord): Promise<void> {
  await firestore().collection("forgeRequests").doc(record.signature).set(record, { merge: false });
}

async function readLicenseFromFirestore(licenseId: string): Promise<LicenseRecord | null> {
  const snap = await firestore().collection("licenses").doc(licenseId).get();
  if (!snap.exists) return null;
  return snap.data() as LicenseRecord;
}

async function claimForgeFinalizationInFirestore(input: {
  requestId: string;
  licenseId: string;
  nowIso: string;
}): Promise<ForgeFinalizationClaim> {
  const db = firestore();
  return db.runTransaction(async (transaction) => {
    const requestRef = db.collection("forgeRequests").doc(input.requestId);
    const requestSnap = await transaction.get(requestRef);
    if (!requestSnap.exists) return { status: "not_found" };

    const request = requestSnap.data() as FinalizableForgeRequest;
    const licenseId = request.licenseId ?? (request.signature ? deriveLicenseId(request.signature) : input.licenseId);

    if (request.status === "minted") {
      const licenseSnap = await transaction.get(db.collection("licenses").doc(licenseId));
      if (licenseSnap.exists) {
        return {
          status: "minted",
          request,
          license: licenseSnap.data() as LicenseRecord,
        };
      }
      return { status: "invalid", error: "minted license record not found" };
    }
    if (request.status === "generating") {
      return { status: "in_progress", licenseId };
    }
    if (request.status === "failed") {
      return { status: "invalid", error: "failed forge requests cannot be finalized" };
    }
    if (request.status !== "verified" && request.status !== "generated") {
      return { status: "invalid", error: "forge request status cannot be finalized" };
    }

    const claimed: FinalizableForgeRequest = {
      ...request,
      status: "generating",
      licenseId,
      finalizationStartedAt: input.nowIso,
      updatedAt: input.nowIso,
    };
    transaction.set(
      requestRef,
      {
        status: claimed.status,
        licenseId: claimed.licenseId,
        finalizationStartedAt: claimed.finalizationStartedAt,
        updatedAt: claimed.updatedAt,
      },
      { merge: true },
    );
    return { status: "claimed", request: claimed };
  });
}

async function loadActiveTraitPackFromFirestore(): Promise<TraitPack> {
  const snap = await firestore().collection("traitPacks").doc("active").get();
  if (!snap.exists) return loadStarterTraitPack();
  return snap.data() as TraitPack;
}

async function readUserForgeLootFromFirestore(input: { uid?: string; wallet: string }): Promise<number> {
  const db = firestore();
  if (input.uid) {
    const snap = await db.collection("users").doc(input.uid).get();
    return normalizeForgeLoot(snap.exists ? snap.data()?.forgeLoot : undefined);
  }

  const query = await db.collection("users").where("wallet", "==", input.wallet).limit(1).get();
  const first = query.docs[0];
  return normalizeForgeLoot(first?.data().forgeLoot);
}

async function persistFinalizedLicenseToFirestore(input: {
  requestId: string;
  license: LicenseRecord;
  request: FinalizableForgeRequest;
}): Promise<void> {
  const db = firestore();
  await db.runTransaction(async (transaction) => {
    const requestRef = db.collection("forgeRequests").doc(input.requestId);
    const licenseRef = db.collection("licenses").doc(input.license.licenseId);
    const [requestSnap, licenseSnap] = await Promise.all([
      transaction.get(requestRef),
      transaction.get(licenseRef),
    ]);
    if (!requestSnap.exists) {
      throw new Error("Finalization claim no longer exists.");
    }

    const current = requestSnap.data() as FinalizableForgeRequest;
    if (current.status !== "generating") {
      throw new Error("Finalization claim is not active.");
    }
    if (current.licenseId !== input.license.licenseId) {
      throw new Error("Finalization licenseId mismatch.");
    }
    if (current.assetAddress && current.assetAddress !== input.license.assetAddress) {
      throw new Error("Finalization assetAddress mismatch.");
    }

    if (licenseSnap.exists) {
      const existing = licenseSnap.data() as LicenseRecord;
      if (existing.assetAddress !== input.license.assetAddress) {
        throw new Error("Finalized license assetAddress mismatch.");
      }
    }

    transaction.set(licenseRef, input.license, { merge: false });
    transaction.set(requestRef, input.request, { merge: true });
  });
}

function normalizeForgeLoot(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

function readMinterPublicKey(minterKeypairJson: string): string {
  const parsed = JSON.parse(minterKeypairJson) as unknown;
  if (!Array.isArray(parsed)) throw new Error("FORGEKIT_MINTER_KEYPAIR_JSON must be a Solana keypair array.");
  return Keypair.fromSecretKey(Uint8Array.from(parsed as number[])).publicKey.toBase58();
}

function assertEd25519PublicKey(publicKeyPem: string): void {
  try {
    const key = createPublicKey(publicKeyPem);
    if (key.asymmetricKeyType !== "ed25519") throw new Error("publicKeyPem must be an Ed25519 public key");
  } catch (err) {
    if (err instanceof Error && err.message === "publicKeyPem must be an Ed25519 public key") throw err;
    throw new Error("publicKeyPem must be a valid Ed25519 public key");
  }
}

async function readTrustedWarrenPublicKeyFromFirestore(uid: string): Promise<string | null> {
  const snap = await firestore().collection("users").doc(uid).get();
  if (!snap.exists) return null;
  const data = snap.data() ?? {};
  const key = typeof data.forgeLootPublicKeyPem === "string"
    ? data.forgeLootPublicKeyPem.trim()
    : typeof data.warrenPublicKeyPem === "string"
      ? data.warrenPublicKeyPem.trim()
      : "";
  return key || null;
}

async function persistWarrenPublicKeyToFirestore(record: PersistedWarrenPublicKeyRecord): Promise<void> {
  await firestore().collection("users").doc(record.uid).set(
    {
      warrenPublicKeyPem: record.publicKeyPem,
      forgeLootPublicKeyPem: record.publicKeyPem,
      forgeLootPublicKeyUpdatedAt: record.updatedAt,
    },
    { merge: true },
  );
}

export function lootClaimAuditPath(uid: string, claimId: string): string {
  return `users/${uid}/lootClaims/${claimId}`;
}

function buildPersistedLootClaim(input: {
  parsed: ParsedLootClaim;
  payload: string;
  signature: string;
  publicKeyPem: string;
  nowIso: string;
}): PersistedLootClaimRecord {
  const claimId = createHash("sha256").update(input.payload).digest("hex");
  const forgeLootClaim = {
    claimId,
    wallet: input.parsed.wallet,
    nonce: input.parsed.nonce,
    loot: input.parsed.loot,
    warrenName: input.parsed.warrenName,
    issuedAt: input.parsed.issuedAt,
    expiresAt: input.parsed.expiresAt,
  };
  return {
    claimId,
    auditPath: lootClaimAuditPath(input.parsed.uid, claimId),
    uid: input.parsed.uid,
    wallet: input.parsed.wallet,
    nonce: input.parsed.nonce,
    forgeLoot: input.parsed.loot,
    forgeLootUpdatedAt: input.nowIso,
    forgeLootClaim,
    audit: {
      ...forgeLootClaim,
      uid: input.parsed.uid,
      payload: input.payload,
      signature: input.signature,
      publicKeyPem: input.publicKeyPem,
      createdAt: input.nowIso,
    },
  };
}

async function persistLootClaimToFirestore(record: PersistedLootClaimRecord): Promise<void> {
  const db = firestore();
  const userRef = db.collection("users").doc(record.uid);
  const batch = db.batch();
  batch.set(
    userRef,
    {
      forgeLoot: record.forgeLoot,
      forgeLootUpdatedAt: record.forgeLootUpdatedAt,
      forgeLootClaim: record.forgeLootClaim,
      wallet: record.wallet,
    },
    { merge: true },
  );
  batch.set(userRef.collection("lootClaims").doc(record.claimId), record.audit, { merge: false });
  await batch.commit();
}

export const api = onRequest({ region: "us-central1", timeoutSeconds: 120, memory: "1GiB" }, createApp());
