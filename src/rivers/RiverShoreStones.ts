import * as THREE from 'three';
import { TREE_SHADOW_CAST_LAYER } from '../scene/SceneLayers.ts';
import { createRockShadowGeometry } from '../props/ForestProps.ts';
import type { Terrain } from '../terrain/Terrain.ts';
import type { RiverField } from './RiverField.ts';
import { buildRiverShoreCrossingGaps, isInRiverShoreCrossingGap } from './RiverShoreCrossingGaps.ts';

type RockShadowMaterials = {
  shadowCast: THREE.MeshStandardMaterial;
  shadowDepth: THREE.MeshDepthMaterial;
};

type StonePlacement = {
  x: number;
  z: number;
  scale: number;
};

const TAU = Math.PI * 2;

export function createRiverShoreStones(
  terrain: Terrain,
  riverField: RiverField,
  material: THREE.Material,
  shadowMaterials: RockShadowMaterials,
  rng: () => number,
): { group: THREE.Group; placements: StonePlacement[] } {
  const group = new THREE.Group();
  group.name = 'River shore stones';
  const placements = createShoreStonePlacements(riverField, rng);
  if (placements.length === 0) return { group, placements };

  const variants = [createBoulderGeometry(1.3), createBoulderGeometry(7.7), createBoulderGeometry(13.2)];
  const shadowGeometry = createRockShadowGeometry();
  const buckets = variants.map(() => [] as StonePlacement[]);
  placements.forEach((placement, index) => buckets[index % buckets.length].push(placement));

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scaleVector = new THREE.Vector3();

  buckets.forEach((bucket, variantIndex) => {
    if (bucket.length === 0) return;
    const mesh = new THREE.InstancedMesh(variants[variantIndex], material, bucket.length);
    mesh.name = `River shore boulders ${variantIndex + 1}`;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    const shadowMesh = new THREE.InstancedMesh(shadowGeometry, shadowMaterials.shadowCast, bucket.length);
    shadowMesh.name = `River shore boulder shadows ${variantIndex + 1}`;
    shadowMesh.layers.set(TREE_SHADOW_CAST_LAYER);
    shadowMesh.castShadow = true;
    shadowMesh.receiveShadow = false;
    shadowMesh.customDepthMaterial = shadowMaterials.shadowDepth;
    bucket.forEach((rock, rockIndex) => {
      const y = terrain.getHeightAt(rock.x, rock.z);
      position.set(rock.x, y + rock.scale * 0.14, rock.z);
      quaternion.setFromEuler(new THREE.Euler((rng() - 0.5) * 0.22, rng() * TAU, (rng() - 0.5) * 0.22));
      scaleVector.set(
        rock.scale * (0.92 + rng() * 0.55),
        rock.scale * (0.38 + rng() * 0.24),
        rock.scale * (0.82 + rng() * 0.48),
      );
      matrix.compose(position, quaternion, scaleVector);
      mesh.setMatrixAt(rockIndex, matrix);
      shadowMesh.setMatrixAt(rockIndex, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    shadowMesh.instanceMatrix.needsUpdate = true;
    group.add(mesh, shadowMesh);
  });

  return { group, placements };
}

function createShoreStonePlacements(riverField: RiverField, rng: () => number): StonePlacement[] {
  const placements: StonePlacement[] = [];
  const crossingGaps = buildRiverShoreCrossingGaps(riverField.layout);
  const { resolution, startX, startZ, stepX, stepZ } = riverField;

  for (let gridZ = 0; gridZ < resolution; gridZ++) {
    for (let gridX = 0; gridX < resolution; gridX++) {
      const i = gridZ * resolution + gridX;
      const mask = riverField.riverMask[i];
      if (mask >= 0.48) continue;

      const shore = riverField.shoreDistance[i];
      if (shore < 0.55 || shore > 5.4) continue;

      const wx = startX + gridX * stepX;
      const wz = startZ + gridZ * stepZ;
      const jitterX = (rng() - 0.5) * stepX * 0.72;
      const jitterZ = (rng() - 0.5) * stepZ * 0.72;
      const x = wx + jitterX;
      const z = wz + jitterZ;
      if (riverField.isWaterAt(x, z)) continue;
      if (isInRiverShoreCrossingGap(riverField.layout, crossingGaps, x, z)) continue;

      const bankNoise = valueNoise2(x * 0.08 + 14.2, z * 0.08 - 6.4);
      const chance = THREE.MathUtils.clamp(0.18 + (1 - shore / 5.4) * 0.42 + bankNoise * 0.22, 0.08, 0.72);
      if (rng() > chance) continue;

      const scale = THREE.MathUtils.lerp(0.42, 1.35, Math.pow(rng(), 1.55));
      if (!hasMinimumDistance(placements, x, z, 1.8 + scale * 1.1)) continue;
      placements.push({ x, z, scale });
    }
  }

  return placements;
}

function hasMinimumDistance(points: StonePlacement[], x: number, z: number, minDistance: number): boolean {
  const minDistanceSq = minDistance * minDistance;
  for (const point of points) {
    const dx = x - point.x;
    const dz = z - point.z;
    if (dx * dx + dz * dz < minDistanceSq) return false;
  }
  return true;
}

function createBoulderGeometry(seed: number): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(1, 2);
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const uvs: number[] = [];
  const point = new THREE.Vector3();

  for (let i = 0; i < position.count; i++) {
    point.fromBufferAttribute(position, i).normalize();
    const ridge =
      0.82 + stableSurfaceNoise(point, seed) * 0.28 + Math.sin(point.x * 7.1 + point.z * 3.3 + seed) * 0.06;
    point.multiplyScalar(ridge);
    point.y *= 0.5 + stableSurfaceNoise(point, seed + 4.1) * 0.16;
    if (point.y < -0.24) point.y = THREE.MathUtils.lerp(point.y, -0.28, 0.58);
    position.setXYZ(i, point.x, point.y, point.z);
    uvs.push(Math.atan2(point.z, point.x) / TAU + 0.5, point.y * 0.42 + 0.5);
  }

  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function valueNoise2(x: number, z: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const fx = x - x0;
  const fz = z - z0;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hashGrid2(x0, z0);
  const b = hashGrid2(x0 + 1, z0);
  const c = hashGrid2(x0, z0 + 1);
  const d = hashGrid2(x0 + 1, z0 + 1);
  const x0Lerp = a + (b - a) * ux;
  const x1Lerp = c + (d - c) * ux;
  return x0Lerp + (x1Lerp - x0Lerp) * uz;
}

function hashGrid2(x: number, z: number): number {
  const value = Math.sin(x * 127.1 + z * 311.7) * 43758.5453123;
  return value - Math.floor(value);
}

function stableSurfaceNoise(point: THREE.Vector3, seed: number): number {
  const value = Math.sin(point.x * 127.1 + point.y * 311.7 + point.z * 74.7 + seed * 19.19) * 43758.5453123;
  return value - Math.floor(value);
}
