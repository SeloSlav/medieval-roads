import * as THREE from 'three';
import type { RoadEdge } from '../roads/RoadEdge.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import { distancePointToPolylineXZ } from '../utils/pathGeometry.ts';

const STUMP_SPACING = 5.8;
const STUMP_ROAD_OFFSET = 1.15;

export type StumpPlacement = {
  x: number;
  z: number;
  scale: number;
  yaw: number;
};

export type RoadStumpInstances = {
  group: THREE.Group;
  mesh: THREE.InstancedMesh;
  placements: StumpPlacement[];
};

const STUMP_MAX_COUNT = 512;

export function createRoadStumpMesh(): THREE.InstancedMesh {
  const geometry = createStumpGeometry();
  const material = new THREE.MeshStandardMaterial({
    color: 0x6a5644,
    roughness: 0.96,
    metalness: 0,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, STUMP_MAX_COUNT);
  mesh.name = 'Road edge stumps';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.count = 0;
  return mesh;
}

export function computeRoadStumpPlacements(network: RoadNetwork): StumpPlacement[] {
  const placements: StumpPlacement[] = [];
  const edges = [...network.edges.values()];
  if (edges.length === 0) return placements;

  for (const edge of edges) {
    const path = edge.sampledPath.length >= 2 ? edge.sampledPath : edge.controlPoints;
    if (path.length < 2) continue;

    let accumulated = 0;
    let nextSample = STUMP_SPACING * 0.5;

    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i];
      const b = path[i + 1];
      const segmentLength = Math.hypot(b.x - a.x, b.z - a.z);
      if (segmentLength <= 1e-4) continue;

      const dirX = (b.x - a.x) / segmentLength;
      const dirZ = (b.z - a.z) / segmentLength;
      const normalX = -dirZ;
      const normalZ = dirX;
      const roadHalf = edge.width * 0.5;

      while (accumulated + segmentLength >= nextSample) {
        const t = (nextSample - accumulated) / segmentLength;
        const px = THREE.MathUtils.lerp(a.x, b.x, t);
        const pz = THREE.MathUtils.lerp(a.z, b.z, t);
        const side = placements.length % 2 === 0 ? 1 : -1;
        const offset = roadHalf + STUMP_ROAD_OFFSET + (placements.length % 3) * 0.35;
        const x = px + normalX * offset * side;
        const z = pz + normalZ * offset * side;

        if (!isNearExistingStump(placements, x, z, 2.4)) {
          const hash = stumpHash(x, z);
          placements.push({
            x,
            z,
            scale: 0.62 + (hash % 100) * 0.0048,
            yaw: (hash % 628) * 0.01,
          });
        }

        nextSample += STUMP_SPACING + ((placements.length * 17) % 5) * 0.22;
      }

      accumulated += segmentLength;
    }
  }

  return placements;
}

export function updateRoadStumpInstances(
  mesh: THREE.InstancedMesh,
  placements: StumpPlacement[],
  terrain: { getHeightAt: (x: number, z: number) => number },
): void {
  mesh.count = Math.min(placements.length, STUMP_MAX_COUNT);

  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scaleVector = new THREE.Vector3();

  for (let index = 0; index < mesh.count; index++) {
    const placement = placements[index];
    const y = terrain.getHeightAt(placement.x, placement.z);
    position.set(placement.x, y, placement.z);
    quaternion.setFromEuler(new THREE.Euler(0, placement.yaw, 0));
    scaleVector.set(placement.scale, placement.scale * 0.55, placement.scale);
    matrix.compose(position, quaternion, scaleVector);
    mesh.setMatrixAt(index, matrix);
  }

  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
}

function createStumpGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(0.42, 0.52, 0.38, 8, 1, false);
  geometry.translate(0, 0.19, 0);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function isNearExistingStump(placements: StumpPlacement[], x: number, z: number, minDistance: number): boolean {
  const minSq = minDistance * minDistance;
  for (const stump of placements) {
    const dx = x - stump.x;
    const dz = z - stump.z;
    if (dx * dx + dz * dz < minSq) return true;
  }
  return false;
}

function stumpHash(x: number, z: number): number {
  return Math.abs(Math.floor(Math.sin(x * 127.1 + z * 311.7) * 43758.5453));
}

export function isUndergrowthNearAnyEdge(
  x: number,
  z: number,
  edges: RoadEdge[],
  margin: number,
): boolean {
  for (const edge of edges) {
    const path = edge.sampledPath.length >= 2 ? edge.sampledPath : edge.controlPoints;
    if (path.length < 2) continue;
    const distance = distancePointToPolylineXZ(x, z, path);
    if (distance <= edge.width * 0.5 + margin) return true;
  }
  return false;
}
