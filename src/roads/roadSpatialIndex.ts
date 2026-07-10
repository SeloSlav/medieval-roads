import * as THREE from 'three';
import type { RoadEdge } from './RoadEdge.ts';
import type { RoadNode } from './RoadNode.ts';
import { distancePointToPolylineXZ } from '../utils/pathGeometry.ts';

const CELL_SIZE = 24;

export type IndexedRoadEdge = {
  edgeId: string;
  path: THREE.Vector3[];
  useControlPoints: boolean;
};

type BoundsXZ = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

export class RoadSpatialIndex {
  private readonly edgeCells = new Map<number, IndexedRoadEdge[]>();
  private readonly nodeCells = new Map<number, RoadNode[]>();

  constructor(nodes: Iterable<RoadNode>, edges: Iterable<RoadEdge>) {
    for (const node of nodes) {
      this.insertNode(node);
    }
    for (const edge of edges) {
      this.insertEdge(edge);
    }
  }

  static fromNetwork(network: { getSpatialIndex(): RoadSpatialIndex }): RoadSpatialIndex {
    return network.getSpatialIndex();
  }

  isNearAnyRoad(x: number, z: number, margin: number): boolean {
    return this.nearestDistance(x, z, margin) <= margin;
  }

  nearestDistance(x: number, z: number, maxDistance = Infinity): number {
    if (this.edgeCells.size === 0 && this.nodeCells.size === 0) return Infinity;

    if (Number.isFinite(maxDistance)) {
      return this.nearestDistanceWithin(x, z, maxDistance);
    }

    let searchRadius = CELL_SIZE * 2;
    let best = Infinity;
    for (let ring = 0; ring < 8; ring++) {
      best = this.nearestDistanceWithin(x, z, searchRadius, best);
      if (best <= searchRadius * 0.85) return best;
      searchRadius *= 2;
    }
    return best;
  }

  collectSnapCandidates(x: number, z: number, maxDistance: number): {
    nodes: RoadNode[];
    edges: IndexedRoadEdge[];
  } {
    const nodeSet = new Set<RoadNode>();
    const edgeSet = new Set<IndexedRoadEdge>();

    for (const node of this.queryNodes(x, z, maxDistance)) {
      nodeSet.add(node);
    }
    for (const edge of this.queryEdges(x, z, maxDistance)) {
      edgeSet.add(edge);
    }

    return { nodes: [...nodeSet], edges: [...edgeSet] };
  }

  private nearestDistanceWithin(
    x: number,
    z: number,
    radius: number,
    best = Infinity,
  ): number {
    for (const node of this.queryNodes(x, z, radius)) {
      best = Math.min(best, Math.hypot(x - node.position.x, z - node.position.z));
    }
    for (const edge of this.queryEdges(x, z, radius)) {
      if (edge.path.length < 2) continue;
      best = Math.min(best, distancePointToPolylineXZ(x, z, edge.path));
    }
    return best;
  }

  private queryNodes(x: number, z: number, radius: number): RoadNode[] {
    const results: RoadNode[] = [];
    const seen = new Set<RoadNode>();
    for (const key of cellKeysInRadius(x, z, radius)) {
      const bucket = this.nodeCells.get(key);
      if (!bucket) continue;
      for (const node of bucket) {
        if (seen.has(node)) continue;
        seen.add(node);
        if (Math.hypot(x - node.position.x, z - node.position.z) <= radius + 1e-6) {
          results.push(node);
        }
      }
    }
    return results;
  }

  private queryEdges(x: number, z: number, radius: number): IndexedRoadEdge[] {
    const results: IndexedRoadEdge[] = [];
    const seen = new Set<IndexedRoadEdge>();
    for (const key of cellKeysInRadius(x, z, radius)) {
      const bucket = this.edgeCells.get(key);
      if (!bucket) continue;
      for (const edge of bucket) {
        if (seen.has(edge)) continue;
        seen.add(edge);
        if (isPointNearPathBounds(x, z, edge.path, radius)) {
          results.push(edge);
        }
      }
    }
    return results;
  }

  private insertNode(node: RoadNode): void {
    const key = cellKey(node.position.x, node.position.z);
    const bucket = this.nodeCells.get(key);
    if (bucket) bucket.push(node);
    else this.nodeCells.set(key, [node]);
  }

  private insertEdge(edge: RoadEdge): void {
    const useControlPoints = edge.controlPoints.length >= 2;
    const path = useControlPoints ? edge.controlPoints : edge.sampledPath;
    if (path.length < 2) return;

    const indexed: IndexedRoadEdge = {
      edgeId: edge.id,
      path,
      useControlPoints,
    };
    const bounds = computePathBounds(path, 0);
    for (const key of cellKeysForBounds(bounds)) {
      const bucket = this.edgeCells.get(key);
      if (bucket) bucket.push(indexed);
      else this.edgeCells.set(key, [indexed]);
    }
  }
}

function computePathBounds(path: THREE.Vector3[], padding: number): BoundsXZ {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const point of path) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.z < minZ) minZ = point.z;
    if (point.z > maxZ) maxZ = point.z;
  }
  return {
    minX: minX - padding,
    maxX: maxX + padding,
    minZ: minZ - padding,
    maxZ: maxZ + padding,
  };
}

function isPointNearPathBounds(x: number, z: number, path: THREE.Vector3[], padding: number): boolean {
  const bounds = computePathBounds(path, padding);
  return x >= bounds.minX && x <= bounds.maxX && z >= bounds.minZ && z <= bounds.maxZ;
}

function cellKeysInRadius(x: number, z: number, radius: number): Iterable<number> {
  const minCellX = Math.floor((x - radius) / CELL_SIZE);
  const maxCellX = Math.floor((x + radius) / CELL_SIZE);
  const minCellZ = Math.floor((z - radius) / CELL_SIZE);
  const maxCellZ = Math.floor((z + radius) / CELL_SIZE);
  const keys: number[] = [];
  for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
    for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ++) {
      keys.push(packCell(cellX, cellZ));
    }
  }
  return keys;
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

function cellKey(x: number, z: number): number {
  return packCell(Math.floor(x / CELL_SIZE), Math.floor(z / CELL_SIZE));
}

function packCell(cellX: number, cellZ: number): number {
  return ((cellX + 32768) & 0xffff) | (((cellZ + 32768) & 0xffff) << 16);
}
