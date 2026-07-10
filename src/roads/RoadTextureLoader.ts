import * as THREE from 'three';
import { loadBitmapTexture } from '../utils/textureLoad.ts';

export type TextureSet = {
  albedo: THREE.Texture;
  normal: THREE.Texture;
  roughness: THREE.Texture;
  ao?: THREE.Texture;
  height?: THREE.Texture;
  edgeMask?: THREE.Texture;
  rutMask?: THREE.Texture;
};

export type TerrainBlendTextureSet = {
  meadow: TextureSet;
  dense: TextureSet;
  dry: TextureSet;
};

export class RoadTextureLoader {
  private readonly maxAnisotropy: number;

  constructor(maxAnisotropy: number) {
    this.maxAnisotropy = maxAnisotropy;
  }

  async loadRoadTextures(): Promise<TextureSet> {
    const base = '/assets/textures/roads/medieval_dirt';
    const [albedo, normal, roughness, ao, height, edgeMask, rutMask] = await Promise.all([
      this.load(`${base}/albedo.png`, true),
      this.load(`${base}/normal.png`, false),
      this.load(`${base}/roughness.png`, false),
      this.load(`${base}/ao.png`, false),
      this.load(`${base}/height.png`, false),
      this.load(`${base}/edge_mask.png`, false),
      this.load(`${base}/rut_mask.png`, false),
    ]);
    return { albedo, normal, roughness, ao, height, edgeMask, rutMask };
  }

  async loadBridgeTextures(): Promise<TextureSet> {
    const base = '/assets/textures/roads/wood_logs';
    const [albedo, normal, roughness, ao, height, edgeMask] = await Promise.all([
      this.load(`${base}/albedo.png`, true),
      this.load(`${base}/normal.png`, false),
      this.load(`${base}/roughness.png`, false),
      this.load(`${base}/ao.png`, false),
      this.load(`${base}/height.png`, false),
      this.load(`${base}/edge_mask.png`, false),
    ]);
    return { albedo, normal, roughness, ao, height, edgeMask };
  }

  async loadTerrainTextures(): Promise<TextureSet> {
    const base = '/assets/textures/terrain/manor_grass_blend';
    const wrapping = THREE.MirroredRepeatWrapping;
    const [albedo, normal, roughness, ao, height] = await Promise.all([
      this.load(`${base}/albedo.png`, true, wrapping),
      this.load(`${base}/normal.png`, false, wrapping),
      this.load(`${base}/roughness.png`, false, wrapping),
      this.load(`${base}/ao.png`, false, wrapping),
      this.load(`${base}/height.png`, false, wrapping),
    ]);
    return { albedo, normal, roughness, ao, height };
  }

  async loadTerrainBlendTextures(): Promise<TerrainBlendTextureSet> {
    const [meadow, dense, dry] = await Promise.all([
      this.loadTerrainBlendSet('/assets/textures/terrain/manor_grass_meadow'),
      this.loadTerrainBlendSet('/assets/textures/terrain/manor_grass_dense'),
      this.loadTerrainBlendSet('/assets/textures/terrain/manor_grass_dry'),
    ]);
    return { meadow, dense, dry };
  }

  private async loadTerrainBlendSet(base: string): Promise<TextureSet> {
    const [albedo, normal, roughness, ao, height] = await Promise.all([
      this.load(`${base}/albedo.png`, true, THREE.MirroredRepeatWrapping),
      this.load(`${base}/normal.png`, false, THREE.MirroredRepeatWrapping),
      this.load(`${base}/roughness.png`, false, THREE.MirroredRepeatWrapping),
      this.load(`${base}/ao.png`, false, THREE.MirroredRepeatWrapping),
      this.load(`${base}/height.png`, false, THREE.MirroredRepeatWrapping),
    ]);
    return { albedo, normal, roughness, ao, height };
  }

  private load(url: string, srgb: boolean, wrapping: THREE.Wrapping = THREE.RepeatWrapping): Promise<THREE.Texture> {
    return loadBitmapTexture(url, this.maxAnisotropy, { srgb, wrapping });
  }
}

