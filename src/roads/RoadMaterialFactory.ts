import * as THREE from 'three';
import { RoadTextureLoader, type TextureSet } from './RoadTextureLoader.ts';

export class RoadMaterialFactory {
  readonly road!: THREE.MeshStandardMaterial;
  readonly roadEdge!: THREE.MeshStandardMaterial;
  readonly terrain!: THREE.MeshLambertMaterial;
  readonly previewValid: THREE.MeshStandardMaterial;
  readonly previewInvalid: THREE.MeshStandardMaterial;
  readonly selection: THREE.MeshBasicMaterial;
  readonly snap: THREE.MeshBasicMaterial;
  private roadTextures: TextureSet | null = null;
  private terrainTextures: TextureSet | null = null;

  private constructor() {
    this.previewValid = new THREE.MeshStandardMaterial({
      color: 0xd8b25d,
      emissive: 0x3a270b,
      roughness: 0.9,
      metalness: 0,
      transparent: true,
      opacity: 0.48,
      depthWrite: false,
    });
    this.previewInvalid = new THREE.MeshStandardMaterial({
      color: 0xc97055,
      emissive: 0x3c0f09,
      roughness: 0.9,
      metalness: 0,
      transparent: true,
      opacity: 0.48,
      depthWrite: false,
    });
    this.selection = new THREE.MeshBasicMaterial({
      color: 0xf6cf70,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    });
    this.snap = new THREE.MeshBasicMaterial({
      color: 0xf2d889,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
    });
  }

  static async create(maxAnisotropy: number): Promise<RoadMaterialFactory> {
    const factory = new RoadMaterialFactory();
    const textureLoader = new RoadTextureLoader(Math.min(maxAnisotropy, 8));
    factory.roadTextures = await textureLoader.loadRoadTextures();
    factory.terrainTextures = await textureLoader.loadTerrainTextures();
    Object.assign(factory, factory.createMaterials());
    return factory;
  }

  dispose(): void {
    const materials = [this.road, this.roadEdge, this.terrain, this.previewValid, this.previewInvalid, this.selection, this.snap];
    materials.forEach((material) => material.dispose());
    for (const set of [this.roadTextures, this.terrainTextures]) {
      if (!set) continue;
      this.disposeTextureSet(set);
    }
  }

  private createMaterials(): { road: THREE.MeshStandardMaterial; roadEdge: THREE.MeshStandardMaterial; terrain: THREE.MeshLambertMaterial } {
    if (!this.roadTextures || !this.terrainTextures) throw new Error('Textures are not loaded.');
    const road = new THREE.MeshStandardMaterial({
      map: this.roadTextures.albedo,
      normalMap: this.roadTextures.normal,
      roughnessMap: this.roadTextures.roughness,
      aoMap: this.roadTextures.ao,
      displacementMap: this.roadTextures.height,
      displacementScale: 0.035,
      roughness: 0.95,
      metalness: 0,
    });
    road.normalScale.set(0.85, 0.85);

    const roadEdge = new THREE.MeshStandardMaterial({
      map: this.roadTextures.albedo,
      normalMap: this.roadTextures.normal,
      roughnessMap: this.roadTextures.roughness,
      aoMap: this.roadTextures.ao,
      alphaMap: this.roadTextures.edgeMask,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      roughness: 1,
      metalness: 0,
    });
    roadEdge.normalScale.set(0.55, 0.55);

    const terrain = new THREE.MeshLambertMaterial({
      map: this.terrainTextures.albedo,
      vertexColors: true,
    });
    terrain.name = 'Tinted terrain';

    return { road, roadEdge, terrain };
  }

  private disposeTextureSet(set: TextureSet): void {
    Object.values(set).forEach((texture) => texture?.dispose());
  }
}
