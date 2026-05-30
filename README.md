# ForgeKit

ForgeKit is a standalone procedural NFT engine. It ships as a Vite/Firebase app
with Firebase Functions for quotes, transaction verification, deterministic
trait generation, image composition, metadata upload, admin controls, and
Metaplex Core minting.

The app can still reuse the existing Firebase sign-in setup while it incubates in
this repository, but the product identity is ForgeKit. Collection-specific art,
copy, tokens, pricing, and rarity modifiers belong in project pack config.

## Local Setup

```bash
cd apps/license-forge
cp .firebaserc.example .firebaserc
cp .env.example .env.local
npm install
npm --prefix functions install
npm run dev
```

The browser app has Firebase defaults in `shared/config.ts`, so it can boot
locally without overriding public Firebase web config. Use `.env.local` for a
different Firebase project, Solana RPC, token mint, project pack label, or public
brand copy.

Run checks before a release:

```bash
npm run check
```

## Public Mint Flow

1. A visitor connects a Solana wallet.
2. Optional Firebase sign-in attaches a project-specific modifier score.
3. The app requests a quote from `/api/quote`.
4. The wallet submits the configured Token-2022 burn plus any SOL reserve.
5. `/api/forge/verify` checks wallet ownership, mint, decimals, burn amount,
   treasury destination, reserve lamports, and finalized transaction data.
6. `/api/forge/finalize` rolls deterministic traits, composites the image,
   uploads image and metadata, and mints a tradable Metaplex Core NFT.

The default public target is about `$2.50`. The reserve covers unavoidable
operations cost; the remaining value is burned in the configured project token.

## Project Packs

ForgeKit defaults are defined in `shared/config.ts` and can be overridden by
environment variables. A complete future project pack should supply:

- public brand copy and labels;
- token mint, symbol, decimals, and token program id;
- offer pricing, reserve, mint mode, and rarity boost curve;
- modifier adapter name and verification source;
- trait manifest, base art, and layer assets;
- NFT collection, external URL base, and royalty settings.

The current `$GOBLINTOWN` mint is a sample/default token value for this local
deployment. Engine code treats it as the active project token, not as the
ForgeKit brand.

ForgeKit ships with a copyable template at
`project-packs/forgekit-template/`. Start there for a new collection: replace
the token and Core collection values, swap in owned assets, update copy and
compliance status, then validate the trait manifest before activation.

## Asset And Compliance Model

Real deployments bring their own approved assets. ForgeKit starter assets are for
development and demos; a production pack should upload its own base art, layers,
trait manifest, metadata template, and collection settings.

Compliance is enforced in layers:

- validate manifests before activation: ids, categories, rarity weights, z-index
  values, anchors, incompatibilities, and safe defaults;
- constrain art paths to approved Storage or bundled pack roots and only allow
  supported image types;
- require deterministic generation from the verified request seed and store the
  final trait list with the asset record;
- pin marketplace fields such as royalties, collection, owner wallet, metadata
  URI, and image URI during finalization;
- audit operator changes to offers, trait packs, and no-burn mints;
- gate mainnet minting behind explicit environment configuration and a verified
  devnet/test path.

Project packs can add a manual approval flag before public minting if a pack's
art or legal review needs a human checkpoint.

## Modifier Claim Adapter

The existing local app can feed a user's loot count into ForgeKit as one modifier
adapter. The adapter registers an Ed25519 public key through
`/api/forge/warren-key`, then posts canonical signed claims to
`/api/forge/loot-claim`. The function verifies Firebase UID, wallet, nonce,
expiry, and signature before storing `users/{uid}.forgeLoot` and an audit record.

Other projects can replace this with their own score source as long as the
backend persists a non-negative modifier value for finalization.

## Operator Panel

Admin endpoints require a Firebase bearer token whose UID appears in
`FORGEKIT_ADMIN_UIDS` or the legacy `FORGE_ADMIN_UIDS` alias.

- `/api/admin/offers` updates public pricing, reserve, enablement, and mint mode.
- `/api/admin/traits` updates the active trait manifest.
- `/api/admin/mint` creates an audited no-burn operator mint request.

Operator offer updates keep royalties pinned at 500 basis points and restrict
mint modes to `core` or `offchain_preview`.

## Production Environment

Preferred client settings:

- `VITE_FORGEKIT_ACTIVE_PROJECT`
- `VITE_FORGEKIT_PROJECT_NAME`
- `VITE_FORGEKIT_ISSUER_NAME`
- `VITE_FORGEKIT_PROJECT_PACK_LABEL`
- `VITE_FORGEKIT_MODIFIER_LABEL`
- `VITE_FORGEKIT_TOKEN_MINT`
- `VITE_FORGEKIT_TOKEN_SYMBOL`
- `VITE_FORGEKIT_TOKEN_DECIMALS`
- `VITE_FORGEKIT_TOKEN_PROGRAM_ID`
- `VITE_FORGEKIT_SOLANA_RPC_URL`
- Firebase web config: `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`,
  `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`,
  `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`,
  `VITE_FIREBASE_MEASUREMENT_ID`

Preferred Function settings:

- `FORGEKIT_TOKEN_MINT`
- `FORGEKIT_TOKEN_SYMBOL`
- `FORGEKIT_TOKEN_DECIMALS`
- `FORGEKIT_TOKEN_PROGRAM_ID`
- `FORGEKIT_TREASURY_WALLET`
- `FORGEKIT_SOLANA_RPC_URL`
- `FORGEKIT_RPC_URL`
- `FORGEKIT_MINTER_KEYPAIR_JSON`
- `FORGEKIT_CORE_COLLECTION`
- `FORGEKIT_ROYALTY_CREATOR`
- `FORGEKIT_ADMIN_UIDS`
- `FORGEKIT_CLUSTER`
- `FORGEKIT_ENABLE_MAINNET_MINT`
- `FORGEKIT_STORAGE_BUCKET`
- `FORGEKIT_EXTERNAL_BASE_URL`
- `FORGEKIT_DEXSCREENER_PAIR`
- `FIREBASE_SERVICE_ACCOUNT_JSON`

Legacy `FORGE_*`, `SOLANA_RPC_URL`, and `FIREBASE_STORAGE_BUCKET` aliases are
still accepted where the previous deployment shape used them.

## Deploy

Do not deploy until `.firebaserc`, Firebase credentials, Solana RPC, minter
keypair, Core collection, treasury, royalty creator, storage bucket, and admin
UIDs are configured for the target project.

```bash
cd apps/license-forge
npm run check
npx -y firebase-tools@latest deploy --only hosting,functions:license-forge,firestore:rules,storage
```

Mainnet minting is deliberately gated. Set `FORGEKIT_CLUSTER=mainnet-beta` and
`FORGEKIT_ENABLE_MAINNET_MINT=1` only after a devnet mint has been verified end
to end.
