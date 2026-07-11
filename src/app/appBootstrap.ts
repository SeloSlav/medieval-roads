import { AmbientAudioController } from '../audio/AmbientAudioController.ts';
import { CameraController } from '../camera/CameraController.ts';
import { FirstPersonController } from '../camera/FirstPersonController.ts';
import { BuildingMarkers } from '../buildings/BuildingMarkers.ts';
import { BuildingTool } from '../buildings/BuildingTool.ts';
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
  isWorldInspectionBlocked,
  type PlacementInteractionGate,
} from '../input/PlacementInteractionGate.ts';
import { createInitialGameState } from '../resources/GameState.ts';
import type { GameState } from '../resources/types.ts';
import { countTreesNearBuilding } from '../resources/ForestVisualSync.ts';
import { ResourceInspector } from '../resources/ResourceInspector.ts';
import { computePopulationStats, computeResourceTotals } from '../resources/resourceTotals.ts';
import { WorldLayoutRegistry } from '../resources/WorldLayoutRegistry.ts';
import type { TreeRegistry } from '../resources/TreeRegistry.ts';
import { WorldQueries } from '../resources/WorldQueries.ts';
import { RoadMaterialFactory } from '../roads/RoadMaterialFactory.ts';
import { RoadNetwork } from '../roads/RoadNetwork.ts';
import { RoadSelection } from '../roads/RoadSelection.ts';
import { RoadTool } from '../roads/RoadTool.ts';
import { SceneManager } from '../scene/SceneManager.ts';
import { createInspectorSpacetimeActions } from './inspectorSpacetimeActions.ts';
import { createWorldMapIcons, type WorldMapIconsBundle } from './worldMapIcons.ts';
import { DeliveryAgentRenderer } from '../logistics/DeliveryAgentRenderer.ts';
import { beginStartupTextureLoad } from '../scene/startupTextures.ts';
import { sampleNaturalTerrainHeight } from '../terrain/TerrainHeight.ts';
import { BuildToolbar } from '../ui/BuildToolbar.ts';
import type { BuildingKind } from '../generated/gameBalance.ts';
import { CityAdministrationPanel } from '../ui/CityAdministrationPanel.ts';
import { ECONOMIC_ACTIVITY_TAX_RATE_DEFAULT } from '../economy/villageEconomy.ts';
import { DEFAULT_PARISH_POLICY } from '../economy/chapelParish.ts';
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
  buildingMarkers: BuildingMarkers;
  deliveryAgents: DeliveryAgentRenderer;
  residenceMarkers: ResidenceMarkers;
  backyardGardenMarkers: BackyardGardenMarkers;
  burgageFencing: BurgageFencing;
  toolbar: BuildToolbar;
  toastManager: ToastManager;
  disposeTooltips: () => void;
  resourceInspector: ResourceInspector;
  worldMapIcons: WorldMapIconsBundle;
  ambientAudio: AmbientAudioController;
  spacetimeStore: SpacetimeGameStore;
  placementGate: PlacementInteractionGate;
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
    });
  }
  const worldSettings = await resolveWorldGenerationSettings(root);
  setDraftWorldGeneration(worldSettings);
  saveWorldGenerationSettings(worldSettings);

  loadingScreen?.setProgress({ label: 'Starting world…', detail: 'Setting up scene shell' });

  const sceneRoot = mustElement(root, '[data-scene-root]');
  const uiRoot = mustElement(root, '[data-ui-root]');

  const sceneManager = await SceneManager.create(sceneRoot, worldSettings, (label, detail) => {
    loadingScreen?.setProgress({ label, detail });
  }, materialsPromise, startupTexturesPromise);
  const layoutRegistry = WorldLayoutRegistry.fromWorldLayout(sceneManager.worldLayout);
  const gameState = createInitialGameState(layoutRegistry, getDraftWorldGeneration().seed);
  const liveContext: SessionLiveContext = { gameState, treeRegistry: null };
  const input = new InputManager(sceneManager.renderer.domElement);
  const spacetimeStore = new SpacetimeGameStore();
  const roadNetwork = new RoadNetwork();

  let cameraController: CameraController;
  let firstPersonController: FirstPersonController;
  let roadTool: RoadTool;
  let buildingTool: BuildingTool;
  let burgageTool: BurgageTool;
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
  const placementGate: PlacementInteractionGate = {
    isRoadToolEnabled: () => false,
    isBuildingToolEnabled: () => false,
    isBurgageToolEnabled: () => false,
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
        ?? roadTool?.getCursor()
        ?? null;
    },
    shouldIgnoreInput: (event) =>
      (roadTool?.shouldBlockCameraInput(event) ?? false)
      || (buildingTool?.shouldBlockCameraInput(event) ?? false)
      || (burgageTool?.shouldBlockCameraInput(event) ?? false),
  });

  const roadSelection = new RoadSelection({
    camera: sceneManager.camera,
    domElement: sceneManager.renderer.domElement,
    network: roadNetwork,
    sceneManager,
    onChange: () => bridge.syncToolbar(),
  });

  const toggleRoadTool = (): void => {
    roadTool.setEnabled(!roadTool.isEnabled());
    if (roadTool.isEnabled()) {
      buildingTool.setMode('off');
      burgageTool.setEnabled(false);
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
      if (spacetimeStore.isConnected) {
        spacetimeStore.queueRoadSync(roadNetwork.snapshot());
      }
    },
    onStateChanged: () => bridge.syncToolbar(),
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
      if (!spacetimeStore.isConnected) {
        throw new Error('SpacetimeDB is not connected. Start the local server and refresh.');
      }
      await spacetimeStore.placeBuilding(kind, x, z);
    },
    onDemolishBuilding: async (buildingId) => {
      if (!spacetimeStore.isConnected) {
        throw new Error('SpacetimeDB is not connected. Start the local server and refresh.');
      }
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
      if (!spacetimeStore.isConnected) {
        throw new Error('SpacetimeDB is not connected. Start the local server and refresh.');
      }
      await spacetimeStore.placeBurgageZone({
        corners: commit.corners.map((corner) => ({ x: corner.x, z: corner.z })),
        frontageEdge: commit.frontageEdge,
        plotCount: commit.plotCount,
      });
    },
    onDemolishBurgageZone: async (zoneId) => {
      if (!spacetimeStore.isConnected) {
        throw new Error('SpacetimeDB is not connected. Start the local server and refresh.');
      }
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

  const residenceMarkers = new ResidenceMarkers(sceneManager.selectionGroup);
  const backyardGardenMarkers = new BackyardGardenMarkers(sceneManager.selectionGroup);
  const burgageFencing = new BurgageFencing(sceneManager.selectionGroup);

  toolbar = new BuildToolbar(uiRoot, {
    onOpenRoads: toggleRoadTool,
    onBuildRoad: () => {
      if (burgageTool.isEnabled()) {
        burgageTool.commitDraft();
        return;
      }
      roadTool.commitDraft();
    },
    onToggleBuilding: (kind: BuildingKind) => {
      buildingTool.toggleMode(kind);
      if (buildingTool.isEnabled()) {
        roadTool.setEnabled(false);
        burgageTool.setEnabled(false);
      }
      bridge.syncToolbar();
    },
    onToggleResidences: () => {
      const wasEnabled = burgageTool.isEnabled();
      burgageTool.setEnabled(!wasEnabled);
      if (burgageTool.isEnabled()) {
        roadTool.setEnabled(false);
        buildingTool.setMode('off');
        toastManager?.show(
          'Draw the rectangle along the road, then use the on-screen plot controls to choose how many homes fit.',
          { variant: 'info', durationMs: 6500 },
        );
      }
      bridge.syncToolbar();
    },
    onOpenCityAdministration: () => {
      bridge.getCityAdminPanel()?.openPanel();
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
      && !burgageTool.isEnabled(),
    onNewWorld: () => {
      void beginNewWorld({ connected: spacetimeStore.isConnected });
    },
  });

  const cityAdminPanel = new CityAdministrationPanel(uiRoot, {
    getGameState: () => liveContext.gameState,
    getWorldQueries: () => worldQueries,
    getTaxRate: () => spacetimeStore.snapshot.economicActivityTaxRate ?? ECONOMIC_ACTIVITY_TAX_RATE_DEFAULT,
    getParishPolicy: () => spacetimeStore.snapshot.parishPolicy ?? DEFAULT_PARISH_POLICY,
    onTaxRateChange: async (taxRate) => {
      if (!spacetimeStore.isConnected) {
        toastManager?.show('SpacetimeDB is not connected.', { variant: 'error' });
        throw new Error('SpacetimeDB is not connected.');
      }
      await spacetimeStore.setEconomicActivityTaxRate(taxRate);
    },
    onTaxRateChangeFailed: (error) => {
      const message = error instanceof Error ? error.message : 'Could not update tax rate.';
      toastManager?.show(message, { variant: 'error' });
    },
    onParishPolicyChange: async (autoSweepEnabled, cofferReserveGold, sabbathObservanceEnabled) => {
      if (!spacetimeStore.isConnected) {
        toastManager?.show('SpacetimeDB is not connected.', { variant: 'error' });
        throw new Error('SpacetimeDB is not connected.');
      }
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
    onOpenChange: (open) => {
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
    ...inspectorActions,
    onSelectionChange: (target) => {
      buildingMarkers.setSelectedWorkExtent(
        target?.kind === 'building' ? target.building : null,
      );
    },
    isBlocked: () => isWorldInspectionBlocked(placementGate),
  });
  resourceInspector.setHud(
    computeResourceTotals(gameState),
    computePopulationStats(gameState),
  );

  const worldMapIcons = createWorldMapIcons({
    uiRoot,
    domElement: sceneManager.renderer.domElement,
    terrain: sceneManager.terrain,
    registry: layoutRegistry,
    getCamera: () => sceneManager.camera,
    getZoomPercent: () => cameraController.getZoomPercent(),
    getGameState: () => liveContext.gameState,
    onQuarrySelect: (quarryId) => resourceInspector.selectQuarry(quarryId),
    onForagingSelect: (nodeId) => resourceInspector.selectForaging(nodeId),
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

  toolbar.setWaterOverlayActive(isHydrologyOverlayEnabled());

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
    buildingMarkers,
    deliveryAgents,
    residenceMarkers,
    backyardGardenMarkers,
    burgageFencing,
    toolbar,
    toastManager,
    disposeTooltips,
    resourceInspector,
    worldMapIcons,
    ambientAudio,
    spacetimeStore,
    placementGate,
  };
}
