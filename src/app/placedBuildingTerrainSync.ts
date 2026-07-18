import { BuildingTerrainLayout } from '../buildings/BuildingTerrainLayout.ts';
import type {
  BuildingTerrainSource,
  ResidenceTerrainSource,
} from '../buildings/BuildingTerrainLayout.ts';
import type { BuildingMarkers } from '../buildings/BuildingMarkers.ts';
import type { BuildingState, GameState } from '../resources/types.ts';
import type { SceneManager } from '../scene/SceneManager.ts';
import { setActivePlacedBuildingLayout, sampleNaturalTerrainHeight } from '../terrain/TerrainHeight.ts';
import { updateTerrainBuildingPads } from '../terrain/TerrainBuildingPads.ts';

export function collectPlacedBuildingSources(gameState: GameState | null): BuildingTerrainSource[] {
  if (!gameState) return [];
  const placedSources: BuildingTerrainSource[] = [];
  for (const building of gameState.buildings.values()) {
    placedSources.push({ kind: building.kind, x: building.x, z: building.z });
  }
  return placedSources;
}

export function collectPlacedResidenceSources(gameState: GameState | null): ResidenceTerrainSource[] {
  if (!gameState) return [];
  return [...gameState.residences.values()].map((residence) => ({
    x: residence.x,
    z: residence.z,
    yaw: residence.yaw,
  }));
}

export function getPlacedBuildingSignature(buildings: Map<string, BuildingState>): string {
  return [...buildings.values()]
    .map((building) => `${building.id}:${building.kind}:${building.x.toFixed(2)}:${building.z.toFixed(2)}`)
    .sort()
    .join('|');
}

export function getPlacedTerrainSignature(state: GameState): string {
  const buildings = getPlacedBuildingSignature(state.buildings);
  const residences = [...state.residences.values()]
    .map((residence) => [
      residence.id,
      residence.x.toFixed(2),
      residence.z.toFixed(2),
      residence.yaw.toFixed(3),
    ].join(':'))
    .sort()
    .join('|');
  if (!buildings && !residences) return '';
  return `buildings:${buildings}||residences:${residences}`;
}

export function getForestClearanceSignature(state: GameState): string {
  const buildings = [...state.buildings.values()]
    .map((building) => `${building.id}:${building.kind}:${building.x.toFixed(2)}:${building.z.toFixed(2)}`)
    .sort()
    .join('|');
  const residences = [...state.residences.values()]
    .map((residence) => `${residence.id}:${residence.zoneId}:${residence.parcelIndex}`)
    .sort()
    .join('|');
  const farmFields = [...state.farmFields.values()]
    .map((field) => `${field.id}:${field.corners.map((corner) => `${corner.x.toFixed(2)},${corner.z.toFixed(2)}`).join('-')}`)
    .sort()
    .join('|');
  return `${buildings}§${residences}§${farmFields}`;
}

export function syncBuildingTerrainLayout(
  sceneManager: SceneManager | null,
  gameState: GameState | null,
): void {
  if (!sceneManager) return;
  const placedSources = collectPlacedBuildingSources(gameState);
  const residenceSources = collectPlacedResidenceSources(gameState);
  const placedLayout = BuildingTerrainLayout.fromSettlement(
    placedSources,
    residenceSources,
    sampleNaturalTerrainHeight,
  );
  setActivePlacedBuildingLayout(placedLayout.sites.length > 0 ? placedLayout : null);
}

export function syncPreviewTerrainPads(
  sceneManager: SceneManager | null,
  gameState: GameState | null,
  preview: BuildingTerrainSource | null,
): void {
  if (!sceneManager) return;
  const placedSources = collectPlacedBuildingSources(gameState);
  const residenceSources = collectPlacedResidenceSources(gameState);
  const sources = preview ? [...placedSources, preview] : placedSources;
  const layout = sources.length > 0 || residenceSources.length > 0
    ? BuildingTerrainLayout.fromSettlement(sources, residenceSources, sampleNaturalTerrainHeight)
    : null;
  updateTerrainBuildingPads(sceneManager.terrain, layout);
}

export function syncPlacedBuildingTerrain(options: {
  sceneManager: SceneManager | null;
  gameState: GameState | null;
  buildingMarkers: BuildingMarkers | null;
  forceMeshUpdate?: boolean;
  onSignatureUpdate?: (signature: string) => void;
}): void {
  const { sceneManager, gameState, buildingMarkers, forceMeshUpdate, onSignatureUpdate } = options;
  if (!sceneManager) return;

  const placedSources = collectPlacedBuildingSources(gameState);
  const residenceSources = collectPlacedResidenceSources(gameState);
  const placedLayout = BuildingTerrainLayout.fromSettlement(
    placedSources,
    residenceSources,
    sampleNaturalTerrainHeight,
  );
  const hasPlacedPads = placedLayout.sites.length > 0;
  setActivePlacedBuildingLayout(hasPlacedPads ? placedLayout : null);

  if (forceMeshUpdate) {
    updateTerrainBuildingPads(sceneManager.terrain, hasPlacedPads ? placedLayout : null);
    buildingMarkers?.syncBuildings(gameState?.buildings.values() ?? []);
    if (gameState) {
      onSignatureUpdate?.(getPlacedTerrainSignature(gameState));
    }
  }
}
