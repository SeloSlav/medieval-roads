import type { BuildingKind, BuildingState, BurgageZoneState, QuarryNodeState, ResourceStockpile } from '../resources/types.ts';
import { canAffordBuilding } from '../resources/buildingEconomy.ts';
import { getBuildingDefinition } from '../resources/buildings.ts';
import { sampleBuildingFootprintHeights } from './BuildingTerrainLayout.ts';
import { buildingOverlapsResidenceZone } from '../placement/placementConflicts.ts';

export type BuildingPlacementFailureReason =
  | 'water'
  | 'too_steep'
  | 'too_close'
  | 'within_work_radius'
  | 'within_residence_zone'
  | 'on_quarry_pit'
  | 'no_quarry_in_range'
  | 'no_trees_in_range'
  | 'insufficient_resources';

export type BuildingPlacementResult =
  | { ok: true }
  | { ok: false; reason: BuildingPlacementFailureReason };

const MAX_FOOTPRINT_HEIGHT_DELTA = 9.5;

type BuildingPlacementContext = {
  buildings: Iterable<BuildingState>;
  burgageZones: Iterable<BurgageZoneState>;
  quarries: Iterable<QuarryNodeState>;
  stockpile: ResourceStockpile;
  isWaterAt: (x: number, z: number) => boolean;
  isQuarryPitAt?: (x: number, z: number) => boolean;
  getNaturalHeightAt: (x: number, z: number) => number;
  countMatureTreesInRadius?: (x: number, z: number, radius: number) => number;
};

export function validateBuildingPlacement(
  kind: BuildingKind,
  x: number,
  z: number,
  context: BuildingPlacementContext,
): BuildingPlacementResult {
  if (context.isWaterAt(x, z)) {
    return { ok: false, reason: 'water' };
  }

  if (isFootprintTooUneven(kind, x, z, context.getNaturalHeightAt)) {
    return { ok: false, reason: 'too_steep' };
  }

  if (kind !== 'stone_quarry' && context.isQuarryPitAt?.(x, z)) {
    return { ok: false, reason: 'on_quarry_pit' };
  }

  if (buildingOverlapsResidenceZone(kind, x, z, context.burgageZones)) {
    return { ok: false, reason: 'within_residence_zone' };
  }

  if (isWithinSameKindWorkRadius(kind, x, z, context.buildings)) {
    return { ok: false, reason: 'within_work_radius' };
  }

  if (kind === 'stone_quarry' && !hasQuarryStoneInRadius(x, z, getBuildingDefinition(kind).workRadius, context.quarries)) {
    return { ok: false, reason: 'no_quarry_in_range' };
  }

  if (kind === 'lumber_mill') {
    const workRadius = getBuildingDefinition(kind).workRadius;
    const matureTrees = context.countMatureTreesInRadius?.(x, z, workRadius) ?? 0;
    if (matureTrees <= 0) {
      return { ok: false, reason: 'no_trees_in_range' };
    }
  }

  if (!canAffordBuilding(context.stockpile, kind)) {
    return { ok: false, reason: 'insufficient_resources' };
  }

  const definition = getBuildingDefinition(kind);
  const minSeparation = definition.pickRadius * 1.85;

  for (const building of context.buildings) {
    const other = getBuildingDefinition(building.kind);
    const required = Math.max(minSeparation, (definition.pickRadius + other.pickRadius) * 0.9);
    if (Math.hypot(building.x - x, building.z - z) < required) {
      return { ok: false, reason: 'too_close' };
    }
  }

  return { ok: true };
}

export function isBuildingPlacementValid(
  kind: BuildingKind,
  x: number,
  z: number,
  context: BuildingPlacementContext,
): boolean {
  return validateBuildingPlacement(kind, x, z, context).ok;
}

function isFootprintTooUneven(
  kind: BuildingKind,
  x: number,
  z: number,
  getNaturalHeightAt: (x: number, z: number) => number,
): boolean {
  const heights = sampleBuildingFootprintHeights(kind, x, z, getNaturalHeightAt);
  let minHeight = Number.POSITIVE_INFINITY;
  let maxHeight = Number.NEGATIVE_INFINITY;
  for (const height of heights) {
    minHeight = Math.min(minHeight, height);
    maxHeight = Math.max(maxHeight, height);
  }
  return maxHeight - minHeight > MAX_FOOTPRINT_HEIGHT_DELTA;
}

function isWithinSameKindWorkRadius(
  kind: BuildingKind,
  x: number,
  z: number,
  buildings: Iterable<BuildingState>,
): boolean {
  for (const building of buildings) {
    if (building.kind !== kind) continue;
    const distance = Math.hypot(building.x - x, building.z - z);
    if (distance < building.workRadius) {
      return true;
    }
  }
  return false;
}

function hasQuarryStoneInRadius(
  x: number,
  z: number,
  radius: number,
  quarries: Iterable<QuarryNodeState>,
): boolean {
  for (const quarry of quarries) {
    if (quarry.remaining <= 0) continue;
    if (Math.hypot(quarry.x - x, quarry.z - z) <= radius) {
      return true;
    }
  }
  return false;
}
