import * as THREE from 'three';
import { MeshSSSNodeMaterial } from 'three/webgpu';
import {
  attribute,
  cameraViewMatrix,
  float,
  normalMap,
  normalView,
  normalize,
  texture,
  uniform,
  vec4,
} from 'three/tsl';
import { WIND_DIR } from '@seedthree/core/wind.js';
import { applyFoliageDoubleSideNormals } from '../../scene/foliageDoubleSideNormals.ts';
import type { RendererBackendKind } from '../../scene/RendererBackend.ts';
import { createRootedFoliageWindPosition } from './seedThreeFoliageWind.ts';

type TslNode = {
  mul: (value: unknown) => TslNode;
  add: (value: unknown) => TslNode;
  sub: (value: unknown) => TslNode;
  r: TslNode;
  y: TslNode;
  xyz: TslNode;
};

const tsl = {
  attribute: attribute as (name: string, type: string) => TslNode,
  cameraViewMatrix: cameraViewMatrix as TslNode,
  float: float as (value: number) => TslNode,
  normalMap: normalMap as (sample: unknown) => TslNode,
  normalView: normalView as TslNode,
  normalize: normalize as (value: unknown) => TslNode,
  texture: texture as (map: THREE.Texture) => TslNode,
  uniform: uniform as <T>(value: T) => { value: T },
  vec4: vec4 as (...values: unknown[]) => TslNode,
};

export type SeedThreeGroundCoverTextureSources = {
  albedo: string | undefined;
  normal?: string | undefined;
  roughness?: string | undefined;
  translucency?: string | undefined;
};

export type SeedThreeGroundCoverTextures = {
  albedo: THREE.Texture;
  normal: THREE.Texture | null;
  roughness: THREE.Texture | null;
  translucency: THREE.Texture | null;
};

export type SeedThreeCardGeometrySpec = {
  quads: number;
  width: number;
  tiltMin: number;
  tiltSpan: number;
  heightMin: number;
  heightSpan: number;
  baseSpread: number;
};

export type SeedThreeGroundCoverInstanceAttributes = {
  tint: THREE.InstancedBufferAttribute;
  anchor: THREE.InstancedBufferAttribute;
  wind: THREE.InstancedBufferAttribute;
};

const loader = new THREE.TextureLoader();
const TAU = Math.PI * 2;
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const windQuaternion = new THREE.Quaternion();

export async function loadSeedThreeGroundCoverTextures(
  sources: SeedThreeGroundCoverTextureSources,
  maxAnisotropy: number,
): Promise<SeedThreeGroundCoverTextures> {
  const [albedo, normal, roughness, translucency] = await Promise.all([
    loadGroundCoverTexture(sources.albedo, true, maxAnisotropy),
    loadGroundCoverTexture(sources.normal, false, maxAnisotropy),
    loadGroundCoverTexture(sources.roughness, false, maxAnisotropy),
    loadGroundCoverTexture(sources.translucency, false, maxAnisotropy),
  ]);
  if (!albedo) throw new Error(`SeedThree ground-cover albedo missing (${sources.albedo ?? 'no URL'})`);
  return { albedo, normal, roughness, translucency };
}

export function createSeedThreeGroundCoverMaterial(
  name: string,
  textures: SeedThreeGroundCoverTextures,
  rendererBackend: RendererBackendKind,
  transmitRGB: [number, number, number],
  windAmount = 0.16,
): THREE.Material {
  if (rendererBackend !== 'webgpu') {
    const material = new THREE.MeshStandardMaterial({
      name,
      map: textures.albedo,
      normalMap: textures.normal,
      roughnessMap: textures.roughness,
      alphaTest: 0.38,
      side: THREE.DoubleSide,
      roughness: 0.96,
      metalness: 0,
      vertexColors: true,
    });
    material.forceSinglePass = true;
    material.normalScale.set(0.42, 0.42);
    applyFoliageDoubleSideNormals(material);
    return material;
  }

  const material = new MeshSSSNodeMaterial({
    map: textures.albedo,
    alphaTest: 0.38,
    side: THREE.DoubleSide,
    roughness: 0.96,
    metalness: 0,
  });
  material.name = name;
  material.forceSinglePass = true;
  material.polygonOffset = true;
  material.polygonOffsetFactor = -2;
  material.polygonOffsetUnits = -2;
  material.roughnessMap = textures.roughness;
  if (textures.roughness) material.roughness = 1;

  const transmit = tsl.uniform(new THREE.Color().setRGB(...transmitRGB));
  const edge = textures.translucency ? tsl.texture(textures.translucency).r : tsl.float(1);
  material.thicknessColorNode = edge.mul(tsl.attribute('aTint', 'vec3').y).mul(transmit);
  material.thicknessDistortionNode = tsl.uniform(0.3);
  material.thicknessAmbientNode = tsl.uniform(0.026);
  material.thicknessAttenuationNode = tsl.uniform(1);
  material.thicknessPowerNode = tsl.uniform(5);
  material.thicknessScaleNode = tsl.uniform(1.5);
  material.colorNode = tsl.texture(textures.albedo).mul(
    tsl.vec4(tsl.attribute('aTint', 'vec3'), tsl.float(1)),
  );
  material.positionNode = createRootedFoliageWindPosition(windAmount);

  const upView = tsl.cameraViewMatrix.mul(tsl.vec4(0, 1, 0, 0)).xyz;
  const relief = textures.normal
    ? tsl.normalMap(tsl.texture(textures.normal)).sub(tsl.normalView)
    : null;
  material.normalNode = relief ? tsl.normalize(upView.add(relief.mul(0.4))) : tsl.normalize(upView);
  return material;
}

export function createSeedThreeCardClumpGeometry(
  spec: SeedThreeCardGeometrySpec,
): THREE.BufferGeometry {
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

export function addSeedThreeGroundCoverInstanceAttributes(
  geometry: THREE.BufferGeometry,
  capacity: number,
): SeedThreeGroundCoverInstanceAttributes {
  const tint = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  const anchor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  const wind = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  geometry.setAttribute('aTint', tint);
  geometry.setAttribute('aAnchorPos', anchor);
  geometry.setAttribute('aWindVec', wind);
  return { tint, anchor, wind };
}

export function seedThreeGroundCoverWindVector(
  yaw: number,
  scale: THREE.Vector3,
  out = new THREE.Vector3(),
): THREE.Vector3 {
  windQuaternion.setFromAxisAngle(Y_AXIS, -yaw);
  out.copy(WIND_DIR).applyQuaternion(windQuaternion);
  if (scale.x !== 0) out.x /= scale.x;
  if (scale.y !== 0) out.y /= scale.y;
  if (scale.z !== 0) out.z /= scale.z;
  return out;
}

export function disposeSeedThreeGroundCoverTextures(textures: SeedThreeGroundCoverTextures): void {
  textures.albedo.dispose();
  textures.normal?.dispose();
  textures.roughness?.dispose();
  textures.translucency?.dispose();
}

async function loadGroundCoverTexture(
  url: string | undefined,
  srgb: boolean,
  maxAnisotropy: number,
): Promise<THREE.Texture | null> {
  if (!url) return null;
  const texture = await loader.loadAsync(url);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.anisotropy = Math.max(1, Math.min(16, maxAnisotropy));
  return texture;
}

function hash01(seed: number): number {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}
