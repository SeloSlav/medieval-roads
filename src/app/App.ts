import { AmbientAudioController } from '../audio/AmbientAudioController.ts';
import { CameraController } from '../camera/CameraController.ts';
import { FirstPersonController } from '../camera/FirstPersonController.ts';
import { BuildingMarkers } from '../buildings/BuildingMarkers.ts';
import { BuildingTool } from '../buildings/BuildingTool.ts';
import { FarmFieldMarkers } from '../farming/FarmFieldMarkers.ts';
import { FarmFieldTool } from '../farming/FarmFieldTool.ts';
import { PastureMarkers } from '../farming/PastureMarkers.ts';
import { LivestockVisuals } from '../farming/LivestockVisuals.ts';
import { BurgageTool } from '../residences/BurgageTool.ts';
import { ResidenceMarkers } from '../residences/ResidenceMarkers.ts';
import { BackyardGardenMarkers } from '../residences/BackyardGardenMarkers.ts';
import { BurgageFencing } from '../residences/BurgageFencing.ts';
import { SpacetimeGameStore } from '../data/spacetimeGameStore.ts';
import { InputManager } from '../input/InputManager.ts';
import type { SpacetimeGameSnapshot } from '../data/spacetimeGameStore.ts';
import type { GameState } from '../resources/types.ts';
import { ForestVisualSync } from '../resources/ForestVisualSync.ts';
import { ResourceInspector } from '../resources/ResourceInspector.ts';
import { computePopulationStats, computeResourceTotals } from '../resources/resourceTotals.ts';
import { TreeRegistry } from '../resources/TreeRegistry.ts';
import { WorldLayoutRegistry } from '../resources/WorldLayoutRegistry.ts';
import { RoadNetwork } from '../roads/RoadNetwork.ts';
import { RoadSelection } from '../roads/RoadSelection.ts';
import { RoadTool } from '../roads/RoadTool.ts';
import { GameRuntime } from '../runtime/GameRuntime.ts';
import { SceneManager } from '../scene/SceneManager.ts';
import type { WorldMapUiBundle } from './worldMapIcons.ts';
import { buildBuildingWorldMapMarkers } from '../map/worldMapMarkers.ts';
import { DeliveryAgentRenderer } from '../logistics/DeliveryAgentRenderer.ts';
import { VillagerRenderer } from '../settlement/VillagerRenderer.ts';
import { BuildToolbar, type ToolbarStats } from '../ui/BuildToolbar.ts';
import { ToastManager } from '../ui/ToastManager.ts';
import { SettlementPresentationController } from './settlementSchedulePresentation.ts';
import { SpacetimeSnapshotApplier, type SpacetimeSnapshotApplierDeps } from './spacetimeSnapshotApplier.ts';
import { bootstrapAppSession, type BootstrappedSession, type SessionLiveContext } from './appBootstrap.ts';
import { WorldGenerationMismatchError } from '../world/worldConfigAuthority.ts';
import { SessionConnectionGate } from '../network/SessionConnectionGate.ts';
import { SessionConnectionOverlay } from '../ui/SessionConnectionOverlay.ts';
import {
  disposeSettlementWorld,
  syncSettlementWorld,
  tickSettlementWorld,
} from './settlementWorldSync.ts';
import { buildCrowdViewState } from '../settlement/crowdView.ts';
import { syncPlacedBuildingTerrain } from './placedBuildingTerrainSync.ts';
import { SessionLifecycleController } from './SessionLifecycleController.ts';
import { beginNewWorld } from './worldBootstrapFlow.ts';
import { clearAuthoritativeWorldGeneration } from '../world/worldGenerationContext.ts';
import { createSmokeTestHooks, installSmokeTestHooks } from '../e2e/smokeTestHooks.ts';
import { sampleNaturalTerrainHeight } from '../terrain/TerrainHeight.ts';
import { resolveWorldDimensions } from '../world/worldGenerationSettings.ts';

export class App {
  private readonly root: HTMLElement;
  private liveContext: SessionLiveContext | null = null;
  private sceneManager: SceneManager | null = null;
  private cameraController: CameraController | null = null;
  private firstPersonController: FirstPersonController | null = null;
  private input: InputManager | null = null;
  private roadNetwork: RoadNetwork | null = null;
  private roadTool: RoadTool | null = null;
  private roadSelection: RoadSelection | null = null;
  private buildingTool: BuildingTool | null = null;
  private burgageTool: BurgageTool | null = null;
  private farmFieldTool: FarmFieldTool | null = null;
  private buildingMarkers: BuildingMarkers | null = null;
  private residenceMarkers: ResidenceMarkers | null = null;
  private backyardGardenMarkers: BackyardGardenMarkers | null = null;
  private burgageFencing: BurgageFencing | null = null;
  private farmFieldMarkers: FarmFieldMarkers | null = null;
  private pastureMarkers: PastureMarkers | null = null;
  private livestockVisuals: LivestockVisuals | null = null;
  private toolbar: BuildToolbar | null = null;
  private toastManager: ToastManager | null = null;
  private disposeTooltips: (() => void) | null = null;
  private resourceInspector: ResourceInspector | null = null;
  private worldMapUi: WorldMapUiBundle | null = null;
  private deliveryAgents: DeliveryAgentRenderer | null = null;
  private villagers: VillagerRenderer | null = null;
  private gameState: GameState | null = null;
  private layoutRegistry: WorldLayoutRegistry | null = null;
  private treeRegistry: TreeRegistry | null = null;
  private forestVisualSync: ForestVisualSync | null = null;
  private spacetimeStore: SpacetimeGameStore | null = null;
  private sessionGate: SessionConnectionGate | null = null;
  private connectionOverlay: SessionConnectionOverlay | null = null;
  private sessionLifecycle: SessionLifecycleController | null = null;
  private gameRuntime: GameRuntime | null = null;
  private snapshotApplierDeps: SpacetimeSnapshotApplierDeps | null = null;
  private readonly spacetimeSnapshotApplier = new SpacetimeSnapshotApplier();
  private animationId = 0;
  private lastTime = 0;
  private fpsSampleStart = 0;
  private fpsFrameCount = 0;
  private fpsAccumulatedSeconds = 0;
  private ambientAudio: AmbientAudioController | null = null;
  private readonly settlementPresentation = new SettlementPresentationController();
  private showcaseViewApplied = false;
  private disposed = false;

  constructor(root: HTMLElement) {
    this.root = root;
  }

  async start(): Promise<void> {
    const session = await bootstrapAppSession(this.root, {
      syncToolbar: () => this.syncToolbar(),
    });

    if (isShowcaseMode()) {
      session.uiRoot.hidden = true;
    }

    this.liveContext = session.liveContext;
    this.sceneManager = session.sceneManager;
    this.layoutRegistry = session.layoutRegistry;
    this.gameState = session.gameState;
    this.input = session.input;
    this.roadNetwork = session.roadNetwork;
    this.cameraController = session.cameraController;
    this.firstPersonController = session.firstPersonController;
    this.roadTool = session.roadTool;
    this.roadSelection = session.roadSelection;
    this.buildingTool = session.buildingTool;
    this.burgageTool = session.burgageTool;
    this.farmFieldTool = session.farmFieldTool;
    this.buildingMarkers = session.buildingMarkers;
    this.deliveryAgents = session.deliveryAgents;
    this.villagers = session.villagers;
    this.residenceMarkers = session.residenceMarkers;
    this.backyardGardenMarkers = session.backyardGardenMarkers;
    this.burgageFencing = session.burgageFencing;
    this.farmFieldMarkers = session.farmFieldMarkers;
    this.pastureMarkers = session.pastureMarkers;
    this.livestockVisuals = session.livestockVisuals;
    this.toolbar = session.toolbar;
    this.toastManager = session.toastManager;
    this.disposeTooltips = session.disposeTooltips;
    this.resourceInspector = session.resourceInspector;
    this.worldMapUi = session.worldMapUi;
    this.ambientAudio = session.ambientAudio;
    this.spacetimeStore = session.spacetimeStore;
    this.sessionGate = session.sessionGate;

    this.connectionOverlay = new SessionConnectionOverlay(session.uiRoot);
    this.gameRuntime = new GameRuntime(
      session.spacetimeStore,
      session.layoutRegistry,
      session.sceneManager.worldLayout,
      {
        onSnapshot: (snapshot, state) => this.applySpacetimeSnapshot(snapshot, state),
        onRoadsHydrated: (roads) => {
          this.roadNetwork?.restore(roads);
          this.sceneManager?.syncRoadNetwork(this.roadNetwork!);
          this.roadSelection?.refresh();
          this.syncToolbar();
          if (this.gameState && this.villagers && this.roadNetwork) {
            this.villagers.sync({
              residences: this.gameState.residences.values(),
              buildings: this.gameState.buildings.values(),
              quarries: this.gameState.quarries.values(),
              foragingNodes: this.gameState.foragingNodes.values(),
              trees: this.gameState.trees,
              treeRegistry: this.treeRegistry,
              farmFields: this.gameState.farmFields.values(),
              pastures: this.gameState.pastures.values(),
              roadNetwork: this.roadNetwork,
            });
          }
        },
        onConnectError: (error) => {
          console.warn('SpacetimeDB unavailable — game simulation requires the server.', error);
          clearAuthoritativeWorldGeneration();
          this.sessionLifecycle?.onBootConnectionFailure();
        },
        onBootstrapFailed: (error) => {
          if (error instanceof WorldGenerationMismatchError) {
            this.sessionLifecycle?.onWorldGenerationMismatch(
              error.message,
              () => this.sessionLifecycle?.retryConnection(),
            );
            return;
          }
          this.sessionLifecycle?.onBootstrapFailed(
            error,
            () => this.sessionLifecycle?.retryConnection(),
          );
        },
        onSessionReady: () => this.sessionLifecycle?.onReady(),
      },
    );
    this.sessionLifecycle = new SessionLifecycleController({
      sessionGate: session.sessionGate,
      loadingScreen: session.loadingScreen,
      connectionOverlay: this.connectionOverlay,
      spacetimeStore: session.spacetimeStore,
      toolbar: session.toolbar,
      roadTool: session.roadTool,
      buildingTool: session.buildingTool,
      burgageTool: session.burgageTool,
      farmFieldTool: session.farmFieldTool,
      firstPersonController: session.firstPersonController,
      recoverSession: () => this.gameRuntime?.recoverSession(),
      beginNewWorld: () => {
        void beginNewWorld(
          () => this.spacetimeStore?.isConnected === true
            && this.spacetimeStore?.snapshot.identityHex !== null,
        );
      },
    });

    session.spacetimeStore.setConnectErrorListener((error) => {
      console.warn('SpacetimeDB connection error:', error);
      if (!session.spacetimeStore.isConnected) {
        clearAuthoritativeWorldGeneration();
      }
      this.sessionLifecycle?.onBootConnectionFailure();
    });

    this.snapshotApplierDeps = {
      sceneManager: this.sceneManager,
      buildingMarkers: this.buildingMarkers,
      terrainMinimap: this.worldMapUi?.minimap ?? null,
      burgageFencing: this.burgageFencing,
      forestVisualSync: this.forestVisualSync,
      settlementWorld: {
        residenceMarkers: this.residenceMarkers,
        farmFieldMarkers: this.farmFieldMarkers,
        pastureMarkers: this.pastureMarkers,
        livestockVisuals: this.livestockVisuals,
        backyardGardenMarkers: this.backyardGardenMarkers,
        deliveryAgents: this.deliveryAgents,
        villagers: this.villagers,
        getHeightAt: (x, z) => this.sceneManager?.terrain.getHeightAt(x, z) ?? 0,
        getRoadNetwork: () => this.roadNetwork,
        getTreeRegistry: () => this.treeRegistry,
      },
      onForestClearanceChanged: () => this.syncForestClearance(),
    };

    this.gameRuntime.start();

    this.exposeDevHandles();
    this.exposeE2eHandles(session);

    session.sceneManager.syncRoadNetwork(session.roadNetwork);
    this.syncToolbar();
    window.addEventListener('resize', this.onResize);
    this.onResize();
    session.cameraController.applyRtsOrbitView();
    session.cameraController.update(0);
    this.toolbar?.setZoomPercent(session.cameraController.getZoomPercent());
    this.lastTime = performance.now();
    this.fpsSampleStart = this.lastTime;
    session.loadingScreen?.setProgress({
      label: 'Connecting…',
      detail: 'Syncing world with SpacetimeDB',
      phase: 'connecting',
      fraction: 0.35,
    });
    session.sceneManager.render(0, session.cameraController.getOrbitDistance());
    window.setTimeout(() => {
      void (async () => {
        try {
          session.loadingScreen?.setProgress({
            label: 'Growing forest…',
            detail: 'Building trees and ground cover',
            phase: 'vegetation',
            fraction: 0,
          });
          await session.sceneManager.finishVegetation();
          session.loadingScreen?.setProgress({
            label: 'Growing forest…',
            detail: 'Building trees and ground cover',
            phase: 'vegetation',
            fraction: 1,
          });
          if (this.roadNetwork) session.sceneManager.syncRoadNetwork(this.roadNetwork);
          this.onForestReady();
          // Prime a frame so WebGPU tree materials compile before the overlay clears.
          session.sceneManager.render(0, session.cameraController.getOrbitDistance());
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          this.sessionLifecycle?.onPresentationReady();
        } catch (error) {
          console.error('Vegetation build failed:', error);
          this.toastManager?.show('Forest vegetation failed to load. Try refreshing the page.', { variant: 'error' });
          this.sessionLifecycle?.onPresentationReady();
        }
      })();
    }, 0);
    this.animationId = requestAnimationFrame(this.tick);
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
    this.farmFieldTool?.dispose();
    this.buildingMarkers?.dispose();
    disposeSettlementWorld({
      residenceMarkers: this.residenceMarkers,
      farmFieldMarkers: this.farmFieldMarkers,
      pastureMarkers: this.pastureMarkers,
      livestockVisuals: this.livestockVisuals,
      backyardGardenMarkers: this.backyardGardenMarkers,
      deliveryAgents: this.deliveryAgents,
      villagers: this.villagers,
      getHeightAt: () => 0,
      getRoadNetwork: () => null,
      getTreeRegistry: () => null,
    });
    this.burgageFencing?.dispose();
    this.gameRuntime?.dispose();
    this.sessionLifecycle?.dispose();
    this.connectionOverlay?.dispose();
    this.resourceInspector?.dispose();
    this.worldMapUi?.quarry.dispose();
    this.worldMapUi?.foraging.dispose();
    this.worldMapUi?.minimap.dispose();
    this.toastManager?.dispose();
    this.disposeTooltips?.();
    this.disposeTooltips = null;
    this.firstPersonController?.dispose();
    this.cameraController?.dispose();
    this.toolbar?.dispose();
    this.input?.dispose();
    this.ambientAudio?.dispose();
    this.sceneManager?.dispose();
  }

  private readonly tick = (time: number): void => {
    if (this.disposed) return;
    const rawDt = (time - this.lastTime) / 1000;
    if (rawDt > 0.25) this.resetFpsSample(time);
    const dt = Math.min(0.05, Math.max(0.001, rawDt));
    this.lastTime = time;

    const firstPersonActive = this.firstPersonController?.isActive() ?? false;
    this.syncBuildInteractionPerf();
    this.settlementPresentation.tick({
      settlementHud: this.toolbar?.settlementHud ?? null,
      sceneManager: this.sceneManager,
      residenceMarkers: this.residenceMarkers,
      ambientAudio: this.ambientAudio,
    });
    this.worldMapUi?.minimap.tick({ keyHeld: this.input?.isDown('g') ?? false });
    if (firstPersonActive) {
      this.firstPersonController?.update(dt);
      this.toolbar?.setFirstPersonMode(true);
      this.roadTool?.update(dt);
      this.buildingTool?.update();
      this.burgageTool?.update();
      this.farmFieldTool?.update();
      this.updateBuildButtonPosition();
      this.worldMapUi?.quarry.update();
      this.worldMapUi?.foraging.update();
      this.sceneManager?.render(
        dt,
        12,
        true,
        this.firstPersonController?.isCrouching() ?? false,
      );
    } else {
      this.cameraController?.update(dt);
      this.toolbar?.setFirstPersonMode(false);
      this.toolbar?.setZoomPercent(this.cameraController?.getZoomPercent() ?? 100);
      this.roadTool?.update(dt);
      this.buildingTool?.update();
      this.burgageTool?.update();
      this.farmFieldTool?.update();
      this.updateBuildButtonPosition();
      this.worldMapUi?.quarry.update();
      this.worldMapUi?.foraging.update();
      this.sceneManager?.render(dt, this.cameraController?.getOrbitDistance());
    }
    this.updateFps(time, dt);
    const crowdView = this.buildCrowdViewState();
    tickSettlementWorld(
      {
        residenceMarkers: this.residenceMarkers,
        backyardGardenMarkers: this.backyardGardenMarkers,
        livestockVisuals: this.livestockVisuals,
        deliveryAgents: this.deliveryAgents,
        villagers: this.villagers,
      },
      dt,
      crowdView,
      this.gameState ?? undefined,
    );
    this.ambientAudio?.tick(dt);
    this.animationId = requestAnimationFrame(this.tick);
  };

  private onForestReady(): void {
    const forestManager = this.sceneManager?.getForestManager();
    if (!forestManager || !this.gameState || !this.liveContext) return;

    this.treeRegistry = TreeRegistry.fromForestManager(forestManager);
    this.liveContext.treeRegistry = this.treeRegistry;
    this.forestVisualSync = new ForestVisualSync(forestManager);
    this.forestVisualSync.syncAll(this.gameState.trees);
    if (this.snapshotApplierDeps) {
      this.snapshotApplierDeps.forestVisualSync = this.forestVisualSync;
    }
    this.buildingMarkers?.syncBuildings(this.gameState.buildings.values());
    this.worldMapUi?.minimap.syncBuildings(
      buildBuildingWorldMapMarkers(this.gameState.buildings.values()),
    );
    syncPlacedBuildingTerrain({
      sceneManager: this.sceneManager,
      gameState: this.gameState,
      buildingMarkers: this.buildingMarkers,
      forceMeshUpdate: true,
    });
    if (this.snapshotApplierDeps) {
      syncSettlementWorld(this.snapshotApplierDeps.settlementWorld, this.gameState);
    }
    this.burgageFencing?.syncZones(
      this.gameState.burgageZones.values(),
      this.gameState.residences.values(),
      (x, z) => this.sceneManager?.terrain.getHeightAt(x, z) ?? 0,
    );
    this.syncForestClearance();
    this.syncResourceUi();
    this.exposeDevHandles();
  }

  private readonly onResize = (): void => {
    this.sceneManager?.resize();
  };

  private syncToolbar(): void {
    if (!this.toolbar || !this.roadNetwork || !this.roadTool || !this.roadSelection || !this.buildingTool || !this.burgageTool || !this.farmFieldTool) return;
    const buildingMode = this.buildingTool.getMode();
    const burgageEnabled = this.burgageTool.isEnabled();
    const farmFieldEnabled = this.farmFieldTool.isEnabled();
    const stats: ToolbarStats = {
      canBuild: farmFieldEnabled ? this.farmFieldTool.isDraftBuildable() : burgageEnabled ? this.burgageTool.isDraftBuildable() : this.roadTool.isDraftBuildable(),
      hasDraft: farmFieldEnabled ? this.farmFieldTool.hasDraft() : burgageEnabled ? this.burgageTool.hasDraft() : this.roadTool.hasDraft(),
      mode: farmFieldEnabled
        ? this.farmFieldTool.getMode() === 'pasture' ? 'pastures' : 'farm-fields'
        : burgageEnabled
        ? 'residences'
        : this.roadTool.isEnabled()
          ? 'road'
          : buildingMode === 'off'
            ? 'idle'
            : buildingMode,
      statusDetail: farmFieldEnabled ? this.farmFieldTool.getStatusDetail() : burgageEnabled ? this.burgageTool.getStatusDetail() : null,
    };
    this.toolbar.setStats(stats);
    this.updateBuildButtonPosition();
  }

  private syncBuildInteractionPerf(): void {
    const roadDraft = Boolean(this.roadTool?.isEnabled() && this.roadTool.hasDraft());
    const burgageDraft = Boolean(this.burgageTool?.isEnabled() && this.burgageTool.hasDraft());
    const farmFieldDraft = Boolean(this.farmFieldTool?.isEnabled() && this.farmFieldTool.hasDraft());
    const buildingActive = Boolean(this.buildingTool?.isEnabled());
    this.sceneManager?.setBuildInteractionActive(roadDraft || burgageDraft || farmFieldDraft || buildingActive);
    this.sceneManager?.setRoadDraftActive(roadDraft);
  }

  private updateBuildButtonPosition(): void {
    const roadTool = this.roadTool;
    const burgageTool = this.burgageTool;
    const farmFieldTool = this.farmFieldTool;
    if (!this.toolbar || !roadTool || !burgageTool || !farmFieldTool) return;
    const farmFieldEnabled = farmFieldTool.isEnabled();
    const burgageEnabled = burgageTool.isEnabled();
    const layoutHudState = burgageEnabled ? burgageTool.getLayoutHudState() : null;
    const layoutHudPosition = layoutHudState ? burgageTool.getLayoutHudPosition() : null;
    this.toolbar.setBurgageLayoutHud(layoutHudPosition, layoutHudState);

    const visible = farmFieldEnabled
      ? farmFieldTool.isDraftBuildable()
      : burgageEnabled
      ? burgageTool.isDraftBuildable()
      : roadTool.isDraftBuildable();
    if (!visible) {
      this.toolbar.setBuildButtonPosition(null, false);
      return;
    }
    const position = farmFieldEnabled
      ? farmFieldTool.getBuildButtonPosition()
      : burgageEnabled
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
    if (!snapshot.connected) {
      clearAuthoritativeWorldGeneration();
      this.spacetimeSnapshotApplier.reset();
      this.settlementPresentation.reset();
      this.syncToolbar();
      return;
    }

    const previous = this.gameState;
    this.gameState = state;
    if (this.liveContext) {
      this.liveContext.gameState = state;
    }

    if (!this.snapshotApplierDeps) return;

    this.spacetimeSnapshotApplier.apply(
      this.snapshotApplierDeps,
      state,
      previous,
    );

    this.applyShowcaseView(state);

    if (resourceUiNeedsSync(state, previous)) {
      this.syncResourceUi();
    }
    this.syncToolbar();
    this.settlementPresentation.sync(
      {
        settlementHud: this.toolbar?.settlementHud ?? null,
        sceneManager: this.sceneManager,
        residenceMarkers: this.residenceMarkers,
        ambientAudio: this.ambientAudio,
      },
      snapshot,
      state,
      this.spacetimeStore?.isConnected ?? false,
    );
  }

  private syncForestClearance(): void {
    if (!this.gameState || !this.snapshotApplierDeps) return;
    this.spacetimeSnapshotApplier.syncForestClearance(this.snapshotApplierDeps, this.gameState);
  }

  private applyShowcaseView(state: GameState): void {
    if (!isShowcaseMode() || this.showcaseViewApplied || !this.cameraController) return;

    const points = [...state.residences.values()].map((residence) => ({
      x: residence.x,
      z: residence.z,
    }));
    if (points.length < 4) return;

    const center = points.reduce(
      (sum, point) => ({ x: sum.x + point.x, z: sum.z + point.z }),
      { x: 0, z: 0 },
    );
    center.x /= points.length;
    center.z /= points.length;

    const chapel = [...state.buildings.values()].find((building) => building.kind === 'chapel');
    if (chapel) {
      center.x = center.x * 0.72 + chapel.x * 0.28;
      center.z = center.z * 0.72 + chapel.z * 0.28;
    }

    this.cameraController.applyShowcaseView(center.x, center.z);
    this.showcaseViewApplied = true;
  }

  private syncResourceUi(): void {
    if (!this.gameState || !this.resourceInspector) return;
    this.resourceInspector.setHud(
      computeResourceTotals(this.gameState),
      computePopulationStats(this.gameState),
    );
    this.resourceInspector.refreshSelection();
  }

  private exposeDevHandles(): void {
    if (!this.gameState || !this.layoutRegistry) return;
    (window as typeof window & {
      __medievalGameState?: {
        getState: () => GameState;
        registry: WorldLayoutRegistry;
        treeRegistry: TreeRegistry | null;
      };
    }).__medievalGameState = {
      getState: () => this.gameState!,
      registry: this.layoutRegistry,
      treeRegistry: this.treeRegistry,
    };
  }

  private exposeE2eHandles(session: BootstrappedSession): void {
    if (import.meta.env.VITE_E2E_TEST !== '1') return;
    if (!this.gameState || !this.spacetimeStore || !this.buildingTool || !this.sceneManager) return;

    const worldSettings = session.sceneManager.worldLayout.settings;
    const playableHalf = resolveWorldDimensions(worldSettings.mapSize).playableHalf;

    installSmokeTestHooks(createSmokeTestHooks({
      getState: () => this.gameState!,
      getBuildingMode: () => this.buildingTool!.getMode(),
      isConnected: () => this.sessionGate?.isReady() ?? false,
      placeBuilding: async (kind, x, z) => {
        await this.spacetimeStore!.placeBuilding(kind, x, z);
      },
      isWaterAt: (x, z) => this.sceneManager!.riverField.isRenderedWetAt(x, z),
      isQuarryPitAt: (x, z) => this.sceneManager!.worldLayout.quarryLayout.isBlockedForProps(x, z),
      getNaturalHeightAt: sampleNaturalTerrainHeight,
      getRoadNetwork: () => this.roadNetwork,
      playableHalf,
    }));
  }

  private buildCrowdViewState() {
    if (this.firstPersonController?.isActive()) {
      const pos = this.firstPersonController.getPosition();
      return buildCrowdViewState(pos.x, pos.z, 48);
    }
    const target = this.cameraController?.getTargetPosition();
    const orbit = this.cameraController?.getOrbitDistance() ?? 240;
    if (!target) return buildCrowdViewState(0, 0, orbit);
    return buildCrowdViewState(target.x, target.z, orbit);
  }
}

function isShowcaseMode(): boolean {
  return new URLSearchParams(window.location.search).get('showcase') === '1';
}

function resourceUiNeedsSync(current: GameState, previous: GameState | null): boolean {
  return !previous
    || current.stockpile !== previous.stockpile
    || current.quarries !== previous.quarries
    || current.foragingNodes !== previous.foragingNodes
    || current.trees !== previous.trees
    || current.buildings !== previous.buildings
    || current.farmFields !== previous.farmFields
    || current.pastures !== previous.pastures
    || current.livestockHerds !== previous.livestockHerds
    || current.burgageZones !== previous.burgageZones
    || current.residences !== previous.residences
    || current.backyardGardens !== previous.backyardGardens
    || current.deliveryTrips !== previous.deliveryTrips;
}
