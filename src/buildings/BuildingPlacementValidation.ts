import type { BuildingKind, BuildingState } from '../resources/types.ts';
import { getBuildingDefinition } from '../resources/buildings.ts';

export type BuildingPlacementFailureReason = 'water' | 'too_steep' | 'too_close';

export type BuildingPlacementResult =
  | { ok: true }
  | { ok: false; reason: BuildingPlacementFailureReason };

const MAX_SLOPE = 0.42;
const SLOPE_SAMPLE_RADIUS = 4.5;

type BuildingPlacementContext = {
  buildings: Iterable<BuildingState>;
  isWaterAt: (x: number, z: number) => boolean;
  getHeightAt: (x: number, z: number) => number;
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

  if (isTooSteep(x, z, context.getHeightAt)) {
    return { ok: false, reason: 'too_steep' };
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

function isTooSteep(x: number, z: number, getHeightAt: (x: number, z: number) => number): boolean {
  const centerY = getHeightAt(x, z);
  const offsets = [
    [SLOPE_SAMPLE_RADIUS, 0],
    [-SLOPE_SAMPLE_RADIUS, 0],
    [0, SLOPE_SAMPLE_RADIUS],
    [0, -SLOPE_SAMPLE_RADIUS],
  ] as const;

  for (const [dx, dz] of offsets) {
    const dy = Math.abs(getHeightAt(x + dx, z + dz) - centerY);
    if (dy / SLOPE_SAMPLE_RADIUS > MAX_SLOPE) return true;
  }

  return false;
}
