import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { vertexColor } from 'three/tsl';
import type { Terrain } from '../terrain/Terrain.ts';
import type { RoadEdge } from '../roads/RoadEdge.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import { distancePointToPolylineXZ } from '../utils/pathGeometry.ts';
import {
  createForestCores,
  createForestSpawnConfig,
  forestDensityAt,
  isInsidePlayableExtent,
  mulberry32,
} from '../props/forestField.ts';
import {
  GRASS_BLADE_CHUNK_SIZE,
  GRASS_BLADE_NEAR_RADIUS,
  GRASS_BLADES_PER_TUFT,
  GRASS_EDGE_FADE_BAND,
  GRASS_STREAM_CHUNK_RADIUS,
  GRASS_STREAM_CHUNKS_PER_FRAME,
  GRASS_TUFT_SCATTER_ATTEMPTS,
  GRASS_TUFTS_PER_CHUNK,
  grassBladeRevealOpacity,
} from './grassLodMath.ts';

export const GRASS_BLADES_ENABLED = true;

type TslNode = {
  rgb: TslNode;
};

export type GrassBladeField = {
  group: THREE.Group;
  syncRoadClearance: (network: RoadNetwork) => void;
  updateCameraState: (
    cameraPosition: THREE.Vector3,
    cameraTarget: THREE.Vector3,
    cameraDistance: number,
  ) => void;
  dispose: () => void;
};

const ROAD_CLEAR_MARGIN = 1.05;
const TAU = Math.PI * 2;
const MAX_STREAM_INSTANCES = (GRASS_STREAM_CHUNK_RADIUS * 2 + 1) ** 2 * (GRASS_TUFTS_PER_CHUNK + 8);
const MIN_TUFT_SPACING_SQ = 0.42 * 0.42;
const MIN_MICRO_TUFT_SPACING_SQ = 0.26 * 0.26;

/** Muted olive — aligned with forest undergrowth. */
const BLADE_BASE = new THREE.Color(0x3a5032);
const BLADE_MID = new THREE.Color(0x4a6340);
const BLADE_TIP = new THREE.Color(0x566b48);

type GrassFieldContext = {
  terrain: Terrain;
  extent: number;
  forestCores: ReturnType<typeof createForestCores>;
  isBlockedAt?: (x: number, z: number) => boolean;
  roadEdges: RoadEdge[];
};

type StreamChunk = {
  chunkX: number;
  chunkZ: number;
  sortKey: number;
};

export function createGrassBladeField(
  terrain: Terrain,
  options?: { isBlockedAt?: (x: number, z: number) => boolean },
): GrassBladeField {
  if (!GRASS_BLADES_ENABLED) {
    return createDisabledGrassBladeField();
  }

  const spawnConfig = createForestSpawnConfig(terrain.playableSize);
  const context: GrassFieldContext = {
    terrain,
    extent: spawnConfig.extent,
    forestCores: createForestCores(mulberry32(0x6a55b1ade), spawnConfig),
    isBlockedAt: options?.isBlockedAt,
    roadEdges: [],
  };

  const material = createGrassBladeMaterial();
  const geometry = createGrassTuftGeometry();

  const createStreamMesh = (name: string): THREE.InstancedMesh => {
    const streamMesh = new THREE.InstancedMesh(geometry, material, MAX_STREAM_INSTANCES);
    streamMesh.name = name;
    streamMesh.count = 0;
    streamMesh.castShadow = false;
    streamMesh.receiveShadow = true;
    streamMesh.frustumCulled = false;
    streamMesh.visible = false;
    return streamMesh;
  };

  const meshPrimary = createStreamMesh('Grass blade stream A');
  const meshSecondary = createStreamMesh('Grass blade stream B');
  let activeMesh = meshPrimary;
  let buildMesh = meshSecondary;

  const group = new THREE.Group();
  group.name = 'Grass blade field';
  group.add(meshPrimary, meshSecondary);

  let streamChunkX = Number.NaN;
  let streamChunkZ = Number.NaN;
  let needsInitialStream = true;
  let roadClearanceDirty = false;
  let rebuildQueue: StreamChunk[] | null = null;
  let buildInstanceIndex = 0;
  let buildFocusX = 0;
  let buildFocusZ = 0;
  let lastMaterialOpacity = Number.NaN;
  let grassZoomVisible = false;

  const collectStreamChunks = (focusX: number, focusZ: number): StreamChunk[] => {
    const centerChunkX = Math.floor(focusX / GRASS_BLADE_CHUNK_SIZE);
    const centerChunkZ = Math.floor(focusZ / GRASS_BLADE_CHUNK_SIZE);
    const includeRadiusSq = (GRASS_BLADE_NEAR_RADIUS + GRASS_BLADE_CHUNK_SIZE * 0.55) ** 2;
    const chunks: StreamChunk[] = [];

    for (let dz = -GRASS_STREAM_CHUNK_RADIUS; dz <= GRASS_STREAM_CHUNK_RADIUS; dz++) {
      for (let dx = -GRASS_STREAM_CHUNK_RADIUS; dx <= GRASS_STREAM_CHUNK_RADIUS; dx++) {
        const chunkX = centerChunkX + dx;
        const chunkZ = centerChunkZ + dz;
        const chunkCenterX = (chunkX + 0.5) * GRASS_BLADE_CHUNK_SIZE;
        const chunkCenterZ = (chunkZ + 0.5) * GRASS_BLADE_CHUNK_SIZE;
        const toFocusX = chunkCenterX - focusX;
        const toFocusZ = chunkCenterZ - focusZ;
        const distSq = toFocusX * toFocusX + toFocusZ * toFocusZ;
        if (distSq > includeRadiusSq) continue;
        chunks.push({ chunkX, chunkZ, sortKey: distSq });
      }
    }

    chunks.sort((a, b) => a.sortKey - b.sortKey);
    return chunks;
  };

  const startBackgroundRebuild = (focusX: number, focusZ: number): void => {
    rebuildQueue = collectStreamChunks(focusX, focusZ);
    buildInstanceIndex = 0;
    buildFocusX = focusX;
    buildFocusZ = focusZ;
    buildMesh.count = 0;
    needsInitialStream = false;
    roadClearanceDirty = false;
  };

  const swapActiveMesh = (): void => {
    activeMesh.visible = false;
    buildMesh.computeBoundingSphere();
    buildMesh.visible = grassZoomVisible;
    activeMesh = buildMesh;
    buildMesh = activeMesh === meshPrimary ? meshSecondary : meshPrimary;
    streamChunkX = Math.floor(buildFocusX / GRASS_BLADE_CHUNK_SIZE);
    streamChunkZ = Math.floor(buildFocusZ / GRASS_BLADE_CHUNK_SIZE);
  };

  const stepBackgroundRebuild = (): void => {
    if (!rebuildQueue) return;

    const end = Math.min(GRASS_STREAM_CHUNKS_PER_FRAME, rebuildQueue.length);
    for (let index = 0; index < end; index++) {
      const { chunkX, chunkZ } = rebuildQueue[index]!;
      buildInstanceIndex = writeChunkInstances(
        buildMesh,
        buildInstanceIndex,
        chunkX,
        chunkZ,
        buildFocusX,
        buildFocusZ,
        context,
      );
    }

    rebuildQueue.splice(0, end);
    buildMesh.count = buildInstanceIndex;
    buildMesh.instanceMatrix.needsUpdate = true;
    if (buildMesh.instanceColor) buildMesh.instanceColor.needsUpdate = true;

    if (activeMesh.count === 0) {
      buildMesh.visible = grassZoomVisible;
      activeMesh.visible = false;
    }

    if (rebuildQueue.length === 0) {
      rebuildQueue = null;
      swapActiveMesh();
    }
  };

  const syncStreamVisibility = (): void => {
    if (!grassZoomVisible) {
      activeMesh.visible = false;
      buildMesh.visible = false;
      return;
    }

    if (rebuildQueue && activeMesh.count > 0) {
      activeMesh.visible = true;
      buildMesh.visible = false;
      return;
    }

    activeMesh.visible = activeMesh.count > 0;
    buildMesh.visible = false;
  };

  return {
    group,
    syncRoadClearance(network: RoadNetwork) {
      context.roadEdges = [...network.edges.values()];
      roadClearanceDirty = true;
    },
    updateCameraState(_cameraPosition: THREE.Vector3, cameraTarget: THREE.Vector3, cameraDistance: number) {
      const zoomOpacity = grassBladeRevealOpacity(cameraDistance);
      grassZoomVisible = zoomOpacity > 0.02;

      if (!Number.isFinite(lastMaterialOpacity) || Math.abs(zoomOpacity - lastMaterialOpacity) > 0.008) {
        lastMaterialOpacity = zoomOpacity;
        material.opacity = zoomOpacity;
        const useTransparency = zoomOpacity < 0.995;
        if (material.transparent !== useTransparency) {
          material.transparent = useTransparency;
          material.depthWrite = !useTransparency;
          material.needsUpdate = true;
        }
      }

      if (!grassZoomVisible) {
        rebuildQueue = null;
        syncStreamVisibility();
        return;
      }

      const focusX = cameraTarget.x;
      const focusZ = cameraTarget.z;
      const centerChunkX = Math.floor(focusX / GRASS_BLADE_CHUNK_SIZE);
      const centerChunkZ = Math.floor(focusZ / GRASS_BLADE_CHUNK_SIZE);

      if (rebuildQueue) {
        const queueChunkX = Math.floor(buildFocusX / GRASS_BLADE_CHUNK_SIZE);
        const queueChunkZ = Math.floor(buildFocusZ / GRASS_BLADE_CHUNK_SIZE);
        if (
          roadClearanceDirty ||
          centerChunkX !== queueChunkX ||
          centerChunkZ !== queueChunkZ
        ) {
          startBackgroundRebuild(focusX, focusZ);
        }
        stepBackgroundRebuild();
        syncStreamVisibility();
        return;
      }

      const chunkChanged = centerChunkX !== streamChunkX || centerChunkZ !== streamChunkZ;
      if (needsInitialStream || roadClearanceDirty || chunkChanged) {
        startBackgroundRebuild(focusX, focusZ);
        stepBackgroundRebuild();
      }

      syncStreamVisibility();
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

function createDisabledGrassBladeField(): GrassBladeField {
  const group = new THREE.Group();
  group.name = 'Grass blade field (disabled)';
  group.visible = false;
  return {
    group,
    syncRoadClearance() {},
    updateCameraState() {},
    dispose() {},
  };
}

function chunkSeed(chunkX: number, chunkZ: number): number {
  return ((chunkX * 73856093) ^ (chunkZ * 19349663) ^ 0x6a55b1ade) >>> 0;
}

const writeMatrix = new THREE.Matrix4();
const writeQuaternion = new THREE.Quaternion();
const writePosition = new THREE.Vector3();
const writeScale = new THREE.Vector3();
const writeEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const writeColor = new THREE.Color();

function writeChunkInstances(
  mesh: THREE.InstancedMesh,
  startIndex: number,
  chunkX: number,
  chunkZ: number,
  focusX: number,
  focusZ: number,
  context: GrassFieldContext,
): number {
  const { terrain, extent, forestCores, isBlockedAt, roadEdges } = context;
  const rng = mulberry32(chunkSeed(chunkX, chunkZ));
  const chunkMinX = chunkX * GRASS_BLADE_CHUNK_SIZE;
  const chunkMinZ = chunkZ * GRASS_BLADE_CHUNK_SIZE;
  const chunkSpan = GRASS_BLADE_CHUNK_SIZE;
  const margin = chunkSpan * 0.06;
  let instanceIndex = startIndex;
  const heightCache = new Map<number, number>();

  const heightAt = (x: number, z: number): number => {
    const key = (Math.round(x * 8) & 0xffff) | ((Math.round(z * 8) & 0xffff) << 16);
    const cached = heightCache.get(key);
    if (cached !== undefined) return cached;
    const sample = terrain.getHeightAt(x, z);
    heightCache.set(key, sample);
    return sample;
  };

  const localPlacements: { x: number; z: number; micro: boolean }[] = [];
  const tuftTarget = GRASS_TUFTS_PER_CHUNK + Math.floor(rng() * 9);

  for (let attempt = 0; attempt < GRASS_TUFT_SCATTER_ATTEMPTS && localPlacements.length < tuftTarget; attempt++) {
    const micro = rng() < 0.42 && localPlacements.length > 2;
    let x: number;
    let z: number;

    if (localPlacements.length > 0 && rng() < 0.42) {
      const anchor = localPlacements[Math.floor(rng() * localPlacements.length)]!;
      const clusterRadius = micro ? 0.22 + rng() * 0.55 : 0.45 + rng() * 1.15;
      const angle = rng() * TAU;
      x = anchor.x + Math.cos(angle) * clusterRadius;
      z = anchor.z + Math.sin(angle) * clusterRadius;
    } else {
      x = chunkMinX + margin + rng() * (chunkSpan - margin * 2);
      z = chunkMinZ + margin + rng() * (chunkSpan - margin * 2);
    }

    const spacingSq = micro ? MIN_MICRO_TUFT_SPACING_SQ : MIN_TUFT_SPACING_SQ;
    let tooClose = false;
    for (const placed of localPlacements) {
      const dx = x - placed.x;
      const dz = z - placed.z;
      if (dx * dx + dz * dz < spacingSq) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;

    if (!isInsidePlayableExtent(x, z, extent)) continue;
    if (isBlockedAt?.(x, z)) continue;
    if (isGrassNearAnyEdge(x, z, roadEdges)) continue;

    const focusDist = Math.hypot(x - focusX, z - focusZ);
    const edgeFade = edgeFadeFromFocusDistance(focusDist);
    if (edgeFade <= 0.02) continue;

    localPlacements.push({ x, z, micro });

    const density = forestDensityAt(x, z, forestCores, extent);
    const sizeRoll = Math.pow(rng(), micro ? 1.1 : 0.72);
    const scale =
      THREE.MathUtils.lerp(micro ? 0.58 : 0.88, micro ? 0.92 : 1.32, sizeRoll) *
      THREE.MathUtils.lerp(0.9, 1.06, density) *
      edgeFade;

    composeTuftMatrix(
      x,
      z,
      scale,
      rng,
      heightAt,
      writeMatrix,
      writeQuaternion,
      writePosition,
      writeScale,
      writeEuler,
    );
    mesh.setMatrixAt(instanceIndex, writeMatrix);
    writeColor.setHSL(
      0.27 + (rng() - 0.5) * 0.035,
      0.38 + rng() * 0.1,
      0.3 + rng() * 0.08,
    );
    mesh.setColorAt(instanceIndex, writeColor);
    instanceIndex++;
  }

  return instanceIndex;
}

function composeTuftMatrix(
  x: number,
  z: number,
  scale: number,
  rng: () => number,
  heightAt: (x: number, z: number) => number,
  matrix: THREE.Matrix4,
  quaternion: THREE.Quaternion,
  position: THREE.Vector3,
  scaleVector: THREE.Vector3,
  euler: THREE.Euler,
): void {
  const yaw = rng() * TAU;
  const leanDir = rng() * TAU;
  const leanAmount = THREE.MathUtils.lerp(0.14, 0.42, Math.pow(rng(), 0.65));
  const tiltX = Math.cos(leanDir) * leanAmount;
  const tiltZ = Math.sin(leanDir) * leanAmount * 0.75;
  const roll = (rng() - 0.5) * 0.22;

  position.set(x, heightAt(x, z), z);
  euler.set(tiltX, yaw, tiltZ + roll);
  quaternion.setFromEuler(euler);
  const widthScale = scale * THREE.MathUtils.lerp(0.92, 1.14, rng());
  const heightScale = scale * THREE.MathUtils.lerp(0.96, 1.18, rng());
  scaleVector.set(widthScale, heightScale, widthScale);
  matrix.compose(position, quaternion, scaleVector);
}

/** 1 near focus, 0 at outer radius. */
function edgeFadeFromFocusDistance(focusDist: number): number {
  const inner = GRASS_BLADE_NEAR_RADIUS - GRASS_EDGE_FADE_BAND;
  const outer = GRASS_BLADE_NEAR_RADIUS;
  const t = THREE.MathUtils.clamp((focusDist - inner) / (outer - inner), 0, 1);
  const smooth = t * t * (3 - 2 * t);
  return 1 - smooth;
}

function createGrassBladeMaterial(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial();
  material.name = 'Grass blade';
  material.side = THREE.DoubleSide;
  material.transparent = true;
  material.opacity = 1;
  material.alphaTest = 0.15;
  material.depthWrite = true;
  material.roughness = 0.92;
  material.metalness = 0;
  material.color.set(0xffffff);
  material.colorNode = (vertexColor() as TslNode).rgb;
  return material;
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

function createGrassTuftGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  const bladeCount = GRASS_BLADES_PER_TUFT;
  for (let i = 0; i < bladeCount; i++) {
    const spread = (i / bladeCount) * TAU + (rngHash(i) - 0.5) * 0.55;
    const yaw = spread + (i % 2 === 0 ? 0.2 : -0.16);
    const height = 0.48 + (i % 4) * 0.1 + (i % 3) * 0.055;
    const halfWidth = 0.02 + (i % 2) * 0.007;
    const lean = 0.06 + (i % 3) * 0.035 + (i % 2) * 0.02;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const leanX = cos * lean;
    const leanZ = sin * lean;
    const shade = i % 3 === 0 ? BLADE_TIP : i % 2 === 0 ? BLADE_MID : BLADE_BASE;

    appendTaperedBlade(
      positions,
      normals,
      colors,
      indices,
      cos,
      sin,
      leanX,
      leanZ,
      halfWidth,
      height,
      shade,
    );
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

function rngHash(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function appendTaperedBlade(
  positions: number[],
  normals: number[],
  colors: number[],
  indices: number[],
  cos: number,
  sin: number,
  leanX: number,
  leanZ: number,
  halfWidth: number,
  height: number,
  baseColor: THREE.Color,
): void {
  const base = positions.length / 3;
  const tipColor = BLADE_TIP.clone().lerp(baseColor, 0.42);
  const midColor = BLADE_MID.clone().lerp(baseColor, 0.62);

  const verts = [
    { x: -halfWidth * cos, y: 0, z: -halfWidth * sin, c: baseColor },
    { x: halfWidth * cos, y: 0, z: halfWidth * sin, c: baseColor },
    { x: leanX * 0.35, y: height * 0.55, z: leanZ * 0.35, c: midColor },
    { x: leanX, y: height, z: leanZ, c: tipColor },
  ];

  for (const v of verts) {
    positions.push(v.x, v.y, v.z);
    normals.push(cos * 0.35, 0.92, sin * 0.35);
    colors.push(v.c.r, v.c.g, v.c.b);
  }

  indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
}
