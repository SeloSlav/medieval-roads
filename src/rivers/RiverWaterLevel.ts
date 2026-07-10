import type { RiverField } from './RiverField.ts';
import type { Terrain } from '../terrain/Terrain.ts';

export const RIVER_WATER_DEPTH = 1.05;
export const RIVER_CENTER_DEPTH_BOOST = 0.2;
export const RIVER_SHORE_DEPTH_LIFT = 0.06;

/** Still water surface Y at world XZ — matches RiverWaterMesh base depth formula. */
export function getStillWaterSurfaceY(terrain: Terrain, riverField: RiverField, x: number, z: number): number {
  if (!riverField.isRenderedWetAt(x, z)) {
    return terrain.getHeightAt(x, z);
  }
  const bed = terrain.getHeightAt(x, z);
  const organic = riverField.sampleOrganicSignedDistance(x, z);
  const shore = 1 - Math.min(1, Math.max(0, organic) / 6);
  const centerDepth = 1 - shore;
  const depth = RIVER_WATER_DEPTH + shore * RIVER_SHORE_DEPTH_LIFT + centerDepth * RIVER_CENTER_DEPTH_BOOST;
  return bed + depth;
}
