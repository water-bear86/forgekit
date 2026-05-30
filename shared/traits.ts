export type TraitCategory =
  | "eyes"
  | "nose"
  | "ears"
  | "mouth"
  | "hat_hair"
  | "shirt"
  | "extras"
  | "background"
  | "rare_mutations";

export interface TraitEntry {
  id: string;
  name: string;
  rarity_weight: number;
  imagePath: string;
  category: TraitCategory;
  zIndex: number;
  anchorX: number;
  anchorY: number;
  colorOverlayAllowed: boolean;
  incompatibleTraits: string[];
  rare: boolean;
}

export interface TraitPack {
  id: string;
  version: number;
  categories: TraitCategory[];
  traits: TraitEntry[];
  safeDefaultTraitIds?: Partial<Record<TraitCategory, string>>;
}

export interface LootBoostConfig {
  maxBoost: number;
  boostCurve: number;
}

export interface TraitRollResult {
  seed: string;
  traits: TraitEntry[];
  rarityScore: number;
  rareCount: number;
}

export function calculateLootBoost(loot: number, config: LootBoostConfig): number {
  const safeLoot = Math.max(0, Math.floor(loot));
  const rawBoost = Math.log10(safeLoot + 1) * config.boostCurve;
  return Math.max(0, Math.min(config.maxBoost, Number(rawBoost.toFixed(6))));
}

export function rollTraits(input: {
  pack: TraitPack;
  seed: string;
  lootBoost: number;
}): TraitRollResult {
  if (!Number.isFinite(input.lootBoost) || input.lootBoost < 0 || input.lootBoost > 1) {
    throw new Error("lootBoost must be a finite number between 0 and 1.");
  }

  const rng = seededRng(input.seed);
  const selected: TraitEntry[] = [];

  for (const category of input.pack.categories) {
    const candidates = input.pack.traits.filter((trait) => trait.category === category);
    if (candidates.length === 0) {
      throw new Error(`Trait category ${category} has no candidates.`);
    }

    const picked = pickTraitForCategory({
      candidates,
      selected,
      rng,
      lootBoost: input.lootBoost,
      category,
      safeDefaultTraitId: input.pack.safeDefaultTraitIds?.[category],
    });
    selected.push(picked);
  }

  const sorted = selected.slice().sort((a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id));
  const rareCount = sorted.filter((trait) => trait.rare).length;
  const rarityScore = sorted.reduce((score, trait) => {
    if (trait.rare) {
      return score + 1000;
    }

    return score + 100 / Math.max(1, trait.rarity_weight);
  }, 0);

  return {
    seed: input.seed,
    traits: sorted,
    rareCount,
    rarityScore: Number(rarityScore.toFixed(4)),
  };
}

function pickTraitForCategory(input: {
  candidates: TraitEntry[];
  selected: TraitEntry[];
  rng: () => number;
  lootBoost: number;
  category: TraitCategory;
  safeDefaultTraitId?: string;
}): TraitEntry {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = pickWeighted(input.candidates, input.rng, input.lootBoost);
    if (isCompatible(candidate, input.selected)) {
      return candidate;
    }
  }

  if (input.safeDefaultTraitId) {
    const safeDefault = input.candidates.find((candidate) => candidate.id === input.safeDefaultTraitId);
    if (!safeDefault) {
      throw new Error(`Safe default trait ${input.safeDefaultTraitId} for ${input.category} was not found.`);
    }
    if (!isCompatible(safeDefault, input.selected)) {
      throw new Error(`Safe default trait ${input.safeDefaultTraitId} for ${input.category} is incompatible.`);
    }

    return safeDefault;
  }

  const compatibleNonRare = input.candidates.find(
    (candidate) => !candidate.rare && isCompatible(candidate, input.selected),
  );
  if (compatibleNonRare) {
    return compatibleNonRare;
  }

  throw new Error(`Could not resolve compatible fallback trait for ${input.category}.`);
}

function pickWeighted(traits: TraitEntry[], rng: () => number, lootBoost: number): TraitEntry {
  const weighted = traits.map((trait) => {
    const baseWeight = Math.max(0, trait.rarity_weight);
    if (baseWeight === 0) {
      return { trait, weight: 0 };
    }

    return {
      trait,
      weight: trait.rare ? baseWeight * (1 + lootBoost) : baseWeight,
    };
  });

  const total = weighted.reduce((sum, item) => sum + item.weight, 0);
  if (total <= 0) {
    throw new Error("Trait candidates must include at least one positive rarity weight.");
  }

  let cursor = rng() * total;
  for (const item of weighted) {
    cursor -= item.weight;
    if (cursor <= 0) {
      return item.trait;
    }
  }

  return weighted[weighted.length - 1].trait;
}

function isCompatible(candidate: TraitEntry, selected: TraitEntry[]): boolean {
  return selected.every(
    (trait) =>
      !candidate.incompatibleTraits.includes(trait.id) &&
      !trait.incompatibleTraits.includes(candidate.id),
  );
}

function seededRng(seed: string): () => number {
  let state = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    state ^= seed.charCodeAt(i);
    state = Math.imul(state, 16777619);
  }

  return () => {
    state += 0x6d2b79f5;
    let next = state;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}
