import assert from 'node:assert/strict';
import * as THREE from 'three';
import { syncSettlementWorld } from '../src/app/settlementWorldSync.ts';
import { SpacetimeSnapshotApplier } from '../src/app/spacetimeSnapshotApplier.ts';
import { GameTableSync } from '../src/data/spacetimeTableSync/gameTableSync.ts';
import { syncWorldConfig } from '../src/data/spacetimeTableSync/syncWorldConfig.ts';
import { ForestManager } from '../src/props/ForestManager.ts';
import { createStubForestInstances } from '../src/props/forestInstanceStub.ts';
import type { GameState } from '../src/resources/types.ts';
import type { RoadNetwork } from '../src/roads/RoadNetwork.ts';

await testTableCallbackCoalescing();
testPlacementClearanceKeepsRoadWorkCached();
testSettlementSyncSkipsUnchangedDomains();
testTreeVisualSyncSkipsUnchangedSnapshots();
testWorldGenerationReferenceStaysStableAcrossTicks();

console.log('client sync scheduling tests passed');

async function testTableCallbackCoalescing(): Promise<void> {
  let tableRebuilds = 0;
  let notifications = 0;
  const owner = { toHexString: () => 'owner' };
  const row = {
    id: 1n,
    owner,
    kind: 'lumber_mill',
    x: 1,
    z: 2,
    workRadius: 3,
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
    assignedLabor: 0n,
    storehouseAcceptsTimber: true,
    storehouseAcceptsStone: true,
    storehouseAcceptsFirewood: true,
  };
  const callbacks: {
    insert?: (context: unknown, row: typeof row) => void;
    update?: (context: unknown, oldRow: typeof row, row: typeof row) => void;
    delete?: (context: unknown, row: typeof row) => void;
  } = {};
  const buildingTable = {
    iter: () => {
      tableRebuilds += 1;
      return [row];
    },
    onInsert: (callback: (context: unknown, row: typeof row) => void) => {
      callbacks.insert = callback;
    },
    onUpdate: (callback: (context: unknown, oldRow: typeof row, row: typeof row) => void) => {
      callbacks.update = callback;
    },
    onDelete: (callback: (context: unknown, row: typeof row) => void) => {
      callbacks.delete = callback;
    },
  };
  const state = {
    identityHex: 'owner',
    simTick: 0,
    worldGeneration: null,
    stockpile: {},
    economicActivityTaxRate: 0,
    parishPolicy: {},
    monasteryPolicy: {},
    marketState: {},
    quarries: new Map(),
    foragingNodes: new Map(),
    trees: new Map(),
    buildings: new Map(),
    farmFields: new Map(),
    pastures: new Map(),
    livestockHerds: new Map(),
    burgageZones: new Map(),
    residences: new Map(),
    backyardGardens: new Map(),
    deliveryTrips: new Map(),
    roads: null,
  };

  const sync = new GameTableSync(
    state as ConstructorParameters<typeof GameTableSync>[0],
    () => {
      notifications += 1;
    },
  );
  sync.attachHandlers({
    db: { building: buildingTable },
  } as Parameters<GameTableSync['attachHandlers']>[0]);

  for (let index = 0; index < 100; index++) {
    callbacks.update?.(undefined, row, { ...row, actionCooldown: index });
  }
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(tableRebuilds, 0, 'row callbacks should not reread the whole table');
  assert.equal(notifications, 1, 'one table burst should notify app listeners once');
  assert.equal(state.buildings.size, 1);
  assert.equal(state.buildings.get('building-1')?.actionCooldown, 99);
}

function testPlacementClearanceKeepsRoadWorkCached(): void {
  const placements = Array.from({ length: 80 }, (_, index) => ({
    x: (index % 10) * 8 - 40,
    z: Math.floor(index / 10) * 8 - 32,
    form: index % 3 === 0 ? 'broad' as const : 'narrow' as const,
    species: 'scotsPine',
    scale: 1,
  }));
  const forestInstances = createStubForestInstances(placements);
  let roadPathReads = 0;
  const points = [
    new THREE.Vector3(-80, 0, 0),
    new THREE.Vector3(80, 0, 0),
  ];
  const edge = {
    width: 4,
    get sampledPath() {
      roadPathReads += 1;
      return points;
    },
    controlPoints: points,
  };
  const network = {
    edges: new Map([['road-1', edge]]),
  } as unknown as RoadNetwork;
  const manager = new ForestManager(
    new THREE.Group(),
    forestInstances,
    { group: new THREE.Group(), instances: [] },
    null,
    [],
    { getHeightAt: () => 0 } as never,
    () => {},
    {
      hideTree: () => {},
      showTree: () => {},
      commit: () => {},
      setShadows: () => {},
      dispose: () => {},
    },
  );

  manager.syncRoadClearance(network);
  assert.ok(roadPathReads > 0, 'road sync should evaluate road paths');
  roadPathReads = 0;
  manager.syncPlacementClearance({
    buildings: [{ kind: 'lumber_mill', x: 0, z: 0 }],
  });
  assert.equal(
    roadPathReads,
    0,
    'building placement should reuse the existing road-clearance result',
  );
}

function testSettlementSyncSkipsUnchangedDomains(): void {
  const previous = emptyGameState();
  const current = {
    ...previous,
    tick: previous.tick + 1,
    buildings: new Map(previous.buildings),
  };
  const calls = {
    residences: 0,
    fields: 0,
    pastures: 0,
    livestock: 0,
    gardens: 0,
    deliveries: 0,
    villagers: 0,
  };
  const targets = {
    residenceMarkers: { syncResidences: () => { calls.residences += 1; } },
    farmFieldMarkers: { syncFields: () => { calls.fields += 1; } },
    pastureMarkers: { syncPastures: () => { calls.pastures += 1; } },
    livestockVisuals: { sync: () => { calls.livestock += 1; } },
    backyardGardenMarkers: { syncGardens: () => { calls.gardens += 1; } },
    deliveryAgents: {
      syncTrips: () => { calls.deliveries += 1; },
      applyTripStates: () => {},
    },
    villagers: { sync: () => { calls.villagers += 1; } },
    getHeightAt: () => 0,
    getRoadNetwork: () => null,
    getTreeRegistry: () => null,
  };

  syncSettlementWorld(targets as never, current, previous);
  assert.deepEqual(calls, {
    residences: 0,
    fields: 0,
    pastures: 0,
    livestock: 0,
    gardens: 0,
    deliveries: 0,
    villagers: 0,
  });
}

function testTreeVisualSyncSkipsUnchangedSnapshots(): void {
  const first = emptyGameState();
  first.trees.set('tree-1', {
    treeId: 'tree-1',
    layoutIndex: 1,
    phase: 'mature',
    growthProgress: 1,
  });
  let syncAllCalls = 0;
  let syncTreeCalls = 0;
  let buildingSyncCalls = 0;
  let fenceSyncCalls = 0;
  let forestClearanceCalls = 0;
  const deps = {
    sceneManager: null,
    buildingMarkers: {
      syncBuildings: () => {
        buildingSyncCalls += 1;
      },
    },
    terrainMinimap: null,
    burgageFencing: {
      syncZones: () => {
        fenceSyncCalls += 1;
      },
    },
    forestVisualSync: {
      syncAll: () => {
        syncAllCalls += 1;
      },
      syncTrees: () => {
        syncTreeCalls += 1;
      },
    },
    settlementWorld: {
      residenceMarkers: null,
      farmFieldMarkers: null,
      pastureMarkers: null,
      livestockVisuals: null,
      backyardGardenMarkers: null,
      deliveryAgents: null,
      villagers: null,
      getHeightAt: () => 0,
      getRoadNetwork: () => null,
      getTreeRegistry: () => null,
    },
    onForestClearanceChanged: () => {
      forestClearanceCalls += 1;
    },
  };
  const applier = new SpacetimeSnapshotApplier();
  applier.apply(deps as never, first, null);
  assert.equal(syncAllCalls, 1);
  assert.equal(buildingSyncCalls, 0);
  assert.equal(fenceSyncCalls, 1);
  assert.equal(forestClearanceCalls, 1);

  const tickOnly = { ...first, tick: 1 };
  applier.apply(deps as never, tickOnly, first);
  assert.equal(syncAllCalls, 1);
  assert.equal(syncTreeCalls, 0);
  assert.equal(buildingSyncCalls, 0);
  assert.equal(fenceSyncCalls, 1);
  assert.equal(forestClearanceCalls, 1);

  const changedTrees = new Map(tickOnly.trees);
  changedTrees.set('tree-1', {
    ...changedTrees.get('tree-1')!,
    phase: 'stump',
    growthProgress: 0,
  });
  const treeChanged = { ...tickOnly, tick: 2, trees: changedTrees };
  applier.apply(deps as never, treeChanged, tickOnly);
  assert.equal(syncTreeCalls, 1);

  const changedBuildings = new Map(treeChanged.buildings);
  changedBuildings.set('building-1', {
    id: 'building-1',
    kind: 'lumber_mill',
    x: 0,
    z: 0,
    workRadius: 10,
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
    assignedLabor: 1,
    storehouseAcceptsTimber: true,
    storehouseAcceptsStone: true,
    storehouseAcceptsFirewood: true,
  });
  const buildingAdded = { ...treeChanged, tick: 3, buildings: changedBuildings };
  applier.apply(deps as never, buildingAdded, treeChanged);
  assert.equal(buildingSyncCalls, 1);

  const laborChanged = new Map(buildingAdded.buildings);
  laborChanged.set('building-1', {
    ...laborChanged.get('building-1')!,
    assignedLabor: 2,
  });
  applier.apply(
    deps as never,
    { ...buildingAdded, tick: 4, buildings: laborChanged },
    buildingAdded,
  );
  assert.equal(
    buildingSyncCalls,
    1,
    'labor-only updates should not rebuild building geometry or terrain pads',
  );
}

function testWorldGenerationReferenceStaysStableAcrossTicks(): void {
  const state = {
    simTick: 0,
    worldGeneration: null,
  };
  const row = {
    id: 0,
    seed: 123n,
    nextBuildingId: 1n,
    simTick: 1n,
    mapSize: 1,
    topography: 50,
    hydrology: 50,
    forestDensity: 50,
    configured: false,
  };

  syncWorldConfig([row] as never, state as never);
  const firstGeneration = state.worldGeneration;
  syncWorldConfig([{ ...row, simTick: 2n }] as never, state as never);

  assert.equal(state.simTick, 2);
  assert.strictEqual(
    state.worldGeneration,
    firstGeneration,
    'simulation ticks should not replace unchanged world-generation settings',
  );
}

function emptyGameState(): GameState {
  return {
    seed: 1,
    tick: 0,
    stockpile: {
      timber: 0,
      stone: 0,
      firewood: 0,
      water: 0,
      game: 0,
      berries: 0,
      food: 0,
      grain: 0,
      flour: 0,
      ale: 0,
      preservedFood: 0,
      honey: 0,
      wine: 0,
      gold: 0,
    },
    quarries: new Map(),
    foragingNodes: new Map(),
    trees: new Map(),
    buildings: new Map(),
    farmFields: new Map(),
    pastures: new Map(),
    livestockHerds: new Map(),
    burgageZones: new Map(),
    residences: new Map(),
    backyardGardens: new Map(),
    deliveryTrips: new Map(),
    nextBuildingId: 1,
  };
}
