import * as THREE from 'three';
import { loadSkyPerlinTexture } from '../sky/SkyCloudMesh.ts';
import { loadMossyRockTextures, type MossyRockTextureSet } from '../utils/propTextureLoad.ts';

export type SceneStartupTextures = {
  riverRock: MossyRockTextureSet;
  skyPerlin: THREE.Texture;
};

const DEFAULT_MAX_ANISOTROPY = 8;

export function beginStartupTextureLoad(maxAnisotropy = DEFAULT_MAX_ANISOTROPY): Promise<SceneStartupTextures> {
  return Promise.all([
    loadMossyRockTextures(maxAnisotropy),
    loadSkyPerlinTexture(),
  ]).then(([riverRock, skyPerlin]) => ({ riverRock, skyPerlin }));
}

export function applyMaxAnisotropy(textures: SceneStartupTextures, maxAnisotropy: number): void {
  const limit = Math.max(1, Math.min(16, maxAnisotropy));
  for (const texture of [textures.riverRock.map, textures.riverRock.normalMap, textures.riverRock.roughnessMap]) {
    texture.anisotropy = limit;
  }
}
