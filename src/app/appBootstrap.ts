import { AmbientAudioController } from '../audio/AmbientAudioController.ts';
import { CameraController } from '../camera/CameraController.ts';
import { FirstPersonController } from '../camera/FirstPersonController.ts';
import { BuildingMarkers } from '../buildings/BuildingMarkers.ts';
import { BuildingTool } from '../buildings/BuildingTool.ts';
import { FarmFieldMarkers } from '../farming/FarmFieldMarkers.ts';
import { FarmFieldTool, type FarmFieldPlacementFailureReason } from '../farming/FarmFieldTool.ts';
import { BurgageTool } from '../residences/BurgageTool.ts';
import { MAX_ZONE_DEPTH, MIN_ZONE_DEPTH } from '../residences/burgageLayout.ts';
import { ResidenceMarkers } from '../residences/ResidenceMarkers.ts';
import { BackyardGardenMarkers } from '../residences/BackyardGardenMarkers.ts';
import { BurgageFencing } from '../residences/BurgageFencing.ts';
import { SpacetimeGameStore } from '../data/spacetimeGameStore.ts';
import { InputManager } from '../input/InputManager.ts';
import {
  isBurgagePlacementBlocked,
  isBuildingPlacementBlocked,
  isFarmFieldPlacementBlocked,
  isRoadPlacementBlocked,
  isWorldInspectionBlocked,
  type PlacementInteractionGate,
} from '../input/PlacementInteractionGate.ts';
import { SessionConnectionGate } from '../network/SessionConnectionGate.ts';
import { createInitialGameState } from '../resources/GameState.ts';
import type { GameState } from '../resources/types.ts';
import { countTreesNearBuilding } from '../resources/ForestVisualSync.ts';
import { ResourceInspector } from '../resources/ResourceInspector.ts';
import { computePopulationStats, computeResourceTotals } from '../resources/resourceTotals.ts';
import { WorldLayoutRegistry } from '../resources/WorldLayoutRegistry.ts';
import type { TreeRegistry } from '../resources/TreeRegistry.ts';
import { WorldQueries } from '../resources/WorldQueries.ts';
import { getBuildingWorkExtentHighlight } from '../resources/inspector/buildingProcessorStatus.ts';
import { RoadMaterialFactory } from '../roads/RoadMaterialFactory.ts';
import { RoadNetwork } from '../roads/RoadNetwork.ts';
import { RoadSelection } from '../roads/RoadSelection.ts';
import { RoadTool } from '../roads/RoadTool.ts';
import { SceneManager } from '../scene/SceneManager.ts';
import { createInspectorSpacetimeActions } from './inspectorSpacetimeActions.ts';
import { createWorldMapUi, resolveWorldMapFocus, type WorldMapUiBundle } from './worldMapIcons.ts';
import { buildBuildingWorldMapMarkers } from '../map/worldMapMarkers.ts';
import { DeliveryAgentRenderer } from '../logistics/DeliveryAgentRenderer.ts';
import { VillagerRenderer } from '../settlement/VillagerRenderer.ts';
import { beginStartupTextureLoad } from '../scene/startupTextures.ts';
import { sampleNaturalTerrainHeight } from '../terrain/TerrainHeight.ts';
import { BuildToolbar } from '../ui/BuildToolbar.ts';
import type { BuildingKind } from '../generated/gameBalance.ts';
import { CityAdministrationPanel } from '../ui/CityAdministrationPanel.ts';
import { ECONOMIC_ACTIVITY_TAX_RATE_DEFAULT } from '../economy/villageEconomy.ts';
import { DEFAULT_PARISH_POLICY } from '../economy/chapelParish.ts';
import { DEFAULT_MONASTERY_POLICY } from '../economy/monasteryPolicy.ts';
import { beginNewWorld, resolveWorldGenerationSettings } from './worldBootstrapFlow.ts';
import {
  syncBuildingTerrainLayout,
  syncPreviewTerrainPads,
} from './placedBuildingTerrainSync.ts';
import { LoadingScreen } from '../ui/LoadingScreen.ts';
import { ToastManager } from '../ui/ToastManager.ts';
import { saveWorldGenerationSettings, shouldShowWorldSetup } from '../world/worldGenerationSettings.ts';
import { getDraftWorldGeneration, setDraftWorldGeneration } from '../world/worldGenerationContext.ts';
import { mountTooltips } from '../ui/tooltips.ts';
import { setHydrologyOverlayEnabled, isHydrologyOverlayEnabled } from '../scene/hydrologyOverlayPreference.ts';
import {
  roadPlacementReasonToToastId,
  buildingPlacementReasonToToastId,
  burgagePlacementReasonToToastId,
} from '../ui/toastMessages.ts';

export type AppBootstrapBridge = {
  syncToolbar: () => void;
  getCityAdminPanel: () => CityAdministrationPanel | null;
  setCityAdminPanel: (panel: CityAdministrationPanel) => void;
};

export type SessionLiveContext = {
  gameState: GameState;
  treeRegistry: TreeRegistry | null;
};

export type BootstrappedSession = {
  loadingScreen: ReturnType<typeof LoadingScreen.tryCreate>;
  liveContext: SessionLiveContext;
  sceneManager: SceneManager;
  layoutRegistry: WorldLayoutRegistry;
  gameState: GameState;
  input: InputManager;
  roadNetwork: RoadNetwork;
  cameraController: CameraController;
  firstPersonController: FirstPersonController;
  roadTool: RoadTool;
  roadSelection: RoadSelection;
  buildingTool: BuildingTool;
  burgageTool: BurgageTool;
  farmFieldTool: FarmFieldTool;
  buildingMarkers: BuildingMarkers;
  deliveryAgents: DeliveryAgentRenderer;
  villagers: VillagerRenderer;
  residenceMarkers: ResidenceMarkers;
  backyardGardenMarkers: BackyardGardenMarkers;
  burgageFencing: BurgageFencing;
  farmFieldMarkers: FarmFieldMarkers;
  toolbar: BuildToolbar;
  toastManager: ToastManager;
  disposeTooltips: () => void;
  resourceInspector: ResourceInspector;
  worldMapUi: WorldMapUiBundle;
  ambientAudio: AmbientAudioController;
  spacetimeStore: SpacetimeGameStore;
  sessionGate: SessionConnectionGate;
  placementGate: PlacementInteractionGate;
  uiRoot: HTMLElement;
};

function mustElement(root: HTMLElement, selector: string): HTMLElement {
  const element = root.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`Missing app element ${selector}`);
  return element;
}

export async function bootstrapAppSession(
  root: HTMLElement,
  bridge: AppBootstrapBridge,
): Promise<BootstrappedSession> {
  const loadingScreen = LoadingScreen.tryCreate();
  const materialsPromise = RoadMaterialFactory.create(8);
  const startupTexturesPromise = beginStartupTextureLoad();

  root.innerHTML = `
      <div class="app-shell">
        <div class="scene-root" data-scene-root></div>
        <div data-ui-root></div>
      </div>
    `;

  if (shouldShowWorldSetup()) {
    loadingScreen?.setProgress({
      label: 'New settlement',
      detail: 'Choose map size, landscape, and seed',
      phase: 'worldSetup',
      fraction: 0,
    });
  }
  const worldSettings = await resolveWorldGenerationSettings(root, (progress) => {
    loadingScreen?.setProgress({
      ...progress,
      phase: 'worldSetup',
      fraction: progress.label === 'Checking world…' ? 0.35 : 0.7,
    });
  });
  setDraftWorldGeneration(worldSettings);
  saveWorldGenerationSettings(worldSettings);

  loadingScreen?.setProgress({
    label: 'Starting world…',
    detail: 'Setting up scene shell',
    phase: 'worldSetup',
    fraction: 1,
  });
  loadingScreen?.setProgress({
    label: 'Starting world…',
    detail: 'Setting up scene shell',
    phase: 'sceneShell',
    fraction: 0,
  });

  const sceneRoot = mustElement(root, '[data-scene-root]');
  const uiRoot = mustElement(root, '[data-ui-root]');

  const sceneManager = await SceneManager.create(sceneRoot, worldSettings, (progress) => {
    loadingScreen?.setProgress(progress);
  }, materialsPromise, startupTexturesPromise);
  const layoutRegistry = WorldLayoutRegistry.fromWorldLayout(sceneManager.worldLayout);
  const gameState = createInitialGameState(layoutRegistry, getDraftWorldGeneration().seed);
  const liveContext: SessionLiveContext = { gameState, treeRegistry: null };
  const input = new InputManager(sceneManager.renderer.domElement);
  const spacetimeStore = new SpacetimeGameStore();
  const sessionGate = new SessionConnectionGate();
  const roadNetwork = new RoadNetwork();

  const requireSessionReady = (): void => {
    if (!sessionGate.isReady()) {
      throw new Error('SpacetimeDB is not connected. Start the local server and refresh.');
    }
  };

  let cameraController: CameraController;
  let firstPersonController: FirstPersonController;
  let roadTool: RoadTool;
  let buildingTool: BuildingTool;
  let burgageTool: BurgageTool;
  let farmFieldTool: FarmFieldTool;
  let toolbar: BuildToolbar;
  let toastManager: ToastManager;

  const ambientAudio = new AmbientAudioController({
    unlockElement: sceneManager.renderer.domElement,
    getCameraTarget: () => {
      const target = sceneManager.cameraTarget;
      return { x: target.x, z: target.z };
    },
    getOrbitDistance: () => {
      if (firstPersonController?.isActive()) return 12;
      return cameraController?.getOrbitDistance() ?? 240;
    },
    getBuildings: () => liveContext.gameState.buildings.values(),
    getBurgageZones: () => liveContext.gameState.burgageZones.values(),
  });

  const worldQueries = new WorldQueries({
    terrain: sceneManager.terrain,
    riverField: sceneManager.riverField,
    registry: layoutRegistry,
    getGameState: () => liveContext.gameState,
    getRoadNetwork: () => roadNetwork,
    getTreeRegistry: () => liveContext.treeRegistry,
  });
  const buildingMarkers = new BuildingMarkers({
    terrain: sceneManager.terrain,
    parent: sceneManager.selectionGroup,
    getRoadNetwork: () => roadNetwork,
  });
  const deliveryAgents = new DeliveryAgentRenderer({
    terrain: sceneManager.terrain,
    parent: sceneManager.selectionGroup,
  });
  const villagers = new VillagerRenderer({
    parent: sceneManager.selectionGroup,
    getHeightAt: (x, z) => sceneManager.terrain.getHeightAt(x, z),
    getRoadDeckY: (x, z) => sceneManager.sampleRoadDeckY(x, z),
  });
  const placementGate: PlacementInteractionGate = {
    isSessionReady: () => sessionGate.isReady(),
    isRoadToolEnabled: () => false,
    isBuildingToolEnabled: () => false,
    isBurgageToolEnabled: () => false,
    isFarmFieldToolEnabled: () => false,
    isFirstPersonActive: () => false,
    isMenuOpen: () => false,
  };

  cameraController = new CameraController({
    camera: sceneManager.camera,
    target: sceneManager.cameraTarget,
    domElement: sceneManager.renderer.domElement,
    bounds: sceneManager.terrain.bounds,
    getHeightAt: (x, z) => sceneManager.terrain.getHeightAt(x, z),
    getCursorOverride: () => {
      if (firstPersonController?.isActive()) return 'default';
      return burgageTool?.getCursor()
        ?? farmFieldTool?.getCursor()
        ?? roadTool?.getCursor()
        ?? null;
    },
    shouldIgnoreInput: (event) =>
      (roadTool?.shouldBlockCameraInput(event) ?? false)
      || (buildingTool?.shouldBlockCameraInput(event) ?? false)
      || (burgageTool?.shouldBlockCameraInput(event) ?? false)
      || (farmFieldTool?.shouldBlockCameraInput(event) ?? false),
    onViewChanged: () => {
      if (firstPersonController?.isActive()) return;
      sceneManager.render(0, cameraController.getOrbitDistance());
    },
  });

  const roadSelection = new RoadSelection({
    camera: sceneManager.camera,
    domElement: sceneManager.renderer.domElement,
    network: roadNetwork,
    sceneManager,
    onChange: () => bridge.syncToolbar(),
  });

  const toggleRoadTool = (): void => {
    if (!sessionGate.isReady()) {
      toastManager?.show('SpacetimeDB is not connected.', { variant: 'error' });
      return;
    }
    roadTool.setEnabled(!roadTool.isEnabled());
    if (roadTool.isEnabled()) {
      buildingTool.setMode('off');
      burgageTool.setEnabled(false);
      farmFieldTool.setEnabled(false);
    }
    bridge.syncToolbar();
  };

  roadTool = new RoadTool({
    domElement: sceneManager.renderer.domElement,
    network: roadNetwork,
    sceneManager,
    selection: roadSelection,
    terrainProjector: sceneManager.terrainProjector,
    getGameState: () => liveContext.gameState,
    onToggle: toggleRoadTool,
    onNetworkChanged: () => {
      sceneManager.syncRoadNetwork(roadNetwork);
      roadSelection.refresh();
      bridge.syncToolbar();
      spacetimeStore.queueRoadSync(roadNetwork.snapshot());
    },
    onStateChanged: () => bridge.syncToolbar(),
    isBlocked: () => isRoadPlacementBlocked(placementGate),
    onDeleteRequested: (request) => {
      if (!toolbar) return;
      if (!request) {
        toolbar.hideDeletePopup();
        return;
      }
      toolbar.showDeletePopup({
        clientX: request.clientX,
        clientY: request.clientY,
        onRemove: () => roadTool.confirmDelete(request.edgeId),
        onCancel: () => roadSelection.setSelected(null),
      });
    },
    onPlacementRejected: (event) => {
      const messageId = roadPlacementReasonToToastId(event.reason);
      if (messageId) toastManager?.showMessageId(messageId, { variant: 'error' });
    },
  });

  buildingTool = new BuildingTool({
    domElement: sceneManager.renderer.domElement,
    terrainProjector: sceneManager.terrainProjector,
    markers: buildingMarkers,
    getState: () => liveContext.gameState,
    onPlaceBuilding: async (kind, x, z) => {
      requireSessionReady();
      await spacetimeStore.placeBuilding(kind, x, z);
    },
    onDemolishBuilding: async (buildingId) => {
      requireSessionReady();
      await spacetimeStore.demolishBuilding(buildingId);
    },
    isWaterAt: (x, z) => sceneManager.riverField.isRenderedWetAt(x, z),
    isQuarryPitAt: (x, z) => sceneManager.worldLayout.quarryLayout.isBlockedForProps(x, z),
    getNaturalHeightAt: (x, z) => sampleNaturalTerrainHeight(x, z),
    countMatureTreesInRadius: (x, z, radius) => {
      const registry = liveContext.treeRegistry;
      if (!registry) return 0;
      return countTreesNearBuilding(liveContext.gameState, registry, x, z, radius).matureTrees;
    },
    getRoadNetwork: () => roadNetwork,
    onPreviewChange: (preview) => {
      syncBuildingTerrainLayout(sceneManager, liveContext.gameState);
      syncPreviewTerrainPads(sceneManager, liveContext.gameState, preview);
    },
    onModeChanged: () => bridge.syncToolbar(),
    onPlacementRejected: (reason) => {
      toastManager?.showMessageId(buildingPlacementReasonToToastId(reason), { variant: 'error' });
    },
    onPlacementFailed: (message) => {
      toastManager?.show(message, { variant: 'error' });
    },
    onUndoFailed: (message) => {
      toastManager?.show(message, { variant: 'error' });
    },
    onRedoFailed: (message) => {
      toastManager?.show(message, { variant: 'error' });
    },
    isBlocked: () => isBuildingPlacementBlocked(placementGate),
  });

  burgageTool = new BurgageTool({
    domElement: sceneManager.renderer.domElement,
    camera: sceneManager.camera,
    terrainProjector: sceneManager.terrainProjector,
    roadNetwork,
    getState: () => liveContext.gameState,
    getHeightAt: (x, z) => sceneManager.terrain.getHeightAt(x, z),
    getNaturalHeightAt: (x, z) => sampleNaturalTerrainHeight(x, z),
    isWaterAt: (x, z) => sceneManager.riverField.isRenderedWetAt(x, z),
    isQuarryPitAt: (x, z) => sceneManager.worldLayout.quarryLayout.isBlockedForProps(x, z),
    onCommit: async (commit) => {
      requireSessionReady();
      await spacetimeStore.placeBurgageZone({
        corners: commit.corners.map((corner) => ({ x: corner.x, z: corner.z })),
        frontageEdge: commit.frontageEdge,
        plotCount: commit.plotCount,
      });
    },
    onDemolishBurgageZone: async (zoneId) => {
      requireSessionReady();
      await spacetimeStore.demolishBurgageZone(zoneId);
    },
    onModeChanged: () => bridge.syncToolbar(),
    onPlacementRejected: (reason) => {
      toastManager?.showMessageId(burgagePlacementReasonToToastId(reason), { variant: 'error' });
    },
    onPlacementFailed: (message) => {
      toastManager?.show(message, { variant: 'error' });
    },
    onUndoFailed: (message) => {
      toastManager?.show(message, { variant: 'error' });
    },
    onRedoFailed: (message) => {
      toastManager?.show(message, { variant: 'error' });
    },
    onPickRejected: (reason) => {
      if (reason === 'missed_terrain') {
        toastManager?.show('Click on terrain to place a point.', { variant: 'info', durationMs: 2200 });
        return;
      }
      if (reason === 'off_road') {
        toastManager?.show('Click beside a road for the frontage edge.', { variant: 'info', durationMs: 2400 });
        return;
      }
      if (reason === 'invalid_depth') {
        toastManager?.show(
          `Set depth between ~${Math.round(MIN_ZONE_DEPTH)}m and ~${Math.round(MAX_ZONE_DEPTH)}m behind the road.`,
          { variant: 'info', durationMs: 2600 },
        );
        return;
      }
      toastManager?.show('Move farther from the last corner.', { variant: 'info', durationMs: 2200 });
    },
    isBlocked: () => isBurgagePlacementBlocked(placementGate),
  });
  burgageTool.attachTo(sceneManager.previewGroup);

  const fieldFailureMessage = (reason: FarmFieldPlacementFailureReason): string => {
    switch (reason) {
      case 'too_small': return 'Draw a larger field.';
      case 'too_large': return 'Draw a smaller field.';
      case 'edge_too_short': return 'Each field edge must be at least 6 metres.';
      case 'too_steep': return 'This ground is too steep to cultivate.';
      case 'no_farmstead': return 'Place a farmstead first, then draw inside its working radius.';
      case 'water': return 'Fields cannot cover open water.';
      case 'quarry': return 'Fields cannot cover a quarry pit.';
      case 'building': return 'Field overlaps a building.';
      case 'residence': return 'Field overlaps a residence plot.';
      case 'field': return 'Field overlaps existing farmland.';
      case 'trees': return 'Clear standing trees before cultivating this field.';
    }
  };

  farmFieldTool = new FarmFieldTool({
    domElement: sceneManager.renderer.domElement,
    camera: sceneManager.camera,
    terrainProjector: sceneManager.terrainProjector,
    getState: () => liveContext.gameState,
    getTreeRegistry: () => liveContext.treeRegistry,
    getHeightAt: (x, z) => sceneManager.terrain.getHeightAt(x, z),
    isWaterAt: (x, z) => sceneManager.riverField.isRenderedWetAt(x, z),
    isQuarryPitAt: (x, z) => sceneManager.worldLayout.quarryLayout.isBlockedForProps(x, z),
    onCommit: async (input) => {
      requireSessionReady();
      await spacetimeStore.placeFarmField(input);
    },
    onModeChanged: () => bridge.syncToolbar(),
    onPlacementRejected: (reason) => toastManager?.show(fieldFailureMessage(reason), { variant: 'error' }),
    onPlacementFailed: (message) => toastManager?.show(message, { variant: 'error' }),
    onCropChanged: (crop, recommendation) => toastManager?.show(
      `${crop[0].toUpperCase()}${crop.slice(1)} selected · ${recommendation}.`,
      { variant: 'info', durationMs: 2400 },
    ),
    isBlocked: () => isFarmFieldPlacementBlocked(placementGate),
  });
  farmFieldTool.attachTo(sceneManager.previewGroup);

  const residenceMarkers = new ResidenceMarkers(sceneManager.selectionGroup);
  const backyardGardenMarkers = new BackyardGardenMarkers(sceneManager.selectionGroup, {
    maxAnisotropy: sceneManager.textureAnisotropy,
    useSeedThree: sceneManager.rendererBackend === 'webgpu',
  });
  const burgageFencing = new BurgageFencing(sceneManager.selectionGroup);
  const farmFieldMarkers = new FarmFieldMarkers(
    sceneManager.selectionGroup,
    (x, z) => sceneManager.terrain.getHeightAt(x, z),
  );

  toolbar = new BuildToolbar(uiRoot, {
    onOpenRoads: toggleRoadTool,
    onBuildRoad: () => {
      if (farmFieldTool.isEnabled()) {
        farmFieldTool.commitDraft();
        return;
      }
      if (burgageTool.isEnabled()) {
        burgageTool.commitDraft();
        return;
      }
      roadTool.commitDraft();
    },
    onToggleBuilding: (kind: BuildingKind) => {
      if (!sessionGate.isReady()) {
        toastManager?.show('SpacetimeDB is not connected.', { variant: 'error' });
        return;
      }
      buildingTool.toggleMode(kind);
      if (buildingTool.isEnabled()) {
        roadTool.setEnabled(false);
        burgageTool.setEnabled(false);
        farmFieldTool.setEnabled(false);
      }
      bridge.syncToolbar();
    },
    onToggleResidences: () => {
      if (!sessionGate.isReady()) {
        toastManager?.show('SpacetimeDB is not connected.', { variant: 'error' });
        return;
      }
      const wasEnabled = burgageTool.isEnabled();
      burgageTool.setEnabled(!wasEnabled);
      if (burgageTool.isEnabled()) {
        roadTool.setEnabled(false);
        buildingTool.setMode('off');
        farmFieldTool.setEnabled(false);
        toastManager?.show(
          'Draw the rectangle along the road, then use the on-screen plot controls to choose how many homes fit.',
          { variant: 'info', durationMs: 6500 },
        );
      }
      bridge.syncToolbar();
    },
    onToggleFarmFields: () => {
      if (!sessionGate.isReady()) {
        toastManager?.show('SpacetimeDB is not connected.', { variant: 'error' });
        return;
      }
      farmFieldTool.setEnabled(!farmFieldTool.isEnabled());
      if (farmFieldTool.isEnabled()) {
        roadTool.setEnabled(false);
        buildingTool.setMode('off');
        burgageTool.setEnabled(false);
        toastManager?.show(
          'Draw a baseline, set field depth, then choose rye, oats, or fallow with C.',
          { variant: 'info', durationMs: 6000 },
        );
      }
      bridge.syncToolbar();
    },
    onToggleCityAdministration: () => {
      bridge.getCityAdminPanel()?.toggle();
    },
    onBurgagePlotDecrease: () => {
      burgageTool.adjustPlotCount(-1);
      bridge.syncToolbar();
    },
    onBurgagePlotIncrease: () => {
      burgageTool.adjustPlotCount(1);
      bridge.syncToolbar();
    },
    onBurgageRotateFrontage: () => {
      burgageTool.rotateFrontageEdge();
      bridge.syncToolbar();
    },
    onSetWaterOverlay: (active) => {
      setHydrologyOverlayEnabled(active);
      sceneManager.setHydrologyOverlayVisible(active);
      toolbar.setWaterOverlayActive(active);
    },
    onMenuOpenChange: (open) => {
      cameraController.setInputEnabled(!open && !firstPersonController.isActive() && !bridge.getCityAdminPanel()?.isOpen());
    },
    onShadowPreferenceChange: () => {
      sceneManager.applyShadowPreferences();
    },
    canOpenMenuFromKeyboard: () =>
      !firstPersonController.isActive()
      && !roadTool.isEnabled()
      && !buildingTool.isEnabled()
      && !burgageTool.isEnabled()
      && !farmFieldTool.isEnabled()
      && !bridge.getCityAdminPanel()?.isOpen(),
    onNewWorld: () => {
      void beginNewWorld(() => sessionGate.isReady());
    },
  });

  const cityAdminPanel = new CityAdministrationPanel(uiRoot, {
    getGameState: () => liveContext.gameState,
    getWorldQueries: () => worldQueries,
    getTaxRate: () => spacetimeStore.snapshot.economicActivityTaxRate ?? ECONOMIC_ACTIVITY_TAX_RATE_DEFAULT,
    getParishPolicy: () => spacetimeStore.snapshot.parishPolicy ?? DEFAULT_PARISH_POLICY,
    getMonasteryPolicy: () => spacetimeStore.snapshot.monasteryPolicy ?? DEFAULT_MONASTERY_POLICY,
    onTaxRateChange: async (taxRate) => {
      requireSessionReady();
      await spacetimeStore.setEconomicActivityTaxRate(taxRate);
    },
    onTaxRateChangeFailed: (error) => {
      const message = error instanceof Error ? error.message : 'Could not update tax rate.';
      toastManager?.show(message, { variant: 'error' });
    },
    onParishPolicyChange: async (autoSweepEnabled, cofferReserveGold, sabbathObservanceEnabled) => {
      requireSessionReady();
      await spacetimeStore.setChapelParishPolicy(
        autoSweepEnabled,
        cofferReserveGold,
        sabbathObservanceEnabled,
      );
    },
    onParishPolicyChangeFailed: (error) => {
      const message = error instanceof Error ? error.message : 'Could not update parish policy.';
      toastManager?.show(message, { variant: 'error' });
    },
    onMonasteryPolicyChange: async (titheShare, feastsEnabled) => {
      requireSessionReady();
      await spacetimeStore.setMonasteryPolicy(titheShare, feastsEnabled);
    },
    onMonasteryPolicyChangeFailed: (error) => {
      const message = error instanceof Error ? error.message : 'Could not update monastery policy.';
      toastManager?.show(message, { variant: 'error' });
    },
    onOpenChange: (open) => {
      toolbar.setCityAdministrationOpen(open);
      const menuOpen = toolbar.isGameMenuOpen();
      cameraController.setInputEnabled(!open && !menuOpen && !firstPersonController.isActive());
    },
  });
  bridge.setCityAdminPanel(cityAdminPanel);

  const disposeTooltips = mountTooltips(uiRoot);
  toastManager = new ToastManager(uiRoot);
  spacetimeStore.setRoadSyncFailedListener((error) => {
    const message = error instanceof Error ? error.message : 'Road sync failed.';
    toastManager?.show(`Road sync failed: ${message}`, { variant: 'error', durationMs: 6000 });
  });
  const inspectorActions = createInspectorSpacetimeActions(
    () => spacetimeStore,
    () => liveContext.gameState,
    () => sessionGate.isReady(),
    toastManager,
  );
  const resourceInspector = new ResourceInspector({
    domElement: sceneManager.renderer.domElement,
    uiRoot,
    sceneManager,
    terrainProjector: sceneManager.terrainProjector,
    worldQueries,
    getState: () => liveContext.gameState,
    getEconomicActivityTaxRate: () =>
      spacetimeStore.snapshot.economicActivityTaxRate ?? ECONOMIC_ACTIVITY_TAX_RATE_DEFAULT,
    getParishPolicy: () =>
      spacetimeStore.snapshot.parishPolicy ?? DEFAULT_PARISH_POLICY,
    getMarketState: () => spacetimeStore.snapshot.marketState,
    ...inspectorActions,
    onSelectionChange: (target) => {
      if (target?.kind === 'building') {
        buildingMarkers.setSelectedWorkExtent(
          target.building,
          getBuildingWorkExtentHighlight(target.building, worldQueries, {
            matureTrees: target.matureTrees,
          }),
        );
        return;
      }
      buildingMarkers.setSelectedWorkExtent(null);
    },
    isBlocked: () => isWorldInspectionBlocked(placementGate),
  });
  resourceInspector.setHud(
    computeResourceTotals(gameState),
    computePopulationStats(gameState),
  );

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
    isSessionReady: () => sessionGate.isReady(),
    onModeChange: (active) => {
      cameraController.setInputEnabled(!active && !toolbar.isGameMenuOpen());
      toolbar.setFirstPersonMode(active);
      if (active) {
        if (roadTool.isEnabled()) roadTool.setEnabled(false);
        if (buildingTool.isEnabled()) buildingTool.setMode('off');
        if (burgageTool.isEnabled()) burgageTool.setEnabled(false);
        if (farmFieldTool.isEnabled()) farmFieldTool.setEnabled(false);
        return;
      }
      const pos = firstPersonController.getPosition();
      cameraController.syncFromFirstPerson(pos.x, pos.z, firstPersonController.getBodyYaw());
    },
  });

  placementGate.isRoadToolEnabled = () => roadTool.isEnabled();
  placementGate.isBuildingToolEnabled = () => buildingTool.isEnabled();
  placementGate.isBurgageToolEnabled = () => burgageTool.isEnabled();
  placementGate.isFarmFieldToolEnabled = () => farmFieldTool.isEnabled();
  placementGate.isFirstPersonActive = () => firstPersonController.isActive();
  placementGate.isMenuOpen = () => toolbar.isGameMenuOpen();

  const worldMapUi = createWorldMapUi({
    uiRoot,
    domElement: sceneManager.renderer.domElement,
    terrain: sceneManager.terrain,
    riverField: sceneManager.riverField,
    registry: layoutRegistry,
    getCamera: () => sceneManager.camera,
    getZoomPercent: () => cameraController.getZoomPercent(),
    getGameState: () => liveContext.gameState,
    getFocus: () => resolveWorldMapFocus(cameraController, firstPersonController),
    placementGate,
    onQuarrySelect: (quarryId) => resourceInspector.selectQuarry(quarryId),
    onForagingSelect: (nodeId) => resourceInspector.selectForaging(nodeId),
  });
  worldMapUi.minimap.syncBuildings(buildBuildingWorldMapMarkers(liveContext.gameState.buildings.values()));

  toolbar.setWaterOverlayActive(isHydrologyOverlayEnabled());
  toolbar.setGameplayEnabled(false);
  loadingScreen?.setProgress({
    label: 'Connecting…',
    detail: 'Syncing with SpacetimeDB',
    phase: 'connecting',
    fraction: 0,
  });

  return {
    loadingScreen,
    liveContext,
    sceneManager,
    layoutRegistry,
    gameState,
    input,
    roadNetwork,
    cameraController,
    firstPersonController,
    roadTool,
    roadSelection,
    buildingTool,
    burgageTool,
    farmFieldTool,
    buildingMarkers,
    deliveryAgents,
    villagers,
    residenceMarkers,
    backyardGardenMarkers,
    burgageFencing,
    farmFieldMarkers,
    toolbar,
    toastManager,
    disposeTooltips,
    resourceInspector,
    worldMapUi,
    ambientAudio,
    spacetimeStore,
    sessionGate,
    placementGate,
    uiRoot,
  };
}
