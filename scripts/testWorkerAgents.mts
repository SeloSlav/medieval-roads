import assert from 'node:assert/strict';
import type {
  BuildingState,
  ResidenceState,
  ResourceNodeState,
  TreeEntityState,
  TreeLayoutEntry,
} from '../src/resources/types.ts';
import { computeVillagerSlots } from '../src/settlement/villagerPaths.ts';
import {
  allocateProductionWorkers,
  collectWorkerTargets,
  pickWorkerWalkPath,
} from '../src/settlement/workerPaths.ts';

const residenceA = residence('residence-a', 0, 0, 3);
const residenceB = residence('residence-b', 100, 0, 2);
const lumberMill = building('building-1', 'lumber_mill', 10, 0, 2, 60);
const stoneCamp = building('building-2', 'stone_quarry', 92, 0, 2, 55);
const serviceWell = building('building-3', 'well', 50, 0, 2, 90);

const roster = allocateProductionWorkers(
  [residenceA, residenceB],
  [serviceWell, stoneCamp, lumberMill],
);
assert.equal(roster.assignments.length, 4, 'only production labor becomes workplace agents');
assert.deepEqual(
  roster.assignments.map((assignment) => assignment.buildingId),
  ['building-1', 'building-1', 'building-2', 'building-2'],
);
assert.equal(roster.remainingPopulationByResidence.get(residenceA.id), 1);
assert.equal(roster.remainingPopulationByResidence.get(residenceB.id), 0);
assert.ok(
  roster.assignments.every((assignment) => assignment.homeResidenceId !== null),
  'nearby housed residents should be claimed before starting-population fallbacks',
);

const homeSlots = computeVillagerSlots(
  [residenceA, residenceB],
  null,
  roster.remainingPopulationByResidence,
);
assert.equal(homeSlots.get(residenceA.id), 1);
assert.equal(homeSlots.has(residenceB.id), false, 'fully assigned households disappear from home crowd');

const overstaffed = allocateProductionWorkers(
  [residence('residence-c', 0, 0, 1)],
  [building('building-4', 'stone_quarry', 0, 0, 3, 55)],
);
assert.equal(overstaffed.assignments[0]?.homeResidenceId, 'residence-c');
assert.equal(overstaffed.assignments[1]?.homeResidenceId, null);
assert.equal(overstaffed.assignments[2]?.homeResidenceId, null);

const treeEntries: TreeLayoutEntry[] = [
  treeEntry('tree-mature', 20, 0),
  treeEntry('tree-stump', 22, 0),
];
const trees = new Map<string, TreeEntityState>([
  ['tree-mature', treeState('tree-mature', 'mature')],
  ['tree-stump', treeState('tree-stump', 'stump')],
]);
const targetInputs = {
  quarries: [] as ResourceNodeState[],
  foragingNodes: [],
  trees,
  treeRegistry: {
    treesInRadius: () => treeEntries,
  },
  farmFields: [],
  pastures: [],
};
assert.deepEqual(
  collectWorkerTargets(lumberMill, targetInputs).map((target) => target.id),
  ['tree-mature'],
  'lumber workers should only walk toward mature trees',
);
assert.deepEqual(
  collectWorkerTargets(
    building('building-5', 'reforester', 0, 0, 1, 60),
    targetInputs,
  ).map((target) => target.id),
  ['tree-stump'],
  'reforesters should walk toward stumps or growing trees',
);

const quarryCamp = building('building-6', 'stone_quarry', 0, 0, 1, 55);
const quarryTarget = resourceNode('quarry-near', 'quarry', 30, 0, 40);
const depletedTarget = resourceNode('quarry-empty', 'quarry', 20, 0, 0);
const distantTarget = resourceNode('quarry-far', 'quarry', 80, 0, 40);
const quarryTargets = collectWorkerTargets(quarryCamp, {
  ...targetInputs,
  quarries: [quarryTarget, depletedTarget, distantTarget],
});
assert.deepEqual(quarryTargets.map((target) => target.id), ['quarry-near']);

let resourcePathFound = false;
for (let seed = 0; seed < 24; seed++) {
  const path = pickWorkerWalkPath(quarryCamp, 0, quarryTargets, seed);
  assert.ok(path && path.length >= 5);
  assert.ok(
    path.every((point) => Math.hypot(point.x - quarryCamp.x, point.z - quarryCamp.z) <= 55),
    'worker paths must stay inside the workplace extent',
  );
  if (path.some((point) => Math.hypot(point.x - quarryTarget.x, point.z - quarryTarget.z) < 4)) {
    resourcePathFound = true;
  }
}
assert.equal(resourcePathFound, true, 'workers should regularly walk out to eligible resources');

console.log('production worker agent tests passed');

function residence(
  id: string,
  x: number,
  z: number,
  population: number,
): ResidenceState {
  return {
    id,
    zoneId: `zone-${id}`,
    parcelIndex: 0,
    x,
    z,
    yaw: 0,
    population,
    populationCapacity: population,
    tier: 1,
    settlementTicks: 0,
    needs: {
      firewood: { stock: 0, deficitTicks: 0 },
      water: { stock: 0, deficitTicks: 0 },
      food: { stock: 0, deficitTicks: 0 },
      ale: { stock: 0, deficitTicks: 0 },
      preservedFood: { stock: 0, deficitTicks: 0 },
    },
    abandoned: false,
    householdWealth: 0,
  };
}

function building(
  id: string,
  kind: BuildingState['kind'],
  x: number,
  z: number,
  assignedLabor: number,
  workRadius: number,
): BuildingState {
  return {
    id,
    kind,
    x,
    z,
    workRadius,
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
    assignedLabor,
    storehouseAcceptsTimber: true,
    storehouseAcceptsStone: true,
    storehouseAcceptsFirewood: true,
  };
}

function treeEntry(id: string, x: number, z: number): TreeLayoutEntry {
  return {
    id,
    layoutIndex: Number(id.length),
    x,
    z,
    woodYield: 4,
    form: 'broad',
    species: 'beech',
    scale: 1,
  };
}

function treeState(
  treeId: string,
  phase: TreeEntityState['phase'],
): TreeEntityState {
  return {
    treeId,
    layoutIndex: treeId.length,
    phase,
    growthProgress: phase === 'mature' ? 1 : 0,
  };
}

function resourceNode(
  nodeId: string,
  kind: ResourceNodeState['kind'],
  x: number,
  z: number,
  remaining: number,
): ResourceNodeState {
  return {
    nodeId,
    kind,
    resource: 'stone',
    remaining,
    maxYield: 100,
    x,
    z,
  };
}
