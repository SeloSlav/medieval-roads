import type { BuildingMarkers } from '../buildings/BuildingMarkers.ts';
import type { BurgageFencing } from '../residences/BurgageFencing.ts';
import type { ForestVisualSync } from '../resources/ForestVisualSync.ts';
import type { GameState } from '../resources/types.ts';
import type { SceneManager } from '../scene/SceneManager.ts';
import type { TerrainMinimapOverlay } from '../map/TerrainMinimapOverlay.ts';
import { buildBuildingWorldMapMarkers } from '../map/worldMapMarkers.ts';
import { collectOccupiedParcelPolygons } from '../residences/burgageZoneLayout.ts';
import { syncSettlementWorld, type SettlementWorldSyncTargets } from './settlementWorldSync.ts';
import {
  collectPlacedBuildingSources,
  getForestClearanceSignature,
  getPlacedTerrainSignature,
  syncPlacedBuildingTerrain,
} from './placedBuildingTerrainSync.ts';

export type SpacetimeSnapshotApplierDeps = {
  sceneManager: SceneManager | null;
  buildingMarkers: BuildingMarkers | null;
  terrainMinimap: TerrainMinimapOverlay | null;
  burgageFencing: BurgageFencing | null;
  forestVisualSync: ForestVisualSync | null;
  settlementWorld: SettlementWorldSyncTargets;
  onForestClearanceChanged?: () => void;
};

export class SpacetimeSnapshotApplier {
  private lastPlacedBuildingSignature = '';
  private lastForestClearanceSignature = '';
  private readonly previousTreePhases = new Map<string, string>();
  private readonly previousTreeGrowth = new Map<string, number>();

  apply(
    deps: SpacetimeSnapshotApplierDeps,
    state: GameState,
    previous: GameState | null,
  ): void {
    const buildingsChanged = !previous || state.buildings !== previous.buildings;
    const residencesChanged = !previous || state.residences !== previous.residences;
    const burgageZonesChanged = !previous || state.burgageZones !== previous.burgageZones;
    const farmFieldsChanged = !previous || state.farmFields !== previous.farmFields;
    const treesChanged = !previous || !mapEntriesShareValues(state.trees, previous.trees);
    if (treesChanged) {
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

      if (previous && state.trees.size < previous.trees.size) {
        for (const treeId of previous.trees.keys()) {
          if (state.trees.has(treeId)) continue;
          this.previousTreePhases.delete(treeId);
          this.previousTreeGrowth.delete(treeId);
        }
      }

      if (deps.forestVisualSync && state.trees.size !== previousTreeCount) {
        deps.forestVisualSync.syncAll(state.trees);
      } else if (changedTreeIds.length > 0) {
        deps.forestVisualSync?.syncTrees(state.trees, changedTreeIds);
      }
    }

    if (buildingsChanged || residencesChanged) {
      const terrainSignature = getPlacedTerrainSignature(state);
      if (terrainSignature !== this.lastPlacedBuildingSignature) {
        this.lastPlacedBuildingSignature = terrainSignature;
        if (buildingsChanged) {
          deps.buildingMarkers?.syncBuildings(state.buildings.values());
          deps.terrainMinimap?.syncBuildings(buildBuildingWorldMapMarkers(state.buildings.values()));
        }
        syncPlacedBuildingTerrain({
          sceneManager: deps.sceneManager,
          gameState: state,
          buildingMarkers: deps.buildingMarkers,
          forceMeshUpdate: true,
          onSignatureUpdate: (signature) => {
            this.lastPlacedBuildingSignature = signature;
          },
        });
      }
    }

    syncSettlementWorld(deps.settlementWorld, state, previous);
    if (burgageZonesChanged || residencesChanged || buildingsChanged) {
      deps.burgageFencing?.syncZones(
        state.burgageZones.values(),
        state.residences.values(),
        (x, z) => deps.sceneManager?.terrain.getHeightAt(x, z) ?? 0,
      );
    }

    if (buildingsChanged || residencesChanged || farmFieldsChanged) {
      const forestSignature = getForestClearanceSignature(state);
      if (forestSignature !== this.lastForestClearanceSignature) {
        this.lastForestClearanceSignature = forestSignature;
        deps.onForestClearanceChanged?.();
      }
    }
  }

  syncForestClearance(deps: SpacetimeSnapshotApplierDeps, gameState: GameState): void {
    if (!deps.sceneManager) return;
    deps.sceneManager.setForestClearanceSources(
      collectPlacedBuildingSources(gameState),
      collectOccupiedParcelPolygons(gameState.burgageZones.values(), gameState.residences.values()),
      [...gameState.farmFields.values()].map((field) => field.corners),
    );
  }

  reset(): void {
    this.lastPlacedBuildingSignature = '';
    this.lastForestClearanceSignature = '';
    this.previousTreePhases.clear();
    this.previousTreeGrowth.clear();
  }
}

function mapEntriesShareValues<K, V>(
  current: ReadonlyMap<K, V>,
  previous: ReadonlyMap<K, V>,
): boolean {
  if (current === previous) return true;
  if (current.size !== previous.size) return false;
  for (const [key, value] of current) {
    if (previous.get(key) !== value) return false;
  }
  return true;
}
