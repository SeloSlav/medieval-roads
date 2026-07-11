import { AmbientAudioController } from '../audio/AmbientAudioController.ts';
import { CameraController } from '../camera/CameraController.ts';
import { FirstPersonController } from '../camera/FirstPersonController.ts';
import { BuildingMarkers } from '../buildings/BuildingMarkers.ts';
import { BuildingTool } from '../buildings/BuildingTool.ts';
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
import type { WorldMapIconsBundle } from './worldMapIcons.ts';
import { DeliveryAgentRenderer } from '../logistics/DeliveryAgentRenderer.ts';
import { BuildToolbar, type ToolbarStats } from '../ui/BuildToolbar.ts';
import { CityAdministrationPanel } from '../ui/CityAdministrationPanel.ts';
import { ToastManager } from '../ui/ToastManager.ts';
import { SettlementPresentationController } from './settlementSchedulePresentation.ts';
import { SpacetimeSnapshotApplier, type SpacetimeSnapshotApplierDeps } from './spacetimeSnapshotApplier.ts';
import { bootstrapAppSession, type BootstrappedSession, type SessionLiveContext } from './appBootstrap.ts';
import { WorldGenerationMismatchError } from '../world/worldConfigAuthority.ts';
import {
  disposeSettlementWorld,
  syncSettlementWorld,
  tickSettlementWorld,
} from './settlementWorldSync.ts';
import { syncPlacedBuildingTerrain } from './placedBuildingTerrainSync.ts';
import { clearAuthoritativeWorldGeneration } from '../world/worldGenerationContext.ts';
import { createSmokeTestHooks, installSmokeTestHooks } from '../e2e/smokeTestHooks.ts';
import { sampleNaturalTerrainHeight } from '../terrain/TerrainHeight.ts';
import { resolveWorldDimensions } from '../world/worldGenerationSettings.ts';

const TARGET_MAX_FPS = 90;
const TARGET_FRAME_MS = 1000 / TARGET_MAX_FPS;

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
  private buildingMarkers: BuildingMarkers | null = null;
  private residenceMarkers: ResidenceMarkers | null = null;
  private backyardGardenMarkers: BackyardGardenMarkers | null = null;
  private burgageFencing: BurgageFencing | null = null;
  private toolbar: BuildToolbar | null = null;
  private cityAdminPanel: CityAdministrationPanel | null = null;
  private toastManager: ToastManager | null = null;
  private disposeTooltips: (() => void) | null = null;
  private resourceInspector: ResourceInspector | null = null;
  private worldMapIcons: WorldMapIconsBundle | null = null;
  private deliveryAgents: DeliveryAgentRenderer | null = null;
  private gameState: GameState | null = null;
  private layoutRegistry: WorldLayoutRegistry | null = null;
  private treeRegistry: TreeRegistry | null = null;
  private forestVisualSync: ForestVisualSync | null = null;
  private spacetimeStore: SpacetimeGameStore | null = null;
  private gameRuntime: GameRuntime | null = null;
  private snapshotApplierDeps: SpacetimeSnapshotApplierDeps | null = null;
  private readonly spacetimeSnapshotApplier = new SpacetimeSnapshotApplier();
  private animationId = 0;
  private lastTime = 0;
  private frameBudgetTime = 0;
  private fpsSampleStart = 0;
  private fpsFrameCount = 0;
  private fpsAccumulatedSeconds = 0;
  private ambientAudio: AmbientAudioController | null = null;
  private readonly settlementPresentation = new SettlementPresentationController();
  private disposed = false;

  constructor(root: HTMLElement) {
    this.root = root;
  }

  async start(): Promise<void> {
    const session = await bootstrapAppSession(this.root, {
      syncToolbar: () => this.syncToolbar(),
      getCityAdminPanel: () => this.cityAdminPanel,
      setCityAdminPanel: (panel) => {
        this.cityAdminPanel = panel;
      },
    });

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
    this.buildingMarkers = session.buildingMarkers;
    this.deliveryAgents = session.deliveryAgents;
    this.residenceMarkers = session.residenceMarkers;
    this.backyardGardenMarkers = session.backyardGardenMarkers;
    this.burgageFencing = session.burgageFencing;
    this.toolbar = session.toolbar;
    this.toastManager = session.toastManager;
    this.disposeTooltips = session.disposeTooltips;
    this.resourceInspector = session.resourceInspector;
    this.worldMapIcons = session.worldMapIcons;
    this.ambientAudio = session.ambientAudio;
    this.spacetimeStore = session.spacetimeStore;

    this.snapshotApplierDeps = {
      sceneManager: this.sceneManager,
      buildingMarkers: this.buildingMarkers,
      burgageFencing: this.burgageFencing,
      forestVisualSync: this.forestVisualSync,
      settlementWorld: {
        residenceMarkers: this.residenceMarkers,
        backyardGardenMarkers: this.backyardGardenMarkers,
        deliveryAgents: this.deliveryAgents,
        getHeightAt: (x, z) => this.sceneManager?.terrain.getHeightAt(x, z) ?? 0,
      },
      onForestClearanceChanged: () => this.syncForestClearance(),
    };

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
        },
        onConnectError: (error) => {
          console.warn('SpacetimeDB unavailable — game simulation requires the server.', error);
          clearAuthoritativeWorldGeneration();
          this.toastManager?.show('SpacetimeDB is offline. Run `spacetime start` and refresh.', { variant: 'error' });
        },
        onBootstrapFailed: (error) => {
          const message = error instanceof WorldGenerationMismatchError
            ? error.message
            : error instanceof Error
              ? error.message
              : 'World bootstrap failed.';
          this.toastManager?.show(message, { variant: 'error', durationMs: 8000 });
        },
      },
    );
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
    this.frameBudgetTime = this.lastTime;
    this.fpsSampleStart = this.lastTime;
    session.loadingScreen?.setProgress({ label: 'Almost ready…', detail: 'Rendering first frame' });
    session.sceneManager.render(0, session.cameraController.getOrbitDistance());
    session.loadingScreen?.dismiss();
    window.setTimeout(() => {
      void (async () => {
        try {
          await session.sceneManager.finishVegetation();
          if (this.roadNetwork) session.sceneManager.syncRoadNetwork(this.roadNetwork);
          this.onForestReady();
        } catch (error) {
          console.error('Vegetation build failed:', error);
          this.toastManager?.show('Forest vegetation failed to load. Try refreshing the page.', { variant: 'error' });
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
    this.buildingMarkers?.dispose();
    disposeSettlementWorld({
      residenceMarkers: this.residenceMarkers,
      backyardGardenMarkers: this.backyardGardenMarkers,
      deliveryAgents: this.deliveryAgents,
      getHeightAt: () => 0,
    });
    this.burgageFencing?.dispose();
    this.gameRuntime?.dispose();
    this.resourceInspector?.dispose();
    this.worldMapIcons?.quarry.dispose();
    this.worldMapIcons?.foraging.dispose();
    this.toastManager?.dispose();
    this.disposeTooltips?.();
    this.disposeTooltips = null;
    this.firstPersonController?.dispose();
    this.cameraController?.dispose();
    this.toolbar?.dispose();
    this.cityAdminPanel?.dispose();
    this.input?.dispose();
    this.ambientAudio?.dispose();
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
    this.settlementPresentation.tick({
      settlementHud: this.toolbar?.settlementHud ?? null,
      sceneManager: this.sceneManager,
      residenceMarkers: this.residenceMarkers,
    });
    if (firstPersonActive) {
      this.firstPersonController?.update(dt);
      this.toolbar?.setFirstPersonMode(true);
      this.roadTool?.update(dt);
      this.buildingTool?.update();
      this.burgageTool?.update();
      this.updateBuildButtonPosition();
      this.worldMapIcons?.quarry.update();
      this.worldMapIcons?.foraging.update();
      this.sceneManager?.render(dt, 12, true);
    } else {
      this.cameraController?.update(dt);
      this.toolbar?.setFirstPersonMode(false);
      this.toolbar?.setZoomPercent(this.cameraController?.getZoomPercent() ?? 100);
      this.roadTool?.update(dt);
      this.buildingTool?.update();
      this.burgageTool?.update();
      this.updateBuildButtonPosition();
      this.worldMapIcons?.quarry.update();
      this.worldMapIcons?.foraging.update();
      this.sceneManager?.render(dt, this.cameraController?.getOrbitDistance());
    }
    this.updateFps(time, dt);
    tickSettlementWorld(
      { residenceMarkers: this.residenceMarkers, deliveryAgents: this.deliveryAgents },
      dt,
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
    if (this.snapshotApplierDeps) {
      this.snapshotApplierDeps.forestVisualSync = this.forestVisualSync;
    }
    this.buildingMarkers?.syncBuildings(this.gameState.buildings.values());
    if (this.snapshotApplierDeps) {
      syncSettlementWorld(this.snapshotApplierDeps.settlementWorld, this.gameState);
    }
    this.burgageFencing?.syncZones(
      this.gameState.burgageZones.values(),
      this.gameState.residences.values(),
      (x, z) => this.sceneManager?.terrain.getHeightAt(x, z) ?? 0,
    );
    syncPlacedBuildingTerrain({
      sceneManager: this.sceneManager,
      gameState: this.gameState,
      buildingMarkers: this.buildingMarkers,
      forceMeshUpdate: true,
    });
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

    this.syncResourceUi();
    this.syncToolbar();
    this.settlementPresentation.sync(
      {
        settlementHud: this.toolbar?.settlementHud ?? null,
        sceneManager: this.sceneManager,
        residenceMarkers: this.residenceMarkers,
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

  private syncResourceUi(): void {
    if (!this.gameState || !this.resourceInspector) return;
    this.resourceInspector.setHud(
      computeResourceTotals(this.gameState),
      computePopulationStats(this.gameState),
    );
    this.resourceInspector.refreshSelection();
    this.cityAdminPanel?.refresh();
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
      isConnected: () => this.spacetimeStore!.isConnected,
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
}
