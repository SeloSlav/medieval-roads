import * as THREE from 'three';
import { createTerrainGrassMaterial, createTerrainGrassMaterialWithRiverShore } from '../terrain/TerrainGrassMaterial.ts';
import { createRoadCoreMaterial, createRoadEdgeMaterial, createRiverBankMaterial } from './RoadSurfaceMaterial.ts';
import { RoadTextureLoader, type TerrainBlendTextureSet, type TextureSet } from './RoadTextureLoader.ts';
import type { MeshStandardNodeMaterial } from 'three/webgpu';

export class RoadMaterialFactory {
  readonly road!: MeshStandardNodeMaterial;
  readonly roadEdge!: MeshStandardNodeMaterial;
  readonly riverBank!: MeshStandardNodeMaterial;
  readonly terrain!: MeshStandardNodeMaterial;
  readonly bridgeSupport!: THREE.MeshStandardMaterial;
  readonly previewValid: THREE.MeshBasicMaterial;
  readonly previewInvalid: THREE.MeshBasicMaterial;
  readonly previewBlendValid: THREE.MeshBasicMaterial;
  readonly previewBlendInvalid: THREE.MeshBasicMaterial;
  readonly previewBridge: THREE.MeshBasicMaterial;
  readonly selection: THREE.MeshBasicMaterial;
  readonly snap: THREE.MeshBasicMaterial;
  private roadTextures: TextureSet | null = null;
  private bridgeTextures: TextureSet | null = null;
  private terrainBlendTextures: TerrainBlendTextureSet | null = null;

  private constructor() {
    this.previewValid = new THREE.MeshBasicMaterial({
      color: 0xc8c5be,
      transparent: true,
      opacity: 0.52,
      depthWrite: false,
    });
    this.previewInvalid = new THREE.MeshBasicMaterial({
      color: 0xcc4444,
      transparent: true,
      opacity: 0.58,
      depthWrite: false,
    });
    this.previewBlendValid = new THREE.MeshBasicMaterial({
      color: 0xc8c5be,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
    });
    this.previewBlendInvalid = new THREE.MeshBasicMaterial({
      color: 0xcc4444,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
    });
    this.previewBridge = new THREE.MeshBasicMaterial({
      color: 0xb8946e,
      transparent: true,
      opacity: 0.56,
      depthWrite: false,
    });
    this.selection = new THREE.MeshBasicMaterial({
      color: 0xc8c2b8,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
    });
    this.snap = new THREE.MeshBasicMaterial({
      color: 0xb8b0a4,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
    });
  }

  static async create(maxAnisotropy: number): Promise<RoadMaterialFactory> {
    const factory = new RoadMaterialFactory();
    const textureLoader = new RoadTextureLoader(Math.min(maxAnisotropy, 8));
    const [roadTextures, bridgeTextures, terrainBlendTextures] = await Promise.all([
      textureLoader.loadRoadTextures(),
      textureLoader.loadBridgeTextures(),
      textureLoader.loadTerrainBlendTextures(),
    ]);
    factory.roadTextures = roadTextures;
    factory.bridgeTextures = bridgeTextures;
    factory.terrainBlendTextures = terrainBlendTextures;
    Object.assign(factory, factory.createMaterials());
    return factory;
  }

  dispose(): void {
    const materials = [
      this.road,
      this.roadEdge,
      this.riverBank,
      this.terrain,
      this.bridgeSupport,
      this.previewValid,
      this.previewInvalid,
      this.previewBlendValid,
      this.previewBlendInvalid,
      this.previewBridge,
      this.selection,
      this.snap,
    ];
    materials.forEach((material) => material.dispose());
    if (this.roadTextures) this.disposeTextureSet(this.roadTextures);
    if (this.bridgeTextures) this.disposeTextureSet(this.bridgeTextures);
    if (this.terrainBlendTextures) {
      this.disposeTextureSet(this.terrainBlendTextures.meadow);
      this.disposeTextureSet(this.terrainBlendTextures.dense);
      this.disposeTextureSet(this.terrainBlendTextures.dry);
    }
  }

  createTerrainMaterialWithRiverShore(): MeshStandardNodeMaterial {
    if (!this.roadTextures || !this.terrainBlendTextures) {
      throw new Error('Textures are not loaded.');
    }
    return createTerrainGrassMaterialWithRiverShore(this.terrainBlendTextures, this.roadTextures);
  }

  private createMaterials(): {
    road: MeshStandardNodeMaterial;
    roadEdge: MeshStandardNodeMaterial;
    riverBank: MeshStandardNodeMaterial;
    terrain: MeshStandardNodeMaterial;
    bridgeSupport: THREE.MeshStandardMaterial;
  } {
    if (!this.roadTextures || !this.bridgeTextures || !this.terrainBlendTextures) {
      throw new Error('Textures are not loaded.');
    }
    const road = createRoadCoreMaterial(this.roadTextures, this.bridgeTextures);
    const roadEdge = createRoadEdgeMaterial(this.roadTextures, true);
    const riverBank = createRiverBankMaterial(this.roadTextures);
    const terrain = createTerrainGrassMaterial(this.terrainBlendTextures);
    const bridgeSupport = new THREE.MeshStandardMaterial({
      map: this.bridgeTextures.albedo,
      color: 0xa07850,
      roughness: 0.94,
      metalness: 0,
    });
    if (this.bridgeTextures.normal) {
      bridgeSupport.normalMap = this.bridgeTextures.normal;
      bridgeSupport.normalScale.set(0.45, 0.45);
    }
    return { road, roadEdge, riverBank, terrain, bridgeSupport };
  }

  private disposeTextureSet(set: TextureSet): void {
    Object.values(set).forEach((texture) => texture?.dispose());
  }
}
