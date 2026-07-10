import * as THREE from 'three';

export type RockObstacle = {
  x: number;
  z: number;
  scale: number;
};

export function distancePointToPolylineXZ(x: number, z: number, path: THREE.Vector3[]): number {
  let minDistance = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    minDistance = Math.min(minDistance, distancePointToSegmentXZ(x, z, path[i], path[i + 1]));
  }
  return minDistance;
}

export function distancePointToSegmentXZ(x: number, z: number, a: THREE.Vector3, b: THREE.Vector3): number {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const lengthSq = abx * abx + abz * abz;
  const t = lengthSq <= 1e-6 ? 0 : THREE.MathUtils.clamp(((x - a.x) * abx + (z - a.z) * abz) / lengthSq, 0, 1);
  const px = a.x + abx * t;
  const pz = a.z + abz * t;
  return Math.hypot(x - px, z - pz);
}

export function isRockNearPath(
  rock: RockObstacle,
  path: THREE.Vector3[],
  roadHalfWidth: number,
  margin = 0.8,
): boolean {
  const rockRadius = rock.scale * 1.35;
  const threshold = roadHalfWidth + rockRadius + margin;
  return distancePointToPolylineXZ(rock.x, rock.z, path) <= threshold;
}

export type PathBoundsXZ = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

export function computePathBoundsXZ(path: THREE.Vector3[], padding: number): PathBoundsXZ {
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

export function isPointInsideBoundsXZ(x: number, z: number, bounds: PathBoundsXZ): boolean {
  return x >= bounds.minX && x <= bounds.maxX && z >= bounds.minZ && z <= bounds.maxZ;
}

export function downsamplePath(
  path: THREE.Vector3[],
  minSpacing: number,
  out?: THREE.Vector3[],
): THREE.Vector3[] {
  if (path.length <= 2) return path;

  if (out) {
    out.length = 0;
    out.push(path[0]);
    let last = path[0];
    for (let i = 1; i < path.length; i++) {
      const point = path[i];
      const isLast = i === path.length - 1;
      if (isLast || Math.hypot(point.x - last.x, point.z - last.z) >= minSpacing) {
        out.push(point);
        last = point;
      }
    }
    return out;
  }

  const result = [path[0]];
  let last = path[0];
  for (let i = 1; i < path.length; i++) {
    const point = path[i];
    const isLast = i === path.length - 1;
    if (isLast || Math.hypot(point.x - last.x, point.z - last.z) >= minSpacing) {
      result.push(point);
      last = point;
    }
  }
  return result;
}
