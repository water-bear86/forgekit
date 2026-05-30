# ForgeKit Template Pack

This is the copyable starter pack for a new ForgeKit deployment. It is complete
enough to show the required shape, but it is not production art and should not be
made public-mintable as-is.

## Bring Your Own Assets

Replace the bundled SVG layers with owned project assets:

- base image or full-canvas background;
- one or more traits per category;
- safe default trait for every category;
- rarity weights;
- z-index and anchor coordinates;
- incompatibility rules.

Keep each layer aligned to the shared canvas defined in `project-pack.json`.
ForgeKit assumes every layer can be composited into that coordinate system.

## Required Project Values

Before activation, replace:

- `token.mint`
- `token.symbol`
- `token.decimals`
- `nft.collectionAddress`
- `nft.royaltyCreator`
- `externalBaseUrl`
- public copy in `copy`
- compliance status and operator notes

## Compliance Checklist

- Asset ownership or license is recorded outside the public manifest.
- `compliance.publicMintAllowed` is false until art, metadata, and economics are
  reviewed.
- All asset paths stay inside the pack root and use `.png` or `.svg`.
- Metadata templates include required marketplace fields.
- Devnet mint has been verified before mainnet env flags are enabled.
- Operator changes are made through the admin panel so audit records exist.
