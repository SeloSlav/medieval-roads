import * as THREE from 'three';
import type { BuildingTerrainSource } from '../buildings/BuildingTerrainLayout.ts';
import { createForestProps } from '../props/ForestProps.ts';
import type { ForestManager } from '../props/ForestManager.ts';
import { createGrassBladeField, GRASS_BLADES_ENABLED, type GrassBladeField } from '../grass/GrassBladeField.ts';
import { updateTerrainZoomBlend } from '../grass/GrassLodConfig.ts';
import { createRiverSystem, type RiverSystem } from '../rivers/RiverSystem.ts';
import { updateTerrainRoadWear } from '../terrain/TerrainRoadWear.ts';
import { RiverField } from '../rivers/RiverField.ts';
import { setActiveRiverLayout, setActiveQuarryLayout, getActivePlacedBuildingLayout } from '../terrain/TerrainHeight.ts';
import { createQuarrySystem, type QuarrySystem } from '../quarries/QuarrySystem.ts';
import { createWorldLayout, type WorldLayout } from '../resources/WorldLayout.ts';
import type { RoadEdge } from '../roads/RoadEdge.ts';
import { RoadJunctionBuilder } from '../roads/RoadJunctionBuilder.ts';
import { RoadMaterialFactory } from '../roads/RoadMaterialFactory.ts';
import { RoadMeshBuilder } from '../roads/RoadMeshBuilder.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import type { BurgageZoneState } from '../resources/types.ts';
import type { BridgeSamplingContext } from '../roads/RiverBridgeSpans.ts';
import { getStillWaterSurfaceY } from '../rivers/RiverWaterLevel.ts';
import { SkyCloudMesh } from '../sky/SkyCloudMesh.ts';
import { Terrain } from '../terrain/Terrain.ts';
import { TerrainProjector } from '../terrain/TerrainProjector.ts';
import { disposeObject3D } from '../utils/dispose.ts';
import { computePathBoundsXZ } from '../utils/pathGeometry.ts';
import { RockSpatialIndex } from '../utils/rockSpatialIndex.ts';
import { yieldToMain } from '../utils/yieldToMain.ts';
import { createPostProcessor, type ScenePostProcessor } from './PostProcessing.ts';
import { fitDirectionalLightShadow } from './fitDirectionalShadow.ts';
import { createPreferredRenderer, type RendererBackend, type RendererBackendKind, type SupportedRenderer } from './RendererBackend.ts';
import { TREE_SHADOW_CAST_LAYER } from './SceneLayers.ts';
import { applyMaxAnisotropy, beginStartupTextureLoad, type SceneStartupTextures } from './startupTextures.ts';

export class SceneManager {
  private readonly container: HTMLElement;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: SupportedRenderer;
  readonly rendererBackend: RendererBackendKind;
  readonly postProcessor: ScenePostProcessor;
  private readonly maxAnisotropy: number;
  readonly cameraTarget = new THREE.Vector3();
  readonly terrain: Terrain;
  readonly terrainProjector: TerrainProjector;
  readonly materials: RoadMaterialFactory;
  readonly roadMeshBuilder: RoadMeshBuilder;
  readonly previewGroup = new THREE.Group();
  readonly selectionGroup = new THREE.Group();
  private readonly sky: SkyCloudMesh;
  private readonly sunDirection = new THREE.Vector3();
  private sunLight!: THREE.DirectionalLight;
  private forestManager: ForestManager | null = null;
  private grassField: GrassBladeField | null = null;
  private vegetationBuilt = false;
  private roadNetworkRef: RoadNetwork | null = null;
  private forestClearanceBuildings: BuildingTerrainSource[] = [];
  private forestClearanceBurgageZones: BurgageZoneState[] = [];
  private readonly riverSystem: RiverSystem;
  private readonly quarrySystem: QuarrySystem;
  readonly worldLayout: WorldLayout;

  get riverField() {
    return this.riverSystem.field;
  }
  private readonly roadGroup = new THREE.Group();
  private readonly junctionGroup = new THREE.Group();
  private readonly edgeVisuals = new Map<string, { revision: number; group: THREE.Group }>();
  private rockSpatialIndex: RockSpatialIndex | null = null;
  private buildInteractionActive = false;
  private shadowsEnabledBeforeDraft = true;
  private renderFrame = 0;

  private constructor(
    container: HTMLElement,
    backend: RendererBackend,
    materials: RoadMaterialFactory,
    startupTextures: SceneStartupTextures,
    terrain: Terrain,
    riverSystem: RiverSystem,
    quarrySystem: QuarrySystem,
    worldLayout: WorldLayout,
  ) {
    this.container = container;
    this.renderer = backend.renderer;
    this.rendererBackend = backend.kind;
    this.maxAnisotropy = backend.maxAnisotropy;
    this.materials = materials;
    this.scene = new THREE.Scene();
    this.scene.background = null;
    this.scene.fog = new THREE.FogExp2(0xc8def1, 0.00082);
    this.camera = new THREE.PerspectiveCamera(54, 1, 0.1, 2600);
    this.sunDirection.setFromSphericalCoords(1, THREE.MathUtils.degToRad(43), THREE.MathUtils.degToRad(225));
    this.terrain = terrain;
    this.terrainProjector = new TerrainProjector(this.terrain, this.camera, this.renderer.domElement);
    this.sky = new SkyCloudMesh({
      sunDirection: this.sunDirection,
      cloudCoverage: 0.3,
      cloudHeight: 185,
      cloudThickness: 54,
      cloudAbsorption: 0.42,
      hazeStrength: 0.07,
      maxCloudDistance: 6200,
      radius: 1900,
      rayleigh: 0.62,
      turbidity: 1.2,
      windSpeedX: 0.12,
      windSpeedZ: 0.07,
      widthSegments: 56,
      heightSegments: 28,
      rendererBackend: backend.kind,
      perlinTexture: startupTextures.skyPerlin,
    });
    this.riverSystem = riverSystem;
    this.quarrySystem = quarrySystem;
    this.worldLayout = worldLayout;
    this.roadMeshBuilder = new RoadMeshBuilder(this.terrain, materials, this.getBridgeSamplingContext());

    this.roadGroup.name = 'Road network visuals';
    this.junctionGroup.name = 'Road junction visuals';
    this.previewGroup.name = 'Road preview root';
    this.selectionGroup.name = 'Road selection root';

    this.scene.add(
      this.sky,
      this.terrain.mesh,
      this.riverSystem.group,
      this.quarrySystem.group,
      this.roadGroup,
      this.junctionGroup,
      this.previewGroup,
      this.selectionGroup,
    );
    this.addLighting();
    this.postProcessor = createPostProcessor(backend, this.scene, this.camera);
  }

  static async create(
    container: HTMLElement,
    onProgress?: (label: string, detail?: string) => void,
    materialsPromise?: Promise<RoadMaterialFactory>,
    startupTexturesPromise?: Promise<SceneStartupTextures>,
  ): Promise<SceneManager> {
    onProgress?.('Loading graphics', 'Renderer, roads, sky, and river textures');
    const [backend, materials, startupTextures] = await Promise.all([
      createPreferredRenderer(),
      materialsPromise ?? RoadMaterialFactory.create(8),
      startupTexturesPromise ?? beginStartupTextureLoad(),
    ]);
    applyMaxAnisotropy(startupTextures, backend.maxAnisotropy);
    container.appendChild(backend.renderer.domElement);

    onProgress?.('Building world', 'River layout, quarries, and terrain');
    const worldLayout = createWorldLayout();
    const { quarryLayout, riverLayout } = worldLayout;
    setActiveRiverLayout(riverLayout);
    setActiveQuarryLayout(quarryLayout);
    const riverBounds = Terrain.fullBounds();
    const riverField = RiverField.fromLayout({ bounds: riverBounds, layout: riverLayout });
    await yieldToMain();

    const terrain = await Terrain.create(
      materials.createTerrainMaterialWithRiverShore(),
      riverField,
      quarryLayout,
      (completedRows, totalRows) => {
        onProgress?.('Building world', `Shaping terrain (${completedRows}/${totalRows})`);
      },
    );
    await yieldToMain();

    onProgress?.('Building world', 'River water, banks, and quarries');
    await yieldToMain();
    const riverSystem = createRiverSystem(
      terrain,
      riverField,
      materials.riverBank,
      startupTextures.riverRock,
    );
    const quarrySystem = createQuarrySystem(terrain, quarryLayout, startupTextures.riverRock);
    await yieldToMain();

    onProgress?.('Building world', 'Sky and scene lighting');
    const manager = new SceneManager(container, backend, materials, startupTextures, terrain, riverSystem, quarrySystem, worldLayout);
    void manager.sky.ready.catch((error) => {
      console.warn('Sky volumetric shader still compiling:', error);
    });
    return manager;
  }

  /** Builds forest and grass after the first frame — same bundle, no dynamic import. */
  async finishVegetation(): Promise<void> {
    if (this.vegetationBuilt) return;
    this.vegetationBuilt = true;

    this.forestManager = await createForestProps(this.terrain, this.maxAnisotropy, {
      isBlockedAt: (x, z) => this.riverSystem.isBlockedAt(x, z) || this.quarrySystem.isBlockedAt(x, z),
      rendererBackend: this.rendererBackend,
    });
    if (GRASS_BLADES_ENABLED) {
      this.grassField = createGrassBladeField(this.terrain, {
        isBlockedAt: (x, z) =>
          this.riverSystem.isGrassBlockedAt(x, z)
          || this.quarrySystem.isGrassBlockedAt(x, z)
          || (getActivePlacedBuildingLayout()?.isBlockedForGrass(x, z) ?? false),
      });
      this.scene.add(this.grassField.group);
      // Draw reeds after grass so shoreline cattails stay visible at ground level.
      this.scene.attach(this.riverSystem.reedsGroup);
    }

    this.scene.add(this.forestManager.group);
    this.rebuildRockSpatialIndex();

    if (this.roadNetworkRef) {
      this.refreshForestClearance();
      this.grassField?.syncRoadClearance(this.roadNetworkRef);
      this.refreshShadowMap();
    }
  }

  resize(): void {
    const rect = this.container.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    const pixelRatio = Math.min(window.devicePixelRatio, 1);
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
    this.postProcessor.setPixelRatio(pixelRatio);
    this.postProcessor.setSize(width, height);
    this.sky.updateResolution(width * pixelRatio, height * pixelRatio);
  }

  setBuildInteractionActive(active: boolean): void {
    if (this.buildInteractionActive === active) {
      this.grassField?.setBuildInteractionActive(active);
      return;
    }
    this.buildInteractionActive = active;
    this.grassField?.setBuildInteractionActive(active);
    if (active) {
      this.shadowsEnabledBeforeDraft = this.sunLight.castShadow;
      this.sunLight.castShadow = false;
      return;
    }
    this.sunLight.castShadow = this.shadowsEnabledBeforeDraft;
    this.refreshShadowMap();
  }

  setRoadDraftActive(active: boolean): void {
    this.grassField?.setRoadDraftActive(active);
  }

  private rebuildRockSpatialIndex(): void {
    const rocks = [
      ...(this.forestManager?.rockPlacements ?? []),
      ...this.riverSystem.shoreRockPlacements,
      ...this.quarrySystem.rockPlacements,
    ];
    this.rockSpatialIndex = rocks.length > 0 ? new RockSpatialIndex(rocks) : null;
  }

  render(dt: number, orbitDistance?: number, firstPersonActive = false): void {
    const elapsed = performance.now() * 0.001;
    const cameraDistance = orbitDistance ?? this.camera.position.distanceTo(this.cameraTarget);
    updateTerrainZoomBlend(this.terrain, cameraDistance, firstPersonActive);
    this.grassField?.updateCameraState(
      this.camera.position,
      this.cameraTarget,
      cameraDistance,
      firstPersonActive,
    );
    this.riverSystem.updateCameraState(
      this.camera.position,
      this.cameraTarget,
      cameraDistance,
      firstPersonActive,
    );
    this.sky.updateCamera(this.camera);
    this.sky.updateSun(this.sunDirection);
    this.sky.updateTime(elapsed);
    this.riverSystem.tick(dt, elapsed);
    this.renderFrame++;
    if (!this.buildInteractionActive) {
      fitDirectionalLightShadow(this.sunLight, { bounds: this.terrain.bounds, sunOffsetDir: this.sunDirection });
    }
    this.postProcessor.render(dt);
  }

  getPerformanceStats(): { backend: RendererBackendKind; calls: number; triangles: number; pixelRatio: number } {
    return {
      backend: this.rendererBackend,
      calls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      pixelRatio: this.renderer.getPixelRatio(),
    };
  }

  getForestManager(): ForestManager | null {
    return this.forestManager;
  }

  setForestClearanceSources(
    buildings: Iterable<BuildingTerrainSource>,
    burgageZones: Iterable<BurgageZoneState>,
  ): void {
    this.forestClearanceBuildings = [...buildings];
    this.forestClearanceBurgageZones = [...burgageZones];
    this.refreshForestClearance();
  }

  getBridgeSamplingContext(): BridgeSamplingContext {
    const { terrain, riverSystem } = this;
    const riverField = riverSystem.field;
    return {
      isWaterAt: (x, z) => riverField.isRenderedWetAt(x, z),
      getTerrainY: (x, z) => terrain.getHeightAt(x, z),
      getWaterSurfaceY: (x, z) => getStillWaterSurfaceY(terrain, riverField, x, z),
    };
  }

  isRoadPathBlocked(path: THREE.Vector3[], roadWidth: number): boolean {
    return this.getRoadPathBlockReason(path, roadWidth) !== null;
  }

  getRoadPathBlockReason(
    path: THREE.Vector3[],
    roadWidth: number,
    _bridgeCtx?: BridgeSamplingContext,
    sampledPath?: THREE.Vector3[],
    rockCheckPath?: THREE.Vector3[],
  ): 'river' | 'rocks' | null {
    if (path.length < 2) return null;
    const sampled = sampledPath ?? this.roadMeshBuilder.samplePath(path, 1.25);
    if (sampled.length < 2) return null;

    const roadHalfWidth = roadWidth * 0.5;
    const rockPath = rockCheckPath ?? sampled;
    const bounds = computePathBoundsXZ(rockPath, roadHalfWidth + 10);
    if (this.rockSpatialIndex?.findRockBlockNearPath(rockPath, bounds, roadHalfWidth)) {
      return 'rocks';
    }

    return null;
  }

  sampleRoadDeckY(x: number, z: number): number | null {
    const network = this.roadNetworkRef;
    if (!network) return null;

    let best: number | null = null;
    for (const edge of network.edges.values()) {
      const path = edge.sampledPath.length >= 2 ? edge.sampledPath : edge.controlPoints;
      if (path.length < 2) continue;

      const projection = projectPointToPathXZ(x, z, path);
      if (projection.distance > edge.width * 0.52) continue;
      best = best == null ? projection.y : Math.max(best, projection.y);
    }
    return best;
  }

  syncRoadNetwork(network: RoadNetwork): void {
    this.roadNetworkRef = network;
    for (const [edgeId, visual] of this.edgeVisuals) {
      if (!network.edges.has(edgeId)) {
        this.roadGroup.remove(visual.group);
        disposeObject3D(visual.group);
        this.edgeVisuals.delete(edgeId);
      }
    }

    for (const edge of network.edges.values()) {
      this.upsertEdge(edge, network);
    }

    this.rebuildJunctions(network);
    this.refreshForestClearance();
    this.grassField?.syncRoadClearance(network);
    updateTerrainRoadWear(this.terrain, network);
    this.refreshShadowMap();
  }

  private refreshForestClearance(): void {
    this.forestManager?.syncPlacementClearance({
      roadNetwork: this.roadNetworkRef,
      buildings: this.forestClearanceBuildings,
      burgageZones: this.forestClearanceBurgageZones,
    });
  }

  private refreshShadowMap(): void {
    const shadowMap = this.renderer.shadowMap as { needsUpdate?: boolean };
    if ('needsUpdate' in shadowMap) shadowMap.needsUpdate = true;
  }

  getRoadPickMeshes(): THREE.Object3D[] {
    const meshes: THREE.Object3D[] = [];
    for (const visual of this.edgeVisuals.values()) {
      visual.group.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) meshes.push(child);
      });
    }
    return meshes;
  }

  dispose(): void {
    for (const visual of this.edgeVisuals.values()) disposeObject3D(visual.group);
    this.edgeVisuals.clear();
    if (this.forestManager) {
      disposeObject3D(this.forestManager.group);
      this.forestManager.dispose();
    }
    if (this.grassField) {
      this.grassField.dispose();
      disposeObject3D(this.grassField.group);
    }
    this.riverSystem.dispose();
    disposeObject3D(this.riverSystem.group);
    this.quarrySystem.dispose();
    disposeObject3D(this.quarrySystem.group);
    this.sky.dispose();
    this.postProcessor.dispose();
    disposeObject3D(this.junctionGroup);
    disposeObject3D(this.previewGroup);
    disposeObject3D(this.selectionGroup);
    this.terrain.dispose();
    this.materials.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private upsertEdge(edge: RoadEdge, network: RoadNetwork): void {
    const existing = this.edgeVisuals.get(edge.id);
    if (existing && existing.revision === edge.revision) return;
    if (existing) {
      this.roadGroup.remove(existing.group);
      disposeObject3D(existing.group);
      this.edgeVisuals.delete(edge.id);
    }
    const group = this.roadMeshBuilder.buildEdge(edge, network);
    this.roadGroup.add(group);
    this.edgeVisuals.set(edge.id, { revision: edge.revision, group });
  }

  private rebuildJunctions(network: RoadNetwork): void {
    disposeObject3D(this.junctionGroup);
    this.junctionGroup.clear();
    const builder = new RoadJunctionBuilder(this.terrain, this.materials);
    const next = builder.build(network);
    for (const child of [...next.children]) this.junctionGroup.add(child);
  }

  private addLighting(): void {
    const hemi = new THREE.HemisphereLight(0xdff0ff, 0x56644a, 1.9);
    this.scene.add(hemi);

    const ambient = new THREE.AmbientLight(0xb8d1ff, 0.2);
    this.scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xffefd2, 4.9);
    sun.name = 'Sun';
    sun.position.copy(this.sunDirection).multiplyScalar(180);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    sun.shadow.bias = -0.00015;
    sun.shadow.normalBias = 0.012;
    sun.shadow.radius = 2.8;
    sun.shadow.camera.layers.enable(TREE_SHADOW_CAST_LAYER);
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sunLight = sun;
    fitDirectionalLightShadow(sun, { bounds: this.terrain.bounds, sunOffsetDir: this.sunDirection });
    this.refreshShadowMap();

    const blueFill = new THREE.DirectionalLight(0x9fc8ff, 0.45);
    blueFill.name = 'Sky fill';
    blueFill.position.copy(this.sunDirection).multiplyScalar(-90).add(new THREE.Vector3(0, 65, 0));
    this.scene.add(blueFill);
  }

}

function projectPointToPathXZ(
  x: number,
  z: number,
  path: THREE.Vector3[],
): { distance: number; y: number } {
  let bestDistance = Infinity;
  let bestY = path[0].y;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const lengthSq = abx * abx + abz * abz;
    const t = lengthSq <= 1e-6 ? 0 : THREE.MathUtils.clamp(((x - a.x) * abx + (z - a.z) * abz) / lengthSq, 0, 1);
    const px = a.x + abx * t;
    const pz = a.z + abz * t;
    const distance = Math.hypot(x - px, z - pz);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestY = THREE.MathUtils.lerp(a.y, b.y, t);
    }
  }
  return { distance: bestDistance, y: bestY };
}
