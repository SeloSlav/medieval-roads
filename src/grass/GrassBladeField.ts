import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { vertexColor } from 'three/tsl';
import { applyFoliageDoubleSideNormalsNode } from '../scene/foliageDoubleSideNormals.ts';
import {
  createSeedThreeGrassMaterial,
  createSeedThreeTuftVariants,
  disposeSeedThreeGrassTextureCache,
  loadSeedThreeGrassTextures,
  sampleSeedThreeGrassTint,
  type SeedThreeTuftVariant,
} from '../vegetation/seedthree/seedThreeGrass.ts';
import type { Terrain } from '../terrain/Terrain.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import { RoadSpatialIndex } from '../roads/roadSpatialIndex.ts';
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
  setRoadDraftActive: (active: boolean) => void;
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
const SLOT_CAPACITY = GRASS_TUFTS_PER_CHUNK + 14;
const MAX_STREAM_INSTANCES = GRID_SIDE * GRID_SIDE * SLOT_CAPACITY;
const MIN_TUFT_SPACING_SQ = 0.26 * 0.26;
const MIN_MICRO_TUFT_SPACING_SQ = 0.16 * 0.16;
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
  roadSpatialIndex: RoadSpatialIndex | null;
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
  meshCounts: number[];
};

type GrassStreamMesh = {
  mesh: THREE.InstancedMesh;
  variant?: SeedThreeTuftVariant;
  tintAttr?: THREE.InstancedBufferAttribute;
  anchorAttr?: THREE.InstancedBufferAttribute;
};

export type GrassBladeFieldOptions = {
  isBlockedAt?: (x: number, z: number) => boolean;
  useSeedThreeClumps?: boolean;
  maxAnisotropy?: number;
};

export async function createGrassBladeField(
  terrain: Terrain,
  options?: GrassBladeFieldOptions,
): Promise<GrassBladeField> {
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
    roadSpatialIndex: null,
  };

  const useSeedThreeClumps = options?.useSeedThreeClumps === true;
  let streamMeshes: GrassStreamMesh[];
  let material: THREE.Material;
  let disposeResources: () => void;

  if (useSeedThreeClumps) {
    const textures = await loadSeedThreeGrassTextures(options?.maxAnisotropy ?? 4);
    const variants = createSeedThreeTuftVariants();
    material = createSeedThreeGrassMaterial(textures);
    streamMeshes = variants.map((variant, index) => {
      const geometry = variant.geometry;
      const tintAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_STREAM_INSTANCES * 3), 3);
      const anchorAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_STREAM_INSTANCES * 3), 3);
      geometry.setAttribute('aTint', tintAttr);
      geometry.setAttribute('aAnchorPos', anchorAttr);
      const mesh = new THREE.InstancedMesh(geometry, material, MAX_STREAM_INSTANCES);
      mesh.name = index === 0 ? 'SeedThree grass meadow' : 'SeedThree grass clump';
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.renderOrder = 0;
      mesh.visible = false;
      return { mesh, variant, tintAttr, anchorAttr };
    });
    disposeResources = () => {
      for (const entry of streamMeshes) entry.mesh.geometry.dispose();
      material.dispose();
      disposeSeedThreeGrassTextureCache();
    };
  } else {
    material = createGrassBladeMaterial();
    const geometry = createGrassTuftGeometry();
    const mesh = new THREE.InstancedMesh(geometry, material, MAX_STREAM_INSTANCES);
    mesh.name = 'Grass blade stream';
    mesh.count = 0;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.visible = false;
    streamMeshes = [{ mesh }];
    disposeResources = () => {
      geometry.dispose();
      material.dispose();
    };
  }

  const group = new THREE.Group();
  group.name = useSeedThreeClumps ? 'SeedThree grass field' : 'Grass blade field';
  for (const entry of streamMeshes) group.add(entry.mesh);

  const slotRecords: SlotRecord[] = Array.from({ length: GRID_SIDE * GRID_SIDE }, () => ({
    worldChunkX: Number.NaN,
    worldChunkZ: Number.NaN,
    meshCounts: Array.from({ length: streamMeshes.length }, () => 0),
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
    for (let meshIndex = 0; meshIndex < streamMeshes.length; meshIndex++) {
      let maxExclusive = 0;
      for (let gridIdx = 0; gridIdx < slotRecords.length; gridIdx++) {
        const count = slotRecords[gridIdx]!.meshCounts[meshIndex] ?? 0;
        if (count <= 0) continue;
        maxExclusive = Math.max(maxExclusive, gridIdx * SLOT_CAPACITY + count);
      }
      streamMeshes[meshIndex]!.mesh.count = maxExclusive;
    }
  };

  const regenerateSlot = (
    gridIdx: number,
    worldChunkX: number,
    worldChunkZ: number,
    focusX: number,
    focusZ: number,
  ): void => {
    const slotStart = gridIdx * SLOT_CAPACITY;
    for (const entry of streamMeshes) {
      clearSlotRange(entry.mesh, slotStart, SLOT_CAPACITY);
    }
    if (!chunkInStreamRange(worldChunkX, worldChunkZ, focusX, focusZ)) {
      slotRecords[gridIdx] = {
        worldChunkX,
        worldChunkZ,
        meshCounts: Array.from({ length: streamMeshes.length }, () => 0),
      };
      return;
    }

    const meshCounts = useSeedThreeClumps
      ? writeSeedThreeChunkInstances(
          streamMeshes,
          slotStart,
          worldChunkX,
          worldChunkZ,
          context,
          SLOT_CAPACITY,
        )
      : [
          writeChunkInstances(
            streamMeshes[0]!.mesh,
            slotStart,
            worldChunkX,
            worldChunkZ,
            context,
            SLOT_CAPACITY,
          ) - slotStart,
        ];
    slotRecords[gridIdx] = { worldChunkX, worldChunkZ, meshCounts };
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
  let roadDraftActive = false;
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
    for (const entry of streamMeshes) {
      entry.mesh.instanceMatrix.needsUpdate = true;
      if (entry.mesh.instanceColor) entry.mesh.instanceColor.needsUpdate = true;
      if (entry.tintAttr) entry.tintAttr.needsUpdate = true;
      if (entry.anchorAttr) entry.anchorAttr.needsUpdate = true;
    }
    boundingSphereFrame++;
    const sphereInterval = buildInteractionActive ? 4 : 1;
    if (boundingSphereFrame % sphereInterval === 0) {
      for (const entry of streamMeshes) entry.mesh.computeBoundingSphere();
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
      context.roadSpatialIndex = RoadSpatialIndex.fromNetwork(network);
      roadClearanceDirty = true;
    },
    setBuildInteractionActive(active: boolean) {
      buildInteractionActive = active;
    },
    setRoadDraftActive(active: boolean) {
      roadDraftActive = active;
      if (active) pendingSlots = [];
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

      for (const entry of streamMeshes) entry.mesh.visible = grassZoomVisible;
      if (!grassZoomVisible) {
        pendingSlots = [];
        wasGrassVisible = false;
        return;
      }
      if (!wasGrassVisible) {
        needsFullStream = true;
      }
      wasGrassVisible = true;

      if (roadDraftActive) return;

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
      disposeResources();
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
    setRoadDraftActive() {},
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
const Y_AXIS = new THREE.Vector3(0, 1, 0);

function writeSeedThreeChunkInstances(
  streamMeshes: GrassStreamMesh[],
  startIndex: number,
  chunkX: number,
  chunkZ: number,
  context: GrassFieldContext,
  maxInstancesPerMesh = Number.POSITIVE_INFINITY,
): number[] {
  const { terrain, extent, terrainExtent, forestCores, isBlockedAt, roadSpatialIndex } = context;
  const rng = mulberry32(chunkSeed(chunkX, chunkZ));
  const chunkMinX = chunkX * GRASS_BLADE_CHUNK_SIZE;
  const chunkMinZ = chunkZ * GRASS_BLADE_CHUNK_SIZE;
  const chunkSpan = GRASS_BLADE_CHUNK_SIZE;
  const margin = chunkSpan * 0.02;
  const meshWriteIndices = streamMeshes.map(() => startIndex);
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
  const tuftTarget = GRASS_TUFTS_PER_CHUNK + Math.floor(rng() * 14);

  const tryPlaceTuft = (micro: boolean): boolean => {
    if (streamMeshes.every((_, meshIndex) => meshWriteIndices[meshIndex]! - startIndex >= maxInstancesPerMesh)) {
      return false;
    }
    if (!micro && localPlacements.filter((p) => !p.micro).length >= tuftTarget) return false;

    let x: number;
    let z: number;
    if (localPlacements.length > 0 && rng() < 0.58) {
      const anchor = localPlacements[Math.floor(rng() * localPlacements.length)]!;
      const clusterRadius = micro ? 0.18 + rng() * 0.48 : 0.35 + rng() * 0.95;
      const angle = rng() * TAU;
      x = anchor.x + Math.cos(angle) * clusterRadius;
      z = anchor.z + Math.sin(angle) * clusterRadius;
    } else {
      x = chunkMinX + margin + rng() * (chunkSpan - margin * 2);
      z = chunkMinZ + margin + rng() * (chunkSpan - margin * 2);
    }

    const spacingSq = micro ? MIN_MICRO_TUFT_SPACING_SQ : MIN_TUFT_SPACING_SQ;
    for (const placed of localPlacements) {
      const dx = x - placed.x;
      const dz = z - placed.z;
      if (dx * dx + dz * dz < spacingSq) return false;
    }

    if (!isInsidePlayableExtent(x, z, extent)) return false;
    if (isBlockedAt?.(x, z)) return false;
    if (isGrassNearAnyRoad(x, z, roadSpatialIndex)) return false;

    const variantIndex = rng() < (streamMeshes[0]?.variant?.share ?? 0.62) ? 0 : 1;
    const entry = streamMeshes[variantIndex];
    if (!entry?.variant || meshWriteIndices[variantIndex]! - startIndex >= maxInstancesPerMesh) return false;

    localPlacements.push({ x, z, micro });

    const density = forestDensityAt(x, z, forestCores, extent, terrainExtent);
    if (density > 0.48 && rng() > 0.4) return false;
    if (density > 0.3 && rng() > 0.66) return false;
    if (density > 0.22 && micro && rng() > 0.52) return false;

    const dry = Math.min(1, Math.max(0, (1 - density - 0.15) * 1.2)) + (rng() < 0.1 ? 0.3 : 0);
    const forestHeightMul = density > 0.35 ? THREE.MathUtils.lerp(0.72, 0.92, density) : 1;
    const heightMul =
      (micro ? THREE.MathUtils.lerp(0.42, 0.72, rng()) : THREE.MathUtils.lerp(0.55, 1.15, rng())) *
      forestHeightMul;
    const height =
      heightMul *
      THREE.MathUtils.lerp(0.9, 1.06, density) *
      entry.variant.tall;
    const widthScale = (height * THREE.MathUtils.lerp(micro ? 1.2 : 1.4, micro ? 1.6 : 2.1, rng())) / entry.variant.tall;

    const rootY = heightAt(x, z) - 0.02;
    composeSeedThreeTuftMatrix(x, z, rootY, height, widthScale, rng, writeMatrix, writeQuaternion, writePosition, writeScale);
    const instanceIndex = meshWriteIndices[variantIndex]!;
    entry.mesh.setMatrixAt(instanceIndex, writeMatrix);
    const tint = sampleSeedThreeGrassTint(rng, dry);
    entry.tintAttr?.setXYZ(instanceIndex, tint.x, tint.y, tint.z);
    entry.anchorAttr?.setXYZ(instanceIndex, x, rootY, z);
    meshWriteIndices[variantIndex] = instanceIndex + 1;
    return true;
  };

  for (let attempt = 0; attempt < GRASS_TUFT_SCATTER_ATTEMPTS; attempt++) {
    if (localPlacements.filter((p) => !p.micro).length >= tuftTarget) break;
    tryPlaceTuft(false);
  }

  const microTarget = Math.floor(tuftTarget * 0.42);
  for (let attempt = 0; attempt < GRASS_TUFT_SCATTER_ATTEMPTS && localPlacements.filter((p) => p.micro).length < microTarget; attempt++) {
    if (localPlacements.length < 3) break;
    tryPlaceTuft(true);
  }

  for (let meshIndex = 0; meshIndex < streamMeshes.length; meshIndex++) {
    const entry = streamMeshes[meshIndex]!;
    for (
      let pad = meshWriteIndices[meshIndex]!;
      pad < startIndex + maxInstancesPerMesh && Number.isFinite(maxInstancesPerMesh);
      pad++
    ) {
      entry.mesh.setMatrixAt(pad, hiddenMatrix);
    }
  }

  return meshWriteIndices.map((index) => index - startIndex);
}

function composeSeedThreeTuftMatrix(
  x: number,
  z: number,
  rootY: number,
  height: number,
  widthScale: number,
  rng: () => number,
  matrix: THREE.Matrix4,
  quaternion: THREE.Quaternion,
  position: THREE.Vector3,
  scaleVector: THREE.Vector3,
): void {
  const yaw = rng() * TAU;
  quaternion.setFromAxisAngle(Y_AXIS, yaw);
  position.set(x, rootY, z);
  scaleVector.set(widthScale, height, widthScale);
  matrix.compose(position, quaternion, scaleVector);
}

function writeChunkInstances(
  mesh: THREE.InstancedMesh,
  startIndex: number,
  chunkX: number,
  chunkZ: number,
  context: GrassFieldContext,
  maxInstances = Number.POSITIVE_INFINITY,
): number {
  const { terrain, extent, terrainExtent, forestCores, isBlockedAt, roadSpatialIndex } = context;
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
    if (isGrassNearAnyRoad(x, z, roadSpatialIndex)) continue;

    localPlacements.push({ x, z, micro });

    const density = forestDensityAt(x, z, forestCores, extent, terrainExtent);
    const sizeRoll = Math.pow(rng(), micro ? 1.1 : 0.72);
    const scale =
      THREE.MathUtils.lerp(micro ? 0.58 : 0.88, micro ? 0.92 : 1.32, sizeRoll) *
      THREE.MathUtils.lerp(0.9, 1.06, density);

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
  applyFoliageDoubleSideNormalsNode(material);
  return material;
}

function isGrassNearAnyRoad(x: number, z: number, index: RoadSpatialIndex | null): boolean {
  if (!index) return false;
  return index.isNearAnyRoad(x, z, ROAD_CLEAR_MARGIN);
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
