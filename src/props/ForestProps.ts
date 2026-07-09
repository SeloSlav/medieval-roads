import * as THREE from 'three';
import type { Terrain } from '../terrain/Terrain.ts';
import { ForestManager, type ConiferForestInstances } from './ForestManager.ts';
import { applyTreeShadowReceiveFilter, setTreeShadowInstanceAttributes } from './treeShadowReceiveFilter.ts';
import type { RendererBackendKind } from '../scene/RendererBackend.ts';
import {
  CENTRAL_CLEARING_RADIUS,
  createForestCores,
  createForestSpawnConfig,
  distanceToNearest,
  fbm2,
  forestDensityAt,
  hasMinimumDistance,
  isInsidePlayableExtent,
  mulberry32,
  pick,
  samplePointInForestCore,
  samplePointInPlayableExtent,
  type ForestCore,
} from './forestField.ts';
import {
  buildUndergrowthInstances,
  createUndergrowthMaterials,
  createUndergrowthPlacements,
  disposeUndergrowthInstances,
} from './ForestUndergrowth.ts';

type ForestMaterialSet = {
  bark: THREE.MeshStandardMaterial;
  needles: THREE.MeshStandardMaterial[];
  rock: THREE.MeshStandardMaterial;
  shadowCast: THREE.MeshStandardMaterial;
  shadowDepth: THREE.MeshDepthMaterial;
  textures: THREE.Texture[];
};

type TreePlacement = {
  x: number;
  z: number;
  form: 'narrow' | 'broad' | 'young' | 'midstory';
  scale: number;
};

type RockPlacement = {
  x: number;
  z: number;
  scale: number;
};

type RockOutcrop = {
  x: number;
  z: number;
  radius: number;
  count: number;
  strength: number;
};

const UP = new THREE.Vector3(0, 1, 0);
const TAU = Math.PI * 2;
/** Layer used for invisible tree shadow proxies — hidden from the main camera, visible to the shadow map. */
export const TREE_SHADOW_CAST_LAYER = 1;

export type ForestPropsOptions = {
  isBlockedAt?: (x: number, z: number) => boolean;
  rendererBackend?: RendererBackendKind;
};

export function createForestProps(
  terrain: Terrain,
  maxAnisotropy: number,
  options?: ForestPropsOptions,
): ForestManager {
  const rng = mulberry32(0x5eedf0a5);
  const spawnConfig = createForestSpawnConfig(terrain.playableSize);
  const isBlockedAt = options?.isBlockedAt;
  const enableTreeShadowFilter = options?.rendererBackend !== 'webgpu';
  const materials = createForestMaterials(maxAnisotropy, enableTreeShadowFilter);
  const forest = new THREE.Group();
  forest.name = 'Road-scale forest props';
  const forestCores = createForestCores(rng, spawnConfig);
  const treePlacements = createTreePlacements(rng, forestCores, spawnConfig, isBlockedAt);
  const saplingPlacements = createSaplingPlacements(rng, forestCores, spawnConfig, treePlacements, isBlockedAt);
  const allTreePlacements = [...treePlacements, ...saplingPlacements];
  const conifer = createConiferForest(allTreePlacements, terrain, materials, rng);
  const rockPlacements = createRockPlacements(rng, forestCores, allTreePlacements, spawnConfig, isBlockedAt);
  const undergrowthPlacements = createUndergrowthPlacements(rng, forestCores, spawnConfig, isBlockedAt);
  const undergrowthMaterials = createUndergrowthMaterials(maxAnisotropy, options?.rendererBackend, materials.textures);
  const undergrowth = buildUndergrowthInstances(undergrowthPlacements, terrain, undergrowthMaterials, rng);

  forest.add(conifer.group);
  forest.add(undergrowth.group);
  forest.add(
    createRockField(
      rockPlacements,
      terrain,
      materials.rock,
      materials.shadowCast,
      materials.shadowDepth,
      rng,
    ),
  );

  return new ForestManager(
    forest,
    conifer,
    rockPlacements,
    undergrowth,
    undergrowthPlacements,
    terrain,
    () => {
      disposeForestMaterials(materials);
      disposeUndergrowthInstances(undergrowth, undergrowthMaterials);
    },
  );
}

function createTreePlacements(
  rng: () => number,
  forestCores: ForestCore[],
  spawnConfig: ReturnType<typeof createForestSpawnConfig>,
  isBlockedAt?: (x: number, z: number) => boolean,
): TreePlacement[] {
  const placements: TreePlacement[] = [];
  let attempts = 0;

  while (placements.length < spawnConfig.treeTargetCount && attempts < spawnConfig.treeTargetCount * 48) {
    attempts++;
    const core = rng() < 0.82 ? pick(forestCores, rng) : undefined;
    const sampled = core
      ? samplePointInForestCore(core, rng)
      : samplePointInPlayableExtent(rng, spawnConfig.extent);
    const { x, z } = sampled;

    if (!isInsidePlayableExtent(x, z, spawnConfig.extent)) continue;
    if (Math.hypot(x, z) < CENTRAL_CLEARING_RADIUS + rng() * 18) continue;

    const density = forestDensityAt(x, z, forestCores, spawnConfig.extent);
    if (density < 0.12 || rng() > density * 1.14) continue;

    const formNoise = valueNoise2(x * 0.025 + 37.2, z * 0.025 - 11.8);
    const broadChance = THREE.MathUtils.clamp(0.18 + density * 0.34 + (formNoise - 0.5) * 0.22, 0.1, 0.48);
    const youngChance = THREE.MathUtils.clamp(0.24 - density * 0.12, 0.08, 0.22);
    const form: TreePlacement['form'] = rng() < broadChance ? 'broad' : rng() < youngChance ? 'young' : 'narrow';
    const densitySpacing = THREE.MathUtils.lerp(1, 0.68, density);
    const minDistance =
      (form === 'broad'
        ? THREE.MathUtils.lerp(7.2, 4.8, density)
        : form === 'young'
          ? THREE.MathUtils.lerp(4.8, 3.2, density)
          : THREE.MathUtils.lerp(6.1, 3.6, density)) * densitySpacing;
    if (!hasMinimumDistance(placements, x, z, minDistance)) continue;

    const scale =
      form === 'broad'
        ? THREE.MathUtils.lerp(1.02, 1.62, Math.pow(rng(), 0.78)) * THREE.MathUtils.lerp(1.08, 0.94, density)
        : form === 'young'
          ? THREE.MathUtils.lerp(0.54, 0.92, Math.pow(rng(), 0.7))
          : THREE.MathUtils.lerp(0.82, 1.42, Math.pow(rng(), 0.7)) * THREE.MathUtils.lerp(1.04, 0.92, density);

    if (isTreePlacementBlocked(x, z, form, scale, isBlockedAt)) continue;

    placements.push({ x, z, form, scale });
  }

  return placements;
}

function createSaplingPlacements(
  rng: () => number,
  forestCores: ForestCore[],
  spawnConfig: ReturnType<typeof createForestSpawnConfig>,
  existingTrees: TreePlacement[],
  isBlockedAt?: (x: number, z: number) => boolean,
): TreePlacement[] {
  const placements: TreePlacement[] = [];
  let attempts = 0;

  while (placements.length < spawnConfig.saplingTargetCount && attempts < spawnConfig.saplingTargetCount * 42) {
    attempts++;
    const core = pick(forestCores, rng);
    const { x, z } = samplePointInForestCore(core, rng);

    if (!isInsidePlayableExtent(x, z, spawnConfig.extent)) continue;
    if (Math.hypot(x, z) < CENTRAL_CLEARING_RADIUS + 8) continue;

    const density = forestDensityAt(x, z, forestCores, spawnConfig.extent);
    if (density < 0.42 || rng() > density * 1.06) continue;

    const minDistance = THREE.MathUtils.lerp(2.8, 1.9, density);
    if (!hasMinimumDistance(placements, x, z, minDistance)) continue;
    if (distanceToNearest(existingTrees, x, z) < 2.4) continue;
    if (isTreePlacementBlocked(x, z, 'midstory', 0.8, isBlockedAt)) continue;

    placements.push({
      x,
      z,
      form: 'midstory',
      scale: THREE.MathUtils.lerp(0.72, 1.18, Math.pow(rng(), 0.82)),
    });
  }

  return placements;
}

function createForestMaterials(maxAnisotropy: number, enableTreeShadowFilter: boolean): ForestMaterialSet {
  const loader = new THREE.TextureLoader();
  const textures: THREE.Texture[] = [];
  const loadMap = (url: string, srgb = false, anisotropyLimit = 16): THREE.Texture => {
    const texture = loader.load(url);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = Math.max(1, Math.min(anisotropyLimit, maxAnisotropy));
    if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    textures.push(texture);
    return texture;
  };

  const barkMap = createPineBarkTexture(maxAnisotropy);
  const needleMap = loadMap('/assets/textures/props/pine_foliage/albedo.png', true, 4);
  const needleRoughnessMap = loadMap('/assets/textures/props/pine_foliage/roughness.png', false, 4);
  textures.push(barkMap);

  const bark = new THREE.MeshStandardMaterial({
    map: barkMap,
    color: 0x6f5844,
    roughness: 0.94,
    metalness: 0,
  });

  const rock = new THREE.MeshStandardMaterial({
    map: loadMap('/assets/textures/props/mossy_rock/albedo.png', true),
    normalMap: loadMap('/assets/textures/props/mossy_rock/normal.png'),
    roughnessMap: loadMap('/assets/textures/props/mossy_rock/roughness.png'),
    color: 0xb6b3a4,
    roughness: 0.9,
    metalness: 0,
  });
  rock.normalScale.set(0.55, 0.55);

  const needles = [
    new THREE.MeshStandardMaterial({
      map: needleMap,
      roughnessMap: needleRoughnessMap,
      color: 0xffffff,
      roughness: 0.98,
      metalness: 0,
      side: THREE.DoubleSide,
    }),
  ];
  if (enableTreeShadowFilter) applyTreeShadowReceiveFilter(needles[0]);
  if (enableTreeShadowFilter) applyTreeShadowReceiveFilter(bark);

  return {
    bark,
    rock,
    shadowCast: new THREE.MeshStandardMaterial({
      transparent: true,
      opacity: 0,
      colorWrite: false,
      depthWrite: false,
    }),
    shadowDepth: new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
    }),
    needles,
    textures,
  };
}

function createPineBarkTexture(maxAnisotropy: number): THREE.Texture {
  const width = 96;
  const height = 192;
  const data = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = x / width;
      const v = y / height;
      const fiber =
        valueNoise2(u * 12 + Math.sin(v * 28) * 0.16, v * 56) * 0.58 +
        valueNoise2(u * 34, v * 128 + 17.2) * 0.28 +
        Math.abs(Math.sin(u * 36 + valueNoise2(u * 9, v * 18) * 4.5)) * 0.14;
      const groove = smoothstep(0.5, 0.92, fiber);
      const warm = valueNoise2(u * 5.5 - 4.3, v * 12.5 + 8.7);
      const shade = 0.82 + groove * 0.18;
      const index = (y * width + x) * 4;
      data[index] = Math.round((78 + warm * 24) * shade);
      data[index + 1] = Math.round((62 + warm * 18) * shade);
      data[index + 2] = Math.round((48 + warm * 14) * shade);
      data[index + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = Math.max(1, Math.min(16, maxAnisotropy));
  texture.needsUpdate = true;
  return texture;
}

function isTreePlacementBlocked(
  x: number,
  z: number,
  form: TreePlacement['form'],
  scale: number,
  isBlockedAt?: (x: number, z: number) => boolean,
): boolean {
  if (!isBlockedAt) return false;
  if (isBlockedAt(x, z)) return true;

  const canopyRadius =
    form === 'broad' ? 3.5 * scale : form === 'young' || form === 'midstory' ? 1.9 * scale : 2.9 * scale;
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * TAU;
    if (isBlockedAt(x + Math.cos(angle) * canopyRadius, z + Math.sin(angle) * canopyRadius)) return true;
  }
  return false;
}

function createRockPlacements(
  rng: () => number,
  forestCores: ForestCore[],
  treePlacements: TreePlacement[],
  spawnConfig: ReturnType<typeof createForestSpawnConfig>,
  isBlockedAt?: (x: number, z: number) => boolean,
): RockPlacement[] {
  const placements: RockPlacement[] = [];
  const outcrops = createRockOutcrops(rng, forestCores, spawnConfig);

  for (const outcrop of outcrops) {
    let placedInOutcrop = 0;
    let attempts = 0;
    while (placedInOutcrop < outcrop.count && attempts < outcrop.count * 24) {
      attempts++;
      const angle = rng() * TAU;
      const radius = Math.pow(rng(), 0.58) * outcrop.radius;
      const stretch = 0.7 + rng() * 0.65;
      const x = outcrop.x + Math.cos(angle) * radius * stretch + (rng() - 0.5) * 3.6;
      const z = outcrop.z + Math.sin(angle) * radius * (1.2 - stretch * 0.28) + (rng() - 0.5) * 3.6;
      if (!isInsidePlayableExtent(x, z, spawnConfig.extent)) continue;
      if (isBlockedAt?.(x, z)) continue;
      if (Math.hypot(x, z) < CENTRAL_CLEARING_RADIUS * 0.62) continue;

      const forestDensity = forestDensityAt(x, z, forestCores, spawnConfig.extent);
      if (forestDensity > 0.88 && rng() < 0.55) continue;

      const scale = THREE.MathUtils.lerp(0.58, 1.9, Math.pow(rng(), 1.45)) * THREE.MathUtils.lerp(0.92, 1.22, outcrop.strength);
      if (distanceToNearest(treePlacements, x, z) < 2.7 + scale * 0.78) continue;
      if (!hasMinimumDistance(placements, x, z, 2.8 + scale * 1.35)) continue;

      placements.push({ x, z, scale });
      placedInOutcrop++;
    }
  }

  let attempts = 0;
  while (placements.length < spawnConfig.rockTargetCount && attempts < spawnConfig.rockTargetCount * 40) {
    attempts++;
    const { x, z } = samplePointInPlayableExtent(rng, spawnConfig.extent);
    if (isBlockedAt?.(x, z)) continue;
    if (Math.hypot(x, z) < CENTRAL_CLEARING_RADIUS * 0.78) continue;

    const suitability = rockSuitabilityAt(x, z, forestCores, spawnConfig.extent);
    if (suitability < 0.28 || rng() > suitability * 0.92) continue;

    const scale = THREE.MathUtils.lerp(0.5, 1.55, Math.pow(rng(), 1.6));
    if (distanceToNearest(treePlacements, x, z) < 3.2 + scale * 0.7) continue;
    if (!hasMinimumDistance(placements, x, z, 5.4 + scale * 1.2)) continue;
    placements.push({ x, z, scale });
  }

  return placements;
}

function createRockOutcrops(
  rng: () => number,
  forestCores: ForestCore[],
  spawnConfig: ReturnType<typeof createForestSpawnConfig>,
): RockOutcrop[] {
  const outcrops: RockOutcrop[] = [];
  let attempts = 0;
  const minOutcropDistance = spawnConfig.extent * 0.11;

  while (outcrops.length < spawnConfig.rockOutcropCount && attempts < spawnConfig.rockOutcropCount * 90) {
    attempts++;
    const { x, z } = samplePointInPlayableExtent(rng, spawnConfig.extent);
    if (Math.hypot(x, z) < CENTRAL_CLEARING_RADIUS + 12) continue;
    if (!hasMinimumDistance(outcrops, x, z, minOutcropDistance)) continue;

    const suitability = rockSuitabilityAt(x, z, forestCores, spawnConfig.extent);
    if (suitability < 0.32 || rng() > suitability) continue;

    outcrops.push({
      x,
      z,
      radius: THREE.MathUtils.lerp(10, 24, rng()),
      count: 5 + Math.floor(rng() * 7),
      strength: suitability,
    });
  }

  return outcrops;
}

function rockSuitabilityAt(x: number, z: number, forestCores: ForestCore[], extent: number): number {
  const forestDensity = forestDensityAt(x, z, forestCores, extent);
  const forestEdge = 1 - Math.abs(forestDensity - 0.46) / 0.46;
  const stoneNoise = fbm2(x * 0.018 + 18.5, z * 0.018 - 4.4, 4);
  const openGround = 1 - smoothstep(0.74, 1, forestDensity);
  const edgeDistance = Math.max(Math.abs(x), Math.abs(z));
  const ridgeBias = smoothstep(extent * 0.42, extent * 0.82, edgeDistance) * 0.14;
  return saturate(forestEdge * 0.38 + stoneNoise * 0.4 + openGround * 0.14 + ridgeBias);
}

function createConiferForest(
  placements: TreePlacement[],
  terrain: Terrain,
  materials: ForestMaterialSet,
  rng: () => number,
): ConiferForestInstances {
  const group = new THREE.Group();
  group.name = 'Instanced pine forest';
  if (placements.length === 0) {
    return {
      group,
      trunkMesh: new THREE.InstancedMesh(new THREE.CylinderGeometry(0.28, 1, 1, 8, 1, false), materials.bark, 0),
      foliageMesh: new THREE.InstancedMesh(createPineTierGeometry(), materials.needles[0], 0),
      shadowTierMesh: new THREE.InstancedMesh(createPineShadowTierGeometry(), materials.shadowCast, 0),
      placements,
      layerCounts: [],
      foliageStartIndex: [],
      trunkMatrices: [],
      foliageMatrices: [],
    };
  }

  const trunkGeometry = new THREE.CylinderGeometry(0.28, 1, 1, 8, 1, false);
  const tierGeometry = createPineTierGeometry();
  const shadowTierGeometry = createPineShadowTierGeometry();
  const trunkMesh = new THREE.InstancedMesh(trunkGeometry, materials.bark, placements.length);
  const layerCounts = placements.map((placement) => {
    const formLayers =
      placement.form === 'broad'
        ? 10
        : placement.form === 'young'
          ? 5
          : placement.form === 'midstory'
            ? 5
            : 8;
    return formLayers + Math.floor(rng() * 2);
  });
  const totalLayers = layerCounts.reduce((sum, count) => sum + count, 0);
  const foliageMesh = new THREE.InstancedMesh(tierGeometry, materials.needles[0], totalLayers);
  const shadowTierMesh = new THREE.InstancedMesh(shadowTierGeometry, materials.shadowCast, totalLayers);
  const foliageStartIndex: number[] = [];
  const trunkMatrices = placements.map(() => new THREE.Matrix4());
  const foliageMatrices = Array.from({ length: totalLayers }, () => new THREE.Matrix4());
  const foliageTreeRoots = new Float32Array(totalLayers * 2);
  const foliageTreeBaseYs = new Float32Array(totalLayers);
  const foliageTreeHeights = new Float32Array(totalLayers);
  const foliageCanopyRadii = new Float32Array(totalLayers);
  const trunkTreeRoots = new Float32Array(placements.length * 2);
  const trunkTreeBaseYs = new Float32Array(placements.length);
  const trunkTreeHeights = new Float32Array(placements.length);
  const trunkCanopyRadii = new Float32Array(placements.length);
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const scaleVector = new THREE.Vector3();
  const position = new THREE.Vector3();
  const color = new THREE.Color();
  let layerIndex = 0;

  trunkMesh.name = 'Instanced pine trunks';
  trunkMesh.castShadow = true;
  trunkMesh.receiveShadow = true;
  shadowTierMesh.name = 'Instanced pine shadow tiers';
  shadowTierMesh.layers.set(TREE_SHADOW_CAST_LAYER);
  shadowTierMesh.castShadow = true;
  shadowTierMesh.receiveShadow = false;
  shadowTierMesh.customDepthMaterial = materials.shadowDepth;
  foliageMesh.name = 'Instanced pine needle tiers';
  foliageMesh.castShadow = false;
  foliageMesh.receiveShadow = true;

  placements.forEach((placement, treeIndex) => {
    const rootY = terrain.getHeightAt(placement.x, placement.z);
    const isBroad = placement.form === 'broad';
    const isYoung = placement.form === 'young';
    const isMidstory = placement.form === 'midstory';
    const heightMul = isBroad ? 0.86 : isYoung ? 0.72 : isMidstory ? 0.44 : 1.08;
    const spreadMul = isBroad ? 1.48 : isYoung ? 0.74 : isMidstory ? 0.9 : 1.06;
    const trunkMul = isBroad ? 1.2 : isYoung || isMidstory ? 0.68 : 1;
    const height = isMidstory
      ? (3.6 + rng() * 2.6) * placement.scale
      : (13.5 + rng() * 5.2) * placement.scale * heightMul;
    const trunkRadius = (0.28 + rng() * 0.13) * placement.scale * trunkMul;
    const lean = new THREE.Vector3((rng() - 0.5) * 0.045, 1, (rng() - 0.5) * 0.045).normalize();
    const lowWhorl = isBroad ? 0.14 : isMidstory ? 0.18 : 0.17;
    const highWhorlSpan = isYoung || isMidstory ? 0.72 : 0.78;
    const topTierHeight =
      (2.02 * (1 - (isBroad ? 0.25 : 0.36)) + 0.18) * placement.scale * (isYoung || isMidstory ? 0.82 : 1);
    const tierApexLocal = 0.44;
    const trunkHeight = height * (lowWhorl + highWhorlSpan) + tierApexLocal * topTierHeight * 0.72;
    const trunkTop = new THREE.Vector3(placement.x, rootY, placement.z).addScaledVector(lean, trunkHeight);
    composeBranchMatrix(new THREE.Vector3(placement.x, rootY, placement.z), trunkTop, trunkRadius, matrix, quaternion, scaleVector, position);
    trunkMesh.setMatrixAt(treeIndex, matrix);
    trunkMatrices[treeIndex].copy(matrix);

    const layers = layerCounts[treeIndex];
    foliageStartIndex[treeIndex] = layerIndex;
    const yawOffset = rng() * TAU;
    let maxTierRadius = 0;

    for (let i = 0; i < layers; i++) {
      const t = layers > 1 ? i / (layers - 1) : 0;
      const whorl = lowWhorl + t * highWhorlSpan;
      const tierRadius =
        (3.35 * Math.pow(1 - t, isBroad ? 0.98 : 1.16) + (isYoung || isMidstory ? 0.36 : 0.5)) *
        placement.scale *
        spreadMul *
        (0.94 + rng() * 0.12);
      const tierHeight =
        (2.02 * (1 - t * (isBroad ? 0.25 : 0.36)) + 0.18) * placement.scale * (isYoung || isMidstory ? 0.82 : 1);
      const sway = (1 - t) * (isBroad ? 0.42 : 0.5);
      position.set(
        placement.x + lean.x * height * whorl + Math.cos(yawOffset + i * 1.74) * sway * rng(),
        rootY + height * whorl,
        placement.z + lean.z * height * whorl + Math.sin(yawOffset + i * 1.74) * sway * rng(),
      );
      quaternion.setFromEuler(new THREE.Euler((rng() - 0.5) * 0.075, yawOffset + i * 0.83, (rng() - 0.5) * 0.075));
      scaleVector.set(tierRadius, tierHeight, tierRadius * (0.9 + rng() * 0.16));
      maxTierRadius = Math.max(maxTierRadius, tierRadius);
      matrix.compose(position, quaternion, scaleVector);
      foliageMesh.setMatrixAt(layerIndex, matrix);
      shadowTierMesh.setMatrixAt(layerIndex, matrix);
      foliageMatrices[layerIndex].copy(matrix);
      color
        .set(t < 0.42 ? 0xd1dcc4 : t < 0.76 ? 0xe1e8d0 : 0xc5cfb7)
        .offsetHSL((rng() - 0.5) * 0.014, (rng() - 0.5) * 0.035, (rng() - 0.5) * 0.045);
      foliageMesh.setColorAt(layerIndex, color);
      foliageTreeRoots[layerIndex * 2] = placement.x;
      foliageTreeRoots[layerIndex * 2 + 1] = placement.z;
      foliageTreeBaseYs[layerIndex] = rootY;
      foliageTreeHeights[layerIndex] = height;
      layerIndex++;
    }

    const treeCanopyRadius = maxTierRadius * 1.06;
    trunkTreeRoots[treeIndex * 2] = placement.x;
    trunkTreeRoots[treeIndex * 2 + 1] = placement.z;
    trunkTreeBaseYs[treeIndex] = rootY;
    trunkTreeHeights[treeIndex] = height;
    trunkCanopyRadii[treeIndex] = treeCanopyRadius;
    for (let i = 0; i < layers; i++) {
      foliageCanopyRadii[foliageStartIndex[treeIndex] + i] = treeCanopyRadius;
    }
  });

  setTreeShadowInstanceAttributes(trunkGeometry, trunkTreeRoots, trunkTreeBaseYs, trunkTreeHeights, trunkCanopyRadii);
  setTreeShadowInstanceAttributes(tierGeometry, foliageTreeRoots, foliageTreeBaseYs, foliageTreeHeights, foliageCanopyRadii);

  trunkMesh.instanceMatrix.needsUpdate = true;
  shadowTierMesh.instanceMatrix.needsUpdate = true;
  foliageMesh.instanceMatrix.needsUpdate = true;
  if (foliageMesh.instanceColor) foliageMesh.instanceColor.needsUpdate = true;
  group.add(trunkMesh, shadowTierMesh, foliageMesh);
  return {
    group,
    trunkMesh,
    foliageMesh,
    shadowTierMesh,
    placements,
    layerCounts,
    foliageStartIndex,
    trunkMatrices,
    foliageMatrices,
  };
}

function composeBranchMatrix(
  start: THREE.Vector3,
  end: THREE.Vector3,
  radius: number,
  matrix: THREE.Matrix4,
  quaternion: THREE.Quaternion,
  scaleVector: THREE.Vector3,
  position: THREE.Vector3,
): void {
  const direction = end.clone().sub(start);
  const length = direction.length();
  position.copy(start).addScaledVector(direction, 0.5);
  quaternion.setFromUnitVectors(UP, direction.normalize());
  scaleVector.set(radius, length, radius);
  matrix.compose(position, quaternion, scaleVector);
}

/** Solid cone envelope aligned to unit pine needle tiers — fills gaps between star arms for coherent shadows. */
function createPineShadowTierGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(0.14, 1.0, 0.88, 12, 1, false);
  geometry.translate(0, -0.05, 0);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function createPineTierGeometry(): THREE.BufferGeometry {
  const arms = 12;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let ring = 0; ring < 2; ring++) {
    for (let i = 0; i < arms; i++) {
      const span = TAU / arms;
      const angle = (i / arms) * TAU + ring * span * 0.5;
      const direction = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
      const bend = stableSurfaceNoise(direction, 10.3 + ring) - 0.5;
      const ringScale = ring === 0 ? 1 : 0.68;
      const outerRadius = (0.9 + stableSurfaceNoise(direction, 16.8 + ring) * 0.16) * ringScale;
      const spread = ring === 0 ? 0.38 : 0.32;
      const leftAngle = angle - span * (spread + stableSurfaceNoise(direction, 22.1 + ring) * 0.08);
      const rightAngle = angle + span * (spread + stableSurfaceNoise(direction, 28.6 + ring) * 0.08);
      const midRadius = outerRadius * (0.56 + stableSurfaceNoise(direction, 32.4 + ring) * 0.06);
      const innerRadius = 0.1 + stableSurfaceNoise(direction, 37.9 + ring) * 0.04;
      const rootY = (ring === 0 ? 0.34 : 0.44) + bend * 0.05;
      const midY = (ring === 0 ? -0.05 : 0.04) - stableSurfaceNoise(direction, 42.7 + ring) * 0.07;
      const tipY = (ring === 0 ? -0.43 : -0.24) - stableSurfaceNoise(direction, 47.5 + ring) * 0.14;
      const base = positions.length / 3;

      positions.push(
        Math.cos(angle) * innerRadius,
        rootY,
        Math.sin(angle) * innerRadius,
        Math.cos(leftAngle) * midRadius,
        midY,
        Math.sin(leftAngle) * midRadius,
        Math.cos(angle + bend * 0.08) * outerRadius,
        tipY,
        Math.sin(angle + bend * 0.08) * outerRadius,
        Math.cos(rightAngle) * midRadius,
        midY,
        Math.sin(rightAngle) * midRadius,
      );
      uvs.push(0.5, 1, 0, 0.42, 0.5, 0, 1, 0.42);
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Solid dome envelope for boulder shadow proxies — stable ground silhouettes without mesh self-shadow. */
export function createRockShadowGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.SphereGeometry(1, 10, 6, 0, TAU, 0, Math.PI * 0.52);
  geometry.scale(1, 0.48, 1);
  geometry.translate(0, -0.12, 0);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function createRockField(
  placements: Array<{ x: number; z: number; scale: number }>,
  terrain: Terrain,
  material: THREE.Material,
  shadowCast: THREE.MeshStandardMaterial,
  shadowDepth: THREE.MeshDepthMaterial,
  rng: () => number,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Instanced mossy boulder field';
  const variants = [createBoulderGeometry(1.3), createBoulderGeometry(7.7), createBoulderGeometry(13.2)];
  const shadowGeometry = createRockShadowGeometry();
  const buckets = variants.map(() => [] as Array<{ x: number; z: number; scale: number }>);
  placements.forEach((placement, index) => buckets[index % buckets.length].push(placement));
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scaleVector = new THREE.Vector3();

  buckets.forEach((bucket, variantIndex) => {
    if (bucket.length === 0) return;
    const mesh = new THREE.InstancedMesh(variants[variantIndex], material, bucket.length);
    mesh.name = `Instanced mossy boulders ${variantIndex + 1}`;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    const shadowMesh = new THREE.InstancedMesh(shadowGeometry, shadowCast, bucket.length);
    shadowMesh.name = `Instanced mossy boulder shadows ${variantIndex + 1}`;
    shadowMesh.layers.set(TREE_SHADOW_CAST_LAYER);
    shadowMesh.castShadow = true;
    shadowMesh.receiveShadow = false;
    shadowMesh.customDepthMaterial = shadowDepth;
    bucket.forEach((rock, rockIndex) => {
      const y = terrain.getHeightAt(rock.x, rock.z);
      position.set(rock.x, y + rock.scale * 0.18, rock.z);
      quaternion.setFromEuler(new THREE.Euler((rng() - 0.5) * 0.18, rng() * TAU, (rng() - 0.5) * 0.18));
      scaleVector.set(
        rock.scale * (1.08 + rng() * 0.68),
        rock.scale * (0.46 + rng() * 0.28),
        rock.scale * (0.9 + rng() * 0.55),
      );
      matrix.compose(position, quaternion, scaleVector);
      mesh.setMatrixAt(rockIndex, matrix);
      shadowMesh.setMatrixAt(rockIndex, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    shadowMesh.instanceMatrix.needsUpdate = true;
    group.add(mesh, shadowMesh);
  });

  return group;
}

function createBoulderGeometry(seed: number): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(1, 2);
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const uvs: number[] = [];
  const point = new THREE.Vector3();

  for (let i = 0; i < position.count; i++) {
    point.fromBufferAttribute(position, i).normalize();
    const ridge =
      0.82 +
      stableSurfaceNoise(point, seed) * 0.28 +
      Math.sin(point.x * 7.1 + point.z * 3.3 + seed) * 0.06;
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
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const sx = noiseFade(fx);
  const sz = noiseFade(fz);
  const a = hashGrid2(ix, iz);
  const b = hashGrid2(ix + 1, iz);
  const c = hashGrid2(ix, iz + 1);
  const d = hashGrid2(ix + 1, iz + 1);
  const x0 = THREE.MathUtils.lerp(a, b, sx);
  const x1 = THREE.MathUtils.lerp(c, d, sx);
  return THREE.MathUtils.lerp(x0, x1, sz);
}

function hashGrid2(x: number, z: number): number {
  const value = Math.sin(x * 127.1 + z * 311.7) * 43758.5453123;
  return value - Math.floor(value);
}

function noiseFade(value: number): number {
  return value * value * value * (value * (value * 6 - 15) + 10);
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = saturate((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function saturate(value: number): number {
  return THREE.MathUtils.clamp(value, 0, 1);
}

function stableSurfaceNoise(point: THREE.Vector3, seed: number): number {
  const value = Math.sin(point.x * 127.1 + point.y * 311.7 + point.z * 74.7 + seed * 19.19) * 43758.5453123;
  return value - Math.floor(value);
}

function disposeForestMaterials(materials: ForestMaterialSet): void {
  materials.bark.dispose();
  materials.rock.dispose();
  materials.shadowCast.dispose();
  materials.shadowDepth.dispose();
  materials.needles.forEach((material) => material.dispose());
  materials.textures.forEach((texture) => texture.dispose());
}
