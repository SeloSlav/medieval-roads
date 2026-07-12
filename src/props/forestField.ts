import * as THREE from 'three';

const TAU = Math.PI * 2;
export const CENTRAL_CLEARING_RADIUS = 34;

export type ForestCore = {
  x: number;
  z: number;
  radiusX: number;
  radiusZ: number;
  rotation: number;
  strength: number;
  coniferBias: number;
};

export type ForestSpawnConfig = {
  extent: number;
  terrainExtent: number;
  playableSize: number;
  terrainSize: number;
  treeTargetCount: number;
  hillEdgeTreeTargetCount: number;
  rockTargetCount: number;
  forestCoreCount: number;
  rockOutcropCount: number;
  undergrowthTargetCount: number;
  saplingTargetCount: number;
};

const LEGACY_PLAYABLE_SIZE = 496;
const LEGACY_TERRAIN_SIZE = 1080;
const BASE_TREE_COUNT = 360;
const BASE_HILL_EDGE_TREE_COUNT = 820;
const BASE_ROCK_COUNT = 86;
const BASE_UNDERGROWTH_COUNT = 880;
const BASE_SAPLING_COUNT = 148;

export function createForestSpawnConfig(
  playableSize: number,
  terrainSize: number,
  densityScale = 1,
): ForestSpawnConfig {
  const extent = playableSize * 0.5;
  const terrainExtent = terrainSize * 0.5;
  const areaScale = (playableSize / LEGACY_PLAYABLE_SIZE) ** 2;
  const hillRingAreaScale =
    (terrainSize ** 2 - playableSize ** 2) / (LEGACY_TERRAIN_SIZE ** 2 - LEGACY_PLAYABLE_SIZE ** 2);
  const density = Math.max(0.25, densityScale);

  return {
    extent,
    terrainExtent,
    playableSize,
    terrainSize,
    treeTargetCount: Math.round(BASE_TREE_COUNT * areaScale * density),
    hillEdgeTreeTargetCount: Math.round(BASE_HILL_EDGE_TREE_COUNT * hillRingAreaScale * density),
    rockTargetCount: Math.round(BASE_ROCK_COUNT * areaScale * Math.sqrt(density)),
    forestCoreCount: Math.round((20 + areaScale * 5) * Math.sqrt(density)),
    rockOutcropCount: Math.round((9 + areaScale * 5) * Math.sqrt(density)),
    undergrowthTargetCount: Math.round(BASE_UNDERGROWTH_COUNT * areaScale * density),
    saplingTargetCount: Math.round(BASE_SAPLING_COUNT * areaScale * density),
  };
}

/** Matches terrain edge-hill ramp in TerrainHeight.ts. */
export function getEdgeHillFactor(
  x: number,
  z: number,
  playableSize: number,
  terrainSize: number,
): number {
  const edgeDistance = Math.max(Math.abs(x), Math.abs(z));
  const hillStart = playableSize * 0.44;
  const hillEnd = terrainSize * 0.5;
  return smoothstep(hillStart, hillEnd, edgeDistance);
}

export function createForestCores(rng: () => number, spawnConfig: ForestSpawnConfig): ForestCore[] {
  const cores: ForestCore[] = [];
  const edgeMargin = spawnConfig.extent * 0.06;
  const minCoreDistance = spawnConfig.extent * 0.15;
  let attempts = 0;

  while (cores.length < spawnConfig.forestCoreCount && attempts < spawnConfig.forestCoreCount * 80) {
    attempts++;
    const x = (rng() * 2 - 1) * (spawnConfig.extent - edgeMargin);
    const z = (rng() * 2 - 1) * (spawnConfig.extent - edgeMargin);
    if (Math.hypot(x, z) < CENTRAL_CLEARING_RADIUS + 24) continue;
    if (!hasMinimumDistance(cores, x, z, minCoreDistance)) continue;

    const woodlandNoise = fbm2(x * 0.0045 + 12.4, z * 0.0045 - 8.6, 3);
    if (woodlandNoise < 0.32 && rng() > woodlandNoise * 1.28) continue;

    const shapeNoise = fbm2(x * 0.009 - 4.2, z * 0.009 + 6.8, 2);
    cores.push({
      x: x + (rng() - 0.5) * 14,
      z: z + (rng() - 0.5) * 14,
      radiusX: THREE.MathUtils.lerp(52, 112, woodlandNoise) * (0.92 + rng() * 0.2),
      radiusZ: THREE.MathUtils.lerp(44, 98, shapeNoise) * (0.9 + rng() * 0.22),
      rotation: rng() * TAU,
      strength: THREE.MathUtils.lerp(0.78, 1.22, woodlandNoise) * (0.96 + rng() * 0.1),
      coniferBias: THREE.MathUtils.clamp(THREE.MathUtils.lerp(0.36, 0.78, shapeNoise) + (rng() - 0.5) * 0.1, 0.32, 0.84),
    });
  }

  return cores;
}

export function forestDensityAt(
  x: number,
  z: number,
  forestCores: ForestCore[],
  extent: number,
  terrainExtent?: number,
): number {
  let density = 0;
  for (const core of forestCores) {
    density = Math.max(density, forestCoreInfluence(x, z, core) * core.strength);
  }

  const edgeDistance = Math.max(Math.abs(x), Math.abs(z));
  const playableSize = extent * 2;
  const terrainSize = (terrainExtent ?? extent) * 2;
  const hillFactor = getEdgeHillFactor(x, z, playableSize, terrainSize);
  const edgeWoods = smoothstep(extent * 0.58, extent * 0.9, edgeDistance) * 0.24;
  const hillEdgeWoods = hillFactor * 0.96;
  const canopyNoise = fbm2(x * 0.006 + 5.4, z * 0.006 - 8.8, 4);
  const pocketNoise = fbm2(x * 0.024 - 14.2, z * 0.024 + 3.7, 3);
  const regionalNoise = fbm2(x * 0.0028 + 21.6, z * 0.0028 - 17.4, 3);
  const centralClear = smoothstep(CENTRAL_CLEARING_RADIUS, CENTRAL_CLEARING_RADIUS + 34, Math.hypot(x, z));
  const meadowBreak =
    (0.82 +
      smoothstep(18, 58, Math.abs(z + Math.sin(x * 0.012) * 34 - extent * 0.16)) * 0.12 +
      smoothstep(16, 52, Math.abs(x * 0.28 - z - extent * 0.09)) * 0.08) *
      (1 - hillFactor * 0.9) +
    hillFactor * 0.94;

  density +=
    Math.max(edgeWoods, hillEdgeWoods) +
    (canopyNoise - 0.4) * 0.3 * (1 - hillFactor * 0.72) +
    (pocketNoise - 0.5) * 0.18 * (1 - hillFactor * 0.55) +
    (regionalNoise - 0.46) * 0.22 * (1 - hillFactor * 0.45);
  return saturate(density * centralClear * meadowBreak);
}

export function forestCoreInfluence(x: number, z: number, core: ForestCore): number {
  const dx = x - core.x;
  const dz = z - core.z;
  const cos = Math.cos(-core.rotation);
  const sin = Math.sin(-core.rotation);
  const localX = dx * cos - dz * sin;
  const localZ = dx * sin + dz * cos;
  const normalizedDistance = Math.sqrt((localX / core.radiusX) ** 2 + (localZ / core.radiusZ) ** 2);
  return 1 - smoothstep(0.38, 1.18, normalizedDistance);
}

export function samplePointInForestCore(core: ForestCore, rng: () => number): { x: number; z: number } {
  const angle = rng() * TAU;
  const radius = Math.pow(rng(), 0.54);
  const localX = Math.cos(angle) * core.radiusX * radius;
  const localZ = Math.sin(angle) * core.radiusZ * radius;
  const cos = Math.cos(core.rotation);
  const sin = Math.sin(core.rotation);
  return {
    x: core.x + localX * cos - localZ * sin + (rng() - 0.5) * 9,
    z: core.z + localX * sin + localZ * cos + (rng() - 0.5) * 9,
  };
}

export function samplePointInPlayableExtent(rng: () => number, extent: number): { x: number; z: number } {
  return {
    x: (rng() * 2 - 1) * extent,
    z: (rng() * 2 - 1) * extent,
  };
}

export function isInsidePlayableExtent(x: number, z: number, extent: number): boolean {
  return Math.abs(x) <= extent && Math.abs(z) <= extent;
}

export function isInsideTerrainExtent(x: number, z: number, terrainExtent: number): boolean {
  return Math.abs(x) <= terrainExtent && Math.abs(z) <= terrainExtent;
}

export function samplePointInHillEdgeBand(
  rng: () => number,
  playableSize: number,
  terrainSize: number,
): { x: number; z: number } {
  const hillStart = playableSize * 0.44;
  const hillEnd = terrainSize * 0.5;
  const edgeDistance = THREE.MathUtils.lerp(hillStart, hillEnd, Math.pow(rng(), 0.34));
  const along = (rng() * 2 - 1) * edgeDistance;

  if (rng() < 0.5) {
    return {
      x: along,
      z: edgeDistance * (rng() < 0.5 ? 1 : -1),
    };
  }

  return {
    x: edgeDistance * (rng() < 0.5 ? 1 : -1),
    z: along,
  };
}

export function hasMinimumDistance(
  points: Array<{ x: number; z: number }>,
  x: number,
  z: number,
  minDistance: number,
): boolean {
  const minDistanceSq = minDistance * minDistance;
  for (const point of points) {
    const dx = x - point.x;
    const dz = z - point.z;
    if (dx * dx + dz * dz < minDistanceSq) return false;
  }
  return true;
}

export function distanceToNearest(points: Array<{ x: number; z: number }>, x: number, z: number): number {
  let nearestSq = Infinity;
  for (const point of points) {
    const dx = x - point.x;
    const dz = z - point.z;
    nearestSq = Math.min(nearestSq, dx * dx + dz * dz);
  }
  return Math.sqrt(nearestSq);
}

export { mulberry32, pick } from '../utils/random.ts';

export function fbm2(x: number, z: number, octaves: number): number {
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let amplitudeSum = 0;

  for (let octave = 0; octave < octaves; octave++) {
    value += valueNoise2(x * frequency, z * frequency) * amplitude;
    amplitudeSum += amplitude;
    amplitude *= 0.5;
    frequency *= 2.03;
  }

  return value / amplitudeSum;
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
