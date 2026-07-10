import type { GameState } from '../resources/types.ts';
import { burgageZonePolygon, buildingFootprintPolygonFromState } from './placementConflicts.ts';
import { convexPolygonsOverlap2, type Point2 } from '../utils/polygonGeometry.ts';

const CELL_SIZE = 48;

type FootprintKind = 'zone' | 'building';

type IndexedFootprint = {
  kind: FootprintKind;
  polygon: Point2[];
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

export class PlacementSpatialIndex {
  private readonly cells = new Map<number, IndexedFootprint[]>();

  static fromGameState(state: GameState): PlacementSpatialIndex {
    const index = new PlacementSpatialIndex();
    for (const zone of state.burgageZones.values()) {
      index.insert('zone', burgageZonePolygon(zone));
    }
    for (const building of state.buildings.values()) {
      index.insert('building', buildingFootprintPolygonFromState(building));
    }
    return index;
  }

  zoneOverlaps(candidate: Point2[]): boolean {
    return this.overlapsKind(candidate, 'zone');
  }

  buildingOverlaps(candidate: Point2[]): boolean {
    return this.overlapsKind(candidate, 'building');
  }

  private overlapsKind(candidate: Point2[], kind: FootprintKind): boolean {
    const bounds = polygonBounds(candidate);
    for (const footprint of this.queryBounds(bounds)) {
      if (footprint.kind !== kind) continue;
      if (convexPolygonsOverlap2(candidate, footprint.polygon)) return true;
    }
    return false;
  }

  private insert(kind: FootprintKind, polygon: Point2[]): void {
    const bounds = polygonBounds(polygon);
    const indexed: IndexedFootprint = { kind, polygon, ...bounds };
    for (const key of cellKeysForBounds(bounds)) {
      const bucket = this.cells.get(key);
      if (bucket) bucket.push(indexed);
      else this.cells.set(key, [indexed]);
    }
  }

  private queryBounds(bounds: BoundsXZ): IndexedFootprint[] {
    const results: IndexedFootprint[] = [];
    const seen = new Set<IndexedFootprint>();
    for (const key of cellKeysForBounds(bounds)) {
      const bucket = this.cells.get(key);
      if (!bucket) continue;
      for (const footprint of bucket) {
        if (seen.has(footprint)) continue;
        if (!aabbOverlap(bounds, footprint)) continue;
        seen.add(footprint);
        results.push(footprint);
      }
    }
    return results;
  }
}

const indexCache = new WeakMap<GameState, PlacementSpatialIndex>();

export function getPlacementSpatialIndex(state: GameState): PlacementSpatialIndex {
  const cached = indexCache.get(state);
  if (cached) return cached;
  const index = PlacementSpatialIndex.fromGameState(state);
  indexCache.set(state, index);
  return index;
}

type BoundsXZ = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

function polygonBounds(polygon: Point2[]): BoundsXZ {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const point of polygon) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.z < minZ) minZ = point.z;
    if (point.z > maxZ) maxZ = point.z;
  }
  return { minX, maxX, minZ, maxZ };
}

function aabbOverlap(a: BoundsXZ, b: BoundsXZ): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minZ <= b.maxZ && a.maxZ >= b.minZ;
}

function cellKeysForBounds(bounds: BoundsXZ): Iterable<number> {
  const minCellX = Math.floor(bounds.minX / CELL_SIZE);
  const maxCellX = Math.floor(bounds.maxX / CELL_SIZE);
  const minCellZ = Math.floor(bounds.minZ / CELL_SIZE);
  const maxCellZ = Math.floor(bounds.maxZ / CELL_SIZE);
  const keys: number[] = [];
  for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
    for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ++) {
      keys.push(packCell(cellX, cellZ));
    }
  }
  return keys;
}

function packCell(cellX: number, cellZ: number): number {
  return ((cellX + 32768) & 0xffff) | (((cellZ + 32768) & 0xffff) << 16);
}
