import assert from 'node:assert/strict';
import type { BuildingState, GameState } from '../src/resources/types.ts';
import { createEmptyStockpile } from '../src/resources/types.ts';
import { getBuildingProcessorStatus, getBuildingWorkExtentHighlight } from '../src/resources/inspector/buildingProcessorStatus.ts';
import { WorldQueries } from '../src/resources/WorldQueries.ts';
import type { RoadNetwork } from '../src/roads/RoadNetwork.ts';

function emptyGameState(buildings: BuildingState[]): GameState {
  return {
    seed: 1,
    tick: 0,
    stockpile: createEmptyStockpile(),
    quarries: new Map(),
    foragingNodes: new Map(),
    trees: new Map(),
    buildings: new Map(buildings.map((building) => [building.id, building])),
    farmFields: new Map(),
    burgageZones: new Map(),
    residences: new Map(),
    backyardGardens: new Map(),
    deliveryTrips: new Map(),
    nextBuildingId: 1,
  };
}

function makeBuilding(partial: Partial<BuildingState> & Pick<BuildingState, 'id' | 'kind' | 'x' | 'z'>): BuildingState {
  return {
    workRadius: 40,
    actionCooldown: 0,
    timber: 0,
    firewood: 0,
    stone: 0,
    water: 0,
    food: 0,
    grain: 0,
    flour: 0,
    ale: 0,
    preservedFood: 0,
    honey: 0,
    wine: 0,
    gold: 0,
    waterCapacity: 0,
    assignedLabor: 0,
    ...partial,
  };
}

function stubWorldQueries(
  buildings: BuildingState[],
  roadDistance: (ax: number, az: number, bx: number, bz: number) => number | null,
): WorldQueries {
  const gameState = emptyGameState(buildings);
  const network = {} as RoadNetwork;
  return {
    getGameState: () => gameState,
    getRoadNetwork: () => network,
    getRoadNetworkSnapshot: () => network,
    getRoadConnectedWells: (building: BuildingState) =>
      buildings.filter(
        (candidate) =>
          candidate.kind === 'well'
          && roadDistance(building.x, building.z, candidate.x, candidate.z) != null,
      ),
    getRoadPathDistance: roadDistance,
    hasRoadPathToBuildingKind: (ax, az, kind) =>
      buildings.some(
        (candidate) =>
          candidate.kind === kind
          && roadDistance(ax, az, candidate.x, candidate.z) != null,
      ),
  } as WorldQueries;
}

const granary = makeBuilding({
  id: 'granary-1',
  kind: 'granary',
  x: 0,
  z: 0,
  assignedLabor: 2,
});

const well = makeBuilding({
  id: 'well-1',
  kind: 'well',
  x: 10,
  z: 0,
  water: 0,
});

const connected = (_ax: number, _az: number, bx: number, bz: number) =>
  bx === 10 && bz === 0 ? 12 : null;

const noWellQueries = stubWorldQueries([granary], connected);
const dryWellQueries = stubWorldQueries([granary, well], connected);
const readyGranary = makeBuilding({
  id: 'granary-2',
  kind: 'granary',
  x: 0,
  z: 0,
  assignedLabor: 2,
  flour: 3,
  firewood: 1,
  water: 2,
});
const readyWell = makeBuilding({
  id: 'well-2',
  kind: 'well',
  x: 10,
  z: 0,
  water: 5,
});
const readyQueries = stubWorldQueries([readyGranary, readyWell], connected);

assert.equal(
  getBuildingProcessorStatus(granary, noWellQueries)?.statusText,
  'Idle — needs a road-connected well to operate',
);
assert.equal(
  getBuildingProcessorStatus(granary, noWellQueries)?.statusState,
  'warning',
);
assert.equal(getBuildingWorkExtentHighlight(granary, noWellQueries), 'warning');

assert.equal(
  getBuildingProcessorStatus(granary, dryWellQueries)?.statusText,
  'Waiting for water — needs 2 per cycle',
);

assert.equal(
  getBuildingProcessorStatus(readyGranary, readyQueries)?.statusText,
  'Baking staple food',
);
assert.equal(
  getBuildingProcessorStatus(readyGranary, readyQueries)?.statusState,
  'active',
);
assert.equal(getBuildingWorkExtentHighlight(readyGranary, readyQueries), 'normal');

const brewery = makeBuilding({
  id: 'brewery-1',
  kind: 'brewery',
  x: 0,
  z: 0,
  assignedLabor: 1,
  water: 2,
  grain: 0,
});
assert.match(
  getBuildingProcessorStatus(brewery, readyQueries)?.statusText ?? '',
  /Waiting for grain/,
);

console.log('building processor status tests passed');
