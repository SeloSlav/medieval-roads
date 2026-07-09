import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { cameraPosition, distance, float, positionWorld, smoothstep, sub, vertexColor } from 'three/tsl';
import type { Terrain } from '../terrain/Terrain.ts';
import type { RoadEdge } from '../roads/RoadEdge.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import { distancePointToPolylineXZ } from '../utils/pathGeometry.ts';
import {
  CENTRAL_CLEARING_RADIUS,
  createForestCores,
  createForestSpawnConfig,
  forestDensityAt,
  isInsidePlayableExtent,
  mulberry32,
} from '../props/forestField.ts';
import { GRASS_LOD } from './GrassLodConfig.ts';

type TslNode = {
  add(value: TslNode): TslNode;
  mul(value: TslNode): TslNode;
  sub(value: TslNode): TslNode;
  rgb: TslNode;
};

export type GrassBladePlacement = {
  x: number;
  z: number;
  scale: number;
  yaw: number;
  meshIndex: number;
};

export type GrassBladeField = {
  group: THREE.Group;
  mesh: THREE.InstancedMesh;
  placements: GrassBladePlacement[];
  baseMatrices: THREE.Matrix4[];
  syncRoadClearance: (network: RoadNetwork) => void;
  dispose: () => void;
};

const GRASS_CELL = 2.55;
const ROAD_CLEAR_MARGIN = 1.05;
const TAU = Math.PI * 2;

export function createGrassBladeField(
  terrain: Terrain,
  options?: { isBlockedAt?: (x: number, z: number) => boolean },
): GrassBladeField {
  const rng = mulberry32(0x6a55b1ade);
  const spawnConfig = createForestSpawnConfig(terrain.playableSize);
  const forestCores = createForestCores(rng, spawnConfig);
  const placements = createGrassPlacements(rng, terrain, spawnConfig.extent, forestCores, options?.isBlockedAt);
  const material = createGrassBladeMaterial();
  const geometry = createGrassClusterGeometry();
  const mesh = new THREE.InstancedMesh(geometry, material, placements.length);
  mesh.name = 'Instanced grass blades';
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;

  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scaleVector = new THREE.Vector3();
  const color = new THREE.Color();
  const baseMatrices = placements.map(() => new THREE.Matrix4());
  const euler = new THREE.Euler();

  placements.forEach((placement, index) => {
    placement.meshIndex = index;
    composeGrassMatrix(placement, terrain, matrix, quaternion, position, scaleVector, euler);
    mesh.setMatrixAt(index, matrix);
    baseMatrices[index].copy(matrix);
    color.setHSL(0.29 + (rng() - 0.5) * 0.035, 0.48 + rng() * 0.16, 0.32 + rng() * 0.1);
    mesh.setColorAt(index, color);
  });

  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  const group = new THREE.Group();
  group.name = 'Grass blade field';
  group.add(mesh);

  const hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
  const removed = new Set<number>();

  return {
    group,
    mesh,
    placements,
    baseMatrices,
    syncRoadClearance(network: RoadNetwork) {
      const edges = [...network.edges.values()];
      const nextRemoved = new Set<number>();

      for (let index = 0; index < placements.length; index++) {
        const { x, z } = placements[index];
        if (isGrassNearAnyEdge(x, z, edges)) nextRemoved.add(index);
      }

      for (let index = 0; index < placements.length; index++) {
        const shouldRemove = nextRemoved.has(index);
        if (shouldRemove === removed.has(index)) continue;
        mesh.setMatrixAt(index, shouldRemove ? hiddenMatrix : baseMatrices[index]);
      }

      removed.clear();
      for (const index of nextRemoved) removed.add(index);
      mesh.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

function createGrassBladeMaterial(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial();
  material.name = 'Grass blade distance fade';
  material.side = THREE.DoubleSide;
  material.transparent = true;
  material.alphaTest = 0.38;
  material.depthWrite = true;
  material.roughness = 0.92;
  material.metalness = 0;
  material.color.set(0xffffff);

  const dist = distance(positionWorld as TslNode, cameraPosition as TslNode) as TslNode;
  const fade = sub(
    float(1) as TslNode,
    smoothstep(float(GRASS_LOD.near) as TslNode, float(GRASS_LOD.far) as TslNode, dist) as TslNode,
  ) as TslNode;
  material.opacityNode = fade;
  material.colorNode = (vertexColor() as TslNode).rgb;
  return material;
}

function createGrassPlacements(
  rng: () => number,
  terrain: Terrain,
  extent: number,
  forestCores: ReturnType<typeof createForestCores>,
  isBlockedAt?: (x: number, z: number) => boolean,
): GrassBladePlacement[] {
  const placements: GrassBladePlacement[] = [];
  const half = terrain.playableSize * 0.5;
  const cells = Math.ceil(terrain.playableSize / GRASS_CELL);

  for (let xi = 0; xi < cells; xi++) {
    for (let zi = 0; zi < cells; zi++) {
      const x = -half + (xi + rng()) * GRASS_CELL;
      const z = -half + (zi + rng()) * GRASS_CELL;

      if (!isInsidePlayableExtent(x, z, extent)) continue;
      if (Math.hypot(x, z) < CENTRAL_CLEARING_RADIUS + rng() * 8) continue;
      if (isBlockedAt?.(x, z)) continue;

      const density = forestDensityAt(x, z, forestCores, extent);
      const spawnChance = THREE.MathUtils.lerp(0.28, 0.94, density);
      if (rng() > spawnChance) continue;

      const scale = THREE.MathUtils.lerp(0.72, 1.28, Math.pow(rng(), 0.82)) * THREE.MathUtils.lerp(0.88, 1.08, density);
      placements.push({
        x,
        z,
        scale,
        yaw: rng() * TAU,
        meshIndex: -1,
      });
    }
  }

  return placements;
}

function composeGrassMatrix(
  placement: GrassBladePlacement,
  terrain: Terrain,
  matrix: THREE.Matrix4,
  quaternion: THREE.Quaternion,
  position: THREE.Vector3,
  scaleVector: THREE.Vector3,
  euler: THREE.Euler,
): void {
  position.set(placement.x, terrain.getHeightAt(placement.x, placement.z), placement.z);
  euler.set(0, placement.yaw, 0);
  quaternion.setFromEuler(euler);
  scaleVector.set(placement.scale, placement.scale, placement.scale);
  matrix.compose(position, quaternion, scaleVector);
}

function isGrassNearAnyEdge(x: number, z: number, edges: RoadEdge[]): boolean {
  for (const edge of edges) {
    const path = edge.sampledPath.length >= 2 ? edge.sampledPath : edge.controlPoints;
    if (path.length < 2) continue;
    if (distancePointToPolylineXZ(x, z, path) <= edge.width * 0.5 + ROAD_CLEAR_MARGIN) {
      return true;
    }
  }
  return false;
}

/** Three crossed blades — one instance reads as a small clump at ground level. */
function createGrassClusterGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const bladeCount = 3;
  for (let blade = 0; blade < bladeCount; blade++) {
    const yaw = (blade / bladeCount) * TAU;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const width = 0.11;
    const height = 0.62 + blade * 0.04;
    const lean = 0.08 + blade * 0.02;
    const base = positions.length / 3;

    const bottomLeft = [-width * cos, 0, -width * sin];
    const bottomRight = [width * cos, 0, width * sin];
    const topLeft = [(-width * 0.35 + lean) * cos, height, (-width * 0.35 + lean) * sin];
    const topRight = [(width * 0.35 + lean) * cos, height, (width * 0.35 + lean) * sin];

    for (const [x, y, z] of [bottomLeft, bottomRight, topRight, topLeft]) {
      positions.push(x, y, z);
      normals.push(0, 1, 0);
      uvs.push(x + 0.5, y / height);
    }

    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
