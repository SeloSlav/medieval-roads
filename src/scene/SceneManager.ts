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
import type { WorldGenerationSettings } from '../world/worldGenerationSettings.ts';
import { resolveWorldDimensions } from '../world/worldGenerationSettings.ts';
import { forestDensityScale } from '../world/worldGenerationSettings.ts';
import type { RoadEdge } from '../roads/RoadEdge.ts';
import { RoadJunctionBuilder } from '../roads/RoadJunctionBuilder.ts';
import { RoadMaterialFactory } from '../roads/RoadMaterialFactory.ts';
import { RoadMeshBuilder } from '../roads/RoadMeshBuilder.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import type { Point2 } from '../utils/polygonGeometry.ts';
import type { BridgeSamplingContext } from '../roads/RiverBridgeSpans.ts';
import { getStillWaterSurfaceY } from '../rivers/RiverWaterLevel.ts';
import { SkyCloudMesh } from '../sky/SkyCloudMesh.ts';
import type { DayNightLightingState } from '../world/dayNightPresentation.ts';
import { Terrain } from '../terrain/Terrain.ts';
import { TerrainProjector } from '../terrain/TerrainProjector.ts';
import { disposeObject3D } from '../utils/dispose.ts';
import { computePathBoundsXZ } from '../utils/pathGeometry.ts';
import { RockSpatialIndex } from '../utils/rockSpatialIndex.ts';
import { yieldToMain } from '../utils/yieldToMain.ts';
import { createPostProcessor, type ScenePostProcessor } from './PostProcessing.ts';
import { fitDirectionalLightShadow, computeViewShadowBounds, intersectTerrainBounds, updateDirectionalShadowCameraMatrices } from './fitDirectionalShadow.ts';
import { createPreferredRenderer, type RendererBackend, type RendererBackendKind, type SupportedRenderer } from './RendererBackend.ts';
import { applyShadowPreferences as syncShadowCasters } from './applyShadowPreferences.ts';
import { TREE_SHADOW_CAST_LAYER } from './SceneLayers.ts';
import { subscribeShadowPreferences } from './shadowPreference.ts';
import { applyMaxAnisotropy, beginStartupTextureLoad, type SceneStartupTextures } from './startupTextures.ts';
import { HydrologyOverlay } from '../hydrology/HydrologyOverlay.ts';
import {
  isHydrologyOverlayEnabled,
  subscribeHydrologyOverlayPreference,
} from './hydrologyOverlayPreference.ts';
import type { LoadingPhase } from '../ui/loadingProgress.ts';
import { createBerryPatchVisuals, type BerryPatchVisuals } from '../foraging/BerryPatchVisuals.ts';
import { createDeerWildlifeVisuals, type DeerWildlifeVisuals } from '../foraging/DeerWildlifeVisuals.ts';
import {
  disposeBuildingMaterialLibrary,
  initializeBuildingMaterialLibrary,
  setBuildingIndirectLightIntensity,
} from '../buildings/buildingMaterials.ts';
import {
  disposeVineyardVineResources,
  initializeVineyardVineResources,
} from '../vegetation/seedthree/vineyardVines.ts';

export type SceneLoadProgress = {
  label: string;
  detail?: string;
  phase: LoadingPhase;
  fraction: number;
};

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
  private hemiLight!: THREE.HemisphereLight;
  private ambientLight!: THREE.AmbientLight;
  private skyFillLight!: THREE.DirectionalLight;
  private skyAnimationTime = 0;
  private forestManager: ForestManager | null = null;
  private grassField: GrassBladeField | null = null;
  private berryPatchVisuals: BerryPatchVisuals | null = null;
  private deerWildlifeVisuals: DeerWildlifeVisuals | null = null;
  private vegetationBuilt = false;
  private roadNetworkRef: RoadNetwork | null = null;
  private forestClearanceBuildings: BuildingTerrainSource[] = [];
  private forestClearanceBurgageParcelPolygons: Point2[][] = [];
  private forestClearanceFarmFieldPolygons: Point2[][] = [];
  private lastForestClearanceSourceSignature = '';
  private readonly riverSystem: RiverSystem;
  private readonly quarrySystem: QuarrySystem;
  private readonly hydrologyOverlay: HydrologyOverlay;
  readonly worldLayout: WorldLayout;

  get riverField() {
    return this.riverSystem.field;
  }

  get textureAnisotropy(): number {
    return this.maxAnisotropy;
  }
  private readonly roadGroup = new THREE.Group();
  private readonly junctionGroup = new THREE.Group();
  private readonly edgeVisuals = new Map<string, { revision: number; group: THREE.Group }>();
  private rockSpatialIndex: RockSpatialIndex | null = null;
  private buildInteractionActive = false;
  private renderFrame = 0;
  private readonly firstPersonDeerObserver = { x: 0, z: 0, crouching: false };
  private lastShadowTargetX = Number.NaN;
  private lastShadowTargetZ = Number.NaN;
  private lastShadowDistance = Number.NaN;
  private unsubscribeShadowPreferences: (() => void) | null = null;
  private unsubscribeHydrologyOverlayPreference: (() => void) | null = null;

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
    this.camera.layers.disable(TREE_SHADOW_CAST_LAYER);
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
    this.hydrologyOverlay = new HydrologyOverlay({
      terrain,
      riverField: riverSystem.field,
      parent: this.scene,
    });
    this.unsubscribeHydrologyOverlayPreference = subscribeHydrologyOverlayPreference(() => {
      this.applyHydrologyOverlayPreference();
    });
    this.applyHydrologyOverlayPreference();
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
    this.unsubscribeShadowPreferences = subscribeShadowPreferences(() => this.applyShadowPreferences());
    this.applyShadowPreferences();
  }

  static async create(
    container: HTMLElement,
    settings: WorldGenerationSettings,
    onProgress?: (progress: SceneLoadProgress) => void,
    materialsPromise?: Promise<RoadMaterialFactory>,
    startupTexturesPromise?: Promise<SceneStartupTextures>,
  ): Promise<SceneManager> {
    onProgress?.({
      label: 'Loading graphics',
      detail: 'Renderer, roads, sky, and river textures',
      phase: 'graphics',
      fraction: 0,
    });
    const [backend, materials, startupTextures] = await Promise.all([
      createPreferredRenderer(),
      materialsPromise ?? RoadMaterialFactory.create(8),
      startupTexturesPromise ?? beginStartupTextureLoad(),
      initializeBuildingMaterialLibrary(8),
    ]);
    applyMaxAnisotropy(startupTextures, backend.maxAnisotropy);
    await initializeVineyardVineResources(backend.maxAnisotropy, backend.kind);
    container.appendChild(backend.renderer.domElement);
    onProgress?.({
      label: 'Loading graphics',
      detail: 'Renderer, roads, sky, and river textures',
      phase: 'graphics',
      fraction: 1,
    });

    onProgress?.({
      label: 'Building world',
      detail: 'River layout, quarries, and terrain',
      phase: 'worldFeatures',
      fraction: 0,
    });
    const dimensions = resolveWorldDimensions(settings.mapSize);
    const worldLayout = createWorldLayout(settings);
    const { quarryLayout, riverLayout } = worldLayout;
    setActiveRiverLayout(riverLayout);
    setActiveQuarryLayout(quarryLayout);
    const riverBounds = Terrain.fullBounds(dimensions.terrainSize);
    const riverField = RiverField.fromLayout({ bounds: riverBounds, layout: riverLayout });
    await yieldToMain();

    const terrain = await Terrain.create(
      materials.createTerrainMaterialWithRiverShore(),
      riverField,
      quarryLayout,
      (completedRows, totalRows) => {
        onProgress?.({
          label: 'Building world',
          detail: `Shaping terrain (${completedRows}/${totalRows})`,
          phase: 'terrain',
          fraction: completedRows / totalRows,
        });
      },
      dimensions,
    );
    await yieldToMain();

    onProgress?.({
      label: 'Building world',
      detail: 'River water, banks, and quarries',
      phase: 'worldFeatures',
      fraction: 0.55,
    });
    await yieldToMain();
    const riverSystem = await createRiverSystem(
      terrain,
      riverField,
      materials.riverBank,
      startupTextures.riverRock,
      backend.maxAnisotropy,
      backend.kind,
    );
    const quarrySystem = createQuarrySystem(terrain, quarryLayout, startupTextures.riverRock);
    await yieldToMain();

    onProgress?.({
      label: 'Building world',
      detail: 'Sky and scene lighting',
      phase: 'worldFeatures',
      fraction: 1,
    });
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
      webgpuRenderer: this.rendererBackend === 'webgpu' ? this.renderer : undefined,
      treeSeed: this.worldLayout.treeSeed,
      densityScale: forestDensityScale(this.worldLayout.settings.forestDensity),
      forestCores: this.worldLayout.forestCores,
    });
    const isForagingSiteBlocked = (x: number, z: number) =>
      this.riverSystem.isBlockedAt(x, z) || this.quarrySystem.isBlockedAt(x, z);
    const deerVisualsPromise = createDeerWildlifeVisuals(
      this.terrain,
      this.worldLayout.foragingLayout.sites,
      this.worldLayout.foragingLayout.seed,
      isForagingSiteBlocked,
    ).catch((error: unknown) => {
      console.warn('Animated deer model could not be loaded:', error);
      return null;
    });
    this.berryPatchVisuals = await createBerryPatchVisuals(
      this.terrain,
      this.worldLayout.foragingLayout.sites,
      this.maxAnisotropy,
      this.rendererBackend,
      this.worldLayout.foragingLayout.seed,
      isForagingSiteBlocked,
    );
    this.scene.add(this.berryPatchVisuals.group);
    this.deerWildlifeVisuals = await deerVisualsPromise;
    if (this.deerWildlifeVisuals) this.scene.add(this.deerWildlifeVisuals.group);
    if (GRASS_BLADES_ENABLED) {
      this.grassField = await createGrassBladeField(this.terrain, {
        isBlockedAt: (x, z) =>
          this.riverSystem.isGrassBlockedAt(x, z)
          || this.quarrySystem.isGrassBlockedAt(x, z)
          || (getActivePlacedBuildingLayout()?.isBlockedForGrass(x, z) ?? false),
        useSeedThreeClumps: this.rendererBackend === 'webgpu',
        maxAnisotropy: this.maxAnisotropy,
      });
      this.scene.add(this.grassField.group);
      // Draw reeds after grass so shoreline cattails stay visible at ground level.
      this.scene.attach(this.riverSystem.reedsGroup);
    }

    this.scene.add(this.forestManager.group);
    if (this.roadNetworkRef) {
      this.forestManager.syncRoadClearance(this.roadNetworkRef);
    }
    this.refreshForestClearance();
    this.grassField?.syncPlacementClearance(this.forestClearanceFarmFieldPolygons);

    if (this.roadNetworkRef) {
      this.grassField?.syncRoadClearance(this.roadNetworkRef);
      this.refreshShadowMap();
    }

    this.applyShadowPreferences();
  }

  applyShadowPreferences(): void {
    if (!this.sunLight) return;
    syncShadowCasters({
      sunLight: this.sunLight,
      forestManager: this.forestManager,
      propGroups: [this.riverSystem.group, this.quarrySystem.group],
      buildingRoot: this.selectionGroup,
    });
    this.refreshShadowMap();
  }

  applyHydrologyOverlayPreference(): void {
    this.hydrologyOverlay.setVisible(isHydrologyOverlayEnabled());
  }

  isHydrologyOverlayVisible(): boolean {
    return this.hydrologyOverlay.isVisible();
  }

  setHydrologyOverlayVisible(visible: boolean): void {
    this.hydrologyOverlay.setVisible(visible);
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
    if (!active) {
      this.refreshShadowMap();
    }
  }

  setRoadDraftActive(active: boolean): void {
    this.grassField?.setRoadDraftActive(active);
  }

  private rebuildRockSpatialIndex(): void {
    const rocks = [
      ...(this.forestManager?.rockPlacements ?? []),
      ...this.riverSystem.getShoreRockPlacements(),
      ...this.quarrySystem.rockPlacements,
    ];
    this.rockSpatialIndex = rocks.length > 0 ? new RockSpatialIndex(rocks) : null;
  }

  render(
    dt: number,
    orbitDistance?: number,
    firstPersonActive = false,
    firstPersonCrouching = false,
  ): void {
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
    this.sky.updateTime(this.skyAnimationTime);
    this.riverSystem.tick(dt, elapsed);
    if (firstPersonActive) {
      this.firstPersonDeerObserver.x = this.camera.position.x;
      this.firstPersonDeerObserver.z = this.camera.position.z;
      this.firstPersonDeerObserver.crouching = firstPersonCrouching;
    }
    this.deerWildlifeVisuals?.update(
      dt,
      firstPersonActive ? this.firstPersonDeerObserver : null,
      cameraDistance,
    );
    this.renderFrame++;
    if (this.shouldRefreshShadowMap(cameraDistance)) {
      const viewBounds = computeViewShadowBounds(this.camera, this.cameraTarget, cameraDistance);
      const shadowBounds = intersectTerrainBounds(viewBounds, this.terrain.bounds);
      fitDirectionalLightShadow(this.sunLight, {
        bounds: shadowBounds,
        sunOffsetDir: this.sunDirection,
      });
      this.lastShadowTargetX = this.cameraTarget.x;
      this.lastShadowTargetZ = this.cameraTarget.z;
      this.lastShadowDistance = cameraDistance;
      this.refreshShadowMap();
    }
    this.postProcessor.render(dt);
  }

  private shouldRefreshShadowMap(cameraDistance: number): boolean {
    if (!Number.isFinite(this.lastShadowTargetX)) return true;
    const interval = this.buildInteractionActive ? 3 : 2;
    if (this.renderFrame % interval !== 0) return false;
    const dx = this.cameraTarget.x - this.lastShadowTargetX;
    const dz = this.cameraTarget.z - this.lastShadowTargetZ;
    if (Math.hypot(dx, dz) > 10) return true;
    return Math.abs(cameraDistance - this.lastShadowDistance) > 8;
  }

  applyDayNight(state: DayNightLightingState): void {
    this.skyAnimationTime = state.skyAnimationTime;
    this.sunDirection.copy(state.sunDirection);
    this.sunLight.color.setHex(state.sunColor);
    this.sunLight.intensity = state.sunIntensity;
    // Keep the sun parallel to the fitted shadow target — not world origin — so panning
    // does not skew directional shadows between shadow-map refits.
    this.sunLight.position.copy(this.sunLight.target.position).addScaledVector(state.sunDirection, 180);
    this.sunLight.updateMatrixWorld();
    this.sunLight.target.updateMatrixWorld();
    updateDirectionalShadowCameraMatrices(this.sunLight);
    this.hemiLight.color.setHex(state.hemiSkyColor);
    this.hemiLight.groundColor.setHex(state.hemiGroundColor);
    this.hemiLight.intensity = state.hemiIntensity;
    this.ambientLight.color.setHex(state.ambientColor);
    this.ambientLight.intensity = state.ambientIntensity;
    setBuildingIndirectLightIntensity(state.buildingIndirectIntensity);
    this.skyFillLight.color.setHex(state.fillColor);
    this.skyFillLight.intensity = state.fillIntensity;
    this.skyFillLight.position.copy(this.sunDirection).multiplyScalar(-90).add(new THREE.Vector3(0, 65, 0));
    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.color.setHex(state.fogColor);
      this.scene.fog.density = state.fogDensity;
    }
    this.postProcessor.setDayNightGrade(state.grade);
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
    burgageParcelPolygons: Iterable<Point2[]>,
    farmFieldPolygons: Iterable<Point2[]>,
  ): void {
    const nextBuildings = [...buildings];
    const nextParcelPolygons = [...burgageParcelPolygons];
    const nextFarmFieldPolygons = [...farmFieldPolygons];
    const signature = forestClearanceSourceSignature(nextBuildings, nextParcelPolygons, nextFarmFieldPolygons);
    if (signature === this.lastForestClearanceSourceSignature) return;
    this.lastForestClearanceSourceSignature = signature;
    this.forestClearanceBuildings = nextBuildings;
    this.forestClearanceBurgageParcelPolygons = nextParcelPolygons;
    this.forestClearanceFarmFieldPolygons = nextFarmFieldPolygons;
    this.refreshForestClearance();
    this.grassField?.syncPlacementClearance(nextFarmFieldPolygons);
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
    this.forestManager?.syncRoadClearance(network);
    this.grassField?.syncRoadClearance(network);
    updateTerrainRoadWear(this.terrain, network);
    this.refreshShadowMap();
  }

  private refreshForestClearance(): void {
    this.forestManager?.syncPlacementClearance({
      buildings: this.forestClearanceBuildings,
      burgageParcelPolygons: this.forestClearanceBurgageParcelPolygons,
      farmFieldPolygons: this.forestClearanceFarmFieldPolygons,
    });
    this.riverSystem.syncPlacementClearance(
      this.forestClearanceBuildings,
      this.forestClearanceFarmFieldPolygons,
    );
    this.rebuildRockSpatialIndex();
  }

  private refreshShadowMap(): void {
    if (this.sunLight) {
      this.sunLight.shadow.needsUpdate = true;
    }

    const shadowMap = this.renderer.shadowMap as { needsUpdate?: boolean };
    if ('needsUpdate' in shadowMap) {
      shadowMap.needsUpdate = true;
    }
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
    this.unsubscribeShadowPreferences?.();
    this.unsubscribeShadowPreferences = null;
    this.unsubscribeHydrologyOverlayPreference?.();
    this.unsubscribeHydrologyOverlayPreference = null;
    this.hydrologyOverlay.dispose();
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
    if (this.berryPatchVisuals) {
      this.berryPatchVisuals.dispose();
      disposeObject3D(this.berryPatchVisuals.group);
      this.berryPatchVisuals = null;
    }
    if (this.deerWildlifeVisuals) {
      this.scene.remove(this.deerWildlifeVisuals.group);
      this.deerWildlifeVisuals.dispose();
      this.deerWildlifeVisuals = null;
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
    disposeVineyardVineResources();
    disposeBuildingMaterialLibrary();
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
    this.hemiLight = hemi;
    this.scene.add(hemi);

    const ambient = new THREE.AmbientLight(0xb8d1ff, 0.2);
    this.ambientLight = ambient;
    this.scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xffefd2, 4.9);
    sun.name = 'Sun';
    sun.position.copy(this.sunDirection).multiplyScalar(180);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.00015;
    sun.shadow.normalBias = 0.012;
    sun.shadow.radius = 2.8;
    sun.shadow.autoUpdate = true;
    sun.shadow.camera.layers.enable(TREE_SHADOW_CAST_LAYER);
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sunLight = sun;
    fitDirectionalLightShadow(sun, { bounds: this.terrain.bounds, sunOffsetDir: this.sunDirection });
    this.refreshShadowMap();

    const blueFill = new THREE.DirectionalLight(0x9fc8ff, 0.45);
    blueFill.name = 'Sky fill';
    this.skyFillLight = blueFill;
    blueFill.position.copy(this.sunDirection).multiplyScalar(-90).add(new THREE.Vector3(0, 65, 0));
    this.scene.add(blueFill);
  }

}

function forestClearanceSourceSignature(
  buildings: BuildingTerrainSource[],
  burgageParcelPolygons: Point2[][],
  farmFieldPolygons: Point2[][],
): string {
  const buildingPart = buildings
    .map((building) => `${building.kind}:${building.x.toFixed(2)}:${building.z.toFixed(2)}`)
    .sort()
    .join('|');
  const parcelPart = burgageParcelPolygons
    .map((polygon) => polygon
      .map((point) => `${point.x.toFixed(2)},${point.z.toFixed(2)}`)
      .join('-'))
    .sort()
    .join('|');
  const farmFieldPart = farmFieldPolygons
    .map((polygon) => polygon
      .map((point) => `${point.x.toFixed(2)},${point.z.toFixed(2)}`)
      .join('-'))
    .sort()
    .join('|');
  return `${buildingPart}§${parcelPart}§${farmFieldPart}`;
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
