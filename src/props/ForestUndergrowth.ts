import * as THREE from 'three';
import { MeshSSSNodeMaterial } from 'three/webgpu';
import {
  attribute,
  cameraViewMatrix,
  float,
  modelWorldMatrix,
  normalMap,
  normalView,
  normalize,
  positionLocal,
  sin,
  texture,
  time,
  uniform,
  vec4,
} from 'three/tsl';
import { windSpeed, windStrength, WIND_DIR } from '@seedthree/core/wind.js';
import { createRootedFoliageWindPosition } from '../vegetation/seedthree/seedThreeFoliageWind.ts';
import type { Terrain } from '../terrain/Terrain.ts';
import { applyFoliageDoubleSideNormals } from '../scene/foliageDoubleSideNormals.ts';
import { TREE_SHADOW_CAST_LAYER } from '../scene/SceneLayers.ts';
import type { RendererBackendKind } from '../scene/RendererBackend.ts';
import { seedThreeLeafUrl } from '../vegetation/seedthree/seedThreeTextures.ts';
import {
  CENTRAL_CLEARING_RADIUS,
  type ForestCore,
  type ForestSpawnConfig,
  forestDensityAt,
  hasMinimumDistance,
  isInsidePlayableExtent,
  pick,
  samplePointInForestCore,
  samplePointInPlayableExtent,
} from './forestField.ts';

type TslNode = {
  mul: (value: unknown) => TslNode;
  add: (value: unknown) => TslNode;
  sub: (value: unknown) => TslNode;
  div: (value: unknown) => TslNode;
  x: TslNode;
  y: TslNode;
  z: TslNode;
  r: TslNode;
  xyz: TslNode;
};

const tsl = {
  attribute: attribute as (name: string, type: string) => TslNode,
  cameraViewMatrix: cameraViewMatrix as TslNode,
  float: float as (value: number) => TslNode,
  modelWorldMatrix: modelWorldMatrix as TslNode,
  normalMap: normalMap as (sample: unknown) => TslNode,
  normalView: normalView as TslNode,
  normalize: normalize as (value: unknown) => TslNode,
  positionLocal: positionLocal as TslNode,
  sin: sin as (value: unknown) => TslNode,
  texture: texture as (map: THREE.Texture) => TslNode,
  time: time as TslNode,
  uniform: uniform as <T>(value: T) => { value: T },
  vec4: vec4 as (...values: unknown[]) => TslNode,
  windSpeed: windSpeed as unknown as TslNode,
  windStrength: windStrength as unknown as TslNode,
};

const TAU = Math.PI * 2;
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const windQuat = new THREE.Quaternion();
const windVecScratch = new THREE.Vector3();

export type UndergrowthKind = 'bush' | 'fern' | 'juniper';

export type UndergrowthPlacement = {
  x: number;
  z: number;
  kind: UndergrowthKind;
  scale: number;
  yaw: number;
  meshIndex: number;
};

type UndergrowthTextureSet = {
  albedo: THREE.Texture;
  normal: THREE.Texture | null;
  roughness: THREE.Texture | null;
  translucency: THREE.Texture | null;
};

type UndergrowthTextureFiles = {
  albedo: string;
  normal: string;
  roughness: string;
  translucency: string;
};

export type UndergrowthMaterials = {
  bush: THREE.Material;
  fern: THREE.Material;
  juniper: THREE.Material;
  shadowCast: THREE.MeshStandardMaterial;
  bushShadowDepth: THREE.MeshDepthMaterial;
  fernShadowDepth: THREE.MeshDepthMaterial;
  juniperShadowDepth: THREE.MeshDepthMaterial;
  textures: THREE.Texture[];
};

export type UndergrowthInstances = {
  group: THREE.Group;
  bushMesh: THREE.InstancedMesh;
  fernMesh: THREE.InstancedMesh;
  juniperMesh: THREE.InstancedMesh;
  bushShadowMesh: THREE.InstancedMesh;
  fernShadowMesh: THREE.InstancedMesh;
  juniperShadowMesh: THREE.InstancedMesh;
  placements: UndergrowthPlacement[];
  bushMatrices: THREE.Matrix4[];
  fernMatrices: THREE.Matrix4[];
  juniperMatrices: THREE.Matrix4[];
};

type UndergrowthBucket = {
  placements: UndergrowthPlacement[];
  mesh: THREE.InstancedMesh;
  shadowMesh: THREE.InstancedMesh;
  matrices: THREE.Matrix4[];
  tintAttr: THREE.InstancedBufferAttribute;
  anchorAttr: THREE.InstancedBufferAttribute;
  windVecAttr: THREE.InstancedBufferAttribute;
};

const CARD_FILES: Record<UndergrowthKind, UndergrowthTextureFiles> = {
  bush: {
    albedo: 'bilberry_albedo.png',
    normal: 'bilberry_normal.png',
    roughness: 'bilberry_roughness.png',
    translucency: 'bilberry_translucency.png',
  },
  fern: {
    albedo: 'fern_albedo.png',
    normal: 'fern_normal.png',
    roughness: 'fern_roughness.png',
    translucency: 'fern_translucency.png',
  },
  juniper: {
    albedo: 'juniper_scrub_albedo.png',
    normal: 'juniper_scrub_normal.png',
    roughness: 'juniper_scrub_roughness.png',
    translucency: 'juniper_scrub_translucency.png',
  },
};

const CARD_GEOMETRY = {
  bush: { quads: 7, width: 0.82, tiltMin: 0.14, tiltSpan: 0.42, heightMin: 0.7, heightSpan: 0.45, baseSpread: 0.12 },
  fern: { quads: 8, width: 0.62, tiltMin: 0.38, tiltSpan: 0.42, heightMin: 0.82, heightSpan: 0.34, baseSpread: 0.08 },
  juniper: { quads: 6, width: 0.88, tiltMin: 0.18, tiltSpan: 0.48, heightMin: 0.72, heightSpan: 0.42, baseSpread: 0.1 },
} satisfies Record<UndergrowthKind, CardGeometrySpec>;

const loader = new THREE.TextureLoader();

export async function createUndergrowthMaterials(
  maxAnisotropy: number,
  rendererBackend: RendererBackendKind | undefined,
  _sharedTextures: THREE.Texture[],
): Promise<UndergrowthMaterials> {
  const [bushTextures, fernTextures, juniperTextures] = await Promise.all([
    loadUndergrowthTextures(CARD_FILES.bush, maxAnisotropy),
    loadUndergrowthTextures(CARD_FILES.fern, maxAnisotropy),
    loadUndergrowthTextures(CARD_FILES.juniper, maxAnisotropy),
  ]);
  const useNodeMaterials = rendererBackend === 'webgpu';
  const textures = collectTextures(bushTextures, fernTextures, juniperTextures);

  return {
    bush: createUndergrowthCardMaterial('SeedThree bilberry undergrowth', bushTextures, useNodeMaterials, [0.3, 0.44, 0.16]),
    fern: createUndergrowthCardMaterial('SeedThree fern undergrowth', fernTextures, useNodeMaterials, [0.26, 0.5, 0.18]),
    juniper: createUndergrowthCardMaterial('SeedThree juniper undergrowth', juniperTextures, useNodeMaterials, [0.22, 0.36, 0.14]),
    shadowCast: new THREE.MeshStandardMaterial({
      transparent: true,
      opacity: 0,
      colorWrite: false,
      depthWrite: false,
    }),
    bushShadowDepth: new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }),
    fernShadowDepth: new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }),
    juniperShadowDepth: new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }),
    textures,
  };
}

export function createUndergrowthPlacements(
  rng: () => number,
  forestCores: ForestCore[],
  spawnConfig: ForestSpawnConfig,
  isBlockedAt?: (x: number, z: number) => boolean,
): UndergrowthPlacement[] {
  const placements: UndergrowthPlacement[] = [];
  let attempts = 0;

  while (placements.length < spawnConfig.undergrowthTargetCount && attempts < spawnConfig.undergrowthTargetCount * 36) {
    attempts++;
    const core = rng() < 0.84 ? pick(forestCores, rng) : undefined;
    const sampled = core
      ? samplePointInForestCore(core, rng)
      : samplePointInPlayableExtent(rng, spawnConfig.extent);
    const { x, z } = sampled;

    if (!isInsidePlayableExtent(x, z, spawnConfig.extent)) continue;
    if (Math.hypot(x, z) < CENTRAL_CLEARING_RADIUS + rng() * 12) continue;

    const density = forestDensityAt(x, z, forestCores, spawnConfig.extent, spawnConfig.terrainExtent);
    if (density < 0.18 || rng() > density * 1.12) continue;

    const kind = pickUndergrowthKind(rng, density);
    const minDistance =
      kind === 'fern'
        ? THREE.MathUtils.lerp(1.3, 0.8, density)
        : kind === 'juniper'
          ? THREE.MathUtils.lerp(1.85, 1.25, density)
          : THREE.MathUtils.lerp(1.6, 1.0, density);
    if (!hasMinimumDistance(placements, x, z, minDistance)) continue;
    if (isBlockedAt?.(x, z)) continue;

    placements.push({
      x,
      z,
      kind,
      scale: sampleUndergrowthScale(kind, density, rng),
      yaw: rng() * TAU,
      meshIndex: -1,
    });
  }

  return placements;
}

export function buildUndergrowthInstances(
  placements: UndergrowthPlacement[],
  terrain: Terrain,
  materials: UndergrowthMaterials,
  rng: () => number,
): UndergrowthInstances {
  const group = new THREE.Group();
  group.name = 'SeedThree temperate undergrowth';

  const bushPlacements = placements.filter((p) => p.kind === 'bush');
  const fernPlacements = placements.filter((p) => p.kind === 'fern');
  const juniperPlacements = placements.filter((p) => p.kind === 'juniper');

  const bush = createUndergrowthBucket('bush', bushPlacements, materials.bush, materials.shadowCast, materials.bushShadowDepth);
  const fern = createUndergrowthBucket('fern', fernPlacements, materials.fern, materials.shadowCast, materials.fernShadowDepth);
  const juniper = createUndergrowthBucket('juniper', juniperPlacements, materials.juniper, materials.shadowCast, materials.juniperShadowDepth);

  placeUndergrowthBucket(bush, terrain, rng);
  placeUndergrowthBucket(fern, terrain, rng);
  placeUndergrowthBucket(juniper, terrain, rng);

  group.add(
    bush.mesh,
    fern.mesh,
    juniper.mesh,
    bush.shadowMesh,
    fern.shadowMesh,
    juniper.shadowMesh,
  );

  return {
    group,
    bushMesh: bush.mesh,
    fernMesh: fern.mesh,
    juniperMesh: juniper.mesh,
    bushShadowMesh: bush.shadowMesh,
    fernShadowMesh: fern.shadowMesh,
    juniperShadowMesh: juniper.shadowMesh,
    placements,
    bushMatrices: bush.matrices,
    fernMatrices: fern.matrices,
    juniperMatrices: juniper.matrices,
  };
}

export function disposeUndergrowthInstances(instances: UndergrowthInstances, materials: UndergrowthMaterials): void {
  instances.bushMesh.geometry.dispose();
  instances.fernMesh.geometry.dispose();
  instances.juniperMesh.geometry.dispose();
  instances.bushShadowMesh.geometry.dispose();
  instances.fernShadowMesh.geometry.dispose();
  instances.juniperShadowMesh.geometry.dispose();
  materials.bush.dispose();
  materials.fern.dispose();
  materials.juniper.dispose();
  materials.shadowCast.dispose();
  materials.bushShadowDepth.dispose();
  materials.fernShadowDepth.dispose();
  materials.juniperShadowDepth.dispose();
  materials.textures.forEach((texture) => texture.dispose());
}

function createUndergrowthBucket(
  kind: UndergrowthKind,
  placements: UndergrowthPlacement[],
  material: THREE.Material,
  shadowCast: THREE.MeshStandardMaterial,
  shadowDepth: THREE.MeshDepthMaterial,
): UndergrowthBucket {
  const capacity = Math.max(placements.length, 1);
  const geometry = createCardClumpGeometry(CARD_GEOMETRY[kind]);
  const tintAttr = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  const anchorAttr = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  const windVecAttr = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  geometry.setAttribute('aTint', tintAttr);
  geometry.setAttribute('aAnchorPos', anchorAttr);
  geometry.setAttribute('aWindVec', windVecAttr);

  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.name = `SeedThree ${kind} undergrowth cards`;
  mesh.count = placements.length;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.renderOrder = 2;
  mesh.frustumCulled = false;

  const shadowMesh = createShadowInstancedMesh(
    createUndergrowthShadowGeometry(kind),
    shadowCast,
    shadowDepth,
    capacity,
    `SeedThree ${kind} undergrowth shadows`,
  );
  shadowMesh.count = placements.length;

  return {
    placements,
    mesh,
    shadowMesh,
    matrices: placements.map(() => new THREE.Matrix4()),
    tintAttr,
    anchorAttr,
    windVecAttr,
  };
}

function placeUndergrowthBucket(bucket: UndergrowthBucket, terrain: Terrain, rng: () => number): void {
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scaleVector = new THREE.Vector3();
  const color = new THREE.Color();

  bucket.placements.forEach((placement, index) => {
    placement.meshIndex = index;
    const yaw = composeUndergrowthMatrix(placement, terrain, rng, matrix, quaternion, position, scaleVector);
    bucket.mesh.setMatrixAt(index, matrix);
    bucket.shadowMesh.setMatrixAt(index, matrix);
    bucket.matrices[index].copy(matrix);

    const tint = sampleUndergrowthTint(placement.kind, rng);
    bucket.tintAttr.setXYZ(index, tint.x, tint.y, tint.z);
    bucket.anchorAttr.setXYZ(index, position.x, position.y, position.z);
    const windVec = undergrowthWindVecForYaw(yaw, scaleVector);
    bucket.windVecAttr.setXYZ(index, windVec.x, windVec.y, windVec.z);
    color.setRGB(tint.x, tint.y, tint.z);
    bucket.mesh.setColorAt(index, color);
  });

  bucket.mesh.instanceMatrix.needsUpdate = true;
  bucket.shadowMesh.instanceMatrix.needsUpdate = true;
  bucket.tintAttr.needsUpdate = true;
  bucket.anchorAttr.needsUpdate = true;
  bucket.windVecAttr.needsUpdate = true;
  if (bucket.mesh.instanceColor) bucket.mesh.instanceColor.needsUpdate = true;
}

function createShadowInstancedMesh(
  geometry: THREE.BufferGeometry,
  shadowCast: THREE.MeshStandardMaterial,
  shadowDepth: THREE.MeshDepthMaterial,
  count: number,
  name: string,
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, shadowCast, count);
  mesh.name = name;
  mesh.layers.set(TREE_SHADOW_CAST_LAYER);
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  mesh.customDepthMaterial = shadowDepth;
  return mesh;
}

function composeUndergrowthMatrix(
  placement: UndergrowthPlacement,
  terrain: Terrain,
  rng: () => number,
  matrix: THREE.Matrix4,
  quaternion: THREE.Quaternion,
  position: THREE.Vector3,
  scaleVector: THREE.Vector3,
): number {
  const y = terrain.getHeightAt(placement.x, placement.z) + 0.05;
  const yaw = placement.yaw + (rng() - 0.5) * 0.24;
  const leanDirection = rng() * TAU;
  const lean = placement.kind === 'fern'
    ? THREE.MathUtils.lerp(0.1, 0.28, rng())
    : THREE.MathUtils.lerp(0.04, 0.16, rng());
  position.set(placement.x, y, placement.z);
  quaternion.setFromEuler(
    new THREE.Euler(
      Math.cos(leanDirection) * lean,
      yaw,
      Math.sin(leanDirection) * lean * 0.7,
      'YXZ',
    ),
  );
  const widthFactor = placement.kind === 'fern' ? 1.15 : placement.kind === 'juniper' ? 1.35 : 1.28;
  const widthScale = placement.scale * widthFactor * THREE.MathUtils.lerp(0.9, 1.14, rng());
  const heightScale = placement.scale * THREE.MathUtils.lerp(0.92, 1.14, rng());
  scaleVector.set(widthScale, heightScale, widthScale);
  matrix.compose(position, quaternion, scaleVector);
  return yaw;
}

function pickUndergrowthKind(rng: () => number, density: number): UndergrowthKind {
  const juniperChance = THREE.MathUtils.lerp(0.18, 0.055, density);
  const fernChance = THREE.MathUtils.lerp(0.26, 0.42, density);
  const roll = rng();
  if (roll < juniperChance) return 'juniper';
  if (roll < juniperChance + fernChance) return 'fern';
  return 'bush';
}

function sampleUndergrowthScale(kind: UndergrowthKind, density: number, rng: () => number): number {
  const densityMul = THREE.MathUtils.lerp(0.98, 1.14, density) * 1.16;
  switch (kind) {
    case 'bush':
      return THREE.MathUtils.lerp(0.52, 0.92, Math.pow(rng(), 0.78)) * densityMul;
    case 'fern':
      return THREE.MathUtils.lerp(0.68, 1.18, Math.pow(rng(), 0.7)) * THREE.MathUtils.lerp(0.9, 1.1, density);
    case 'juniper':
      return THREE.MathUtils.lerp(0.54, 1.04, Math.pow(rng(), 0.84)) * THREE.MathUtils.lerp(1.04, 0.9, density);
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

function sampleUndergrowthTint(kind: UndergrowthKind, rng: () => number): THREE.Vector3 {
  switch (kind) {
    case 'bush':
      return new THREE.Vector3(
        rngRange(rng, 0.58, 0.76),
        rngRange(rng, 0.64, 0.84),
        rngRange(rng, 0.56, 0.74),
      );
    case 'fern':
      return new THREE.Vector3(
        rngRange(rng, 0.58, 0.74),
        rngRange(rng, 0.7, 0.88),
        rngRange(rng, 0.52, 0.72),
      );
    case 'juniper':
      return new THREE.Vector3(
        rngRange(rng, 0.54, 0.72),
        rngRange(rng, 0.62, 0.8),
        rngRange(rng, 0.62, 0.82),
      );
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

function createUndergrowthCardMaterial(
  name: string,
  textures: UndergrowthTextureSet,
  useNodeMaterial: boolean,
  transmitRGB: [number, number, number],
): THREE.Material {
  if (!useNodeMaterial) {
    const material = new THREE.MeshStandardMaterial({
      name,
      map: textures.albedo,
      normalMap: textures.normal,
      roughnessMap: textures.roughness,
      alphaTest: 0.42,
      side: THREE.DoubleSide,
      roughness: 0.96,
      metalness: 0,
      vertexColors: true,
    });
    material.forceSinglePass = true;
    material.normalScale.set(0.45, 0.45);
    applyFoliageDoubleSideNormals(material);
    return material;
  }

  const material = new MeshSSSNodeMaterial({
    map: textures.albedo,
    alphaTest: 0.42,
    side: THREE.DoubleSide,
    roughness: 0.96,
    metalness: 0,
  });
  material.name = name;
  material.forceSinglePass = true;
  material.roughnessMap = textures.roughness;
  if (textures.roughness) material.roughness = 1.0;

  const transmit = tsl.uniform(new THREE.Color().setRGB(...transmitRGB));
  const edge = textures.translucency ? tsl.texture(textures.translucency).r : tsl.float(1);
  material.thicknessColorNode = edge.mul(tsl.attribute('aTint', 'vec3').y).mul(transmit);
  material.thicknessDistortionNode = tsl.uniform(0.3);
  material.thicknessAmbientNode = tsl.uniform(0.026);
  material.thicknessAttenuationNode = tsl.uniform(1.0);
  material.thicknessPowerNode = tsl.uniform(5.0);
  material.thicknessScaleNode = tsl.uniform(1.5);
  const tone = tsl.uniform(new THREE.Vector3(0.72, 0.76, 0.64));
  material.colorNode = tsl
    .texture(textures.albedo)
    .mul(tsl.vec4(tsl.attribute('aTint', 'vec3').mul(tone), tsl.float(1)));
  material.positionNode = createRootedFoliageWindPosition(0.16);

  const upView = tsl.cameraViewMatrix.mul(tsl.vec4(0, 1, 0, 0)).xyz;
  const relief = textures.normal ? tsl.normalMap(tsl.texture(textures.normal)).sub(tsl.normalView) : null;
  material.normalNode = relief ? tsl.normalize(upView.add(relief.mul(0.4))) : tsl.normalize(upView);
  return material;
}

function undergrowthWindVecForYaw(yaw: number, scale: THREE.Vector3, out = windVecScratch): THREE.Vector3 {
  windQuat.setFromAxisAngle(Y_AXIS, -yaw);
  out.copy(WIND_DIR).applyQuaternion(windQuat);
  if (scale.x !== 0) out.x /= scale.x;
  if (scale.y !== 0) out.y /= scale.y;
  if (scale.z !== 0) out.z /= scale.z;
  return out;
}

type CardGeometrySpec = {
  quads: number;
  width: number;
  tiltMin: number;
  tiltSpan: number;
  heightMin: number;
  heightSpan: number;
  baseSpread: number;
};

function createCardClumpGeometry(spec: CardGeometrySpec): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let base = 0;

  for (let quad = 0; quad < spec.quads; quad++) {
    const azimuth = (quad / spec.quads) * TAU + (hash01(quad + 1.7) - 0.5) * 0.95;
    const tilt = spec.tiltMin + hash01(quad + 7.1) * spec.tiltSpan;
    const height = spec.heightMin + hash01(quad + 3.3) * spec.heightSpan;
    const width = spec.width * (0.76 + hash01(quad + 11.4) * 0.52);
    const offset = spec.baseSpread * hash01(quad + 5.2);
    const ca = Math.cos(azimuth);
    const sa = Math.sin(azimuth);
    const cx = ca * offset;
    const cz = sa * offset;
    const upX = Math.sin(tilt) * ca;
    const upY = Math.cos(tilt);
    const upZ = Math.sin(tilt) * sa;
    const rightX = -sa;
    const rightZ = ca;

    for (const [localX, localY] of [
      [-0.5 * width, 0],
      [0.5 * width, 0],
      [0.5 * width, 1],
      [-0.5 * width, 1],
    ] as const) {
      positions.push(
        cx + rightX * localX + upX * localY * height,
        upY * localY * height,
        cz + rightZ * localX + upZ * localY * height,
      );
      normals.push(0, 1, 0);
      uvs.push(localX / width + 0.5, localY);
    }

    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    base += 4;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

function createUndergrowthShadowGeometry(kind: UndergrowthKind): THREE.BufferGeometry {
  const geometry = new THREE.SphereGeometry(1, 10, 6, 0, TAU, 0, Math.PI * 0.52);
  switch (kind) {
    case 'fern':
      geometry.scale(0.82, 0.22, 0.82);
      geometry.translate(0, 0.05, 0);
      break;
    case 'juniper':
      geometry.scale(0.9, 0.36, 0.9);
      geometry.translate(0, 0.12, 0);
      break;
    case 'bush':
      geometry.scale(0.78, 0.3, 0.78);
      geometry.translate(0, 0.1, 0);
      break;
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

async function loadUndergrowthTextures(files: UndergrowthTextureFiles, maxAnisotropy: number): Promise<UndergrowthTextureSet> {
  const [albedo, normal, roughness, translucency] = await Promise.all([
    loadRequiredLeafTexture(files.albedo, true, maxAnisotropy),
    loadOptionalLeafTexture(files.normal, false, maxAnisotropy),
    loadOptionalLeafTexture(files.roughness, false, maxAnisotropy),
    loadOptionalLeafTexture(files.translucency, false, maxAnisotropy),
  ]);
  return { albedo, normal, roughness, translucency };
}

async function loadRequiredLeafTexture(name: string, srgb: boolean, maxAnisotropy: number): Promise<THREE.Texture> {
  const texture = await loadOptionalLeafTexture(name, srgb, maxAnisotropy);
  if (!texture) throw new Error(`SeedThree undergrowth texture missing (${name})`);
  return texture;
}

async function loadOptionalLeafTexture(name: string, srgb: boolean, maxAnisotropy: number): Promise<THREE.Texture | null> {
  const url = seedThreeLeafUrl(name);
  if (!url) return null;
  const texture = await loader.loadAsync(url);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.anisotropy = Math.max(1, Math.min(16, maxAnisotropy));
  return texture;
}

function collectTextures(...sets: UndergrowthTextureSet[]): THREE.Texture[] {
  const textures: THREE.Texture[] = [];
  for (const set of sets) {
    textures.push(set.albedo);
    if (set.normal) textures.push(set.normal);
    if (set.roughness) textures.push(set.roughness);
    if (set.translucency) textures.push(set.translucency);
  }
  return textures;
}

function hash01(seed: number): number {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function rngRange(rng: () => number, min: number, max: number): number {
  return THREE.MathUtils.lerp(min, max, rng());
}
