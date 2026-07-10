import type { PathBoundsXZ, RockObstacle } from './pathGeometry.ts';
import { isRockNearPath } from './pathGeometry.ts';
import type * as THREE from 'three';

const CELL_SIZE = 18;

export class RockSpatialIndex {
  private readonly cells = new Map<number, RockObstacle[]>();

  constructor(rocks: readonly RockObstacle[]) {
    for (const rock of rocks) {
      const key = cellKey(rock.x, rock.z);
      const bucket = this.cells.get(key);
      if (bucket) bucket.push(rock);
      else this.cells.set(key, [rock]);
    }
  }

  findRockBlockNearPath(
    path: THREE.Vector3[],
    bounds: PathBoundsXZ,
    roadHalfWidth: number,
  ): boolean {
    for (const rock of this.queryBounds(bounds)) {
      if (isRockNearPath(rock, path, roadHalfWidth)) return true;
    }
    return false;
  }

  private queryBounds(bounds: PathBoundsXZ): RockObstacle[] {
    const minCellX = Math.floor(bounds.minX / CELL_SIZE);
    const maxCellX = Math.floor(bounds.maxX / CELL_SIZE);
    const minCellZ = Math.floor(bounds.minZ / CELL_SIZE);
    const maxCellZ = Math.floor(bounds.maxZ / CELL_SIZE);
    const results: RockObstacle[] = [];
    for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
      for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ++) {
        const bucket = this.cells.get(packCell(cellX, cellZ));
        if (bucket) results.push(...bucket);
      }
    }
    return results;
  }
}

function cellKey(x: number, z: number): number {
  return packCell(Math.floor(x / CELL_SIZE), Math.floor(z / CELL_SIZE));
}

function packCell(cellX: number, cellZ: number): number {
  return ((cellX + 32768) & 0xffff) | (((cellZ + 32768) & 0xffff) << 16);
}
