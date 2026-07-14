import { getBuildingDefinition } from '../buildings.ts';
import {
  FOOD_DELIVERY_SPEED_MPS,
  FOOD_DELIVERY_UNLOAD_SEC,
  GRAIN_TRANSFER_PER_TRIP,
  MONASTERY_CHARITY_FOOD_PER_DELIVERY,
  TIMBER_DELIVERY_SPEED_MPS,
  TIMBER_DELIVERY_UNLOAD_SEC,
} from '../../generated/gameBalance.ts';
import { roadDeliveryTripSeconds } from '../../logistics/deliveryLogistics.ts';
import type { BuildingKind, BuildingState, InspectableTarget } from '../types.ts';
import { buildingDemolishHint, buildingLaborView, buildingRoadAccessRow, buildingStorageRows, buildingWorkRadiusRow } from './buildingCommon.ts';
import { getBuildingProcessorStatus } from './buildingProcessorStatus.ts';
import { renderInboundSupplyRow, renderOutboundDeliveryRows, type DeliveryStatusContext } from './deliveryStatusRows.ts';
import type { DeliveryTripState } from '../../logistics/deliveryTrips.ts';
import type { InspectorRenderContext, InspectorView } from './renderInspectableTarget.ts';

const PROCESS: Record<string, string> = {
  threshing_barn: 'Farmstead crew works nearby drawn fields',
  watermill: 'Grain + river power → flour',
  granary: 'Flour + well water + firewood → staple food',
  brewery: 'Grain + water → ale',
  smokehouse: 'Fresh food + firewood → preserved food',
  apiary: 'Forest forage → honey + food',
  vineyard: 'Terraced vines → wine + food',
  monastery: 'Tithes + alms → charity, feasts, pilgrimages',
  carpenter: 'Timber → construction and cartwright support',
  ferry_landing: 'River crossing → regional trade income',
};

const OUTBOUND_SUPPLY_KINDS = new Set<BuildingKind>([
  'threshing_barn',
  'watermill',
  'granary',
  'brewery',
  'smokehouse',
  'monastery',
]);

function buildingHasOutboundStock(building: BuildingState): boolean {
  switch (building.kind) {
    case 'threshing_barn':
      return building.grain > 0;
    case 'watermill':
      return building.flour > 0;
    case 'granary':
      return building.food > 0;
    case 'brewery':
      return building.ale > 0;
    case 'smokehouse':
      return building.preservedFood > 0;
    case 'monastery':
      return building.food > 0;
    default:
      return false;
  }
}

function outboundDestinationLabel(building: BuildingState): string {
  switch (building.kind) {
    case 'threshing_barn':
      return 'Nearest road-linked mill or granary';
    case 'watermill':
      return 'Nearest road-linked granary';
    case 'granary':
      return 'Nearest road-linked smokehouse or home';
    case 'brewery':
      return 'Nearest road-linked monastery or tier-3 home';
    case 'smokehouse':
      return 'Nearest road-linked tier-2 home';
    case 'monastery':
      return 'Nearest covered home needing food';
    default:
      return 'Awaiting destination';
  }
}

function cargoPerTripLabel(building: BuildingState): string | null {
  switch (building.kind) {
    case 'threshing_barn':
    case 'watermill':
      return `${GRAIN_TRANSFER_PER_TRIP} per haul`;
    case 'monastery':
      return `${MONASTERY_CHARITY_FOOD_PER_DELIVERY} food per charity haul`;
    default:
      return null;
  }
}

function outboundTargetKinds(kind: BuildingKind): BuildingKind[] {
  switch (kind) {
    case 'threshing_barn':
      return ['watermill', 'brewery', 'granary', 'monastery'];
    case 'watermill':
      return ['granary'];
    case 'granary':
      return ['smokehouse'];
    case 'brewery':
      return ['monastery'];
    default:
      return [];
  }
}

function outboundTripTarget(
  building: BuildingState,
  context: InspectorRenderContext,
): { x: number; z: number } | null {
  const buildingTarget = context.worldQueries.findNearestRoadLinkedBuilding(
    building,
    outboundTargetKinds(building.kind),
  );
  if (buildingTarget) return buildingTarget;

  switch (building.kind) {
    case 'granary':
    case 'monastery':
      return context.worldQueries.findNearestRoadLinkedResidence(building, 1);
    case 'smokehouse':
      return context.worldQueries.findNearestRoadLinkedResidence(building, 2);
    case 'brewery':
      return context.worldQueries.findNearestRoadLinkedResidence(building, 3);
    default:
      return null;
  }
}

function plannedOutboundTripSeconds(
  building: BuildingState,
  context: InspectorRenderContext,
): number {
  const network = context.worldQueries.getRoadNetworkSnapshot();
  const target = outboundTripTarget(building, context);
  const speed = building.kind === 'monastery' || building.kind === 'granary' || building.kind === 'brewery' || building.kind === 'smokehouse'
    ? FOOD_DELIVERY_SPEED_MPS
    : TIMBER_DELIVERY_SPEED_MPS;
  const unload = building.kind === 'monastery' || building.kind === 'granary' || building.kind === 'brewery' || building.kind === 'smokehouse'
    ? FOOD_DELIVERY_UNLOAD_SEC
    : TIMBER_DELIVERY_UNLOAD_SEC;
  return roadDeliveryTripSeconds(network, building, target, speed, 1, unload);
}

function renderLogisticsRows(
  building: BuildingState,
  context: InspectorRenderContext,
): string {
  if (!OUTBOUND_SUPPLY_KINDS.has(building.kind)) return '';

  const roadAccess = context.worldQueries.getRoadAccessLabel(building.x, building.z);
  const onRoad = roadAccess.startsWith('Connected');
  const activeTrip = context.worldQueries.getActiveDeliveryTrip(building);
  const inboundTrip = context.worldQueries.getInboundSupplyTrip(building);
  const tripRemaining = context.worldQueries.getActiveTripRemainingSeconds(building);
  const destination = outboundDestinationLabel(building);
  const nearestTarget = outboundTripTarget(building, context);
  const pathDistance = nearestTarget
    ? context.worldQueries.getRoadPathDistance(building.x, building.z, nearestTarget.x, nearestTarget.z)
    : null;
  const deliveryContext: DeliveryStatusContext = {
    getRoadPathDistance: (ax: number, az: number, bx: number, bz: number) =>
      context.worldQueries.getRoadPathDistance(ax, az, bx, bz),
    getResidence: (id: string) => context.worldQueries.getResidence(id),
    getBuilding: (id: string) => context.worldQueries.getBuilding(id),
    getBuildingLabel: (kind: BuildingKind) => context.worldQueries.getBuildingLabel(kind),
    getActiveTripPathDistance: (trip: DeliveryTripState) => context.worldQueries.getActiveTripPathDistance(trip),
  };

  if (!onRoad) {
    return `<li><span>Deliveries</span><span>Off road — connect to dispatch hauls</span></li>`;
  }

  const requiresLabor = building.kind !== 'monastery';
  if (requiresLabor && building.assignedLabor === 0) {
    return `<li><span>Deliveries</span><span>Idle — assign workers to dispatch hauls</span></li>`;
  }

  if (activeTrip) {
    const tripPath = context.worldQueries.getActiveTripPathDistance(activeTrip);
    return renderOutboundDeliveryRows(
      activeTrip,
      tripRemaining,
      destination,
      tripPath,
      plannedOutboundTripSeconds(building, context),
      cargoPerTripLabel(building),
      deliveryContext,
    );
  }

  const inboundRow = renderInboundSupplyRow(inboundTrip, deliveryContext);
  if (inboundRow) return inboundRow;

  if (buildingHasOutboundStock(building)) {
    return renderOutboundDeliveryRows(
      null,
      null,
      destination,
      pathDistance,
      plannedOutboundTripSeconds(building, context),
      cargoPerTripLabel(building),
      deliveryContext,
    );
  }

  return `<li><span>Deliveries</span><span>Ready — awaiting cargo or destination</span></li>`;
}

export function renderExpandedBuildingInspector(
  target: Extract<InspectableTarget, { kind: 'building' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { building } = target;
  const definition = getBuildingDefinition(building.kind);
  const processorStatus = getBuildingProcessorStatus(building, context.worldQueries);
  const fallbackActive = definition.acceptsLabor ? building.assignedLabor > 0 : true;
  const logisticsRows = renderLogisticsRows(building, context);
  return {
    eyebrow: 'Settlement building',
    title: definition.label,
    statusText: processorStatus?.statusText ?? (fallbackActive ? 'Operating' : 'Awaiting workers'),
    statusState: processorStatus?.statusState ?? (fallbackActive ? 'active' : 'warning'),
    detailsHtml: `<li><span>Role</span><span>${PROCESS[building.kind] ?? 'Settlement service'}</span></li>${processorStatus?.waterDetailHtml ?? ''}${buildingStorageRows(building, building.kind)}${buildingRoadAccessRow(context.worldQueries, building)}${buildingWorkRadiusRow(building.kind)}${logisticsRows}`,
    demolish: { visible: true, hint: buildingDemolishHint(building.kind) },
    labor: buildingLaborView(building, context.populationStats),
  };
}
