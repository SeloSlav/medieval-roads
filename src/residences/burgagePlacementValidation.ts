import * as THREE from 'three';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import type { BuildingState, BurgageZoneState } from '../resources/types.ts';
import { distancePointToPolylineXZ } from '../utils/pathGeometry.ts';
import { residenceZoneCost } from '../resources/buildingEconomy.ts';
import {
  type BurgageFrontageEdge,
  type BurgageLayoutResult,
  type BurgageZoneCorners,
  MAX_ROAD_FRONTAGE_DISTANCE,
  MAX_ZONE_DEPTH,
  MIN_PLOT_FRONTAGE,
  MIN_ZONE_DEPTH,
  autoFrontageEdge,
  cornersFromPoints,
  cornersToArray,
  getZoneEdge,
  measureZoneDepth,
  resolveBurgageLayout,
  suggestPlotCount,
} from './burgageLayout.ts';
import { convexPolygonsOverlap2, isConvexQuad2, polygonArea2 } from '../utils/polygonGeometry.ts';
import { burgageZoneOverlapsBuildings } from '../placement/placementConflicts.ts';

export type BurgagePlacementFailureReason =
  | 'water'
  | 'too_steep'
  | 'invalid_shape'
  | 'too_small'
  | 'too_deep'
  | 'no_road_frontage'
  | 'overlaps_existing'
  | 'overlaps_building'
  | 'on_quarry_pit'
  | 'insufficient_resources'
  | 'no_fit';

export type BurgagePlacementResult =
  | { ok: true; layout: BurgageLayoutResult }
  | { ok: false; reason: BurgagePlacementFailureReason };

const MAX_CORNER_HEIGHT_DELTA = 9.5;
const MIN_ZONE_AREA = MIN_PLOT_FRONTAGE * 12;

type BurgagePlacementContext = {
  corners: THREE.Vector3[];
  frontageEdge: BurgageFrontageEdge;
  plotCount: number;
  stockpile: { timber: number; stone: number };
  existingZones: Iterable<BurgageZoneState>;
  existingBuildings: Iterable<BuildingState>;
  roadNetwork: RoadNetwork;
  isWaterAt: (x: number, z: number) => boolean;
  isQuarryPitAt?: (x: number, z: number) => boolean;
  getNaturalHeightAt: (x: number, z: number) => number;
};

function zonePolygon(zone: BurgageZoneState) {
  return [zone.cornerA, zone.cornerB, zone.cornerC, zone.cornerD];
}

function overlapsExistingZone(zoneCorners: BurgageZoneCorners, existingZones: Iterable<BurgageZoneState>): boolean {
  const candidate = cornersToArray(zoneCorners);
  for (const zone of existingZones) {
    if (convexPolygonsOverlap2(candidate, zonePolygon(zone))) {
      return true;
    }
  }
  return false;
}

export function validateBurgagePlacement(context: BurgagePlacementContext): BurgagePlacementResult {
  if (context.corners.length !== 4) {
    return { ok: false, reason: 'invalid_shape' };
  }

  for (const corner of context.corners) {
    if (context.isWaterAt(corner.x, corner.z)) {
      return { ok: false, reason: 'water' };
    }
    if (context.isQuarryPitAt?.(corner.x, corner.z)) {
      return { ok: false, reason: 'on_quarry_pit' };
    }
  }

  const heights = context.corners.map((corner) => context.getNaturalHeightAt(corner.x, corner.z));
  const minHeight = Math.min(...heights);
  const maxHeight = Math.max(...heights);
  if (maxHeight - minHeight > MAX_CORNER_HEIGHT_DELTA) {
    return { ok: false, reason: 'too_steep' };
  }

  const cornerPoints = context.corners.map((corner) => ({ x: corner.x, z: corner.z }));
  const zoneCorners = cornersFromPoints(cornerPoints);
  if (!zoneCorners) return { ok: false, reason: 'invalid_shape' };

  if (!isConvexQuad2(zoneCorners.a, zoneCorners.b, zoneCorners.c, zoneCorners.d)) {
    return { ok: false, reason: 'invalid_shape' };
  }

  if (polygonArea2(cornerPoints) < MIN_ZONE_AREA) {
    return { ok: false, reason: 'too_small' };
  }

  const zoneDepth = measureZoneDepth(zoneCorners, context.frontageEdge);
  if (zoneDepth > MAX_ZONE_DEPTH + 0.05) {
    return { ok: false, reason: 'too_deep' };
  }

  const roadDistance = (edge: BurgageFrontageEdge) =>
    edgeDistanceToRoads(zoneCorners, edge, context.roadNetwork);
  if (roadDistance(context.frontageEdge) > MAX_ROAD_FRONTAGE_DISTANCE) {
    return { ok: false, reason: 'no_road_frontage' };
  }

  const layout = resolveBurgageLayout(zoneCorners, context.frontageEdge, context.plotCount);
  if (!layout || layout.residences.length === 0) {
    if (zoneDepth < MIN_ZONE_DEPTH) {
      return { ok: false, reason: 'too_small' };
    }
    return { ok: false, reason: 'no_fit' };
  }

  if (overlapsExistingZone(zoneCorners, context.existingZones)) {
    return { ok: false, reason: 'overlaps_existing' };
  }

  if (burgageZoneOverlapsBuildings(zoneCorners, context.existingBuildings)) {
    return { ok: false, reason: 'overlaps_building' };
  }

  const cost = residenceZoneCost(layout.residences.length);
  if (context.stockpile.timber < cost.timber || context.stockpile.stone < cost.stone) {
    return { ok: false, reason: 'insufficient_resources' };
  }

  return { ok: true, layout };
}

export function detectFrontageEdge(corners: BurgageZoneCorners, roadNetwork: RoadNetwork): BurgageFrontageEdge {
  return autoFrontageEdge(corners, (edge) => edgeDistanceToRoads(corners, edge, roadNetwork));
}

export function initialPlotCount(corners: BurgageZoneCorners, frontageEdge: BurgageFrontageEdge): number {
  const [start, end] = getZoneEdge(corners, frontageEdge);
  return suggestPlotCount(Math.hypot(end.x - start.x, end.z - start.z));
}

function edgeDistanceToRoads(
  corners: BurgageZoneCorners,
  edge: BurgageFrontageEdge,
  roadNetwork: RoadNetwork,
): number {
  const [start, end] = getZoneEdge(corners, edge);
  const paths = [...roadNetwork.edges.values()].map((edgeRow) => edgeRow.sampledPath);
  if (paths.length === 0) return Infinity;

  let minDistance = Infinity;
  const samples = 10;
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const x = start.x + (end.x - start.x) * t;
    const z = start.z + (end.z - start.z) * t;
    for (const path of paths) {
      minDistance = Math.min(minDistance, distancePointToPolylineXZ(x, z, path));
    }
  }
  return minDistance;
}
