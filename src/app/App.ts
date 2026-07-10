import { CameraController } from '../camera/CameraController.ts';
import { FirstPersonController } from '../camera/FirstPersonController.ts';
import { BuildingMarkers } from '../buildings/BuildingMarkers.ts';
import { BuildingTerrainLayout } from '../buildings/BuildingTerrainLayout.ts';
import type { BuildingTerrainSource } from '../buildings/BuildingTerrainLayout.ts';
import { BuildingTool } from '../buildings/BuildingTool.ts';
import { BurgageTool } from '../residences/BurgageTool.ts';
import { ResidenceMarkers } from '../residences/ResidenceMarkers.ts';
import { BurgageFencing } from '../residences/BurgageFencing.ts';
import { SpacetimeGameStore } from '../data/spacetimeGameStore.ts';
import { InputManager } from '../input/InputManager.ts';
import {
  isBurgagePlacementBlocked,
  isBuildingPlacementBlocked,
  isWorldInspectionBlocked,
  type PlacementInteractionGate,
} from '../input/PlacementInteractionGate.ts';
import {
  createInitialGameState,
  deserializeGameState,
  gameStateToSnapshot,
  restoreGameState,
  serializeGameState,
} from '../resources/GameState.ts';
import type { SpacetimeGameSnapshot } from '../data/spacetimeGameStore.ts';
import type { BuildingState, GameState } from '../resources/types.ts';
import { ForestVisualSync, countTreesNearBuilding } from '../resources/ForestVisualSync.ts';
import { ResourceInspector } from '../resources/ResourceInspector.ts';
import { computePopulationStats, computeResourceTotals } from '../resources/resourceTotals.ts';
import { TreeRegistry } from '../resources/TreeRegistry.ts';
import { WorldLayoutRegistry } from '../resources/WorldLayoutRegistry.ts';
import { WorldQueries } from '../resources/WorldQueries.ts';
import { RoadMaterialFactory } from '../roads/RoadMaterialFactory.ts';
import { RoadNetwork } from '../roads/RoadNetwork.ts';
import { RoadSelection } from '../roads/RoadSelection.ts';
import { RoadTool } from '../roads/RoadTool.ts';
import { GameRuntime } from '../runtime/GameRuntime.ts';
import { SceneManager } from '../scene/SceneManager.ts';
import { QuarryMapIcons } from '../map/QuarryMapIcons.ts';
import { beginStartupTextureLoad } from '../scene/startupTextures.ts';
import { setActivePlacedBuildingLayout, sampleNaturalTerrainHeight } from '../terrain/TerrainHeight.ts';
import { updateTerrainBuildingPads } from '../terrain/TerrainBuildingPads.ts';
import { BuildToolbar, type ToolbarStats } from '../ui/BuildToolbar.ts';
import { LoadingScreen } from '../ui/LoadingScreen.ts';
import { ToastManager } from '../ui/ToastManager.ts';
import { roadPlacementReasonToToastId, buildingPlacementReasonToToastId, burgagePlacementReasonToToastId } from '../ui/toastMessages.ts';

const TARGET_MAX_FPS = 90;
const TARGET_FRAME_MS = 1000 / TARGET_MAX_FPS;

export class App {
  private readonly root: HTMLElement;
  private sceneManager: SceneManager | null = null;
  private cameraController: CameraController | null = null;
  private firstPersonController: FirstPersonController | null = null;
  private input: InputManager | null = null;
  private roadNetwork: RoadNetwork | null = null;
  private roadTool: RoadTool | null = null;
  private roadSelection: RoadSelection | null = null;
  private buildingTool: BuildingTool | null = null;
  private burgageTool: BurgageTool | null = null;
  private buildingMarkers: BuildingMarkers | null = null;
  private residenceMarkers: ResidenceMarkers | null = null;
  private burgageFencing: BurgageFencing | null = null;
  private toolbar: BuildToolbar | null = null;
  private toastManager: ToastManager | null = null;
  private resourceInspector: ResourceInspector | null = null;
  private quarryMapIcons: QuarryMapIcons | null = null;
  private gameState: GameState | null = null;
  private layoutRegistry: WorldLayoutRegistry | null = null;
  private treeRegistry: TreeRegistry | null = null;
  private forestVisualSync: ForestVisualSync | null = null;
  private spacetimeStore: SpacetimeGameStore | null = null;
  private gameRuntime: GameRuntime | null = null;
  private spacetimeConnected = false;
  private lastPlacedBuildingSignature = '';
  private previousTreePhases = new Map<string, string>();
  private previousTreeGrowth = new Map<string, number>();
  private animationId = 0;
  private lastTime = 0;
  private frameBudgetTime = 0;
  private fpsSampleStart = 0;
  private fpsFrameCount = 0;
  private fpsAccumulatedSeconds = 0;
  private disposed = false;

  constructor(root: HTMLElement) {
    this.root = root;
  }

  async start(): Promise<void> {
    const loadingScreen = LoadingScreen.tryCreate();
    const materialsPromise = RoadMaterialFactory.create(8);
    const startupTexturesPromise = beginStartupTextureLoad();
    loadingScreen?.setProgress({ label: 'Starting world…', detail: 'Setting up scene shell' });

    this.root.innerHTML = `
      <div class="app-shell">
        <div class="scene-root" data-scene-root></div>
        <div data-ui-root></div>
      </div>
    `;

    const sceneRoot = this.mustElement('[data-scene-root]');
    const uiRoot = this.mustElement('[data-ui-root]');

    const sceneManager = await SceneManager.create(sceneRoot, (label, detail) => {
      loadingScreen?.setProgress({ label, detail });
    }, materialsPromise, startupTexturesPromise);
    const layoutRegistry = WorldLayoutRegistry.fromWorldLayout(sceneManager.worldLayout);
    const gameState = createInitialGameState(layoutRegistry, sceneManager.worldLayout.seed);
    const input = new InputManager(sceneManager.renderer.domElement);
    const roadNetwork = new RoadNetwork();
    const worldQueries = new WorldQueries({
      terrain: sceneManager.terrain,
      riverField: sceneManager.riverField,
      registry: layoutRegistry,
      getGameState: () => this.gameState ?? gameState,
      getRoadNetwork: () => this.roadNetwork ?? roadNetwork,
      getTreeRegistry: () => this.treeRegistry,
    });
    const buildingMarkers = new BuildingMarkers({
      terrain: sceneManager.terrain,
      parent: sceneManager.selectionGroup,
    });
    const placementGate: PlacementInteractionGate = {
      isRoadToolEnabled: () => false,
      isBuildingToolEnabled: () => false,
      isBurgageToolEnabled: () => false,
      isFirstPersonActive: () => false,
      isMenuOpen: () => false,
    };
    const cameraController = new CameraController({
      camera: sceneManager.camera,
      target: sceneManager.cameraTarget,
      domElement: sceneManager.renderer.domElement,
      bounds: sceneManager.terrain.bounds,
      getHeightAt: (x, z) => sceneManager.terrain.getHeightAt(x, z),
      getCursorOverride: () => {
        if (this.firstPersonController?.isActive()) return 'default';
        return this.burgageTool?.getCursor()
          ?? this.roadTool?.getCursor()
          ?? null;
      },
      shouldIgnoreInput: (event) => this.roadTool?.shouldBlockCameraInput(event) ?? false,
    });

    const roadSelection = new RoadSelection({
      camera: sceneManager.camera,
      domElement: sceneManager.renderer.domElement,
      network: roadNetwork,
      sceneManager,
      onChange: () => this.syncToolbar(),
    });

    const toggleRoadTool = (): void => {
      roadTool.setEnabled(!roadTool.isEnabled());
      if (roadTool.isEnabled()) {
        buildingTool.setMode('off');
        burgageTool.setEnabled(false);
      }
      this.syncToolbar();
    };

    const roadTool = new RoadTool({
      domElement: sceneManager.renderer.domElement,
      network: roadNetwork,
      sceneManager,
      selection: roadSelection,
      terrainProjector: sceneManager.terrainProjector,
      getGameState: () => this.gameState ?? gameState,
      onToggle: toggleRoadTool,
      onNetworkChanged: () => {
        sceneManager.syncRoadNetwork(roadNetwork);
        roadSelection.refresh();
        this.syncToolbar();
        if (this.spacetimeConnected && this.spacetimeStore) {
          this.spacetimeStore.queueRoadSync(roadNetwork.snapshot());
        }
      },
      onStateChanged: () => this.syncToolbar(),
      onDeleteRequested: (request) => {
        if (!this.toolbar) return;
        if (!request) {
          this.toolbar.hideDeletePopup();
          return;
        }
        this.toolbar.showDeletePopup({
          clientX: request.clientX,
          clientY: request.clientY,
          onRemove: () => roadTool.confirmDelete(request.edgeId),
          onCancel: () => roadSelection.setSelected(null),
        });
      },
      onPlacementRejected: (event) => {
        const messageId = roadPlacementReasonToToastId(event.reason);
        if (messageId) this.toastManager?.showMessageId(messageId, { variant: 'error' });
      },
    });

    let firstPersonController: FirstPersonController;

    const buildingTool = new BuildingTool({
      domElement: sceneManager.renderer.domElement,
      terrainProjector: sceneManager.terrainProjector,
      markers: buildingMarkers,
      getState: () => this.gameState ?? gameState,
      onPlaceBuilding: async (kind, x, z) => {
        if (!this.spacetimeStore?.isConnected) {
          throw new Error('SpacetimeDB is not connected. Start the local server and refresh.');
        }
        await this.spacetimeStore.placeBuilding(kind, x, z);
      },
      isWaterAt: (x, z) => sceneManager.riverField.isRenderedWetAt(x, z),
      isQuarryPitAt: (x, z) => sceneManager.worldLayout.quarryLayout.isBlockedForProps(x, z),
      getNaturalHeightAt: (x, z) => sampleNaturalTerrainHeight(x, z),
      countMatureTreesInRadius: (x, z, radius) => {
        const registry = this.treeRegistry;
        const state = this.gameState ?? gameState;
        if (!registry) return 0;
        return countTreesNearBuilding(state, registry, x, z, radius).matureTrees;
      },
      getRoadNetwork: () => roadNetwork,
      onPreviewChange: (preview) => {
        this.syncBuildingTerrainLayout();
        this.syncPreviewTerrainPads(preview);
      },
      onModeChanged: () => this.syncToolbar(),
      onPlacementRejected: (reason) => {
        this.toastManager?.showMessageId(buildingPlacementReasonToToastId(reason), { variant: 'error' });
      },
      onPlacementFailed: (message) => {
        this.toastManager?.show(message, { variant: 'error' });
      },
      isBlocked: () => isBuildingPlacementBlocked(placementGate),
    });

    const burgageTool = new BurgageTool({
      domElement: sceneManager.renderer.domElement,
      camera: sceneManager.camera,
      terrainProjector: sceneManager.terrainProjector,
      roadNetwork,
      getState: () => this.gameState ?? gameState,
      getHeightAt: (x, z) => sceneManager.terrain.getHeightAt(x, z),
      getNaturalHeightAt: (x, z) => sampleNaturalTerrainHeight(x, z),
      isWaterAt: (x, z) => sceneManager.riverField.isRenderedWetAt(x, z),
      isQuarryPitAt: (x, z) => sceneManager.worldLayout.quarryLayout.isBlockedForProps(x, z),
      onCommit: async (commit) => {
        if (!this.spacetimeStore?.isConnected) {
          throw new Error('SpacetimeDB is not connected. Start the local server and refresh.');
        }
        await this.spacetimeStore.placeBurgageZone({
          corners: commit.corners.map((corner) => ({ x: corner.x, z: corner.z })),
          frontageEdge: commit.frontageEdge,
          plotCount: commit.plotCount,
        });
      },
      onModeChanged: () => this.syncToolbar(),
      onPlacementRejected: (reason) => {
        this.toastManager?.showMessageId(burgagePlacementReasonToToastId(reason), { variant: 'error' });
      },
      onPlacementFailed: (message) => {
        this.toastManager?.show(message, { variant: 'error' });
      },
      onPickRejected: (reason) => {
        if (reason === 'missed_terrain') {
          this.toastManager?.show('Click on terrain to place a corner.', { variant: 'info', durationMs: 2200 });
          return;
        }
        this.toastManager?.show('Move farther from the last corner.', { variant: 'info', durationMs: 2200 });
      },
      isBlocked: () => isBurgagePlacementBlocked(placementGate),
    });
    burgageTool.attachTo(sceneManager.previewGroup);

    const residenceMarkers = new ResidenceMarkers(sceneManager.selectionGroup);
    const burgageFencing = new BurgageFencing(sceneManager.selectionGroup);

    const toolbar = new BuildToolbar(uiRoot, {
      onOpenRoads: toggleRoadTool,
      onBuildRoad: () => {
        if (burgageTool.isEnabled()) {
          burgageTool.commitDraft();
          return;
        }
        roadTool.commitDraft();
      },
      onToggleLumberMill: () => {
        buildingTool.toggleMode('lumber_mill');
        if (buildingTool.isEnabled()) {
          roadTool.setEnabled(false);
          burgageTool.setEnabled(false);
        }
        this.syncToolbar();
      },
      onToggleReforester: () => {
        buildingTool.toggleMode('reforester');
        if (buildingTool.isEnabled()) {
          roadTool.setEnabled(false);
          burgageTool.setEnabled(false);
        }
        this.syncToolbar();
      },
      onToggleWoodcuttersLodge: () => {
        buildingTool.toggleMode('woodcutters_lodge');
        if (buildingTool.isEnabled()) {
          roadTool.setEnabled(false);
          burgageTool.setEnabled(false);
        }
        this.syncToolbar();
      },
      onToggleStoneQuarry: () => {
        buildingTool.toggleMode('stone_quarry');
        if (buildingTool.isEnabled()) {
          roadTool.setEnabled(false);
          burgageTool.setEnabled(false);
        }
        this.syncToolbar();
      },
      onToggleResidences: () => {
        const wasEnabled = burgageTool.isEnabled();
        burgageTool.setEnabled(!wasEnabled);
        if (burgageTool.isEnabled()) {
          roadTool.setEnabled(false);
          buildingTool.setMode('off');
          this.toastManager?.show(
            'Draw the rectangle along the road, then use the on-screen plot controls to choose how many homes fit.',
            { variant: 'info', durationMs: 6500 },
          );
        }
        this.syncToolbar();
      },
      onBurgagePlotDecrease: () => {
        burgageTool.adjustPlotCount(-1);
        this.syncToolbar();
      },
      onBurgagePlotIncrease: () => {
        burgageTool.adjustPlotCount(1);
        this.syncToolbar();
      },
      onBurgageRotateFrontage: () => {
        burgageTool.rotateFrontageEdge();
        this.syncToolbar();
      },
      onMenuOpenChange: (open) => {
        cameraController.setInputEnabled(!open && !firstPersonController.isActive());
      },
      canOpenMenuFromKeyboard: () =>
        !firstPersonController.isActive()
        && !roadTool.isEnabled()
        && !buildingTool.isEnabled()
        && !burgageTool.isEnabled(),
      onExportGameState: () => this.exportGameState(),
      onImportGameState: () => this.importGameState(),
    });
    const toastManager = new ToastManager(uiRoot);
    const resourceInspector = new ResourceInspector({
      domElement: sceneManager.renderer.domElement,
      uiRoot,
      sceneManager,
      terrainProjector: sceneManager.terrainProjector,
      worldQueries,
      getState: () => this.gameState!,
      onDemolishBuilding: async (buildingId) => {
        if (!this.spacetimeStore?.isConnected) {
          this.toastManager?.show('SpacetimeDB is not connected.', { variant: 'error' });
          return;
        }
        try {
          await this.spacetimeStore.demolishBuilding(buildingId);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Demolition failed.';
          this.toastManager?.show(message, { variant: 'error' });
        }
      },
      onDemolishBurgageZone: async (zoneId) => {
        if (!this.spacetimeStore?.isConnected) {
          this.toastManager?.show('SpacetimeDB is not connected.', { variant: 'error' });
          return;
        }
        try {
          await this.spacetimeStore.demolishBurgageZone(zoneId);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Residence plot demolition failed.';
          this.toastManager?.show(message, { variant: 'error' });
        }
      },
      onDemolishResidence: async (residenceId) => {
        if (!this.spacetimeStore?.isConnected) {
          this.toastManager?.show('SpacetimeDB is not connected.', { variant: 'error' });
          return;
        }
        try {
          await this.spacetimeStore.demolishResidence(residenceId);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Residence removal failed.';
          this.toastManager?.show(message, { variant: 'error' });
        }
      },
      onAssignBuildingLabor: async (buildingId, labor) => {
        if (!this.spacetimeStore?.isConnected) {
          this.toastManager?.show('SpacetimeDB is not connected.', { variant: 'error' });
          return;
        }
        try {
          await this.spacetimeStore.assignBuildingLabor(buildingId, labor);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Labor assignment failed.';
          this.toastManager?.show(message, { variant: 'error' });
        }
      },
      isBlocked: () => isWorldInspectionBlocked(placementGate),
    });
    resourceInspector.setHud(
      computeResourceTotals(gameState),
      computePopulationStats(gameState),
    );

    const quarryMapIcons = new QuarryMapIcons({
      uiRoot,
      domElement: sceneManager.renderer.domElement,
      terrain: sceneManager.terrain,
      registry: layoutRegistry,
      getCamera: () => sceneManager.camera,
      getZoomPercent: () => this.cameraController?.getZoomPercent() ?? 100,
      onQuarrySelect: (quarryId) => resourceInspector.selectQuarry(quarryId),
      isBlocked: () => isWorldInspectionBlocked(placementGate),
    });

    firstPersonController = new FirstPersonController({
      camera: sceneManager.camera,
      domElement: sceneManager.renderer.domElement,
      bounds: sceneManager.terrain.bounds,
      getHeightAt: (x, z) => sceneManager.terrain.getHeightAt(x, z),
      getRoadDeckY: (x, z) => sceneManager.sampleRoadDeckY(x, z),
      getOrbitSpawn: () => {
        const target = cameraController.getTargetPosition();
        return { x: target.x, z: target.z, yaw: cameraController.getYaw() };
      },
      isMenuOpen: () => toolbar.isGameMenuOpen(),
      onModeChange: (active) => {
        cameraController.setInputEnabled(!active && !toolbar.isGameMenuOpen());
        toolbar.setFirstPersonMode(active);
        if (active) {
          if (roadTool.isEnabled()) roadTool.setEnabled(false);
          if (buildingTool.isEnabled()) buildingTool.setMode('off');
          if (burgageTool.isEnabled()) burgageTool.setEnabled(false);
          return;
        }
        const pos = firstPersonController.getPosition();
        cameraController.syncFromFirstPerson(pos.x, pos.z, firstPersonController.getBodyYaw());
      },
    });

    placementGate.isRoadToolEnabled = () => roadTool.isEnabled();
    placementGate.isBuildingToolEnabled = () => buildingTool.isEnabled();
    placementGate.isBurgageToolEnabled = () => burgageTool.isEnabled();
    placementGate.isFirstPersonActive = () => firstPersonController.isActive();
    placementGate.isMenuOpen = () => toolbar.isGameMenuOpen();

    this.sceneManager = sceneManager;
    this.input = input;
    this.roadNetwork = roadNetwork;
    this.cameraController = cameraController;
    this.firstPersonController = firstPersonController;
    this.roadTool = roadTool;
    this.roadSelection = roadSelection;
    this.buildingTool = buildingTool;
    this.burgageTool = burgageTool;
    this.buildingMarkers = buildingMarkers;
    this.residenceMarkers = residenceMarkers;
    this.burgageFencing = burgageFencing;
    this.toolbar = toolbar;
    this.toastManager = toastManager;
    this.resourceInspector = resourceInspector;
    this.quarryMapIcons = quarryMapIcons;
    this.gameState = gameState;
    this.layoutRegistry = layoutRegistry;

    const spacetimeStore = new SpacetimeGameStore();
    this.spacetimeStore = spacetimeStore;
    this.gameRuntime = new GameRuntime(spacetimeStore, layoutRegistry, sceneManager.worldLayout.seed, {
      onSnapshot: (snapshot, state) => this.applySpacetimeSnapshot(snapshot, state),
      onRoadsHydrated: (roads) => {
        this.roadNetwork?.restore(roads);
        this.sceneManager?.syncRoadNetwork(this.roadNetwork!);
        this.roadSelection?.refresh();
        this.syncToolbar();
      },
      onConnectError: (error) => {
        console.warn('SpacetimeDB unavailable — game simulation requires the server.', error);
        this.spacetimeConnected = false;
        this.toastManager?.show('SpacetimeDB is offline. Run `spacetime start` and refresh.', { variant: 'error' });
      },
    });
    this.gameRuntime.start();

    this.exposeDevHandles();

    sceneManager.syncRoadNetwork(roadNetwork);
    this.syncToolbar();
    window.addEventListener('resize', this.onResize);
    this.onResize();
    cameraController.applyRtsOrbitView();
    cameraController.update(0);
    this.toolbar?.setZoomPercent(cameraController.getZoomPercent());
    this.lastTime = performance.now();
    this.frameBudgetTime = this.lastTime;
    this.fpsSampleStart = this.lastTime;
    loadingScreen?.setProgress({ label: 'Almost ready…', detail: 'Rendering first frame' });
    sceneManager.render(0, cameraController.getOrbitDistance());
    loadingScreen?.dismiss();
    this.animationId = requestAnimationFrame(this.tick);
    window.setTimeout(() => {
      void (async () => {
        try {
          await sceneManager.finishVegetation();
          if (this.roadNetwork) sceneManager.syncRoadNetwork(this.roadNetwork);
          this.onForestReady();
        } catch (error) {
          console.error('Vegetation build failed:', error);
        }
      })();
    }, 0);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.animationId);
    window.removeEventListener('resize', this.onResize);
    this.roadTool?.dispose();
    this.roadSelection?.dispose();
    this.buildingTool?.dispose();
    this.burgageTool?.dispose();
    this.buildingMarkers?.dispose();
    this.residenceMarkers?.dispose();
    this.burgageFencing?.dispose();
    this.gameRuntime?.dispose();
    this.resourceInspector?.dispose();
    this.quarryMapIcons?.dispose();
    this.toastManager?.dispose();
    this.firstPersonController?.dispose();
    this.cameraController?.dispose();
    this.toolbar?.dispose();
    this.input?.dispose();
    this.sceneManager?.dispose();
  }

  private readonly tick = (time: number): void => {
    if (this.disposed) return;
    const budgetElapsed = time - this.frameBudgetTime;
    if (budgetElapsed < TARGET_FRAME_MS) {
      this.animationId = requestAnimationFrame(this.tick);
      return;
    }
    this.frameBudgetTime = time - (budgetElapsed % TARGET_FRAME_MS);
    const rawDt = (time - this.lastTime) / 1000;
    if (rawDt > 0.25) this.resetFpsSample(time);
    const dt = Math.min(0.05, Math.max(0.001, rawDt));
    this.lastTime = time;

    const firstPersonActive = this.firstPersonController?.isActive() ?? false;
    this.syncBuildInteractionPerf();
    if (firstPersonActive) {
      this.firstPersonController?.update(dt);
      this.toolbar?.setFirstPersonMode(true);
      this.roadTool?.update(dt);
      this.buildingTool?.update();
      this.burgageTool?.update();
      this.updateBuildButtonPosition();
      this.quarryMapIcons?.update();
      this.sceneManager?.render(dt, 12, true);
    } else {
      this.cameraController?.update(dt);
      this.toolbar?.setFirstPersonMode(false);
      this.toolbar?.setZoomPercent(this.cameraController?.getZoomPercent() ?? 100);
      this.roadTool?.update(dt);
      this.buildingTool?.update();
      this.burgageTool?.update();
      this.updateBuildButtonPosition();
      this.quarryMapIcons?.update();
      this.sceneManager?.render(dt, this.cameraController?.getOrbitDistance());
    }
    this.updateFps(time, dt);
    this.animationId = requestAnimationFrame(this.tick);
  };

  private onForestReady(): void {
    const forestManager = this.sceneManager?.getForestManager();
    if (!forestManager || !this.gameState) return;

    this.treeRegistry = TreeRegistry.fromForestManager(forestManager);
    this.forestVisualSync = new ForestVisualSync(forestManager);
    this.buildingMarkers?.syncBuildings(this.gameState.buildings.values());
    this.residenceMarkers?.syncResidences(
      this.gameState.residences.values(),
      (x, z) => this.sceneManager?.terrain.getHeightAt(x, z) ?? 0,
    );
    this.burgageFencing?.syncZones(
      this.gameState.burgageZones.values(),
      (x, z) => this.sceneManager?.terrain.getHeightAt(x, z) ?? 0,
    );
    this.syncPlacedBuildingTerrain({ forceMeshUpdate: true });
    this.syncForestClearance();
    this.syncResourceUi();
    this.exposeDevHandles();
  }

  private readonly onResize = (): void => {
    this.sceneManager?.resize();
  };

  private syncToolbar(): void {
    if (!this.toolbar || !this.roadNetwork || !this.roadTool || !this.roadSelection || !this.buildingTool || !this.burgageTool) return;
    const buildingMode = this.buildingTool.getMode();
    const burgageEnabled = this.burgageTool.isEnabled();
    const stats: ToolbarStats = {
      canBuild: burgageEnabled ? this.burgageTool.isDraftBuildable() : this.roadTool.isDraftBuildable(),
      hasDraft: burgageEnabled ? this.burgageTool.hasDraft() : this.roadTool.hasDraft(),
      mode: burgageEnabled
        ? 'residences'
        : this.roadTool.isEnabled()
          ? 'road'
          : buildingMode === 'off'
            ? 'idle'
            : buildingMode,
      statusDetail: burgageEnabled ? this.burgageTool.getStatusDetail() : null,
    };
    this.toolbar.setStats(stats);
    this.updateBuildButtonPosition();
  }

  private syncBuildInteractionPerf(): void {
    const roadDraft = Boolean(this.roadTool?.isEnabled() && this.roadTool.hasDraft());
    const burgageDraft = Boolean(this.burgageTool?.isEnabled() && this.burgageTool.hasDraft());
    const buildingActive = Boolean(this.buildingTool?.isEnabled());
    this.sceneManager?.setBuildInteractionActive(roadDraft || burgageDraft || buildingActive);
    this.sceneManager?.setRoadDraftActive(roadDraft);
  }

  private updateBuildButtonPosition(): void {
    const roadTool = this.roadTool;
    const burgageTool = this.burgageTool;
    if (!this.toolbar || !roadTool || !burgageTool) return;
    const burgageEnabled = burgageTool.isEnabled();
    const layoutHudState = burgageEnabled ? burgageTool.getLayoutHudState() : null;
    const layoutHudPosition = layoutHudState ? burgageTool.getLayoutHudPosition() : null;
    this.toolbar.setBurgageLayoutHud(layoutHudPosition, layoutHudState);

    const visible = burgageEnabled
      ? burgageTool.isDraftBuildable()
      : roadTool.isDraftBuildable();
    if (!visible) {
      this.toolbar.setBuildButtonPosition(null, false);
      return;
    }
    const position = burgageEnabled
      ? burgageTool.getBuildButtonPosition()
      : roadTool.getBuildButtonPosition();
    this.toolbar.setBuildButtonPosition(position, true);
  }

  private updateFps(time: number, dt: number): void {
    this.fpsFrameCount++;
    this.fpsAccumulatedSeconds += dt;
    const sampleMs = time - this.fpsSampleStart;
    if (sampleMs < 400) return;
    const fps = this.fpsFrameCount / Math.max(this.fpsAccumulatedSeconds, 0.001);
    this.toolbar?.setFps(fps);
    (window as typeof window & { __medievalRoadStats?: { backend?: string; fps: number; calls?: number; triangles?: number; pixelRatio?: number } })
      .__medievalRoadStats = { fps, ...this.sceneManager?.getPerformanceStats() };
    this.resetFpsSample(time);
  }

  private resetFpsSample(time: number): void {
    this.fpsSampleStart = time;
    this.fpsFrameCount = 0;
    this.fpsAccumulatedSeconds = 0;
  }

  private applySpacetimeSnapshot(snapshot: SpacetimeGameSnapshot, state: GameState): void {
    this.spacetimeConnected = snapshot.connected;

    if (!snapshot.connected) {
      this.syncToolbar();
      return;
    }

    const previous = this.gameState;
    this.gameState = state;

    const previousTreeCount = previous?.trees.size ?? 0;
    const changedTreeIds: string[] = [];
    for (const [treeId, entity] of state.trees) {
      const previousPhase = this.previousTreePhases.get(treeId);
      const previousGrowth = this.previousTreeGrowth.get(treeId);
      const phaseChanged = previousPhase !== entity.phase || previousPhase === undefined;
      const growthChanged = previousGrowth !== entity.growthProgress;
      if (phaseChanged || growthChanged) {
        changedTreeIds.push(treeId);
      }
      this.previousTreePhases.set(treeId, entity.phase);
      this.previousTreeGrowth.set(treeId, entity.growthProgress);
    }

    if (this.forestVisualSync && state.trees.size > 0 && previousTreeCount === 0) {
      this.forestVisualSync.syncAll(state.trees);
    } else if (changedTreeIds.length > 0) {
      this.forestVisualSync?.syncTrees(state.trees, changedTreeIds);
    }

    const buildingSignature = this.getPlacedBuildingSignature(state.buildings);
    const buildingsChanged = buildingSignature !== this.lastPlacedBuildingSignature;
    if (buildingsChanged) {
      this.lastPlacedBuildingSignature = buildingSignature;
      this.buildingMarkers?.syncBuildings(state.buildings.values());
      this.syncPlacedBuildingTerrain({ forceMeshUpdate: true });
    }

    this.residenceMarkers?.syncResidences(
      state.residences.values(),
      (x, z) => this.sceneManager?.terrain.getHeightAt(x, z) ?? 0,
    );
    this.burgageFencing?.syncZones(
      state.burgageZones.values(),
      (x, z) => this.sceneManager?.terrain.getHeightAt(x, z) ?? 0,
    );

    this.syncForestClearance();
    this.syncResourceUi();
    this.syncToolbar();
  }

  private syncForestClearance(): void {
    if (!this.sceneManager || !this.gameState) return;
    this.sceneManager.setForestClearanceSources(
      this.collectPlacedBuildingSources(),
      this.gameState.burgageZones.values(),
    );
  }

  private syncBuildingTerrainLayout(): void {
    if (!this.sceneManager) return;

    const placedSources = this.collectPlacedBuildingSources();
    const placedLayout = BuildingTerrainLayout.fromBuildings(placedSources, sampleNaturalTerrainHeight);
    setActivePlacedBuildingLayout(placedSources.length > 0 ? placedLayout : null);
  }

  private syncPreviewTerrainPads(preview: BuildingTerrainSource | null): void {
    if (!this.sceneManager) return;

    const placedSources = this.collectPlacedBuildingSources();
    const sources = preview ? [...placedSources, preview] : placedSources;
    const layout = sources.length > 0
      ? BuildingTerrainLayout.fromBuildings(sources, sampleNaturalTerrainHeight)
      : null;
    updateTerrainBuildingPads(this.sceneManager.terrain, layout);
  }

  private syncPlacedBuildingTerrain(options?: { forceMeshUpdate?: boolean }): void {
    if (!this.sceneManager) return;

    const placedSources = this.collectPlacedBuildingSources();
    const placedLayout = BuildingTerrainLayout.fromBuildings(placedSources, sampleNaturalTerrainHeight);
    setActivePlacedBuildingLayout(placedSources.length > 0 ? placedLayout : null);

    if (options?.forceMeshUpdate) {
      updateTerrainBuildingPads(this.sceneManager.terrain, placedSources.length > 0 ? placedLayout : null);
      this.buildingMarkers?.syncBuildings(this.gameState?.buildings.values() ?? []);
      if (this.gameState) {
        this.lastPlacedBuildingSignature = this.getPlacedBuildingSignature(this.gameState.buildings);
      }
    }
  }

  private collectPlacedBuildingSources(): BuildingTerrainSource[] {
    const placedSources: BuildingTerrainSource[] = [];
    if (!this.gameState) return placedSources;
    for (const building of this.gameState.buildings.values()) {
      placedSources.push({ kind: building.kind, x: building.x, z: building.z });
    }
    return placedSources;
  }

  private getPlacedBuildingSignature(buildings: Map<string, BuildingState>): string {
    return [...buildings.values()]
      .map((building) => `${building.id}:${building.kind}:${building.x.toFixed(2)}:${building.z.toFixed(2)}`)
      .sort()
      .join('|');
  }

  private syncResourceUi(): void {
    if (!this.gameState || !this.resourceInspector) return;
    this.resourceInspector.setHud(
      computeResourceTotals(this.gameState),
      computePopulationStats(this.gameState),
    );
    this.resourceInspector.refreshSelection();
  }

  private exportGameState(): void {
    if (!this.gameState || !this.roadNetwork) return;
    const snapshot = gameStateToSnapshot(this.gameState, this.roadNetwork.snapshot());
    const blob = new Blob([serializeGameState(snapshot)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `medieval-road-state-${Date.now()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    this.toastManager?.show('Game state exported.', { variant: 'success' });
  }

  private importGameState(): void {
    if (!this.layoutRegistry || !this.roadNetwork || !this.sceneManager) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return;
      void file.text().then((raw) => {
        try {
          const snapshot = deserializeGameState(raw);
          if (snapshot.seed !== this.gameState!.seed) {
            console.warn('Imported state seed differs from current world layout.');
          }
          this.gameState = restoreGameState(snapshot, this.layoutRegistry!, this.treeRegistry);
          this.roadNetwork!.restore(snapshot.roads);
          this.sceneManager!.syncRoadNetwork(this.roadNetwork!);
          this.buildingMarkers?.syncBuildings(this.gameState.buildings.values());
          this.syncPlacedBuildingTerrain({ forceMeshUpdate: true });
          this.syncForestClearance();
          this.forestVisualSync?.syncAll(this.gameState.trees);
          this.roadSelection?.refresh();
          this.syncResourceUi();
          this.syncToolbar();
          this.toastManager?.show('Game state imported.', { variant: 'success' });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Invalid game state file.';
          this.toastManager?.show(message, { variant: 'error' });
        }
      });
    });
    input.click();
  }

  private exposeDevHandles(): void {
    if (!this.gameState || !this.roadNetwork || !this.layoutRegistry) return;
    (window as typeof window & {
      __medievalGameState?: {
        getState: () => GameState;
        export: () => string;
        import: (raw: string) => void;
        registry: WorldLayoutRegistry;
        treeRegistry: TreeRegistry | null;
      };
    }).__medievalGameState = {
      getState: () => this.gameState!,
      export: () => serializeGameState(gameStateToSnapshot(this.gameState!, this.roadNetwork!.snapshot())),
      import: (raw: string) => {
        const snapshot = deserializeGameState(raw);
        this.gameState = restoreGameState(snapshot, this.layoutRegistry!, this.treeRegistry);
        this.roadNetwork!.restore(snapshot.roads);
        this.sceneManager?.syncRoadNetwork(this.roadNetwork!);
        this.buildingMarkers?.syncBuildings(this.gameState.buildings.values());
        this.syncPlacedBuildingTerrain({ forceMeshUpdate: true });
        this.forestVisualSync?.syncAll(this.gameState.trees);
        this.roadSelection?.refresh();
        this.syncResourceUi();
        this.syncToolbar();
      },
      registry: this.layoutRegistry,
      treeRegistry: this.treeRegistry,
    };
  }

  private mustElement(selector: string): HTMLElement {
    const element = this.root.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`Missing app element ${selector}`);
    return element;
  }
}
