import type { BuildingKind } from './types.ts';

export type BuildingResourceCost = {
  wood: number;
  stone: number;
};

/** Enough for one lumber mill + one stone quarry, plus reserve for early residences. */
export const STARTING_WOOD = 120;
export const STARTING_STONE = 140;

export const STONE_SALVAGE_FRACTION = 0.92;
export const WOOD_SALVAGE_FRACTION = 0.7;

/** Per main house in a burgage zone — cost scales with residence count at placement. */
export const RESIDENCE_WOOD_COST = 8;
export const RESIDENCE_STONE_COST = 12;

/** Planned cottage-scale residence footprint reference. */
export const ESTIMATED_COTTAGE_COST: BuildingResourceCost = {
  wood: RESIDENCE_WOOD_COST,
  stone: RESIDENCE_STONE_COST,
};

export function residenceZoneCost(residenceCount: number): BuildingResourceCost {
  return {
    wood: RESIDENCE_WOOD_COST * residenceCount,
    stone: RESIDENCE_STONE_COST * residenceCount,
  };
}

export const BUILDING_COSTS: Record<BuildingKind, BuildingResourceCost> = {
  lumber_mill: { wood: 45, stone: 15 },
  reforester: { wood: 35, stone: 10 },
  woodcutters_lodge: { wood: 40, stone: 12 },
  stone_quarry: { wood: 25, stone: 40 },
};

export function residenceZoneSalvageRefund(residenceCount: number): BuildingResourceCost {
  const cost = residenceZoneCost(residenceCount);
  return {
    wood: Math.round(cost.wood * WOOD_SALVAGE_FRACTION),
    stone: Math.round(cost.stone * STONE_SALVAGE_FRACTION),
  };
}

export function getBuildingCost(kind: BuildingKind): BuildingResourceCost {
  return BUILDING_COSTS[kind];
}

export function buildingSalvageRefund(kind: BuildingKind): BuildingResourceCost {
  const cost = getBuildingCost(kind);
  return {
    wood: Math.round(cost.wood * WOOD_SALVAGE_FRACTION),
    stone: Math.round(cost.stone * STONE_SALVAGE_FRACTION),
  };
}

export function canAffordBuilding(
  stockpile: BuildingResourceCost,
  kind: BuildingKind,
): boolean {
  const cost = getBuildingCost(kind);
  return stockpile.wood >= cost.wood && stockpile.stone >= cost.stone;
}

export function formatBuildingCost(cost: BuildingResourceCost): string {
  return `${cost.wood} wood, ${cost.stone} stone`;
}
