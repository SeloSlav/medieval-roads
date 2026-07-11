import type { Terrain } from '../terrain/Terrain.ts';
import type { RiverField } from '../rivers/RiverField.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import {
  roadPathDistance,
  sortByRoadPathDistance,
} from '../logistics/roadLogistics.ts';
import {
  findServingChapel,
  hasRoadPathToBuildingKind as landmarkHasRoadPathToBuildingKind,
} from '../logistics/landmarkAccess.ts';
import {
  FoodDeliveryClaimQueries,
  LodgeDeliveryClaimQueries,
  WellDeliveryClaimQueries,
} from '../logistics/deliveryClaimQueries.ts';
import { findNearestResourceNodeWithRemaining } from './depletableNodes.ts';
import { findActiveTripForBuilding, tripRemainingSeconds } from '../logistics/deliveryTrips.ts';
import type { DeliveryTripState } from '../logistics/deliveryTrips.ts';
import {
  foodLaborSplit,
  foodSupplierDeliveryTripSeconds,
} from '../logistics/foodLogistics.ts';
import { lodgeDeliveryTripSeconds, lodgeLaborSplit } from '../logistics/lodgeLogistics.ts';
import {
  isResidenceInWellRange,
  wellDeliveryTripSeconds,
  wellLaborSplit,
} from '../logistics/waterLogistics.ts';
import { areRoadConnected, formatRoadAccess, nearestRoadDistance } from '../roads/roadConnectivity.ts';
import { backyardIconPosition } from '../residences/backyardPosition.ts';
import type { BuildingKind, BuildingState, BurgageZoneState, GameState, InspectableTarget, ResourceNodeState, ResidenceState } from './types.ts';
import type { WorldLayoutRegistry } from './WorldLayoutRegistry.ts';
import { buildingKindLabel, findNearestBuilding as findBuilding } from './WorldLayoutRegistry.ts';
import { countTreesNearBuilding } from './ForestVisualSync.ts';
import type { TreeRegistry } from './TreeRegistry.ts';
import { RESIDENCE_PICK_RADIUS } from '../residences/burgageLayout.ts';

const RIVER_INSPECT_MAX_SHORE = 8;
const NEAREST_ROAD_MAX_DISTANCE = 24;

function findNearestResidenceTarget(
  state: GameState,
  x: number,
  z: number,
): Extract<InspectableTarget, { kind: 'residence' }> | null {
  let bestResidence: ResidenceState | null = null;
  let bestDistance = Infinity;

  for (const residence of state.residences.values()) {
    const distance = Math.hypot(x - residence.x, z - residence.z);
    if (distance > RESIDENCE_PICK_RADIUS || distance >= bestDistance) continue;
    bestDistance = distance;
    bestResidence = residence;
  }

  if (!bestResidence) return null;

  const zone = state.burgageZones.get(bestResidence.zoneId);
  if (!zone) return null;

  let residenceCount = 0;
  for (const residence of state.residences.values()) {
    if (residence.zoneId === zone.id) residenceCount += 1;
  }

  return {
    kind: 'residence',
    residence: bestResidence,
    zone,
    residenceCount,
  };
}

function pickCloserTarget(
  buildingTarget: Extract<InspectableTarget, { kind: 'building' }>,
  residenceTarget: Extract<InspectableTarget, { kind: 'residence' }>,
  x: number,
  z: number,
): InspectableTarget {
  const buildingDistance = Math.hypot(x - buildingTarget.building.x, z - buildingTarget.building.z);
  const residenceDistance = Math.hypot(x - residenceTarget.residence.x, z - residenceTarget.residence.z);
  return residenceDistance < buildingDistance ? residenceTarget : buildingTarget;
}

function buildBackyardTarget(
  state: GameState,
  residence: ResidenceState,
  zone: BurgageZoneState,
): Extract<InspectableTarget, { kind: 'backyard' }> | null {
  if (!backyardIconPosition(residence, zone)) return null;
  return {
    kind: 'backyard',
    residence,
    zone,
    garden: state.backyardGardens.get(residence.id) ?? null,
  };
}

export class WorldQueries {
  private readonly terrain: Terrain;
  private readonly riverField: RiverField;
  private readonly registry: WorldLayoutRegistry;
  private readonly getGameState: () => GameState;
  private readonly getRoadNetwork: () => RoadNetwork;
  private readonly getTreeRegistry: () => TreeRegistry | null;

  constructor(options: {
    terrain: Terrain;
    riverField: RiverField;
    registry: WorldLayoutRegistry;
    getGameState: () => GameState;
    getRoadNetwork: () => RoadNetwork;
    getTreeRegistry: () => TreeRegistry | null;
  }) {
    this.terrain = options.terrain;
    this.riverField = options.riverField;
    this.registry = options.registry;
    this.getGameState = options.getGameState;
    this.getRoadNetwork = options.getRoadNetwork;
    this.getTreeRegistry = options.getTreeRegistry;
  }

  getHeightAt(x: number, z: number): number {
    return this.terrain.getHeightAt(x, z);
  }

  getRiverAccessInfo(x: number, z: number): { shoreDistance: number; onWater: boolean } {
    return {
      onWater: this.riverField.isRenderedWetAt(x, z),
      shoreDistance: this.riverField.sampleShoreDistance(x, z),
    };
  }

  getRiverField(): RiverField {
    return this.riverField;
  }

  findInspectableTarget(x: number, z: number): InspectableTarget | null {
    const state = this.getGameState();
    const backyardTarget = this.findNearestBackyardTarget(x, z);
    const building = findBuilding(state.buildings.values(), x, z);
    const residenceTarget = findNearestResidenceTarget(state, x, z);

    if (backyardTarget) {
      const backyardPos = backyardIconPosition(backyardTarget.residence, backyardTarget.zone);
      const backyardDistance = backyardPos ? Math.hypot(x - backyardPos.x, z - backyardPos.z) : Infinity;
      const residenceDistance = residenceTarget
        ? Math.hypot(x - residenceTarget.residence.x, z - residenceTarget.residence.z)
        : Infinity;
      if (backyardDistance + 0.5 < residenceDistance) {
        return backyardTarget;
      }
    }

    if (building && residenceTarget) {
      const treeRegistry = this.getTreeRegistry();
      const counts = treeRegistry
        ? countTreesNearBuilding(state, treeRegistry, building.x, building.z, building.workRadius)
        : { matureTrees: 0, stumpTrees: 0, growingTrees: 0 };
      return pickCloserTarget(
        {
          kind: 'building',
          building,
          matureTrees: counts.matureTrees,
          stumpTrees: counts.stumpTrees,
          growingTrees: counts.growingTrees,
        },
        residenceTarget,
        x,
        z,
      );
    }

    if (residenceTarget) return residenceTarget;

    if (building) {
      const treeRegistry = this.getTreeRegistry();
      const counts = treeRegistry
        ? countTreesNearBuilding(state, treeRegistry, building.x, building.z, building.workRadius)
        : { matureTrees: 0, stumpTrees: 0, growingTrees: 0 };
      return {
        kind: 'building',
        building,
        matureTrees: counts.matureTrees,
        stumpTrees: counts.stumpTrees,
        growingTrees: counts.growingTrees,
      };
    }

    const quarryDefinition = this.registry.findNearestQuarry(x, z);
    if (quarryDefinition) {
      const quarryState = state.quarries.get(quarryDefinition.id);
      if (quarryState) {
        return { kind: 'quarry', definition: quarryDefinition, state: quarryState };
      }
    }

    const gameDefinition = this.registry.findNearestForagingNode(x, z, 'game');
    if (gameDefinition) {
      const nodeState = state.foragingNodes.get(gameDefinition.id);
      if (nodeState && nodeState.remaining > 0) {
        return { kind: 'foraging', definition: gameDefinition, state: nodeState };
      }
    }

    const berryDefinition = this.registry.findNearestForagingNode(x, z, 'berries');
    if (berryDefinition) {
      const nodeState = state.foragingNodes.get(berryDefinition.id);
      if (nodeState && nodeState.remaining > 0) {
        return { kind: 'foraging', definition: berryDefinition, state: nodeState };
      }
    }

    const river = this.getRiverAccessInfo(x, z);
    if (river.onWater || river.shoreDistance <= RIVER_INSPECT_MAX_SHORE) {
      return { kind: 'river', x, z, ...river };
    }

    return null;
  }

  getNearestRoadNodeDistance(x: number, z: number): number | null {
    const network = this.getRoadNetwork();
    const distance = nearestRoadDistance(x, z, network);
    if (!Number.isFinite(distance) || distance > NEAREST_ROAD_MAX_DISTANCE) return null;
    return distance;
  }

  private deliverySnapshot() {
    const state = this.getGameState();
    return {
      network: this.getRoadNetwork(),
      buildings: [...state.buildings.values()],
      residences: [...state.residences.values()],
    };
  }

  private lodgeClaims(): LodgeDeliveryClaimQueries {
    const { network, buildings, residences } = this.deliverySnapshot();
    return new LodgeDeliveryClaimQueries(network, buildings, residences);
  }

  private wellClaims(): WellDeliveryClaimQueries {
    const { network, buildings, residences } = this.deliverySnapshot();
    return new WellDeliveryClaimQueries(network, buildings, residences);
  }

  private foodClaims(): FoodDeliveryClaimQueries {
    const { network, buildings, residences } = this.deliverySnapshot();
    return new FoodDeliveryClaimQueries(network, buildings, residences);
  }

  getRoadAccessLabel(x: number, z: number): string {
    return formatRoadAccess(nearestRoadDistance(x, z, this.getRoadNetwork()));
  }

  getClaimedResidencesForWell(well: BuildingState): ResidenceState[] {
    return this.wellClaims().getClaimedResidences(well);
  }

  getNextWaterDeliveryTargetForWell(well: BuildingState): ResidenceState | null {
    return this.wellClaims().peekNextTarget(well);
  }

  getRoadConnectedWells(building: BuildingState): BuildingState[] {
    const state = this.getGameState();
    const network = this.getRoadNetwork();
    const wells = [...state.buildings.values()].filter(
      (candidate) =>
        candidate.kind === 'well'
        && roadPathDistance(network, building.x, building.z, candidate.x, candidate.z) != null,
    );
    return sortByRoadPathDistance(network, building, wells);
  }

  getWellDeliveryTripSeconds(
    well: BuildingState,
    target: ResidenceState | null,
  ): number {
    return wellDeliveryTripSeconds(
      this.getRoadNetwork(),
      well,
      target,
      wellLaborSplit(well.assignedLabor).delivering,
    );
  }

  getServingWellForResidence(residence: ResidenceState): BuildingState | null {
    const wellId = this.wellClaims().getServingSupplierForResidence(residence.id);
    if (!wellId) return null;
    return this.getGameState().buildings.get(wellId) ?? null;
  }

  countRoadConnectedResidencesInWellRange(well: BuildingState): number {
    return this.getClaimedResidencesForWell(well).length;
  }

  countResidencesInWellRange(well: BuildingState): number {
    const state = this.getGameState();
    let count = 0;
    for (const residence of state.residences.values()) {
      if (isResidenceInWellRange(well, residence)) count += 1;
    }
    return count;
  }

  getRoadPathDistance(ax: number, az: number, bx: number, bz: number): number | null {
    return roadPathDistance(this.getRoadNetwork(), ax, az, bx, bz);
  }

  hasRoadPathToBuildingKind(ax: number, az: number, kind: BuildingKind): boolean {
    return landmarkHasRoadPathToBuildingKind(
      this.getGameState().buildings.values(),
      ax,
      az,
      kind,
      (a, b, c, d) => this.getRoadPathDistance(a, b, c, d),
    );
  }

  hasRoadPathToStaffedBuildingKind(ax: number, az: number, kind: BuildingKind): boolean {
    return landmarkHasRoadPathToBuildingKind(
      this.getGameState().buildings.values(),
      ax,
      az,
      kind,
      (a, b, c, d) => this.getRoadPathDistance(a, b, c, d),
      true,
    );
  }

  getServingChapelForResidence(residence: ResidenceState): BuildingState | null {
    const chapels = [...this.getGameState().buildings.values()].filter(
      (building) => building.kind === 'chapel',
    );
    return findServingChapel(
      residence,
      chapels,
      (a, b, c, d) => this.getRoadPathDistance(a, b, c, d),
    );
  }

  countRoadConnectedPopulation(building: BuildingState): number {
    const state = this.getGameState();
    const network = this.getRoadNetwork();
    let population = 0;
    for (const residence of state.residences.values()) {
      if (residence.abandoned || residence.population <= 0) continue;
      if (roadPathDistance(network, residence.x, residence.z, building.x, building.z) != null) {
        population += residence.population;
      }
    }
    return population;
  }

  countRoadConnectedResidences(building: BuildingState, requirePopulation = true): number {
    const state = this.getGameState();
    const network = this.getRoadNetwork();
    let count = 0;
    for (const residence of state.residences.values()) {
      if (residence.abandoned) continue;
      if (requirePopulation && residence.population <= 0) continue;
      if (roadPathDistance(network, residence.x, residence.z, building.x, building.z) != null) {
        count += 1;
      }
    }
    return count;
  }

  isResidenceConnectedToMarketplace(residence: ResidenceState): boolean {
    return this.hasRoadPathToBuildingKind(residence.x, residence.z, 'marketplace');
  }

  isResidenceConnectedToChapel(residence: ResidenceState): boolean {
    return this.getServingChapelForResidence(residence) != null;
  }

  getRoadConnectedMills(lodge: BuildingState): BuildingState[] {
    const state = this.getGameState();
    const network = this.getRoadNetwork();
    const mills = [...state.buildings.values()].filter(
      (building) =>
        building.kind === 'lumber_mill'
        && roadPathDistance(network, lodge.x, lodge.z, building.x, building.z) != null,
    );
    return sortByRoadPathDistance(network, lodge, mills);
  }

  getClaimedResidencesForLodge(lodge: BuildingState): ResidenceState[] {
    return this.lodgeClaims().getClaimedResidences(lodge);
  }

  getNextDeliveryTargetForLodge(lodge: BuildingState): ResidenceState | null {
    return this.lodgeClaims().peekNextTarget(lodge);
  }

  getServingLodgeForResidence(residence: ResidenceState): BuildingState | null {
    const lodgeId = this.lodgeClaims().getServingSupplierForResidence(residence.id);
    if (!lodgeId) return null;
    return this.getGameState().buildings.get(lodgeId) ?? null;
  }

  getServingFoodSupplierForResidence(residence: ResidenceState): BuildingState | null {
    const supplierId = this.foodClaims().getServingSupplierForResidence(residence.id);
    if (!supplierId) return null;
    return this.getGameState().buildings.get(supplierId) ?? null;
  }

  getClaimedResidencesForFoodSupplier(supplier: BuildingState): ResidenceState[] {
    return this.foodClaims().getClaimedResidences(supplier);
  }

  getNextFoodDeliveryTargetForSupplier(supplier: BuildingState): ResidenceState | null {
    return this.foodClaims().peekNextTarget(supplier);
  }

  getFoodDeliveryTripSeconds(
    supplier: BuildingState,
    target: ResidenceState | null,
  ): number {
    return foodSupplierDeliveryTripSeconds(
      this.getRoadNetwork(),
      supplier,
      target,
      foodLaborSplit(supplier.assignedLabor).delivering,
    );
  }

  getLodgeDeliveryTripSeconds(
    lodge: BuildingState,
    target: ResidenceState | null,
  ): number {
    return lodgeDeliveryTripSeconds(
      this.getRoadNetwork(),
      lodge,
      target,
      lodgeLaborSplit(lodge.assignedLabor).delivering,
    );
  }

  getActiveDeliveryTrip(building: BuildingState): DeliveryTripState | null {
    return findActiveTripForBuilding(this.getGameState().deliveryTrips.values(), building.id);
  }

  getActiveTripPathDistance(trip: DeliveryTripState): number | null {
    const building = this.getGameState().buildings.get(trip.buildingId);
    const residence = this.getGameState().residences.get(trip.residenceId);
    if (!building || !residence) return null;
    return roadPathDistance(
      this.getRoadNetwork(),
      building.x,
      building.z,
      residence.x,
      residence.z,
    );
  }

  getActiveTripRemainingSeconds(building: BuildingState): number | null {
    const trip = this.getActiveDeliveryTrip(building);
    if (!trip) return null;
    return tripRemainingSeconds(trip, this.getActiveTripPathDistance(trip));
  }

  getResidence(residenceId: string): ResidenceState | null {
    return this.getGameState().residences.get(residenceId) ?? null;
  }

  isRoadConnected(ax: number, az: number, bx: number, bz: number): boolean {
    return areRoadConnected(ax, az, bx, bz, this.getRoadNetwork());
  }

  getBuildingLabel(kind: Parameters<typeof buildingKindLabel>[0]): string {
    return buildingKindLabel(kind);
  }

  findQuarryTarget(quarryId: string): Extract<InspectableTarget, { kind: 'quarry' }> | null {
    const definition = this.registry.getDefinition(quarryId);
    if (!definition || definition.kind !== 'quarry') return null;

    const quarryState = this.getGameState().quarries.get(quarryId);
    if (!quarryState) return null;

    return { kind: 'quarry', definition, state: quarryState };
  }

  findNearestQuarryWithRemaining(x: number, z: number, radius: number): ResourceNodeState | null {
    return findNearestResourceNodeWithRemaining(this.getGameState().quarries.values(), x, z, radius, 'quarry');
  }

  findForagingTarget(nodeId: string): Extract<InspectableTarget, { kind: 'foraging' }> | null {
    const definition = this.registry.getDefinition(nodeId);
    if (!definition || (definition.kind !== 'game' && definition.kind !== 'berries')) return null;

    const state = this.getGameState().foragingNodes.get(nodeId);
    if (!state) return null;

    return { kind: 'foraging', definition, state };
  }

  findBackyardTarget(residenceId: string): Extract<InspectableTarget, { kind: 'backyard' }> | null {
    const state = this.getGameState();
    const residence = state.residences.get(residenceId);
    if (!residence) return null;

    const zone = state.burgageZones.get(residence.zoneId);
    if (!zone) return null;

    return buildBackyardTarget(state, residence, zone);
  }

  findNearestBackyardTarget(x: number, z: number, radius = 7): Extract<InspectableTarget, { kind: 'backyard' }> | null {
    const state = this.getGameState();
    let best: Extract<InspectableTarget, { kind: 'backyard' }> | null = null;
    let bestDistance = Infinity;

    for (const residence of state.residences.values()) {
      if (residence.abandoned) continue;
      const zone = state.burgageZones.get(residence.zoneId);
      if (!zone) continue;
      const position = backyardIconPosition(residence, zone);
      if (!position) continue;
      const distance = Math.hypot(x - position.x, z - position.z);
      if (distance > radius || distance >= bestDistance) continue;
      bestDistance = distance;
      best = buildBackyardTarget(state, residence, zone);
    }

    return best;
  }

  findNearestForagingWithRemaining(
    x: number,
    z: number,
    radius: number,
    nodeKind: 'game' | 'berries',
  ): ResourceNodeState | null {
    return findNearestResourceNodeWithRemaining(
      this.getGameState().foragingNodes.values(),
      x,
      z,
      radius,
      nodeKind,
    );
  }
}
