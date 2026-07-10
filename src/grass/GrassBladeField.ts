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
  GRASS_STREAM_CHUNK_RADIUS,
  GRASS_STREAM_FOCUS_DRIFT,
  GRASS_STREAM_SLOTS_PER_FRAME,
  GRASS_TUFT_SCATTER_ATTEMPTS,
  GRASS_TUFTS_PER_CHUNK,
  grassEdgeFadeFromFocusDistance,
  resolveCloseGroundLod,
} from './grassLodMath.ts';

export const GRASS_BLADES_ENABLED = true;

type TslNode = {
  rgb: TslNode;
};

export type GrassBladeField = {
  group: THREE.Group;
  syncRoadClearance: (network: RoadNetwork) => void;
  setBuildInteractionActive: (active: boolean) => void;
  updateCameraState: (
    cameraPosition: THREE.Vector3,
    cameraTarget: THREE.Vector3,
    cameraDistance: number,
    firstPersonActive?: boolean,
  ) => void;
  dispose: () => void;
};

const ROAD_CLEAR_MARGIN = 1.05;
const TAU = Math.PI * 2;
const GRID_SIDE = GRASS_STREAM_CHUNK_RADIUS * 2 + 1;
const SLOT_CAPACITY = GRASS_TUFTS_PER_CHUNK + 8;
const MAX_STREAM_INSTANCES = GRID_SIDE * GRID_SIDE * SLOT_CAPACITY;
const MIN_TUFT_SPACING_SQ = 0.42 * 0.42;
const MIN_MICRO_TUFT_SPACING_SQ = 0.26 * 0.26;
const hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);

/** Muted olive — aligned with forest undergrowth. */
const BLADE_BASE = new THREE.Color(0x3a5032);
const BLADE_MID = new THREE.Color(0x4a6340);
const BLADE_TIP = new THREE.Color(0x566b48);

type GrassFieldContext = {
  terrain: Terrain;
  extent: number;
  terrainExtent: number;
  forestCores: ReturnType<typeof createForestCores>;
  isBlockedAt?: (x: number, z: number) => boolean;
  roadEdges: RoadEdge[];
};

type PendingSlot = {
  gridIndex: number;
  worldChunkX: number;
  worldChunkZ: number;
  sortKey: number;
};

type SlotRecord = {
  worldChunkX: number;
  worldChunkZ: number;
  count: number;
};

export function createGrassBladeField(
  terrain: Terrain,
  options?: { isBlockedAt?: (x: number, z: number) => boolean },
): GrassBladeField {
  if (!GRASS_BLADES_ENABLED) {
    return createDisabledGrassBladeField();
  }

  const spawnConfig = createForestSpawnConfig(terrain.playableSize, terrain.size);
  const context: GrassFieldContext = {
    terrain,
    extent: spawnConfig.extent,
    terrainExtent: spawnConfig.terrainExtent,
    forestCores: createForestCores(mulberry32(0x6a55b1ade), spawnConfig),
    isBlockedAt: options?.isBlockedAt,
    roadEdges: [],
  };

  const material = createGrassBladeMaterial();
  const geometry = createGrassTuftGeometry();
  const mesh = new THREE.InstancedMesh(geometry, material, MAX_STREAM_INSTANCES);
  mesh.name = 'Grass blade stream';
  mesh.count = 0;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.visible = false;

  const group = new THREE.Group();
  group.name = 'Grass blade field';
  group.add(mesh);

  const slotRecords: SlotRecord[] = Array.from({ length: GRID_SIDE * GRID_SIDE }, () => ({
    worldChunkX: Number.NaN,
    worldChunkZ: Number.NaN,
    count: 0,
  }));

  let anchorChunkX = Number.NaN;
  let anchorChunkZ = Number.NaN;
  let anchorFocusX = 0;
  let anchorFocusZ = 0;
  let needsFullStream = true;
  let roadClearanceDirty = false;
  let pendingSlots: PendingSlot[] = [];
  let lastMaterialOpacity = Number.NaN;
  let grassZoomVisible = false;
  let wasFirstPerson = false;
  let wasGrassVisible = false;

  const chunkInStreamRange = (chunkX: number, chunkZ: number, focusX: number, focusZ: number): boolean => {
    const chunkCenterX = (chunkX + 0.5) * GRASS_BLADE_CHUNK_SIZE;
    const chunkCenterZ = (chunkZ + 0.5) * GRASS_BLADE_CHUNK_SIZE;
    const includeRadiusSq = (GRASS_BLADE_NEAR_RADIUS + GRASS_BLADE_CHUNK_SIZE * 0.85) ** 2;
    const dx = chunkCenterX - focusX;
    const dz = chunkCenterZ - focusZ;
    return dx * dx + dz * dz <= includeRadiusSq;
  };

  const gridIndex = (localX: number, localZ: number): number => localZ * GRID_SIDE + localX;

  const worldChunkAt = (centerChunkX: number, centerChunkZ: number, localX: number, localZ: number) => ({
    chunkX: centerChunkX + localX - GRASS_STREAM_CHUNK_RADIUS,
    chunkZ: centerChunkZ + localZ - GRASS_STREAM_CHUNK_RADIUS,
  });

  const slotDistanceSq = (chunkX: number, chunkZ: number, focusX: number, focusZ: number): number => {
    const centerX = (chunkX + 0.5) * GRASS_BLADE_CHUNK_SIZE;
    const centerZ = (chunkZ + 0.5) * GRASS_BLADE_CHUNK_SIZE;
    const dx = centerX - focusX;
    const dz = centerZ - focusZ;
    return dx * dx + dz * dz;
  };

  const refreshMeshCount = (): void => {
    mesh.count = MAX_STREAM_INSTANCES;
  };

  const regenerateSlot = (
    gridIdx: number,
    worldChunkX: number,
    worldChunkZ: number,
    focusX: number,
    focusZ: number,
  ): void => {
    const slotStart = gridIdx * SLOT_CAPACITY;
    clearSlotRange(mesh, slotStart, SLOT_CAPACITY);
    if (!chunkInStreamRange(worldChunkX, worldChunkZ, focusX, focusZ)) {
      slotRecords[gridIdx] = { worldChunkX, worldChunkZ, count: 0 };
      return;
    }

    const written = writeChunkInstances(
      mesh,
      slotStart,
      worldChunkX,
      worldChunkZ,
      focusX,
      focusZ,
      context,
      SLOT_CAPACITY,
    );
    slotRecords[gridIdx] = { worldChunkX, worldChunkZ, count: written - slotStart };
  };

  const queueFullStream = (centerChunkX: number, centerChunkZ: number, focusX: number, focusZ: number): void => {
    pendingSlots = [];
    for (let localZ = 0; localZ < GRID_SIDE; localZ++) {
      for (let localX = 0; localX < GRID_SIDE; localX++) {
        const { chunkX, chunkZ } = worldChunkAt(centerChunkX, centerChunkZ, localX, localZ);
        if (!chunkInStreamRange(chunkX, chunkZ, focusX, focusZ)) continue;
        pendingSlots.push({
          gridIndex: gridIndex(localX, localZ),
          worldChunkX: chunkX,
          worldChunkZ: chunkZ,
          sortKey: slotDistanceSq(chunkX, chunkZ, focusX, focusZ),
        });
      }
    }
    pendingSlots.sort((a, b) => a.sortKey - b.sortKey);
    anchorChunkX = centerChunkX;
    anchorChunkZ = centerChunkZ;
    anchorFocusX = focusX;
    anchorFocusZ = focusZ;
    needsFullStream = false;
    roadClearanceDirty = false;
  };

  let buildInteractionActive = false;
  let boundingSphereFrame = 0;

  const stepPendingSlots = (focusX: number, focusZ: number): void => {
    if (pendingSlots.length === 0) return;

    const slotBudget = buildInteractionActive
      ? Math.max(2, Math.floor(GRASS_STREAM_SLOTS_PER_FRAME * 0.4))
      : GRASS_STREAM_SLOTS_PER_FRAME;
    const end = Math.min(slotBudget, pendingSlots.length);
    for (let index = 0; index < end; index++) {
      const slot = pendingSlots[index]!;
      regenerateSlot(slot.gridIndex, slot.worldChunkX, slot.worldChunkZ, focusX, focusZ);
    }
    pendingSlots.splice(0, end);
    refreshMeshCount();
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    boundingSphereFrame++;
    const sphereInterval = buildInteractionActive ? 4 : 1;
    if (boundingSphereFrame % sphereInterval === 0) {
      mesh.computeBoundingSphere();
    }
  };

  const shouldRecentreStream = (
    centerChunkX: number,
    centerChunkZ: number,
    focusX: number,
    focusZ: number,
  ): boolean => {
    if (needsFullStream || roadClearanceDirty || !Number.isFinite(anchorChunkX)) return true;
    if (centerChunkX !== anchorChunkX || centerChunkZ !== anchorChunkZ) return true;
    const driftSq = GRASS_STREAM_FOCUS_DRIFT * GRASS_STREAM_FOCUS_DRIFT;
    const dx = focusX - anchorFocusX;
    const dz = focusZ - anchorFocusZ;
    return dx * dx + dz * dz >= driftSq;
  };

  return {
    group,
    syncRoadClearance(network: RoadNetwork) {
      context.roadEdges = [...network.edges.values()];
      roadClearanceDirty = true;
    },
    setBuildInteractionActive(active: boolean) {
      buildInteractionActive = active;
    },
    updateCameraState(
      cameraPosition: THREE.Vector3,
      cameraTarget: THREE.Vector3,
      cameraDistance: number,
      firstPersonActive = false,
    ) {
      if (firstPersonActive && !wasFirstPerson) {
        needsFullStream = true;
      }
      wasFirstPerson = firstPersonActive;

      const { grassOpacity } = resolveCloseGroundLod(cameraDistance, firstPersonActive);
      grassZoomVisible = grassOpacity > 0.02;

      if (!Number.isFinite(lastMaterialOpacity) || Math.abs(grassOpacity - lastMaterialOpacity) > 0.008) {
        lastMaterialOpacity = grassOpacity;
        material.opacity = grassOpacity;
        const useTransparency = grassOpacity < 0.995;
        if (material.transparent !== useTransparency) {
          material.transparent = useTransparency;
          material.depthWrite = !useTransparency;
          material.needsUpdate = true;
        }
      }

      mesh.visible = grassZoomVisible;
      if (!grassZoomVisible) {
        pendingSlots = [];
        wasGrassVisible = false;
        return;
      }
      if (!wasGrassVisible) {
        needsFullStream = true;
      }
      wasGrassVisible = true;

      const focusX = firstPersonActive ? cameraPosition.x : cameraTarget.x;
      const focusZ = firstPersonActive ? cameraPosition.z : cameraTarget.z;
      const centerChunkX = Math.floor(focusX / GRASS_BLADE_CHUNK_SIZE);
      const centerChunkZ = Math.floor(focusZ / GRASS_BLADE_CHUNK_SIZE);

      if (shouldRecentreStream(centerChunkX, centerChunkZ, focusX, focusZ)) {
        queueFullStream(centerChunkX, centerChunkZ, focusX, focusZ);
      }

      stepPendingSlots(focusX, focusZ);
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
    setBuildInteractionActive() {},
    updateCameraState() {},
    dispose() {},
  };
}

function clearSlotRange(mesh: THREE.InstancedMesh, startIndex: number, capacity: number): void {
  for (let index = 0; index < capacity; index++) {
    mesh.setMatrixAt(startIndex + index, hiddenMatrix);
  }
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
  maxInstances = Number.POSITIVE_INFINITY,
): number {
  const { terrain, extent, terrainExtent, forestCores, isBlockedAt, roadEdges } = context;
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
    if (instanceIndex - startIndex >= maxInstances) break;
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
    const edgeFade = grassEdgeFadeFromFocusDistance(focusDist);
    if (edgeFade <= 0.02) continue;

    localPlacements.push({ x, z, micro });

    const density = forestDensityAt(x, z, forestCores, extent, terrainExtent);
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

  for (let pad = instanceIndex; pad < startIndex + maxInstances && Number.isFinite(maxInstances); pad++) {
    mesh.setMatrixAt(pad, hiddenMatrix);
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
