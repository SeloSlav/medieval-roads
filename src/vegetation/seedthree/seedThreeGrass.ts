import * as THREE from 'three';
import { MeshSSSNodeMaterial } from 'three/webgpu';
import {
  attribute,
  cameraViewMatrix,
  float,
  normalMap,
  normalView,
  normalize,
  positionGeometry,
  sin,
  texture,
  time,
  uniform,
  uv,
  vec3,
  vec4,
} from 'three/tsl';
import { windSpeed, windStrength, WIND_DIR } from '@seedthree/core/wind.js';
import { seedThreeLeafUrl } from './seedThreeTextures.ts';

export { WIND_DIR as SEEDTHREE_GRASS_WIND_DIR };

type TslNode = {
  mul: (value: unknown) => TslNode;
  add: (value: unknown) => TslNode;
  sub: (value: unknown) => TslNode;
  x: TslNode;
  y: TslNode;
  z: TslNode;
  xyz: TslNode;
};

const tsl = {
  attribute: attribute as (name: string, type: string) => TslNode,
  cameraViewMatrix: cameraViewMatrix as TslNode,
  float: float as (value: number) => TslNode,
  normalMap: normalMap as (sample: unknown) => TslNode,
  normalView: normalView as TslNode,
  normalize: normalize as (value: unknown) => TslNode,
  positionGeometry: positionGeometry as TslNode,
  sin: sin as (value: unknown) => TslNode,
  texture: texture as (map: THREE.Texture) => TslNode,
  time: time as TslNode,
  uniform: uniform as <T>(value: T) => { value: T },
  uv: uv as () => TslNode,
  vec3: vec3 as (x: unknown, y: unknown, z: unknown) => TslNode,
  vec4: vec4 as (...values: unknown[]) => TslNode,
  windSpeed: windSpeed as unknown as TslNode,
  windStrength: windStrength as unknown as TslNode,
};

/** World wind heading — applied in xz only after instance transform. */
const grassWindDir = tsl.uniform(WIND_DIR.clone()) as unknown as TslNode;

function swayAt(phaseWorld: TslNode, phaseScale: number): TslNode {
  const t = tsl.time.mul(tsl.windSpeed);
  const phase = phaseWorld.x.mul(0.35).add(phaseWorld.z.mul(0.27)).mul(phaseScale);
  return tsl.sin(t.mul(1.15).add(phase))
    .mul(0.72)
    .add(tsl.sin(t.mul(2.63).add(phase.mul(1.9))).mul(0.28));
}

/**
 * Rooted grass sway for instanced tufts.
 * - uv.y weights bend (0 at card root, 1 at tip) — never shifts the planted base.
 * - aAnchorPos gives each tuft its own wind phase (positionWorld is shared on instances).
 * - Y is never modified; only xz shear from world wind heading.
 */
function createPinnedGrassWindPosition(): TslNode {
  const geo = tsl.positionGeometry;
  const stemT = tsl.uv().y;
  const k = stemT.mul(stemT);
  const amp = tsl.windStrength.mul(0.16);
  const anchorWorld = tsl.attribute('aAnchorPos', 'vec3');
  const gust = swayAt(anchorWorld, 2.2).mul(amp);
  const jitterT = tsl.time
    .mul(tsl.windSpeed)
    .mul(3.1)
    .add(anchorWorld.z.mul(1.7))
    .add(anchorWorld.x.mul(1.3));
  const jitter = tsl.sin(jitterT).mul(amp).mul(0.18);
  const bend = gust.add(jitter).mul(k);
  return tsl.vec3(
    geo.x.add(grassWindDir.x.mul(bend)),
    geo.y,
    geo.z.add(grassWindDir.z.mul(bend)),
  );
}

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
  mat.forceSinglePass = true;

  const transmit = tsl.uniform(new THREE.Color().setRGB(0.28, 0.4, 0.14));
  mat.thicknessColorNode = tsl.attribute('aTint', 'vec3').y.mul(transmit);
  mat.thicknessDistortionNode = tsl.uniform(0.32);
  mat.thicknessAmbientNode = tsl.uniform(0.022);
  mat.thicknessAttenuationNode = tsl.uniform(1.0);
  mat.thicknessPowerNode = tsl.uniform(5.0);
  mat.thicknessScaleNode = tsl.uniform(1.45);
  const tone = tsl.uniform(new THREE.Vector3(0.74, 0.78, 0.66));
  mat.colorNode = tsl
    .texture(textures.tuft)
    .mul(tsl.vec4(tsl.attribute('aTint', 'vec3').mul(tone), tsl.float(1)));
  if (textures.tuftRoughness) {
    mat.roughnessMap = textures.tuftRoughness;
    mat.roughness = 1.0;
  }
  mat.positionNode = createPinnedGrassWindPosition();

  const upView = tsl.cameraViewMatrix.mul(tsl.vec4(0, 1, 0, 0)).xyz;
  const relief = textures.tuftNormal
    ? tsl.normalMap(tsl.texture(textures.tuftNormal)).sub(tsl.normalView)
    : null;
  mat.normalNode = relief ? tsl.normalize(upView.add(relief.mul(0.45))) : tsl.normalize(upView);

  mat.name = 'SeedThree grass clump';
  return mat;
}

export function sampleSeedThreeGrassTint(rng: () => number, dry = 0): THREE.Vector3 {
  return new THREE.Vector3(
    rng() * 0.26 + 0.4 + dry * 0.2,
    (rng() * 0.38 + 0.4) * (1 - dry * 0.35),
    (rng() * 0.2 + 0.3) * (1 - dry * 0.55),
  );
}

export function disposeSeedThreeGrassTextureCache(): void {
  if (!textureCache) return;
  textureCache.tuft.dispose();
  textureCache.tuftNormal?.dispose();
  textureCache.tuftRoughness?.dispose();
  textureCache = null;
}
