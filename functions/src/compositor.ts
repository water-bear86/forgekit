import sharp from "sharp";

const MAX_LICENSE_DIMENSION = 4096;

export interface LicenseLayer {
  input: Buffer;
  zIndex: number;
  left?: number;
  top?: number;
  anchorX?: number;
  anchorY?: number;
}

export interface ComposeLicenseInput {
  width: number;
  height: number;
  layers: LicenseLayer[];
  text: {
    goblinName: string;
    idNumber: string;
    issueDate: string;
    expiryDate: string;
    rarityScore: string;
    flavor: string;
  };
}

export async function composeLicensePng(input: ComposeLicenseInput): Promise<Buffer> {
  validateDimensions(input.width, input.height);

  const base = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${input.width}" height="${input.height}" viewBox="0 0 ${input.width} ${input.height}">
      <rect width="100%" height="100%" fill="#c5b953"/>
      <rect x="18" y="18" width="${Math.max(0, input.width - 36)}" height="${Math.max(0, input.height - 36)}" fill="#efe589" stroke="#17120b" stroke-width="8"/>
      <rect x="34" y="36" width="${Math.max(0, input.width - 68)}" height="${Math.max(0, input.height - 72)}" fill="none" stroke="#7f1d1d" stroke-width="3" stroke-dasharray="12 8"/>
      <rect x="${input.width - 190}" y="126" width="132" height="132" fill="#d0c266" stroke="#17120b" stroke-width="4"/>
    </svg>
  `);
  const textOverlay = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${input.width}" height="${input.height}" viewBox="0 0 ${input.width} ${input.height}">
      <rect x="36" y="44" width="${input.width - 72}" height="58" fill="#202915"/>
      <text x="52" y="82" font-family="monospace" font-size="28" font-weight="700" fill="#d9ff60">GOBLINTOWN DRIVER'S LICENSE</text>
      <text x="52" y="145" font-family="monospace" font-size="24" font-weight="700" fill="#17120b">${escapeXml(input.text.goblinName)}</text>
      <text x="52" y="190" font-family="monospace" font-size="18" fill="#17120b">ID ${escapeXml(input.text.idNumber)}</text>
      <text x="52" y="224" font-family="monospace" font-size="18" fill="#17120b">ISS ${escapeXml(input.text.issueDate)}</text>
      <text x="52" y="258" font-family="monospace" font-size="18" fill="#17120b">EXP ${escapeXml(input.text.expiryDate)}</text>
      <text x="52" y="292" font-family="monospace" font-size="18" fill="#17120b">RARITY ${escapeXml(input.text.rarityScore)}</text>
      <text x="52" y="${input.height - 42}" font-family="monospace" font-size="20" font-weight="700" fill="#9c1c13">${escapeXml(input.text.flavor)}</text>
    </svg>
  `);
  const composites = await Promise.all(input.layers
    .slice()
    .sort((a, b) => a.zIndex - b.zIndex)
    .map((layer) => prepareLayer(layer, input.width, input.height)));

  return sharp(base)
    .composite([...composites, { input: textOverlay, left: 0, top: 0 }])
    .png()
    .toBuffer();
}

async function prepareLayer(layer: LicenseLayer, outputWidth: number, outputHeight: number) {
  validateLayer(layer);

  const left = layer.left ?? layer.anchorX ?? 0;
  const top = layer.top ?? layer.anchorY ?? 0;
  const metadata = await sharp(layer.input).metadata();
  const shouldScaleFullCanvas =
    left === 0 &&
    top === 0 &&
    Number.isFinite(metadata.width) &&
    Number.isFinite(metadata.height) &&
    metadata.width !== undefined &&
    metadata.height !== undefined &&
    metadata.width >= outputWidth &&
    metadata.height >= outputHeight &&
    (metadata.width !== outputWidth || metadata.height !== outputHeight);

  if (!shouldScaleFullCanvas) {
    return { input: layer.input, left, top };
  }

  const input = await sharp(layer.input).resize(outputWidth, outputHeight, { fit: "fill" }).png().toBuffer();
  return { input, left: 0, top: 0 };
}

function validateDimensions(width: number, height: number): void {
  if (!Number.isInteger(width) || width <= 0) {
    throw new Error("width must be a positive integer.");
  }
  if (!Number.isInteger(height) || height <= 0) {
    throw new Error("height must be a positive integer.");
  }
  if (width > MAX_LICENSE_DIMENSION) {
    throw new Error(`width must be at most ${MAX_LICENSE_DIMENSION}.`);
  }
  if (height > MAX_LICENSE_DIMENSION) {
    throw new Error(`height must be at most ${MAX_LICENSE_DIMENSION}.`);
  }
}

function validateLayer(layer: LicenseLayer): void {
  if (!Buffer.isBuffer(layer.input) || layer.input.length === 0) {
    throw new Error("layer input must be a non-empty buffer.");
  }
  if (!Number.isFinite(layer.zIndex)) {
    throw new Error("layer zIndex must be finite.");
  }

  validateCoordinate(layer.left ?? layer.anchorX ?? 0, "left");
  validateCoordinate(layer.top ?? layer.anchorY ?? 0, "top");
}

function validateCoordinate(value: number, name: "left" | "top"): void {
  if (!Number.isInteger(value) || !Number.isFinite(value)) {
    throw new Error(`layer ${name} must be a finite integer.`);
  }
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
