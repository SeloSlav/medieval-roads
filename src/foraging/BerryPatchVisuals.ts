import * as THREE from 'three';
import type { Terrain } from '../terrain/Terrain.ts';
import type { RendererBackendKind } from '../scene/RendererBackend.ts';
import { mulberry32 } from '../props/forestField.ts';
import { seedThreeLeafUrl } from '../vegetation/seedthree/seedThreeTextures.ts';
import {
  addSeedThreeGroundCoverInstanceAttributes,
  createSeedThreeCardClumpGeometry,
  createSeedThreeGroundCoverMaterial,
  disposeSeedThreeGroundCoverTextures,
  loadSeedThreeGroundCoverTextures,
  seedThreeGroundCoverWindVector,
} from '../vegetation/seedthree/seedThreeGroundCover.ts';
import type { ForagingSite } from './ForagingLayout.ts';

type BerryClumpPlacement = {
  nodeId: string;
  x: number;
  z: number;
  yaw: number;
  scale: number;
};

export type BerryPatchVisuals = {
  group: THREE.Group;
  placements: ReadonlyArray<BerryClumpPlacement>;
  dispose: () => void;
};

const TAU = Math.PI * 2;
const CLUMPS_PER_PATCH = 30;
const PATCH_RADIUS = 8.8;

/**
 * Turns the authoritative berry resource sites into visible SeedThree bilberry beds.
 * The sites remain gameplay-owned; this layer only provides their physical footprint.
 */
export async function createBerryPatchVisuals(
  terrain: Terrain,
  sites: ReadonlyArray<ForagingSite>,
  maxAnisotropy: number,
  rendererBackend: RendererBackendKind,
  seed: number,
  isBlockedAt?: (x: number, z: number) => boolean,
): Promise<BerryPatchVisuals> {
  const berrySites = sites.filter((site) => site.kind === 'berries');
  const rng = mulberry32(seed ^ 0xb3e771);
  const placements = createBerryClumpPlacements(berrySites, rng, isBlockedAt);
  const textures = await loadSeedThreeGroundCoverTextures({
    albedo: seedThreeLeafUrl('bilberry_albedo.png'),
    normal: seedThreeLeafUrl('bilberry_normal.png'),
    roughness: seedThreeLeafUrl('bilberry_roughness.png'),
    translucency: seedThreeLeafUrl('bilberry_translucency.png'),
  }, maxAnisotropy);
  const material = createSeedThreeGroundCoverMaterial(
    'SeedThree berry resource patch',
    textures,
    rendererBackend,
    [0.3, 0.44, 0.16],
    0.15,
  );
  const geometry = createSeedThreeCardClumpGeometry({
    quads: 7,
    width: 0.84,
    tiltMin: 0.12,
    tiltSpan: 0.4,
    heightMin: 0.7,
    heightSpan: 0.46,
    baseSpread: 0.12,
  });
  const capacity = Math.max(placements.length, 1);
  const attributes = addSeedThreeGroundCoverInstanceAttributes(geometry, capacity);
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.name = 'SeedThree berry resource patch cards';
  mesh.count = placements.length;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.renderOrder = 3;
  mesh.frustumCulled = false;

  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const tint = new THREE.Color();
  const wind = new THREE.Vector3();

  placements.forEach((placement, index) => {
    const y = terrain.getHeightAt(placement.x, placement.z) + 0.07;
    const leanDirection = rng() * TAU;
    const lean = THREE.MathUtils.lerp(0.035, 0.13, rng());
    position.set(placement.x, y, placement.z);
    quaternion.setFromEuler(new THREE.Euler(
      Math.cos(leanDirection) * lean,
      placement.yaw,
      Math.sin(leanDirection) * lean * 0.7,
      'YXZ',
    ));
    const width = placement.scale * THREE.MathUtils.lerp(1.15, 1.42, rng());
    const height = placement.scale * THREE.MathUtils.lerp(0.92, 1.14, rng());
    scale.set(width, height, width);
    matrix.compose(position, quaternion, scale);
    mesh.setMatrixAt(index, matrix);

    const tintR = THREE.MathUtils.lerp(0.58, 0.76, rng());
    const tintG = THREE.MathUtils.lerp(0.64, 0.84, rng());
    const tintB = THREE.MathUtils.lerp(0.56, 0.74, rng());
    attributes.tint.setXYZ(index, tintR, tintG, tintB);
    attributes.anchor.setXYZ(index, position.x, position.y, position.z);
    seedThreeGroundCoverWindVector(placement.yaw, scale, wind);
    attributes.wind.setXYZ(index, wind.x, wind.y, wind.z);
    tint.setRGB(tintR, tintG, tintB);
    mesh.setColorAt(index, tint);
  });

  mesh.instanceMatrix.needsUpdate = true;
  attributes.tint.needsUpdate = true;
  attributes.anchor.needsUpdate = true;
  attributes.wind.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  const group = new THREE.Group();
  group.name = 'SeedThree berry resource patches';
  group.userData.berryPatchCenters = berrySites.map((site, index) => ({
    nodeId: `foraging-berries-${index}`,
    x: site.x,
    z: site.z,
  }));
  group.add(mesh);

  return {
    group,
    placements,
    dispose: () => {
      geometry.dispose();
      material.dispose();
      disposeSeedThreeGroundCoverTextures(textures);
    },
  };
}

function createBerryClumpPlacements(
  sites: ReadonlyArray<ForagingSite>,
  rng: () => number,
  isBlockedAt?: (x: number, z: number) => boolean,
): BerryClumpPlacement[] {
  const placements: BerryClumpPlacement[] = [];

  sites.forEach((site, index) => {
    const nodeId = `foraging-berries-${index}`;
    const patch: BerryClumpPlacement[] = [];
    let attempts = 0;

    while (patch.length < CLUMPS_PER_PATCH && attempts < CLUMPS_PER_PATCH * 18) {
      attempts++;
      const radius = patch.length === 0 ? 0 : Math.sqrt(rng()) * PATCH_RADIUS;
      const angle = rng() * TAU;
      const x = site.x + Math.cos(angle) * radius * THREE.MathUtils.lerp(0.72, 1, rng());
      const z = site.z + Math.sin(angle) * radius * THREE.MathUtils.lerp(0.78, 1.08, rng());
      if (isBlockedAt?.(x, z)) continue;
      if (!hasMinimumClumpDistance(patch, x, z, 0.9 + rng() * 0.5)) continue;

      patch.push({
        nodeId,
        x,
        z,
        yaw: rng() * TAU,
        scale: THREE.MathUtils.lerp(0.7, 1.2, Math.pow(rng(), 0.72)),
      });
    }

    placements.push(...patch);
  });

  return placements;
}

function hasMinimumClumpDistance(
  placements: ReadonlyArray<BerryClumpPlacement>,
  x: number,
  z: number,
  minDistance: number,
): boolean {
  const minDistanceSq = minDistance * minDistance;
  return placements.every((placement) => {
    const dx = placement.x - x;
    const dz = placement.z - z;
    return dx * dx + dz * dz >= minDistanceSq;
  });
}
