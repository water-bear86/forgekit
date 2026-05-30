/// <reference types="vite/client" />

import { describe, expect, it } from "vitest";
import starterManifest from "../../functions/assets/starter-traits/manifest.json";
import {
  calculateLootBoost,
  rollTraits,
  type TraitCategory,
  type TraitEntry,
  type TraitPack,
} from "../../shared/traits";

const fullCategories: TraitCategory[] = [
  "eyes",
  "nose",
  "ears",
  "mouth",
  "hat_hair",
  "shirt",
  "extras",
  "background",
  "rare_mutations",
];

const starterAssets = import.meta.glob("../../functions/assets/starter-traits/*.svg", {
  eager: true,
  import: "default",
  query: "?raw",
});

const pack: TraitPack = {
  id: "starter",
  version: 1,
  categories: ["eyes", "mouth"],
  safeDefaultTraitIds: { mouth: "mouth-cigarette" },
  traits: [
    {
      id: "eyes-dot",
      name: "Dot Eyes",
      rarity_weight: 100,
      imagePath: "eyes-dot.svg",
      category: "eyes",
      zIndex: 10,
      anchorX: 0,
      anchorY: 0,
      colorOverlayAllowed: false,
      incompatibleTraits: [],
      rare: false,
    },
    {
      id: "eyes-galaxy",
      name: "Eyeballs Made Of Galaxies",
      rarity_weight: 1,
      imagePath: "eyes-galaxy.svg",
      category: "eyes",
      zIndex: 10,
      anchorX: 0,
      anchorY: 0,
      colorOverlayAllowed: false,
      incompatibleTraits: [],
      rare: true,
    },
    {
      id: "mouth-grin",
      name: "Municipal Grin",
      rarity_weight: 100,
      imagePath: "mouth-grin.svg",
      category: "mouth",
      zIndex: 20,
      anchorX: 0,
      anchorY: 0,
      colorOverlayAllowed: false,
      incompatibleTraits: ["eyes-galaxy"],
      rare: false,
    },
    {
      id: "mouth-cigarette",
      name: "Wet Cigarette Mouth",
      rarity_weight: 1,
      imagePath: "mouth-cigarette.svg",
      category: "mouth",
      zIndex: 20,
      anchorX: 0,
      anchorY: 0,
      colorOverlayAllowed: false,
      incompatibleTraits: [],
      rare: true,
    },
  ],
};

const trait = (entry: TraitEntry): TraitEntry => entry;

describe("trait engine", () => {
  it("calculates a capped logarithmic loot boost", () => {
    expect(calculateLootBoost(0, { maxBoost: 0.8, boostCurve: 0.22 })).toBe(0);
    expect(calculateLootBoost(100, { maxBoost: 0.8, boostCurve: 0.22 })).toBeCloseTo(0.4409, 3);
    expect(calculateLootBoost(1_000_000, { maxBoost: 0.8, boostCurve: 0.22 })).toBe(0.8);
  });

  it("rolls deterministically from the same seed", () => {
    const a = rollTraits({ pack, seed: "wallet:sig:1", lootBoost: 0.2 });
    const b = rollTraits({ pack, seed: "wallet:sig:1", lootBoost: 0.2 });
    expect(a.traits.map((trait) => trait.id)).toEqual(b.traits.map((trait) => trait.id));
    expect(a.rarityScore).toBe(b.rarityScore);
  });

  it("does not return incompatible trait combinations", () => {
    for (let i = 0; i < 40; i += 1) {
      const roll = rollTraits({ pack, seed: `seed-${i}`, lootBoost: 0.8 });
      const ids = roll.traits.map((trait) => trait.id);
      expect(ids.includes("eyes-galaxy") && ids.includes("mouth-grin")).toBe(false);
    }
  });

  it("falls back to a configured safe default after bounded incompatible rerolls", () => {
    const fallbackPack: TraitPack = {
      id: "fallback",
      version: 1,
      categories: ["eyes", "mouth"],
      safeDefaultTraitIds: { mouth: "mouth-safe" },
      traits: [
        trait({
          id: "eyes-curse",
          name: "Curse Eyes",
          rarity_weight: 1,
          imagePath: "eyes-curse.svg",
          category: "eyes",
          zIndex: 10,
          anchorX: 0,
          anchorY: 0,
          colorOverlayAllowed: false,
          incompatibleTraits: [],
          rare: true,
        }),
        trait({
          id: "mouth-cursed",
          name: "Cursed Mouth",
          rarity_weight: 10_000,
          imagePath: "mouth-cursed.svg",
          category: "mouth",
          zIndex: 20,
          anchorX: 0,
          anchorY: 0,
          colorOverlayAllowed: false,
          incompatibleTraits: ["eyes-curse"],
          rare: false,
        }),
        trait({
          id: "mouth-safe",
          name: "Safe Mouth",
          rarity_weight: 0,
          imagePath: "mouth-safe.svg",
          category: "mouth",
          zIndex: 20,
          anchorX: 0,
          anchorY: 0,
          colorOverlayAllowed: false,
          incompatibleTraits: [],
          rare: false,
        }),
      ],
    };

    const roll = rollTraits({ pack: fallbackPack, seed: "bounded-fallback", lootBoost: 0 });

    expect(roll.traits.map((rolledTrait) => rolledTrait.id)).toEqual(["eyes-curse", "mouth-safe"]);
  });

  it("throws a clear error when the configured safe default is incompatible", () => {
    const fallbackPack: TraitPack = {
      id: "bad-fallback",
      version: 1,
      categories: ["eyes", "mouth"],
      safeDefaultTraitIds: { mouth: "mouth-safe" },
      traits: [
        trait({
          id: "eyes-curse",
          name: "Curse Eyes",
          rarity_weight: 1,
          imagePath: "eyes-curse.svg",
          category: "eyes",
          zIndex: 10,
          anchorX: 0,
          anchorY: 0,
          colorOverlayAllowed: false,
          incompatibleTraits: [],
          rare: true,
        }),
        trait({
          id: "mouth-cursed",
          name: "Cursed Mouth",
          rarity_weight: 10_000,
          imagePath: "mouth-cursed.svg",
          category: "mouth",
          zIndex: 20,
          anchorX: 0,
          anchorY: 0,
          colorOverlayAllowed: false,
          incompatibleTraits: ["eyes-curse"],
          rare: false,
        }),
        trait({
          id: "mouth-safe",
          name: "Unsafe Default Mouth",
          rarity_weight: 1,
          imagePath: "mouth-safe.svg",
          category: "mouth",
          zIndex: 20,
          anchorX: 0,
          anchorY: 0,
          colorOverlayAllowed: false,
          incompatibleTraits: ["eyes-curse"],
          rare: false,
        }),
      ],
    };

    expect(() => rollTraits({ pack: fallbackPack, seed: "bad-safe-default", lootBoost: 0 })).toThrow(
      /Safe default trait mouth-safe for mouth is incompatible/,
    );
  });

  it("rejects invalid or out-of-policy loot boosts", () => {
    for (const lootBoost of [Number.NaN, Infinity, -0.01, 1.01]) {
      expect(() => rollTraits({ pack, seed: `loot-${lootBoost}`, lootBoost })).toThrow(
        /lootBoost must be a finite number between 0 and 1/,
      );
    }
  });

  it("scores rare traits with a flat rarity bonus regardless of weight", () => {
    const rareWeightedPack: TraitPack = {
      id: "rare-weighted",
      version: 1,
      categories: ["eyes"],
      traits: [
        {
          id: "eyes-radioactive",
          name: "Radioactive Eyes",
          rarity_weight: 25,
          imagePath: "eyes-radioactive.svg",
          category: "eyes",
          zIndex: 10,
          anchorX: 0,
          anchorY: 0,
          colorOverlayAllowed: false,
          incompatibleTraits: [],
          rare: true,
        },
      ],
    };

    expect(rollTraits({ pack: rareWeightedPack, seed: "rare-weighted", lootBoost: 0 }).rarityScore).toBe(
      1000,
    );
  });

  it("makes rare traits more likely while keeping common traits possible", () => {
    const countRareSelections = (lootBoost: number) =>
      Array.from({ length: 400 }, (_, i) => rollTraits({ pack, seed: `boost-${i}`, lootBoost }))
        .flatMap((roll) => roll.traits)
        .filter((trait) => trait.rare).length;

    const lowBoostRareCount = countRareSelections(0);
    const highBoostRareCount = countRareSelections(0.8);
    const highBoostCommonCount = 800 - highBoostRareCount;

    expect(highBoostRareCount).toBeGreaterThan(lowBoostRareCount);
    expect(highBoostCommonCount).toBeGreaterThan(0);
  });

  it("ships a complete starter manifest with real compositor assets", () => {
    const manifest = starterManifest as TraitPack & { baseImagePath?: string };
    const ids = new Set<string>();

    expect(manifest.id).toBe("starter");
    expect(manifest.categories).toEqual(fullCategories);
    expect(manifest.baseImagePath).toBe("base-head.svg");
    expect(starterAssets[`../../functions/assets/starter-traits/${manifest.baseImagePath}`]).toBeDefined();
    expect(Object.keys(manifest.safeDefaultTraitIds ?? {}).sort()).toEqual(fullCategories.slice().sort());

    for (const category of fullCategories) {
      expect(manifest.traits.some((trait) => trait.category === category)).toBe(true);
      expect(manifest.traits.some((trait) => trait.category === category && trait.rare)).toBe(true);
      expect(
        manifest.traits.some(
          (trait) =>
            trait.id === manifest.safeDefaultTraitIds?.[category] &&
            trait.category === category &&
            !trait.rare,
        ),
      ).toBe(true);
    }

    for (const trait of manifest.traits as TraitEntry[]) {
      expect(trait.id).toEqual(expect.any(String));
      expect(trait.name).toEqual(expect.any(String));
      expect(trait.rarity_weight).toEqual(expect.any(Number));
      expect(trait.rarity_weight).toBeGreaterThan(0);
      expect(trait.imagePath).toEqual(expect.any(String));
      expect(fullCategories).toContain(trait.category);
      expect(trait.zIndex).toEqual(expect.any(Number));
      expect(trait.anchorX).toEqual(expect.any(Number));
      expect(trait.anchorY).toEqual(expect.any(Number));
      expect(trait.colorOverlayAllowed).toEqual(expect.any(Boolean));
      expect(Array.isArray(trait.incompatibleTraits)).toBe(true);
      expect(trait.rare).toEqual(expect.any(Boolean));
      expect(ids.has(trait.id)).toBe(false);
      expect(starterAssets[`../../functions/assets/starter-traits/${trait.imagePath}`]).toBeDefined();
      ids.add(trait.id);
    }
  });
});
