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
import { instancedGrassWindPosition, WIND_DIR } from '@seedthree/core/wind.js';
import { seedThreeLeafUrl } from './seedThreeTextures.ts';

export { WIND_DIR as SEEDTHREE_GRASS_WIND_DIR };

type TslNode = {
  mul: (value: unknown) => TslNode;
  add: (value: unknown) => TslNode;
  sub: (value: unknown) => TslNode;
  y: TslNode;
  xyz: TslNode;
};

const tsl = {
  attribute: attribute as (name: string, type: string) => TslNode,
  cameraViewMatrix: cameraViewMatrix as TslNode,
  float: float as (value: number) => TslNode,
  instancedGrassWindPosition: instancedGrassWindPosition as (bladeHeight?: number) => TslNode,
  normalMap: normalMap as (sample: unknown) => TslNode,
  normalView: normalView as TslNode,
  normalize: normalize as (value: unknown) => TslNode,
  texture: texture as (map: THREE.Texture) => TslNode,
  uniform: uniform as <T>(value: T) => { value: T },
  vec4: vec4 as (...values: unknown[]) => TslNode,
};

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const windQuat = new THREE.Quaternion();
const windVecScratch = new THREE.Vector3();

export type SeedThreeGrassTextures = {
  tuft: THREE.Texture;
  tuftNormal: THREE.Texture | null;
  tuftRoughness: THREE.Texture | null;
};

export type SeedThreeTuftVariant = {
  geometry: THREE.BufferGeometry;
  share: number;
  tall: number;
};

const loader = new THREE.TextureLoader();
let textureCache: SeedThreeGrassTextures | null = null;

async function loadTex(url: string | undefined, srgb: boolean): Promise<THREE.Texture | null> {
  if (!url) return null;
  const tex = await loader.loadAsync(url);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  return tex;
}

async function loadOptional(url: string | undefined, srgb: boolean): Promise<THREE.Texture | null> {
  if (!url) return null;
  try {
    return await loadTex(url, srgb);
  } catch {
    return null;
  }
}

export async function loadSeedThreeGrassTextures(maxAnisotropy: number): Promise<SeedThreeGrassTextures> {
  if (textureCache) return textureCache;

  const [tuft, tuftNormal, tuftRoughness] = await Promise.all([
    loadTex(seedThreeLeafUrl('grass_tuft.png'), true),
    loadOptional(seedThreeLeafUrl('grass_tuft_normal.png'), false),
    loadOptional(seedThreeLeafUrl('grass_tuft_roughness.png'), false),
  ]);

  if (!tuft) {
    throw new Error('SeedThree grass tuft texture missing (grass_tuft.png)');
  }

  for (const tex of [tuft, tuftNormal, tuftRoughness]) {
    if (tex) tex.anisotropy = maxAnisotropy;
  }

  textureCache = { tuft, tuftNormal, tuftRoughness };
  return textureCache;
}

function tuftGeometry(planes: number, width: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let base = 0;

  for (let quad = 0; quad < planes; quad++) {
    const angle = (quad * Math.PI) / planes;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    for (const [localX, localY] of [
      [-0.5 * width, 0],
      [0.5 * width, 0],
      [0.5 * width, 1],
      [-0.5 * width, 1],
    ] as const) {
      positions.push(localX * cosA, localY, localX * sinA);
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
  return geometry;
}

export function createSeedThreeTuftVariants(): SeedThreeTuftVariant[] {
  return [
    { geometry: tuftGeometry(2, 1.0), share: 0.62, tall: 1.0 },
    { geometry: tuftGeometry(3, 0.6), share: 0.38, tall: 1.4 },
  ];
}

export function createSeedThreeGrassMaterial(textures: SeedThreeGrassTextures): MeshSSSNodeMaterial {
  const mat = new MeshSSSNodeMaterial({
    map: textures.tuft,
    alphaTest: 0.42,
    side: THREE.DoubleSide,
    roughness: 0.95,
    metalness: 0,
  });

  const transmit = tsl.uniform(new THREE.Color().setRGB(0.45, 0.65, 0.22));
  mat.thicknessColorNode = tsl.attribute('aTint', 'vec3').y.mul(transmit);
  mat.thicknessDistortionNode = tsl.uniform(0.4);
  mat.thicknessAmbientNode = tsl.uniform(0.06);
  mat.thicknessAttenuationNode = tsl.uniform(1.0);
  mat.thicknessPowerNode = tsl.uniform(5.0);
  mat.thicknessScaleNode = tsl.uniform(2.6);
  mat.colorNode = tsl.texture(textures.tuft).mul(tsl.vec4(tsl.attribute('aTint', 'vec3'), tsl.float(1)));
  if (textures.tuftRoughness) {
    mat.roughnessMap = textures.tuftRoughness;
    mat.roughness = 1.0;
  }
  mat.positionNode = tsl.instancedGrassWindPosition(1);

  const upView = tsl.cameraViewMatrix.mul(tsl.vec4(0, 1, 0, 0)).xyz;
  const relief = textures.tuftNormal
    ? tsl.normalMap(tsl.texture(textures.tuftNormal)).sub(tsl.normalView)
    : null;
  mat.normalNode = relief ? tsl.normalize(upView.add(relief.mul(0.6))) : tsl.normalize(upView);

  mat.name = 'SeedThree grass clump';
  return mat;
}

/** R⁻¹S⁻¹·WIND_DIR — instance matrix maps this back to the true world heading. */
export function seedThreeGrassWindVecForYaw(
  yaw: number,
  scale: THREE.Vector3,
  out = windVecScratch,
): THREE.Vector3 {
  windQuat.setFromAxisAngle(Y_AXIS, -yaw);
  out.copy(WIND_DIR).applyQuaternion(windQuat);
  if (scale.x !== 0) out.x /= scale.x;
  if (scale.y !== 0) out.y /= scale.y;
  if (scale.z !== 0) out.z /= scale.z;
  return out;
}

export function sampleSeedThreeGrassTint(rng: () => number, dry = 0): THREE.Vector3 {
  return new THREE.Vector3(
    rng() * 0.45 + 0.55 + dry * 0.45,
    (rng() * 0.7 + 0.55) * (1 - dry * 0.35),
    (rng() * 0.35 + 0.45) * (1 - dry * 0.55),
  );
}

export function disposeSeedThreeGrassTextureCache(): void {
  if (!textureCache) return;
  textureCache.tuft.dispose();
  textureCache.tuftNormal?.dispose();
  textureCache.tuftRoughness?.dispose();
  textureCache = null;
}
