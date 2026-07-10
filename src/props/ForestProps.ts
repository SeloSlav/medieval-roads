import * as THREE from 'three';
import type { Terrain } from '../terrain/Terrain.ts';
import { ForestManager, type MixedForestInstances } from './ForestManager.ts';
import { applyTreeShadowReceiveFilter, setTreeShadowInstanceAttributes } from './treeShadowReceiveFilter.ts';
import type { RendererBackendKind } from '../scene/RendererBackend.ts';
import {
  CENTRAL_CLEARING_RADIUS,
  createForestCores,
  createForestSpawnConfig,
  distanceToNearest,
  fbm2,
  forestDensityAt,
  getEdgeHillFactor,
  hasMinimumDistance,
  isInsidePlayableExtent,
  isInsideTerrainExtent,
  mulberry32,
  pick,
  samplePointInForestCore,
  samplePointInHillEdgeBand,
  samplePointInPlayableExtent,
  type ForestCore,
  type ForestSpawnConfig,
} from './forestField.ts';
type ForestMaterialSet = {
  bark: THREE.MeshStandardMaterial;
  coniferFoliage: THREE.MeshStandardMaterial;
  broadleafFoliage: THREE.MeshStandardMaterial;
  rock: THREE.MeshStandardMaterial;
  shadowCast: THREE.MeshStandardMaterial;
  shadowDepth: THREE.MeshDepthMaterial;
  textures: THREE.Texture[];
};

type TreePlacement = {
  x: number;
  z: number;
  species: TreeSpecies;
  form: TreeForm;
  scale: number;
};

type TreeForm = 'narrow' | 'broad' | 'young' | 'midstory';
type TreeCanopyKind = 'conifer' | 'broadleaf';
type ForestZone = 'core' | 'hillEdge' | 'sapling';

type TreeSpecies =
  | 'beech'
  | 'silverFir'
  | 'norwaySpruce'
  | 'sycamoreMaple'
  | 'norwayMaple'
  | 'ash'
  | 'wychElm'
  | 'lime'
  | 'hornbeam'
  | 'sessileOak'
  | 'scotsPine'
  | 'larch';

type LocalForestHabitat = {
  density: number;
  hillFactor: number;
  dampRavine: number;
  lowerWarmth: number;
  poorerGround: number;
  plantedPatch: number;
};

type TreeSpeciesProfile = {
  canopy: TreeCanopyKind;
  barkColor: number;
  foliageColor: number;
  heightMul: number;
  spreadMul: number;
  trunkMul: number;
  lowWhorl: number;
  crownSpan: number;
  radiusPower: number;
};

type RockProfile = 'flat' | 'moderate' | 'tall';

type RockPlacement = {
  x: number;
  z: number;
  scale: number;
  profile: RockProfile;
};

type RockOutcrop = {
  x: number;
  z: number;
  radius: number;
  count: number;
  strength: number;
};

import { loadMossyRockTextures, loadPineFoliageTextures } from '../utils/propTextureLoad.ts';
import { TREE_SHADOW_CAST_LAYER } from '../scene/SceneLayers.ts';

const UP = new THREE.Vector3(0, 1, 0);
const TAU = Math.PI * 2;

export type ForestPropsOptions = {
  isBlockedAt?: (x: number, z: number) => boolean;
  rendererBackend?: RendererBackendKind;
};

export async function createForestProps(
  terrain: Terrain,
  maxAnisotropy: number,
  options?: ForestPropsOptions,
): Promise<ForestManager> {
  const rng = mulberry32(0x5eedf0a5);
  const spawnConfig = createForestSpawnConfig(terrain.playableSize, terrain.size);
  const isBlockedAt = options?.isBlockedAt;
  const enableTreeShadowFilter = options?.rendererBackend !== 'webgpu';
  const materials = await createForestMaterials(maxAnisotropy, enableTreeShadowFilter);
  const forest = new THREE.Group();
  forest.name = 'Road-scale forest props';
  const forestCores = createForestCores(rng, spawnConfig);
  const treePlacements = createTreePlacements(rng, forestCores, spawnConfig, isBlockedAt);
  const hillEdgePlacements = createHillEdgeTreePlacements(rng, spawnConfig, treePlacements, isBlockedAt);
  const saplingPlacements = createSaplingPlacements(rng, forestCores, spawnConfig, treePlacements, isBlockedAt);
  const allTreePlacements = [...treePlacements, ...hillEdgePlacements, ...saplingPlacements];
  const treeInstances = createMixedMountainForest(allTreePlacements, terrain, materials, rng);
  const rockPlacements = createRockPlacements(rng, forestCores, allTreePlacements, spawnConfig, isBlockedAt);

  forest.add(treeInstances.group);
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
    treeInstances,
    rockPlacements,
    null,
    [],
    terrain,
    () => {
      disposeForestMaterials(materials);
    },
  );
}

function createTreePlacements(
  rng: () => number,
  forestCores: ForestCore[],
  spawnConfig: ForestSpawnConfig,
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

    const density = forestDensityAt(x, z, forestCores, spawnConfig.extent, spawnConfig.terrainExtent);
    if (density < 0.12 || rng() > density * 1.14) continue;

    const habitat = sampleLocalForestHabitat(x, z, density, spawnConfig);
    const formNoise = valueNoise2(x * 0.025 + 37.2, z * 0.025 - 11.8);
    const species = pickTreeSpecies(rng, habitat, 'core');
    const form = pickTreeForm(rng, species, habitat, 'core', formNoise);
    const scale = pickTreeScale(rng, species, form, habitat);
    const minDistance = getTreePlacementSpacing(species, form, scale, habitat);
    if (!hasMinimumDistance(placements, x, z, minDistance)) continue;

    if (isTreePlacementBlocked(x, z, species, form, scale, isBlockedAt)) continue;

    placements.push({ x, z, species, form, scale });
  }

  return placements;
}

function createHillEdgeTreePlacements(
  rng: () => number,
  spawnConfig: ForestSpawnConfig,
  existingTrees: TreePlacement[],
  isBlockedAt?: (x: number, z: number) => boolean,
): TreePlacement[] {
  const placements: TreePlacement[] = [];
  let attempts = 0;

  while (placements.length < spawnConfig.hillEdgeTreeTargetCount && attempts < spawnConfig.hillEdgeTreeTargetCount * 52) {
    attempts++;
    const { x, z } = samplePointInHillEdgeBand(rng, spawnConfig.playableSize, spawnConfig.terrainSize);

    if (!isInsideTerrainExtent(x, z, spawnConfig.terrainExtent)) continue;

    const hillFactor = getEdgeHillFactor(x, z, spawnConfig.playableSize, spawnConfig.terrainSize);
    if (hillFactor < 0.06) continue;

    const density = forestDensityAt(x, z, [], spawnConfig.extent, spawnConfig.terrainExtent);
    if (rng() > 0.22 + hillFactor * 0.74) continue;

    const habitat = sampleLocalForestHabitat(x, z, THREE.MathUtils.clamp(density + hillFactor * 0.42, 0, 1), spawnConfig);
    const formNoise = valueNoise2(x * 0.025 + 37.2, z * 0.025 - 11.8);
    const species = pickTreeSpecies(rng, habitat, 'hillEdge');
    const form = pickTreeForm(rng, species, habitat, 'hillEdge', formNoise);
    const scale = pickTreeScale(rng, species, form, habitat);
    const minDistance = getTreePlacementSpacing(species, form, scale, habitat) * THREE.MathUtils.lerp(0.9, 0.62, hillFactor);
    if (!hasMinimumDistance(placements, x, z, minDistance)) continue;
    if (distanceToNearest(existingTrees, x, z) < minDistance * 0.82) continue;

    if (isTreePlacementBlocked(x, z, species, form, scale, isBlockedAt)) continue;

    placements.push({ x, z, species, form, scale });
  }

  return placements;
}

function createSaplingPlacements(
  rng: () => number,
  forestCores: ForestCore[],
  spawnConfig: ForestSpawnConfig,
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

    const density = forestDensityAt(x, z, forestCores, spawnConfig.extent, spawnConfig.terrainExtent);
    if (density < 0.42 || rng() > density * 1.06) continue;

    const minDistance = THREE.MathUtils.lerp(2.8, 1.9, density);
    if (!hasMinimumDistance(placements, x, z, minDistance)) continue;
    if (distanceToNearest(existingTrees, x, z) < 2.4) continue;
    const habitat = sampleLocalForestHabitat(x, z, density, spawnConfig);
    const species = pickTreeSpecies(rng, habitat, 'sapling');
    const form = pickTreeForm(rng, species, habitat, 'sapling', valueNoise2(x * 0.032, z * 0.032));
    const scale = pickTreeScale(rng, species, form, habitat);
    if (isTreePlacementBlocked(x, z, species, form, scale, isBlockedAt)) continue;

    placements.push({
      x,
      z,
      species,
      form,
      scale,
    });
  }

  return placements;
}

function sampleLocalForestHabitat(
  x: number,
  z: number,
  density: number,
  spawnConfig: ForestSpawnConfig,
): LocalForestHabitat {
  const hillFactor = getEdgeHillFactor(x, z, spawnConfig.playableSize, spawnConfig.terrainSize);
  const dampNoise = fbm2(x * 0.017 + 9.4, z * 0.017 - 12.8, 4);
  const warmNoise = fbm2(x * 0.007 - 41.6, z * 0.007 + 27.1, 3);
  const poorNoise = fbm2(x * 0.021 + 18.2, z * 0.021 - 5.7, 3);
  const plantedNoise = fbm2(x * 0.012 - 34.6, z * 0.012 + 2.1, 3);

  return {
    density,
    hillFactor,
    dampRavine: saturate(smoothstep(0.52, 0.84, dampNoise) * (1 - hillFactor * 0.34) + density * 0.16),
    lowerWarmth: saturate(smoothstep(0.48, 0.78, warmNoise) * (1 - hillFactor * 0.82)),
    poorerGround: saturate(smoothstep(0.56, 0.86, poorNoise) * (0.42 + hillFactor * 0.48)),
    plantedPatch: saturate(smoothstep(0.62, 0.88, plantedNoise) * (0.28 + hillFactor * 0.86)),
  };
}

function pickTreeSpecies(rng: () => number, habitat: LocalForestHabitat, zone: ForestZone): TreeSpecies {
  const weights: Array<{ species: TreeSpecies; weight: number }> = [];
  const cold = habitat.hillFactor;
  const damp = habitat.dampRavine;
  const warm = habitat.lowerWarmth;
  const poor = habitat.poorerGround;
  const planted = habitat.plantedPatch;
  const edgeLight = 1 - habitat.density;

  addSpeciesWeight(weights, 'beech', 34 + damp * 6 + warm * 7 - cold * 8);
  addSpeciesWeight(weights, 'silverFir', 30 + cold * 17 + damp * 5 + habitat.density * 4);
  addSpeciesWeight(weights, 'norwaySpruce', 10 + cold * 22 + planted * 9 + poor * 3);
  addSpeciesWeight(weights, 'sycamoreMaple', 4 + damp * 9 + warm * 2);
  addSpeciesWeight(weights, 'norwayMaple', 2.6 + warm * 5 + edgeLight * 1.6);
  addSpeciesWeight(weights, 'ash', 1.8 + damp * 7);
  addSpeciesWeight(weights, 'wychElm', 1.3 + damp * 5.2);
  addSpeciesWeight(weights, 'lime', 1.8 + warm * 4.4);
  addSpeciesWeight(weights, 'hornbeam', 0.9 + warm * 6.5 + edgeLight * 1.2);
  addSpeciesWeight(weights, 'sessileOak', 0.65 + warm * 5.4 + edgeLight * 2.2);
  addSpeciesWeight(weights, 'scotsPine', 0.8 + poor * 6.8 + edgeLight * 1.2);
  addSpeciesWeight(weights, 'larch', 0.24 + planted * 4.8 + cold * 0.8);

  if (zone === 'hillEdge') {
    multiplySpeciesWeight(weights, 'beech', 0.68);
    multiplySpeciesWeight(weights, 'silverFir', 1.18);
    multiplySpeciesWeight(weights, 'norwaySpruce', 1.5);
    multiplySpeciesWeight(weights, 'larch', 1.7);
    multiplySpeciesWeight(weights, 'sessileOak', 0.34);
    multiplySpeciesWeight(weights, 'hornbeam', 0.45);
    multiplySpeciesWeight(weights, 'lime', 0.58);
  } else if (zone === 'sapling') {
    multiplySpeciesWeight(weights, 'beech', 1.18);
    multiplySpeciesWeight(weights, 'silverFir', 1.1);
    multiplySpeciesWeight(weights, 'norwaySpruce', 0.92);
    multiplySpeciesWeight(weights, 'sycamoreMaple', 1.2);
    multiplySpeciesWeight(weights, 'hornbeam', 1.32);
    multiplySpeciesWeight(weights, 'sessileOak', 0.42);
    multiplySpeciesWeight(weights, 'scotsPine', 0.55);
    multiplySpeciesWeight(weights, 'larch', 0.38);
  }

  return pickWeightedSpecies(weights, rng);
}

function addSpeciesWeight(
  weights: Array<{ species: TreeSpecies; weight: number }>,
  species: TreeSpecies,
  weight: number,
): void {
  weights.push({ species, weight: Math.max(0.04, weight) });
}

function multiplySpeciesWeight(
  weights: Array<{ species: TreeSpecies; weight: number }>,
  species: TreeSpecies,
  multiplier: number,
): void {
  const entry = weights.find((candidate) => candidate.species === species);
  if (entry) entry.weight *= multiplier;
}

function pickWeightedSpecies(
  weights: Array<{ species: TreeSpecies; weight: number }>,
  rng: () => number,
): TreeSpecies {
  const total = weights.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = rng() * total;
  for (const entry of weights) {
    roll -= entry.weight;
    if (roll <= 0) return entry.species;
  }
  return 'beech';
}

function pickTreeForm(
  rng: () => number,
  species: TreeSpecies,
  habitat: LocalForestHabitat,
  zone: ForestZone,
  formNoise: number,
): TreeForm {
  const profile = getTreeSpeciesProfile(species);
  if (zone === 'sapling') return profile.canopy === 'conifer' ? 'young' : 'midstory';

  const youngChance = THREE.MathUtils.clamp(
    0.2 - habitat.density * 0.12 + habitat.hillFactor * 0.05 + (formNoise - 0.5) * 0.08,
    0.06,
    0.24,
  );
  if (profile.canopy === 'conifer') return rng() < youngChance ? 'young' : 'narrow';

  const subcanopyBias =
    species === 'hornbeam'
      ? 0.34
      : species === 'lime' || species === 'norwayMaple'
        ? 0.16
        : species === 'ash' || species === 'wychElm'
          ? 0.1
          : 0.04;
  const midstoryChance = THREE.MathUtils.clamp(
    subcanopyBias + habitat.density * 0.12 + habitat.dampRavine * 0.08 - habitat.lowerWarmth * 0.04,
    0.02,
    0.42,
  );
  if (rng() < youngChance * 0.48) return 'young';
  if (rng() < midstoryChance) return 'midstory';
  return 'broad';
}

function pickTreeScale(
  rng: () => number,
  species: TreeSpecies,
  form: TreeForm,
  habitat: LocalForestHabitat,
): number {
  const profile = getTreeSpeciesProfile(species);
  if (form === 'young') {
    const highSiteMul = profile.canopy === 'conifer' ? THREE.MathUtils.lerp(0.96, 1.1, habitat.hillFactor) : 1;
    return THREE.MathUtils.lerp(0.58, 0.98, Math.pow(rng(), 0.72)) * highSiteMul;
  }
  if (form === 'midstory') {
    const dampMul = THREE.MathUtils.lerp(0.92, 1.12, habitat.dampRavine);
    return THREE.MathUtils.lerp(0.78, 1.22, Math.pow(rng(), 0.82)) * dampMul;
  }

  const densityMul = THREE.MathUtils.lerp(1.08, 0.94, habitat.density);
  const highSiteMul =
    profile.canopy === 'conifer'
      ? THREE.MathUtils.lerp(0.98, 1.1, habitat.hillFactor)
      : THREE.MathUtils.lerp(1.05, 0.93, habitat.hillFactor);
  const speciesScale =
    species === 'silverFir'
      ? THREE.MathUtils.lerp(1.04, 1.82, Math.pow(rng(), 0.66))
      : species === 'norwaySpruce'
        ? THREE.MathUtils.lerp(0.94, 1.66, Math.pow(rng(), 0.7))
        : species === 'beech'
          ? THREE.MathUtils.lerp(1.0, 1.7, Math.pow(rng(), 0.72))
          : species === 'sessileOak'
            ? THREE.MathUtils.lerp(0.9, 1.5, Math.pow(rng(), 0.8))
            : species === 'scotsPine'
              ? THREE.MathUtils.lerp(0.88, 1.48, Math.pow(rng(), 0.74))
              : species === 'larch'
                ? THREE.MathUtils.lerp(0.92, 1.56, Math.pow(rng(), 0.72))
                : THREE.MathUtils.lerp(0.86, 1.48, Math.pow(rng(), 0.78));
  return speciesScale * densityMul * highSiteMul;
}

function getTreePlacementSpacing(
  species: TreeSpecies,
  form: TreeForm,
  scale: number,
  habitat: LocalForestHabitat,
): number {
  const profile = getTreeSpeciesProfile(species);
  const canopyRadius = getEstimatedCanopyRadius(species, form, scale);
  const densitySpacing = THREE.MathUtils.lerp(1.08, 0.72, habitat.density);
  const formMul = form === 'young' ? 0.86 : form === 'midstory' ? 0.78 : profile.canopy === 'broadleaf' ? 1.12 : 0.96;
  const habitatMul = THREE.MathUtils.lerp(1.04, 0.86, habitat.hillFactor);
  return Math.max(form === 'young' || form === 'midstory' ? 2.2 : 3.4, canopyRadius * densitySpacing * formMul * habitatMul);
}

function getEstimatedCanopyRadius(species: TreeSpecies, form: TreeForm, scale: number): number {
  const profile = getTreeSpeciesProfile(species);
  if (form === 'young') return 2.1 * scale * profile.spreadMul;
  if (form === 'midstory') return 2.5 * scale * profile.spreadMul;
  if (profile.canopy === 'broadleaf') return 4.2 * scale * profile.spreadMul;
  return 3.15 * scale * profile.spreadMul;
}

function getTreeSpeciesProfile(species: TreeSpecies): TreeSpeciesProfile {
  switch (species) {
    case 'beech':
      return {
        canopy: 'broadleaf',
        barkColor: 0xbbb7aa,
        foliageColor: 0x6f8f53,
        heightMul: 1.04,
        spreadMul: 1.04,
        trunkMul: 0.92,
        lowWhorl: 0.5,
        crownSpan: 0.38,
        radiusPower: 0.82,
      };
    case 'silverFir':
      return {
        canopy: 'conifer',
        barkColor: 0x77766d,
        foliageColor: 0x526b45,
        heightMul: 1.18,
        spreadMul: 1.1,
        trunkMul: 1.04,
        lowWhorl: 0.16,
        crownSpan: 0.78,
        radiusPower: 1.08,
      };
    case 'norwaySpruce':
      return {
        canopy: 'conifer',
        barkColor: 0x5c5147,
        foliageColor: 0x46583f,
        heightMul: 1.1,
        spreadMul: 0.86,
        trunkMul: 0.94,
        lowWhorl: 0.13,
        crownSpan: 0.82,
        radiusPower: 1.38,
      };
    case 'sycamoreMaple':
      return {
        canopy: 'broadleaf',
        barkColor: 0x8b8679,
        foliageColor: 0x779a5a,
        heightMul: 0.98,
        spreadMul: 1.08,
        trunkMul: 0.9,
        lowWhorl: 0.46,
        crownSpan: 0.42,
        radiusPower: 0.78,
      };
    case 'norwayMaple':
      return {
        canopy: 'broadleaf',
        barkColor: 0x756f63,
        foliageColor: 0x829c54,
        heightMul: 0.9,
        spreadMul: 1.0,
        trunkMul: 0.86,
        lowWhorl: 0.45,
        crownSpan: 0.43,
        radiusPower: 0.8,
      };
    case 'ash':
      return {
        canopy: 'broadleaf',
        barkColor: 0x8f897d,
        foliageColor: 0x6d8b5c,
        heightMul: 1.02,
        spreadMul: 0.92,
        trunkMul: 0.82,
        lowWhorl: 0.55,
        crownSpan: 0.34,
        radiusPower: 0.9,
      };
    case 'wychElm':
      return {
        canopy: 'broadleaf',
        barkColor: 0x675d51,
        foliageColor: 0x5f8053,
        heightMul: 0.94,
        spreadMul: 0.98,
        trunkMul: 0.9,
        lowWhorl: 0.48,
        crownSpan: 0.4,
        radiusPower: 0.82,
      };
    case 'lime':
      return {
        canopy: 'broadleaf',
        barkColor: 0x7a7468,
        foliageColor: 0x789b58,
        heightMul: 0.86,
        spreadMul: 1.04,
        trunkMul: 0.84,
        lowWhorl: 0.43,
        crownSpan: 0.44,
        radiusPower: 0.74,
      };
    case 'hornbeam':
      return {
        canopy: 'broadleaf',
        barkColor: 0xa5a094,
        foliageColor: 0x66864f,
        heightMul: 0.72,
        spreadMul: 0.86,
        trunkMul: 0.7,
        lowWhorl: 0.38,
        crownSpan: 0.5,
        radiusPower: 0.84,
      };
    case 'sessileOak':
      return {
        canopy: 'broadleaf',
        barkColor: 0x5d5144,
        foliageColor: 0x657a43,
        heightMul: 0.9,
        spreadMul: 1.18,
        trunkMul: 1.08,
        lowWhorl: 0.42,
        crownSpan: 0.43,
        radiusPower: 0.72,
      };
    case 'scotsPine':
      return {
        canopy: 'conifer',
        barkColor: 0x9a6b42,
        foliageColor: 0x5c7045,
        heightMul: 1,
        spreadMul: 0.78,
        trunkMul: 0.84,
        lowWhorl: 0.36,
        crownSpan: 0.52,
        radiusPower: 1.0,
      };
    case 'larch':
      return {
        canopy: 'conifer',
        barkColor: 0x7d5e43,
        foliageColor: 0x8fa85c,
        heightMul: 0.98,
        spreadMul: 0.82,
        trunkMul: 0.86,
        lowWhorl: 0.24,
        crownSpan: 0.7,
        radiusPower: 1.16,
      };
    default: {
      const _exhaustive: never = species;
      throw new Error(`Unhandled tree species: ${_exhaustive}`);
    }
  }
}

async function createForestMaterials(maxAnisotropy: number, enableTreeShadowFilter: boolean): Promise<ForestMaterialSet> {
  const [rockTextures, foliageTextures] = await Promise.all([
    loadMossyRockTextures(maxAnisotropy),
    loadPineFoliageTextures(maxAnisotropy),
  ]);
  const textures: THREE.Texture[] = [rockTextures.map, rockTextures.normalMap, rockTextures.roughnessMap];

  const barkMap = createPineBarkTexture(maxAnisotropy);
  textures.push(barkMap, foliageTextures.needleMap, foliageTextures.needleRoughnessMap);

  const bark = new THREE.MeshStandardMaterial({
    map: barkMap,
    color: 0xffffff,
    roughness: 0.94,
    metalness: 0,
  });

  const rock = new THREE.MeshStandardMaterial({
    map: rockTextures.map,
    normalMap: rockTextures.normalMap,
    roughnessMap: rockTextures.roughnessMap,
    color: 0xb6b3a4,
    roughness: 0.9,
    metalness: 0,
  });
  rock.normalScale.set(0.55, 0.55);

  const coniferFoliage = new THREE.MeshStandardMaterial({
    map: foliageTextures.needleMap,
    roughnessMap: foliageTextures.needleRoughnessMap,
    color: 0xffffff,
    roughness: 0.98,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const broadleafFoliage = new THREE.MeshStandardMaterial({
    map: foliageTextures.needleMap,
    roughnessMap: foliageTextures.needleRoughnessMap,
    color: 0xffffff,
    roughness: 0.98,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  if (enableTreeShadowFilter) applyTreeShadowReceiveFilter(coniferFoliage);
  if (enableTreeShadowFilter) applyTreeShadowReceiveFilter(broadleafFoliage);
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
    coniferFoliage,
    broadleafFoliage,
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
  species: TreeSpecies,
  form: TreeForm,
  scale: number,
  isBlockedAt?: (x: number, z: number) => boolean,
): boolean {
  if (!isBlockedAt) return false;
  if (isBlockedAt(x, z)) return true;

  const canopyRadius = getEstimatedCanopyRadius(species, form, scale) * 0.86;
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
  spawnConfig: ForestSpawnConfig,
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

      const forestDensity = forestDensityAt(x, z, forestCores, spawnConfig.extent, spawnConfig.terrainExtent);
      if (forestDensity > 0.88 && rng() < 0.55) continue;

      const scale = THREE.MathUtils.lerp(0.55, 2.8, Math.pow(rng(), 1.35)) * THREE.MathUtils.lerp(0.92, 1.28, outcrop.strength);
      if (distanceToNearest(treePlacements, x, z) < 2.7 + scale * 0.78) continue;
      if (!hasMinimumDistance(placements, x, z, 2.8 + scale * 1.35)) continue;

      placements.push({ x, z, scale, profile: rockProfileForScale(scale, rng) });
      placedInOutcrop++;
    }
  }

  let attempts = 0;
  while (placements.length < spawnConfig.rockTargetCount && attempts < spawnConfig.rockTargetCount * 40) {
    attempts++;
    const { x, z } = samplePointInPlayableExtent(rng, spawnConfig.extent);
    if (isBlockedAt?.(x, z)) continue;
    if (Math.hypot(x, z) < CENTRAL_CLEARING_RADIUS * 0.78) continue;

    const suitability = rockSuitabilityAt(x, z, forestCores, spawnConfig.extent, spawnConfig.terrainExtent);
    if (suitability < 0.28 || rng() > suitability * 0.92) continue;

    const scale = THREE.MathUtils.lerp(0.45, 2.2, Math.pow(rng(), 1.45));
    if (distanceToNearest(treePlacements, x, z) < 3.2 + scale * 0.7) continue;
    if (!hasMinimumDistance(placements, x, z, 5.4 + scale * 1.2)) continue;
    placements.push({ x, z, scale, profile: rockProfileForScale(scale, rng) });
  }

  return placements;
}

function createRockOutcrops(
  rng: () => number,
  forestCores: ForestCore[],
  spawnConfig: ForestSpawnConfig,
): RockOutcrop[] {
  const outcrops: RockOutcrop[] = [];
  let attempts = 0;
  const minOutcropDistance = spawnConfig.extent * 0.11;

  while (outcrops.length < spawnConfig.rockOutcropCount && attempts < spawnConfig.rockOutcropCount * 90) {
    attempts++;
    const { x, z } = samplePointInPlayableExtent(rng, spawnConfig.extent);
    if (Math.hypot(x, z) < CENTRAL_CLEARING_RADIUS + 12) continue;
    if (!hasMinimumDistance(outcrops, x, z, minOutcropDistance)) continue;

    const suitability = rockSuitabilityAt(x, z, forestCores, spawnConfig.extent, spawnConfig.terrainExtent);
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

/** Standing eye height is ~1.55 m; large outcrop boulders can exceed that when profile is tall. */
function rockProfileForScale(scale: number, rng: () => number): RockProfile {
  const roll = rng();
  if (scale < 0.75) {
    return roll < 0.68 ? 'flat' : 'moderate';
  }
  if (scale < 1.3) {
    if (roll < 0.38) return 'flat';
    if (roll < 0.8) return 'moderate';
    return 'tall';
  }
  if (roll < 0.16) return 'flat';
  if (roll < 0.5) return 'moderate';
  return 'tall';
}

function rockSuitabilityAt(
  x: number,
  z: number,
  forestCores: ForestCore[],
  extent: number,
  terrainExtent: number,
): number {
  const forestDensity = forestDensityAt(x, z, forestCores, extent, terrainExtent);
  const forestEdge = 1 - Math.abs(forestDensity - 0.46) / 0.46;
  const stoneNoise = fbm2(x * 0.018 + 18.5, z * 0.018 - 4.4, 4);
  const openGround = 1 - smoothstep(0.74, 1, forestDensity);
  const edgeDistance = Math.max(Math.abs(x), Math.abs(z));
  const ridgeBias = smoothstep(extent * 0.42, extent * 0.82, edgeDistance) * 0.14;
  return saturate(forestEdge * 0.38 + stoneNoise * 0.4 + openGround * 0.14 + ridgeBias);
}

function createMixedMountainForest(
  placements: TreePlacement[],
  terrain: Terrain,
  materials: ForestMaterialSet,
  rng: () => number,
): MixedForestInstances {
  const group = new THREE.Group();
  group.name = 'Instanced Gorski kotar mixed mountain forest';

  const trunkGeometry = new THREE.CylinderGeometry(0.28, 1, 1, 8, 1, false);
  const coniferGeometry = createPineTierGeometry();
  const coniferShadowGeometry = createPineShadowTierGeometry();
  const broadleafGeometry = createPineTierGeometry();
  const broadleafShadowGeometry = createPineShadowTierGeometry();
  const trunkMesh = new THREE.InstancedMesh(trunkGeometry, materials.bark, placements.length);
  const coniferLayerCounts = placements.map((placement) => getConiferLayerCount(placement, rng));
  const broadleafLayerCounts = placements.map((placement) => getBroadleafLayerCount(placement, rng));
  const coniferStartIndex: number[] = [];
  const broadleafStartIndex: number[] = [];
  let totalConiferLayers = 0;
  let totalBroadleafLayers = 0;
  for (let i = 0; i < placements.length; i++) {
    coniferStartIndex[i] = totalConiferLayers;
    broadleafStartIndex[i] = totalBroadleafLayers;
    totalConiferLayers += coniferLayerCounts[i];
    totalBroadleafLayers += broadleafLayerCounts[i];
  }

  const coniferFoliageMesh = new THREE.InstancedMesh(coniferGeometry, materials.coniferFoliage, totalConiferLayers);
  const broadleafFoliageMesh = new THREE.InstancedMesh(broadleafGeometry, materials.broadleafFoliage, totalBroadleafLayers);
  const coniferShadowMesh = new THREE.InstancedMesh(coniferShadowGeometry, materials.shadowCast, totalConiferLayers);
  const broadleafShadowMesh = new THREE.InstancedMesh(broadleafShadowGeometry, materials.shadowCast, totalBroadleafLayers);
  const trunkMatrices = placements.map(() => new THREE.Matrix4());
  const coniferFoliageMatrices = Array.from({ length: totalConiferLayers }, () => new THREE.Matrix4());
  const broadleafFoliageMatrices = Array.from({ length: totalBroadleafLayers }, () => new THREE.Matrix4());
  const coniferTreeRoots = new Float32Array(totalConiferLayers * 2);
  const coniferTreeBaseYs = new Float32Array(totalConiferLayers);
  const coniferTreeHeights = new Float32Array(totalConiferLayers);
  const coniferCanopyRadii = new Float32Array(totalConiferLayers);
  const broadleafTreeRoots = new Float32Array(totalBroadleafLayers * 2);
  const broadleafTreeBaseYs = new Float32Array(totalBroadleafLayers);
  const broadleafTreeHeights = new Float32Array(totalBroadleafLayers);
  const broadleafCanopyRadii = new Float32Array(totalBroadleafLayers);
  const trunkTreeRoots = new Float32Array(placements.length * 2);
  const trunkTreeBaseYs = new Float32Array(placements.length);
  const trunkTreeHeights = new Float32Array(placements.length);
  const trunkCanopyRadii = new Float32Array(placements.length);
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const scaleVector = new THREE.Vector3();
  const position = new THREE.Vector3();
  const color = new THREE.Color();
  const root = new THREE.Vector3();
  let coniferLayerIndex = 0;
  let broadleafLayerIndex = 0;

  trunkMesh.name = 'Instanced mixed forest trunks';
  trunkMesh.castShadow = true;
  trunkMesh.receiveShadow = true;
  coniferShadowMesh.name = 'Instanced conifer crown shadows';
  coniferShadowMesh.layers.set(TREE_SHADOW_CAST_LAYER);
  coniferShadowMesh.castShadow = true;
  coniferShadowMesh.receiveShadow = false;
  coniferShadowMesh.customDepthMaterial = materials.shadowDepth;
  broadleafShadowMesh.name = 'Instanced broadleaf crown shadows';
  broadleafShadowMesh.layers.set(TREE_SHADOW_CAST_LAYER);
  broadleafShadowMesh.castShadow = true;
  broadleafShadowMesh.receiveShadow = false;
  broadleafShadowMesh.customDepthMaterial = materials.shadowDepth;
  coniferFoliageMesh.name = 'Instanced fir spruce pine larch tiers';
  coniferFoliageMesh.castShadow = false;
  coniferFoliageMesh.receiveShadow = true;
  broadleafFoliageMesh.name = 'Instanced beech maple ash elm lime oak textured tiers';
  broadleafFoliageMesh.castShadow = false;
  broadleafFoliageMesh.receiveShadow = true;

  placements.forEach((placement, treeIndex) => {
    const profile = getTreeSpeciesProfile(placement.species);
    const rootY = terrain.getHeightAt(placement.x, placement.z);
    const height = getRenderedTreeHeight(placement, profile, rng);
    const trunkRadius = getRenderedTrunkRadius(placement, profile, rng);
    const lean = new THREE.Vector3(
      (rng() - 0.5) * (profile.canopy === 'broadleaf' ? 0.058 : 0.042),
      1,
      (rng() - 0.5) * (profile.canopy === 'broadleaf' ? 0.058 : 0.042),
    ).normalize();
    const trunkHeight = getRenderedTrunkHeight(placement, profile, height);
    root.set(placement.x, rootY, placement.z);
    const trunkTop = root.clone().addScaledVector(lean, trunkHeight);
    composeBranchMatrix(root, trunkTop, trunkRadius, matrix, quaternion, scaleVector, position);
    trunkMesh.setMatrixAt(treeIndex, matrix);
    trunkMatrices[treeIndex].copy(matrix);
    color.set(profile.barkColor).offsetHSL((rng() - 0.5) * 0.012, (rng() - 0.5) * 0.04, (rng() - 0.5) * 0.08);
    trunkMesh.setColorAt(treeIndex, color);

    let treeCanopyRadius = getEstimatedCanopyRadius(placement.species, placement.form, placement.scale);
    if (profile.canopy === 'conifer') {
      treeCanopyRadius = Math.max(
        treeCanopyRadius,
        placeConiferCrown({
          placement,
          profile,
          rootY,
          height,
          lean,
          rng,
          layers: coniferLayerCounts[treeIndex],
          coniferFoliageMesh,
          coniferShadowMesh,
          coniferFoliageMatrices,
          coniferTreeRoots,
          coniferTreeBaseYs,
          coniferTreeHeights,
          coniferCanopyRadii,
          startIndex: coniferLayerIndex,
          matrix,
          quaternion,
          scaleVector,
          position,
          color,
        }),
      );
      coniferLayerIndex += coniferLayerCounts[treeIndex];
    } else {
      treeCanopyRadius = Math.max(
        treeCanopyRadius,
        placeBroadleafCrown({
          placement,
          profile,
          rootY,
          height,
          lean,
          rng,
          layers: broadleafLayerCounts[treeIndex],
          broadleafFoliageMesh,
          broadleafShadowMesh,
          broadleafFoliageMatrices,
          broadleafTreeRoots,
          broadleafTreeBaseYs,
          broadleafTreeHeights,
          broadleafCanopyRadii,
          startIndex: broadleafLayerIndex,
          matrix,
          quaternion,
          scaleVector,
          position,
          color,
        }),
      );
      broadleafLayerIndex += broadleafLayerCounts[treeIndex];
    }

    trunkTreeRoots[treeIndex * 2] = placement.x;
    trunkTreeRoots[treeIndex * 2 + 1] = placement.z;
    trunkTreeBaseYs[treeIndex] = rootY;
    trunkTreeHeights[treeIndex] = height;
    trunkCanopyRadii[treeIndex] = treeCanopyRadius;
  });

  setTreeShadowInstanceAttributes(trunkGeometry, trunkTreeRoots, trunkTreeBaseYs, trunkTreeHeights, trunkCanopyRadii);
  setTreeShadowInstanceAttributes(coniferGeometry, coniferTreeRoots, coniferTreeBaseYs, coniferTreeHeights, coniferCanopyRadii);
  setTreeShadowInstanceAttributes(broadleafGeometry, broadleafTreeRoots, broadleafTreeBaseYs, broadleafTreeHeights, broadleafCanopyRadii);

  trunkMesh.instanceMatrix.needsUpdate = true;
  coniferShadowMesh.instanceMatrix.needsUpdate = true;
  broadleafShadowMesh.instanceMatrix.needsUpdate = true;
  coniferFoliageMesh.instanceMatrix.needsUpdate = true;
  broadleafFoliageMesh.instanceMatrix.needsUpdate = true;
  if (trunkMesh.instanceColor) trunkMesh.instanceColor.needsUpdate = true;
  if (coniferFoliageMesh.instanceColor) coniferFoliageMesh.instanceColor.needsUpdate = true;
  if (broadleafFoliageMesh.instanceColor) broadleafFoliageMesh.instanceColor.needsUpdate = true;
  group.add(trunkMesh, coniferShadowMesh, broadleafShadowMesh, coniferFoliageMesh, broadleafFoliageMesh);
  return {
    group,
    trunkMesh,
    coniferFoliageMesh,
    broadleafFoliageMesh,
    coniferShadowMesh,
    broadleafShadowMesh,
    placements,
    coniferLayerCounts,
    broadleafLayerCounts,
    coniferStartIndex,
    broadleafStartIndex,
    trunkMatrices,
    coniferFoliageMatrices,
    broadleafFoliageMatrices,
  };
}

function getConiferLayerCount(placement: TreePlacement, rng: () => number): number {
  if (getTreeSpeciesProfile(placement.species).canopy !== 'conifer') return 0;
  const base =
    placement.form === 'young'
      ? 5
      : placement.species === 'norwaySpruce'
        ? 9
        : placement.species === 'silverFir'
          ? 8
          : placement.species === 'scotsPine'
            ? 6
            : 7;
  return base + Math.floor(rng() * 2);
}

function getBroadleafLayerCount(placement: TreePlacement, rng: () => number): number {
  if (getTreeSpeciesProfile(placement.species).canopy !== 'broadleaf') return 0;
  const base =
    placement.form === 'young'
      ? 4
      : placement.form === 'midstory'
        ? 5
        : placement.species === 'sessileOak'
          ? 10
          : placement.species === 'ash'
            ? 7
            : 8;
  return base + Math.floor(rng() * 3);
}

function getRenderedTreeHeight(
  placement: TreePlacement,
  profile: TreeSpeciesProfile,
  rng: () => number,
): number {
  const base =
    placement.form === 'midstory'
      ? 4.8 + rng() * 3.8
      : placement.form === 'young'
        ? 7.2 + rng() * 4.4
        : 15.5 + rng() * 7.5;
  const formMul = placement.form === 'young' ? 0.78 : placement.form === 'midstory' ? 0.82 : 1;
  return Math.min(47.5, base * placement.scale * profile.heightMul * formMul);
}

function getRenderedTrunkRadius(
  placement: TreePlacement,
  profile: TreeSpeciesProfile,
  rng: () => number,
): number {
  const formMul = placement.form === 'young' || placement.form === 'midstory' ? 0.68 : 1;
  return (0.25 + rng() * 0.14) * placement.scale * profile.trunkMul * formMul;
}

function getConiferCrownBounds(
  profile: TreeSpeciesProfile,
  isYoung: boolean,
): { crownBase: number; crownTop: number } {
  const crownBase = Math.min(isYoung ? Math.max(profile.lowWhorl, 0.22) : profile.lowWhorl, 0.42);
  const crownSpan = Math.min(profile.crownSpan * (isYoung ? 0.78 : 1), 0.86 - crownBase);
  return { crownBase, crownTop: crownBase + crownSpan };
}

function getBroadleafCrownBounds(
  profile: TreeSpeciesProfile,
  isYoung: boolean,
  isMidstory: boolean,
): { crownBase: number; crownTop: number } {
  const crownBase = Math.min(isYoung ? Math.max(profile.lowWhorl, 0.28) : profile.lowWhorl, 0.64);
  const crownSpan = Math.min(
    profile.crownSpan * (isMidstory ? 0.78 : isYoung ? 0.72 : 1),
    0.94 - crownBase,
  );
  return { crownBase, crownTop: crownBase + crownSpan };
}

function getRenderedTrunkHeight(
  placement: TreePlacement,
  profile: TreeSpeciesProfile,
  height: number,
): number {
  const isYoung = placement.form === 'young';
  const isMidstory = placement.form === 'midstory';

  if (profile.canopy === 'conifer') {
    const { crownTop } = getConiferCrownBounds(profile, isYoung);
    // Meet the top foliage tier at its center; foliage geometry extends above this point.
    return height * crownTop;
  }

  const { crownTop } = getBroadleafCrownBounds(profile, isYoung, isMidstory);
  const broadleafCap = isMidstory ? 0.74 : 0.82;
  return height * Math.min(broadleafCap, crownTop);
}

function placeConiferCrown(options: {
  placement: TreePlacement;
  profile: TreeSpeciesProfile;
  rootY: number;
  height: number;
  lean: THREE.Vector3;
  rng: () => number;
  layers: number;
  coniferFoliageMesh: THREE.InstancedMesh;
  coniferShadowMesh: THREE.InstancedMesh;
  coniferFoliageMatrices: THREE.Matrix4[];
  coniferTreeRoots: Float32Array;
  coniferTreeBaseYs: Float32Array;
  coniferTreeHeights: Float32Array;
  coniferCanopyRadii: Float32Array;
  startIndex: number;
  matrix: THREE.Matrix4;
  quaternion: THREE.Quaternion;
  scaleVector: THREE.Vector3;
  position: THREE.Vector3;
  color: THREE.Color;
}): number {
  const {
    placement,
    profile,
    rootY,
    height,
    lean,
    rng,
    layers,
    coniferFoliageMesh,
    coniferShadowMesh,
    coniferFoliageMatrices,
    coniferTreeRoots,
    coniferTreeBaseYs,
    coniferTreeHeights,
    coniferCanopyRadii,
    startIndex,
    matrix,
    quaternion,
    scaleVector,
    position,
    color,
  } = options;
  const yawOffset = rng() * TAU;
  const isYoung = placement.form === 'young';
  const { crownBase: lowWhorl, crownTop } = getConiferCrownBounds(profile, isYoung);
  const crownSpan = crownTop - lowWhorl;
  const scaleMul = isYoung ? 0.74 : 1;
  let maxTierRadius = 0;

  for (let i = 0; i < layers; i++) {
    const t = layers > 1 ? i / (layers - 1) : 0;
    const layerIndex = startIndex + i;
    const whorl = lowWhorl + t * crownSpan;
    const tierRadius =
      (3.15 * Math.pow(1 - t, profile.radiusPower) + (isYoung ? 0.34 : 0.5)) *
      placement.scale *
      profile.spreadMul *
      scaleMul *
      (0.92 + rng() * 0.16);
    const tierHeight =
      (1.95 * (1 - t * (placement.species === 'norwaySpruce' ? 0.28 : 0.36)) + 0.18) *
      placement.scale *
      scaleMul *
      (placement.species === 'silverFir' ? 0.9 : placement.species === 'norwaySpruce' ? 1.08 : 1);
    const sway = (1 - t) * (placement.species === 'scotsPine' ? 0.7 : 0.46);

    position.set(
      placement.x + lean.x * height * whorl + Math.cos(yawOffset + i * 1.74) * sway * rng(),
      rootY + height * whorl,
      placement.z + lean.z * height * whorl + Math.sin(yawOffset + i * 1.74) * sway * rng(),
    );
    quaternion.setFromEuler(
      new THREE.Euler((rng() - 0.5) * 0.075, yawOffset + i * 0.83, (rng() - 0.5) * 0.075),
    );
    scaleVector.set(tierRadius, tierHeight, tierRadius * (0.9 + rng() * 0.16));
    maxTierRadius = Math.max(maxTierRadius, tierRadius);
    matrix.compose(position, quaternion, scaleVector);
    coniferFoliageMesh.setMatrixAt(layerIndex, matrix);
    coniferShadowMesh.setMatrixAt(layerIndex, matrix);
    coniferFoliageMatrices[layerIndex].copy(matrix);
    color
      .set(profile.foliageColor)
      .offsetHSL((rng() - 0.5) * 0.018, (rng() - 0.5) * 0.052, (t - 0.45) * 0.055 + (rng() - 0.5) * 0.04);
    coniferFoliageMesh.setColorAt(layerIndex, color);
    coniferTreeRoots[layerIndex * 2] = placement.x;
    coniferTreeRoots[layerIndex * 2 + 1] = placement.z;
    coniferTreeBaseYs[layerIndex] = rootY;
    coniferTreeHeights[layerIndex] = height;
  }

  const canopyRadius = maxTierRadius * 1.06;
  for (let i = 0; i < layers; i++) {
    coniferCanopyRadii[startIndex + i] = canopyRadius;
  }
  return canopyRadius;
}

function placeBroadleafCrown(options: {
  placement: TreePlacement;
  profile: TreeSpeciesProfile;
  rootY: number;
  height: number;
  lean: THREE.Vector3;
  rng: () => number;
  layers: number;
  broadleafFoliageMesh: THREE.InstancedMesh;
  broadleafShadowMesh: THREE.InstancedMesh;
  broadleafFoliageMatrices: THREE.Matrix4[];
  broadleafTreeRoots: Float32Array;
  broadleafTreeBaseYs: Float32Array;
  broadleafTreeHeights: Float32Array;
  broadleafCanopyRadii: Float32Array;
  startIndex: number;
  matrix: THREE.Matrix4;
  quaternion: THREE.Quaternion;
  scaleVector: THREE.Vector3;
  position: THREE.Vector3;
  color: THREE.Color;
}): number {
  const {
    placement,
    profile,
    rootY,
    height,
    lean,
    rng,
    layers,
    broadleafFoliageMesh,
    broadleafShadowMesh,
    broadleafFoliageMatrices,
    broadleafTreeRoots,
    broadleafTreeBaseYs,
    broadleafTreeHeights,
    broadleafCanopyRadii,
    startIndex,
    matrix,
    quaternion,
    scaleVector,
    position,
    color,
  } = options;
  const yawOffset = rng() * TAU;
  const isYoung = placement.form === 'young';
  const isMidstory = placement.form === 'midstory';
  const { crownBase, crownTop } = getBroadleafCrownBounds(profile, isYoung, isMidstory);
  const crownSpan = crownTop - crownBase;
  const scaleMul = isYoung ? 0.72 : isMidstory ? 0.82 : 1;
  const crownBreadth =
    placement.species === 'sessileOak'
      ? 1.14
      : placement.species === 'ash'
        ? 0.86
        : placement.species === 'hornbeam'
          ? 0.84
          : 1;
  let maxTierRadius = 0;

  for (let i = 0; i < layers; i++) {
    const layerIndex = startIndex + i;
    const t = layers > 1 ? i / (layers - 1) : 0;
    const whorl = crownBase + t * crownSpan;
    const shoulder = 1 - Math.abs(t - 0.34) * 0.44;
    const tierRadius =
      (2.95 * Math.pow(1 - t * 0.72, profile.radiusPower) * shoulder + 0.42) *
      placement.scale *
      profile.spreadMul *
      crownBreadth *
      scaleMul *
      (0.9 + rng() * 0.18);
    const tierHeight =
      (1.48 * (1 - t * 0.2) + 0.22) *
      placement.scale *
      scaleMul *
      (placement.species === 'ash' || placement.species === 'wychElm' ? 1.08 : 1);
    const sway = (1 - t) * (placement.species === 'sessileOak' ? 0.82 : 0.52);

    position.set(
      placement.x + lean.x * height * whorl + Math.cos(yawOffset + i * 1.58) * sway * rng(),
      rootY + height * whorl,
      placement.z + lean.z * height * whorl + Math.sin(yawOffset + i * 1.58) * sway * rng(),
    );
    quaternion.setFromEuler(
      new THREE.Euler((rng() - 0.5) * 0.08, yawOffset + i * 0.92, (rng() - 0.5) * 0.08),
    );
    scaleVector.set(tierRadius, tierHeight, tierRadius * (0.88 + rng() * 0.18));
    maxTierRadius = Math.max(maxTierRadius, tierRadius);
    matrix.compose(position, quaternion, scaleVector);
    broadleafFoliageMesh.setMatrixAt(layerIndex, matrix);
    broadleafShadowMesh.setMatrixAt(layerIndex, matrix);
    broadleafFoliageMatrices[layerIndex].copy(matrix);
    color
      .set(profile.foliageColor)
      .offsetHSL((rng() - 0.5) * 0.026, (rng() - 0.5) * 0.08, (rng() - 0.5) * 0.075);
    broadleafFoliageMesh.setColorAt(layerIndex, color);
    broadleafTreeRoots[layerIndex * 2] = placement.x;
    broadleafTreeRoots[layerIndex * 2 + 1] = placement.z;
    broadleafTreeBaseYs[layerIndex] = rootY;
    broadleafTreeHeights[layerIndex] = height;
  }

  const canopyRadius = maxTierRadius * 1.08;
  for (let i = 0; i < layers; i++) {
    broadleafCanopyRadii[startIndex + i] = canopyRadius;
  }
  return canopyRadius;
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
  placements: RockPlacement[],
  terrain: Terrain,
  material: THREE.Material,
  shadowCast: THREE.MeshStandardMaterial,
  shadowDepth: THREE.MeshDepthMaterial,
  rng: () => number,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Instanced mossy boulder field';
  const shapeSeeds = [1.3, 7.7, 13.2] as const;
  const profiles: RockProfile[] = ['flat', 'moderate', 'tall'];
  const variants = profiles.flatMap((profile) =>
    shapeSeeds.map((seed) => createBoulderGeometry(seed, profile)),
  );
  const shadowGeometry = createRockShadowGeometry();
  const buckets = variants.map(() => [] as RockPlacement[]);
  placements.forEach((placement, index) => {
    const profileIndex = profiles.indexOf(placement.profile);
    const bucketIndex = profileIndex * shapeSeeds.length + (index % shapeSeeds.length);
    buckets[bucketIndex].push(placement);
  });
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
      rockInstanceScaleForProfile(rock.profile, rock.scale, rng, scaleVector);
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

function rockInstanceScaleForProfile(
  profile: RockProfile,
  scale: number,
  rng: () => number,
  target: THREE.Vector3,
): THREE.Vector3 {
  switch (profile) {
    case 'flat':
      return target.set(
        scale * (1.12 + rng() * 0.72),
        scale * (0.34 + rng() * 0.22),
        scale * (0.95 + rng() * 0.55),
      );
    case 'moderate':
      return target.set(
        scale * (1.02 + rng() * 0.58),
        scale * (0.62 + rng() * 0.36),
        scale * (0.88 + rng() * 0.48),
      );
    case 'tall':
      return target.set(
        scale * (0.84 + rng() * 0.42),
        scale * (0.96 + rng() * 0.68),
        scale * (0.8 + rng() * 0.38),
      );
    default: {
      const _exhaustive: never = profile;
      throw new Error(`Unhandled rock profile: ${_exhaustive}`);
    }
  }
}

function createBoulderGeometry(seed: number, profile: RockProfile = 'moderate'): THREE.BufferGeometry {
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
    const ySquash =
      profile === 'flat'
        ? 0.46 + stableSurfaceNoise(point, seed + 4.1) * 0.14
        : profile === 'moderate'
          ? 0.68 + stableSurfaceNoise(point, seed + 4.1) * 0.16
          : 0.9 + stableSurfaceNoise(point, seed + 4.1) * 0.18;
    point.y *= ySquash;
    const bottomFlatten = profile === 'tall' ? 0.42 : 0.58;
    if (point.y < -0.24) point.y = THREE.MathUtils.lerp(point.y, -0.28, bottomFlatten);
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
  materials.coniferFoliage.dispose();
  materials.broadleafFoliage.dispose();
  materials.textures.forEach((texture) => texture.dispose());
}
