import * as THREE from 'three';
import type { Terrain } from '../terrain/Terrain.ts';
import type { RendererBackendKind } from '../scene/RendererBackend.ts';
import { mulberry32 } from '../props/forestField.ts';
import { sampleBerryPatchClumpScale } from '../vegetation/bilberryBushVisual.ts';
import {
  addSeedThreeGroundCoverInstanceAttributes,
  createSeedThreeCardClumpGeometry,
  createSeedThreeGroundCoverMaterial,
  disposeSeedThreeGroundCoverTextures,
  loadSeedThreeGroundCoverTextures,
  seedThreeGroundCoverWindVector,
} from '../vegetation/seedthree/seedThreeGroundCover.ts';
import type { ForagingSite } from './ForagingLayout.ts';
import type { ForagingNodeState } from '../resources/types.ts';
import { isForagingHarvestAvailable } from './foragingSeason.ts';

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
  sync: (nodes: Iterable<ForagingNodeState>, month: number) => void;
  dispose: () => void;
};

const TAU = Math.PI * 2;
const CLUMPS_PER_PATCH = 22;
const PATCH_RADIUS = 9.6;
const RASPBERRY_PATCH_ALBEDO_URL = '/assets/textures/vegetation/raspberry_patch_albedo.png';
const RASPBERRY_PATCH_CARD_SPEC = {
  quads: 5,
  width: 1.12,
  tiltMin: 0.08,
  tiltSpan: 0.28,
  heightMin: 1.12,
  heightSpan: 0.52,
  baseSpread: 0.14,
};

/**
 * Turns the authoritative berry resource sites into visible raspberry cane beds.
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
    albedo: RASPBERRY_PATCH_ALBEDO_URL,
  }, maxAnisotropy);
  const material = createSeedThreeGroundCoverMaterial(
    'Harvestable raspberry cane patch',
    textures,
    rendererBackend,
    [0.34, 0.46, 0.18],
    0.12,
  );
  const geometry = createSeedThreeCardClumpGeometry(RASPBERRY_PATCH_CARD_SPEC);
  const capacity = Math.max(placements.length, 1);
  const attributes = addSeedThreeGroundCoverInstanceAttributes(geometry, capacity);
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.name = 'Harvestable raspberry cane cards';
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
  const raspberryMatrices: THREE.Matrix4[] = [];

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
    raspberryMatrices.push(matrix.clone());

    const tintR = THREE.MathUtils.lerp(0.84, 1, rng());
    const tintG = THREE.MathUtils.lerp(0.86, 1, rng());
    const tintB = THREE.MathUtils.lerp(0.82, 0.96, rng());
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
  group.name = 'Harvestable raspberry resource patches';
  group.userData.berryPatchCenters = berrySites.map((site, index) => ({
    nodeId: `foraging-berries-${index}`,
    x: site.x,
    z: site.z,
  }));
  group.add(mesh);

  const hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
  const sync = (nodes: Iterable<ForagingNodeState>, month: number): void => {
    const byId = new Map(
      Array.from(nodes, (node) => [node.nodeId, node] as const),
    );
    const seasonAvailable = isForagingHarvestAvailable('berries', month);
    placements.forEach((placement, index) => {
      const node = byId.get(placement.nodeId);
      const stockRatio = node && node.maxYield > 0
        ? THREE.MathUtils.clamp(node.remaining / node.maxYield, 0, 1)
        : 0;
      const visible = seasonAvailable && hash01(index * 7.31 + 21.7) < stockRatio;
      mesh.setMatrixAt(index, visible ? raspberryMatrices[index] : hiddenMatrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  };

  return {
    group,
    placements,
    sync,
    dispose: () => {
      geometry.dispose();
      material.dispose();
      disposeSeedThreeGroundCoverTextures(textures);
    },
  };
}

function hash01(seed: number): number {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
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
      if (!hasMinimumClumpDistance(patch, x, z, 1.25 + rng() * 0.65)) continue;

      patch.push({
        nodeId,
        x,
        z,
        yaw: rng() * TAU,
        scale: sampleBerryPatchClumpScale(rng),
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
