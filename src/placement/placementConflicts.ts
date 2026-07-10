import type { BuildingKind, BuildingState, BurgageZoneState } from '../resources/types.ts';
import { getBuildingDefinition } from '../resources/buildings.ts';
import type { BurgageZoneCorners } from '../residences/burgageLayout.ts';
import { cornersToArray } from '../residences/burgageLayout.ts';
import {
  convexPolygonsOverlap2,
  type Point2,
  pointStrictlyInsidePolygon2,
} from '../utils/polygonGeometry.ts';

const BUILDING_FOOTPRINT_SCALE = 0.9;

export function burgageZonePolygon(zone: BurgageZoneState): Point2[] {
  return [zone.cornerA, zone.cornerB, zone.cornerC, zone.cornerD];
}

function buildingFootprintPolygon(x: number, z: number, kind: BuildingKind): Point2[] {
  const pickRadius = getBuildingDefinition(kind).pickRadius * BUILDING_FOOTPRINT_SCALE;
  return [
    { x: x - pickRadius, z: z - pickRadius },
    { x: x + pickRadius, z: z - pickRadius },
    { x: x + pickRadius, z: z + pickRadius },
    { x: x - pickRadius, z: z + pickRadius },
  ];
}

function buildingFootprintPolygonFromState(building: BuildingState): Point2[] {
  return buildingFootprintPolygon(building.x, building.z, building.kind);
}

export function buildingOverlapsResidenceZone(
  kind: BuildingKind,
  x: number,
  z: number,
  zones: Iterable<BurgageZoneState>,
): boolean {
  const footprint = buildingFootprintPolygon(x, z, kind);
  for (const zone of zones) {
    if (convexPolygonsOverlap2(footprint, burgageZonePolygon(zone))) {
      return true;
    }
  }
  return false;
}

export function burgageZoneOverlapsBuildings(
  zoneCorners: BurgageZoneCorners,
  buildings: Iterable<BuildingState>,
): boolean {
  const candidate = cornersToArray(zoneCorners);
  for (const building of buildings) {
    if (convexPolygonsOverlap2(candidate, buildingFootprintPolygonFromState(building))) {
      return true;
    }
  }
  return false;
}

export function pointInsideResidenceZone(
  x: number,
  z: number,
  zones: Iterable<BurgageZoneState>,
): boolean {
  const point = { x, z };
  for (const zone of zones) {
    if (pointStrictlyInsidePolygon2(point, burgageZonePolygon(zone))) {
      return true;
    }
  }
  return false;
}
