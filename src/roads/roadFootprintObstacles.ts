import { getBuildingPadParams } from '../buildings/BuildingTerrainLayout.ts';
import { buildingPlacementYaw } from '../buildings/buildingPlacement.ts';
import { MAIN_HOUSE_DEPTH, MAIN_HOUSE_WIDTH } from '../residences/burgageLayout.ts';
import type { GameState } from '../resources/types.ts';
import type { PathBoundsXZ } from '../utils/pathGeometry.ts';
import {
  type Point2,
  cross2,
  distancePointToSegment2,
  isPointInPolygon2,
  midpoint2,
  orientedRectCorners2,
  perpendicularLeft2,
  polygonCentroid2,
  segmentsIntersectProperly2,
  subtract2,
} from '../utils/polygonGeometry.ts';

const BUILDING_CLEARANCE_MARGIN = 0.85;
const OBSTACLE_CELL_SIZE = 36;

export type RoadFootprintObstacle = {
  corners: Point2[];
};

export function collectRoadFootprintObstacles(
  state: GameState | undefined,
  roadHalfWidth: number,
): RoadFootprintObstacle[] {
  if (!state) return [];
  return collectRoadFootprintObstaclesInBounds(state, roadHalfWidth, unboundedBounds());
}

export function collectRoadFootprintObstaclesInBounds(
  state: GameState,
  roadHalfWidth: number,
  bounds: PathBoundsXZ,
): RoadFootprintObstacle[] {
  const pad = roadHalfWidth + BUILDING_CLEARANCE_MARGIN;
  const obstacles: RoadFootprintObstacle[] = [];

  for (const building of state.buildings.values()) {
    if (!pointInBounds(building.x, building.z, bounds)) continue;
    const params = getBuildingPadParams(building.kind);
    obstacles.push({
      corners: orientedRectCorners2(
        { x: building.x, z: building.z },
        buildingPlacementYaw(building.x, building.z),
        params.radiusX + pad,
        params.radiusZ + pad,
      ),
    });
  }

  for (const residence of state.residences.values()) {
    if (!pointInBounds(residence.x, residence.z, bounds)) continue;
    obstacles.push({
      corners: orientedRectCorners2(
        { x: residence.x, z: residence.z },
        residence.yaw,
        MAIN_HOUSE_WIDTH * 0.5 + pad,
        MAIN_HOUSE_DEPTH * 0.5 + pad,
      ),
    });
  }

  return obstacles;
}

function unboundedBounds(): PathBoundsXZ {
  return { minX: -Infinity, maxX: Infinity, minZ: -Infinity, maxZ: Infinity };
}

function pointInBounds(x: number, z: number, bounds: PathBoundsXZ): boolean {
  return x >= bounds.minX && x <= bounds.maxX && z >= bounds.minZ && z <= bounds.maxZ;
}

export class RoadFootprintObstacleIndex {
  private readonly cells = new Map<number, RoadFootprintObstacle[]>();

  constructor(obstacles: readonly RoadFootprintObstacle[]) {
    for (const obstacle of obstacles) {
      const bounds = polygonBounds(obstacle.corners);
      const minCellX = Math.floor(bounds.minX / OBSTACLE_CELL_SIZE);
      const maxCellX = Math.floor(bounds.maxX / OBSTACLE_CELL_SIZE);
      const minCellZ = Math.floor(bounds.minZ / OBSTACLE_CELL_SIZE);
      const maxCellZ = Math.floor(bounds.maxZ / OBSTACLE_CELL_SIZE);
      for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
        for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ++) {
          const key = packObstacleCell(cellX, cellZ);
          const bucket = this.cells.get(key);
          if (bucket) bucket.push(obstacle);
          else this.cells.set(key, [obstacle]);
        }
      }
    }
  }

  querySegment(start: Point2, end: Point2, padding: number): RoadFootprintObstacle[] {
    const minX = Math.min(start.x, end.x) - padding;
    const maxX = Math.max(start.x, end.x) + padding;
    const minZ = Math.min(start.z, end.z) - padding;
    const maxZ = Math.max(start.z, end.z) + padding;
    const minCellX = Math.floor(minX / OBSTACLE_CELL_SIZE);
    const maxCellX = Math.floor(maxX / OBSTACLE_CELL_SIZE);
    const minCellZ = Math.floor(minZ / OBSTACLE_CELL_SIZE);
    const maxCellZ = Math.floor(maxZ / OBSTACLE_CELL_SIZE);
    const seen = new Set<RoadFootprintObstacle>();
    const results: RoadFootprintObstacle[] = [];
    for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
      for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ++) {
        const bucket = this.cells.get(packObstacleCell(cellX, cellZ));
        if (!bucket) continue;
        for (const obstacle of bucket) {
          if (seen.has(obstacle)) continue;
          seen.add(obstacle);
          results.push(obstacle);
        }
      }
    }
    return results;
  }
}

export function computeAutoSegmentCurve(
  start: Point2,
  end: Point2,
  obstacles: readonly RoadFootprintObstacle[],
  maxCurve: number,
): number {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const length = Math.hypot(dx, dz);
  if (length < 1.5) return 0;

  const segmentDir = { x: dx / length, z: dz / length };
  const leftNormal = perpendicularLeft2(segmentDir);
  const segmentMid = midpoint2(start, end);

  let bestSign = 0;
  let bestMagnitude = 0;

  for (const obstacle of obstacles) {
    if (!segmentConflictsWithObstacle(start, end, obstacle.corners)) continue;

    const centroid = polygonCentroid2(obstacle.corners);
    const cross = cross2(start, end, centroid);
    const sign = cross >= 0 ? -1 : 1;
    const magnitude = estimateCurveMagnitude(
      start,
      end,
      obstacle.corners,
      segmentMid,
      leftNormal,
      length,
      maxCurve,
    );
    if (magnitude > bestMagnitude) {
      bestMagnitude = magnitude;
      bestSign = sign;
    }
  }

  if (bestMagnitude <= 0 || bestSign === 0) return 0;
  return bestSign * bestMagnitude;
}

function segmentConflictsWithObstacle(start: Point2, end: Point2, corners: Point2[]): boolean {
  if (isPointInPolygon2(midpoint2(start, end), corners)) return true;
  if (isPointInPolygon2(start, corners) || isPointInPolygon2(end, corners)) return true;

  for (const corner of corners) {
    if (distancePointToSegment2(corner, start, end) <= 0.2) return true;
  }

  for (let i = 0; i < corners.length; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % corners.length];
    if (segmentsIntersectProperly2(start, end, a, b, 0.02)) return true;
  }

  for (const corner of corners) {
    const dist = distancePointToSegment2(corner, start, end);
    if (dist > 1.25) continue;
    const t = segmentProjectionT(corner, start, end);
    if (t >= -0.04 && t <= 1.04) return true;
  }

  return false;
}

function estimateCurveMagnitude(
  start: Point2,
  end: Point2,
  corners: Point2[],
  segmentMid: Point2,
  leftNormal: Point2,
  segmentLength: number,
  maxCurve: number,
): number {
  let required = 2.4;

  for (const corner of corners) {
    const gap = Math.max(0, 1.1 - distancePointToSegment2(corner, start, end));
    const rel = subtract2(corner, segmentMid);
    const lateral = Math.abs(rel.x * leftNormal.x + rel.z * leftNormal.z);
    required = Math.max(required, gap * 1.35 + lateral * 0.72);
  }

  const spanAlongNormal = maxProjectionSpan(corners, leftNormal);
  required = Math.max(required, spanAlongNormal * 0.58 + segmentLength * 0.08);
  return Math.min(maxCurve, required);
}

function maxProjectionSpan(points: Point2[], axis: Point2): number {
  let min = Infinity;
  let max = -Infinity;
  for (const point of points) {
    const projection = point.x * axis.x + point.z * axis.z;
    min = Math.min(min, projection);
    max = Math.max(max, projection);
  }
  return max - min;
}

function segmentProjectionT(point: Point2, start: Point2, end: Point2): number {
  const abx = end.x - start.x;
  const abz = end.z - start.z;
  const lengthSq = abx * abx + abz * abz;
  if (lengthSq <= 1e-6) return 0;
  return ((point.x - start.x) * abx + (point.z - start.z) * abz) / lengthSq;
}

function polygonBounds(corners: Point2[]): { minX: number; maxX: number; minZ: number; maxZ: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const corner of corners) {
    if (corner.x < minX) minX = corner.x;
    if (corner.x > maxX) maxX = corner.x;
    if (corner.z < minZ) minZ = corner.z;
    if (corner.z > maxZ) maxZ = corner.z;
  }
  return { minX, maxX, minZ, maxZ };
}

function packObstacleCell(cellX: number, cellZ: number): number {
  return ((cellX + 32768) & 0xffff) | (((cellZ + 32768) & 0xffff) << 16);
}
