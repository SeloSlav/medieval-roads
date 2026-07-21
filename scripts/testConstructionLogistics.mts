import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CONSTRUCTION_DELIVERY_SPEED_MPS,
  CONSTRUCTION_HAUL_PER_WORKER,
  CONSTRUCTION_MAX_BUILDERS,
  CONSTRUCTION_TREASURY_TRANSFER_PER_SEC,
  CONSTRUCTION_WORK_PER_WORKER_PER_SEC,
} from '../src/generated/gameBalance.ts';
import { getBuildingDefinition } from '../src/resources/buildings.ts';
import { getBuildingCost } from '../src/resources/buildingEconomy.ts';
import {
  constructionVisualSignature,
  createConstructionSiteMesh,
} from '../src/buildings/ConstructionSiteMesh.ts';
import {
  findInboundSupplyTripForBuilding,
  type DeliveryTripState,
} from '../src/logistics/deliveryTrips.ts';
import type { BuildingState } from '../src/resources/types.ts';
import { renderConstructionInspector } from '../src/resources/inspector/constructionRenderer.ts';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');

assert.equal(CONSTRUCTION_MAX_BUILDERS, 4);
assert.ok(CONSTRUCTION_HAUL_PER_WORKER > 0);
assert.ok(CONSTRUCTION_DELIVERY_SPEED_MPS > 0);
assert.ok(CONSTRUCTION_TREASURY_TRANSFER_PER_SEC > 0);
assert.ok(CONSTRUCTION_WORK_PER_WORKER_PER_SEC > 0);

for (const kind of ['lumber_mill', 'stone_quarry'] as const) {
  const definition = getBuildingDefinition(kind);
  const cost = getBuildingCost(kind);
  const maxCrewSeconds = (cost.timber + cost.stone)
    / (CONSTRUCTION_WORK_PER_WORKER_PER_SEC * CONSTRUCTION_MAX_BUILDERS);
  assert.ok(
    maxCrewSeconds <= 17,
    `${definition.label} should finish builder work in at most 17 seconds with a full crew`,
  );
}

assert.notEqual(
  constructionVisualSignature(0.1, 0.2, 0.2),
  constructionVisualSignature(0.65, 0.8, 1),
  'site signature must change with construction stage and delivered piles',
);

const mesh = createConstructionSiteMesh('village_storehouse', 0.55, 0.7, 1);
assert.equal(mesh.name, 'Construction site');
assert.ok(mesh.children.length >= 10, 'site should contain a foundation, frame, scaffold, and piles');
assert.ok(
  mesh.children.some((child) => child.position.y > 2),
  'mid-stage site should contain raised timber framing',
);

const constructionServer = read('server/src/simulation/construction.rs');
assert.match(constructionServer, /construction_reserved_timber/);
assert.match(constructionServer, /try_start_construction_supply_trip/);
assert.match(constructionServer, /available_construction_haulers/);
assert.match(constructionServer, /construction_progress/);
assert.match(constructionServer, /complete_site/);
const constructionDispatch = constructionServer.slice(
  constructionServer.indexOf('fn dispatch_reserved_stock'),
  constructionServer.indexOf('fn advance_builder_work'),
);
assert.doesNotMatch(
  constructionDispatch,
  /source\.assigned_labor\s*>\s*0/,
  'unstaffed completed sources must remain eligible for construction pickup',
);

const roadNetworkServer = read('server/src/roads/network.rs');
assert.match(
  roadNetworkServer,
  /heap_key\s*>\s*cost_to_key\(best\)/,
  'road search must compare stale heap entries in the same quantized domain',
);
assert.doesNotMatch(
  roadNetworkServer,
  /heap_key as f64 \/ 1000\.0\)\s*>\s*best/,
  'rounding a heap key back to metres can reject a fresh connected route',
);

const deliveryServer = read('server/src/simulation/delivery_trips.rs');
const constructionTrip = deliveryServer.slice(
  deliveryServer.indexOf('pub fn try_start_construction_supply_trip'),
  deliveryServer.indexOf('fn try_start_road_trip'),
);
assert.doesNotMatch(
  constructionTrip,
  /\|\|\s*origin\.assigned_labor\s*==\s*0/,
  'construction pickup must not require workers assigned to the material source',
);
assert.match(constructionTrip, /available_free_haulers\.min\(1\)/);
assert.match(
  constructionTrip,
  /STOREHOUSE_HAUL_PER_WORKER/,
  'staffed storehouses should retain a batch-hauling advantage',
);

const constructionInspector = read('src/resources/inspector/constructionRenderer.ts');
assert.doesNotMatch(constructionInspector, /Waiting for a staffed material source/);
assert.match(constructionInspector, /Unassigned hauler bringing/);
assert.match(constructionInspector, /No road route to/);
assert.match(constructionInspector, /Material source/);

const returningTrip: DeliveryTripState = {
  id: 'trip-1',
  buildingId: 'building-1',
  residenceId: null,
  destinationKind: 'building',
  targetBuildingId: 'building-2',
  cargoKind: 'stone',
  amount: 0,
  phase: 'inbound',
  x: 0,
  z: 0,
  progress: 0,
  speedMps: 1,
  unloadSeconds: 6,
  unloadRemaining: 0,
  deliveryWorkers: 1,
  pathDistance: 10,
  travelSpeedMultiplier: 1,
  routePolylineJson: '',
};
assert.equal(
  findInboundSupplyTripForBuilding([returningTrip], 'building-2'),
  null,
  'a cart returning empty must no longer appear as an incoming construction haul',
);
const outboundTrip: DeliveryTripState = { ...returningTrip, amount: 8, phase: 'outbound' };
assert.equal(findInboundSupplyTripForBuilding([outboundTrip], 'building-2'), outboundTrip);

const buildingState = (
  overrides: Partial<BuildingState> & Pick<BuildingState, 'id' | 'kind'>,
): BuildingState => ({
  id: overrides.id,
  kind: overrides.kind,
  x: 0,
  z: 0,
  workRadius: 0,
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
  constructionComplete: true,
  constructionProgress: 1,
  constructionRequiredTimber: 0,
  constructionRequiredStone: 0,
  constructionDeliveredTimber: 0,
  constructionDeliveredStone: 0,
  constructionReservedTimber: 0,
  constructionReservedStone: 0,
  constructionTreasuryTimber: 0,
  constructionTreasuryStone: 0,
  storehouseAcceptsTimber: true,
  storehouseAcceptsStone: true,
  storehouseAcceptsFirewood: true,
  ...overrides,
});
const site = buildingState({
  id: 'site',
  kind: 'lumber_mill',
  x: 30,
  assignedLabor: 4,
  constructionComplete: false,
  constructionProgress: 0.75,
  constructionRequiredTimber: 45,
  constructionRequiredStone: 15,
  constructionDeliveredTimber: 45,
  constructionReservedStone: 15,
});
const stoneSource = buildingState({
  id: 'quarry',
  kind: 'stone_quarry',
  stone: 200,
});
const constructionContext = (
  sources: BuildingState[],
  available: number,
  pathDistance: number | null,
  inbound: DeliveryTripState | null = null,
) => {
  const buildings = new Map(sources.concat(site).map((building) => [building.id, building]));
  return {
    gameState: {
      buildings,
      deliveryTrips: new Map(inbound ? [[inbound.id, inbound]] : []),
    },
    worldQueries: {
      getInboundSupplyTrip: () => inbound,
      getBuilding: (id: string) => buildings.get(id) ?? null,
      getRoadPathDistance: () => pathDistance,
      getActiveDeliveryTrip: () => null,
      getRoadAccessLabel: () => 'Connected (5 m to road)',
    },
    populationStats: {
      total: 9,
      assigned: 4,
      available,
      housingCapacity: 4,
      housed: 4,
      vacant: 0,
    },
    resourceTotals: {},
  };
};
const siteTarget = { kind: 'building' as const, building: site };

assert.equal(
  renderConstructionInspector(
    siteTarget,
    constructionContext([stoneSource], 5, 30) as never,
  ).statusText,
  "Unassigned worker fetching 15 stone from Stonecutter's camp",
);
assert.equal(
  renderConstructionInspector(
    siteTarget,
    constructionContext([stoneSource], 0, 30) as never,
  ).statusText,
  "Waiting for an unassigned hauler — 15 stone is at Stonecutter's camp",
);
assert.equal(
  renderConstructionInspector(
    siteTarget,
    constructionContext([stoneSource], 5, null) as never,
  ).statusText,
  "No road route to 15 stone at Stonecutter's camp",
);
const staffedStorehouse = buildingState({
  id: 'storehouse',
  kind: 'village_storehouse',
  stone: 100,
  assignedLabor: 1,
});
assert.equal(
  renderConstructionInspector(
    siteTarget,
    constructionContext([stoneSource, staffedStorehouse], 5, 30) as never,
  ).statusText,
  'Storehouse crew preparing 15 stone',
);
const visibleInbound = {
  ...outboundTrip,
  buildingId: stoneSource.id,
  targetBuildingId: site.id,
};
assert.equal(
  renderConstructionInspector(
    siteTarget,
    constructionContext([stoneSource], 5, 30, visibleInbound) as never,
  ).statusText,
  "Unassigned hauler bringing 8 stone from Stonecutter's camp",
);

const placementServer = read('server/src/reducers/buildings.rs');
assert.match(placementServer, /construction_complete: false/);
assert.match(placementServer, /construction_treasury_reservation/);
assert.match(placementServer, /initial_construction_labor/);
assert.doesNotMatch(
  placementServer.slice(
    placementServer.indexOf('pub fn place_building'),
    placementServer.indexOf('pub fn assign_building_labor'),
  ),
  /assigned_labor:\s*0/,
  'new construction sites must not silently start with zero builders when labor is available',
);
assert.doesNotMatch(
  placementServer.slice(
    placementServer.indexOf('pub fn place_building'),
    placementServer.indexOf('pub fn assign_building_labor'),
  ),
  /spend_aggregate_timber/,
  'building placement must reserve resources instead of consuming them instantly',
);

const simServer = read('server/src/reducers/simulation.rs');
assert.match(simServer, /step_construction_sites/);
assert.match(simServer, /if !building\.construction_complete/);

const woodcutterServer = read('server/src/simulation/woodcutters_lodge.rs');
assert.match(
  woodcutterServer,
  /available_unreserved_building_timber/,
  'firewood processing must not consume timber reserved for construction',
);

const generatedBuilding = read('src/generated/building_table.ts');
for (const field of [
  'constructionComplete',
  'constructionProgress',
  'constructionRequiredTimber',
  'constructionDeliveredStone',
  'constructionReservedTimber',
  'constructionTreasuryStone',
]) {
  assert.match(generatedBuilding, new RegExp(field), `generated binding missing ${field}`);
}

console.log('construction logistics tests passed');
