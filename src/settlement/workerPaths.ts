import type {
  BuildingKind,
  BuildingState,
  FarmFieldState,
  ForagingNodeState,
  PastureState,
  ResourceNodeState,
  ResidenceState,
  TreeEntityState,
  TreeLayoutEntry,
} from '../resources/types.ts';
import { getBuildingDefinition } from '../resources/buildings.ts';
import { polylineLengthXZ, type PointXZ } from '../utils/pathGeometry.ts';
import { hashStringSeed, mulberry32 } from '../utils/random.ts';

export const PRODUCTION_WORKPLACE_KINDS = [
  'lumber_mill',
  'reforester',
  'woodcutters_lodge',
  'stone_quarry',
  'hunters_hall',
  'foragers_shed',
  'threshing_barn',
  'pastoral_farmstead',
  'swineherd',
  'brewery',
  'smokehouse',
  'granary',
  'apiary',
  'watermill',
  'carpenter',
  'vineyard',
] as const satisfies readonly BuildingKind[];

const PRODUCTION_WORKPLACE_KIND_SET = new Set<BuildingKind>(PRODUCTION_WORKPLACE_KINDS);
const MAX_VISIBLE_WORKERS = 1024;
const MAX_TARGETS_PER_BUILDING = 96;
const MAX_PREFERRED_RESOURCE_WALK = 72;

export type WorkerAssignment = {
  id: string;
  buildingId: string;
  slotIndex: number;
  homeResidenceId: string | null;
  personIdentity: string;
};

export type WorkerRoster = {
  assignments: WorkerAssignment[];
  remainingPopulationByResidence: Map<string, number>;
};

export type WorkerTargetKind =
  | 'tree'
  | 'quarry'
  | 'game'
  | 'berries'
  | 'field'
  | 'pasture';

export type WorkerTarget = PointXZ & {
  id: string;
  kind: WorkerTargetKind;
};

export type WorkerTargetInputs = {
  quarries: Iterable<ResourceNodeState>;
  foragingNodes: Iterable<ForagingNodeState>;
  trees: ReadonlyMap<string, TreeEntityState>;
  treeRegistry: {
    treesInRadius(x: number, z: number, radius: number): TreeLayoutEntry[];
  } | null;
  farmFields: Iterable<FarmFieldState>;
  pastures: Iterable<PastureState>;
};

export function isProductionWorkplaceKind(kind: BuildingKind): boolean {
  return PRODUCTION_WORKPLACE_KIND_SET.has(kind);
}

/**
 * Claims real household members for visible production jobs. Nearest occupied
 * homes are used first; the settlement's unhoused starting population is the
 * fallback when there are more jobs than housed residents.
 */
export function allocateProductionWorkers(
  residences: readonly ResidenceState[],
  buildings: readonly BuildingState[],
): WorkerRoster {
  const activeResidences = residences
    .filter((residence) => !residence.abandoned && residence.population > 0)
    .sort((a, b) => a.id.localeCompare(b.id));
  const remainingPopulationByResidence = new Map(
    residences.map((residence) => [
      residence.id,
      residence.abandoned ? 0 : Math.max(0, residence.population),
    ]),
  );
  const assignments: WorkerAssignment[] = [];
  let fallbackPersonIndex = 0;

  const workplaces = buildings
    .filter((building) =>
      building.assignedLabor > 0 && isProductionWorkplaceKind(building.kind)
    )
    .sort((a, b) => a.id.localeCompare(b.id));

  for (const building of workplaces) {
    const workerCount = Math.max(0, Math.floor(building.assignedLabor));
    for (let slotIndex = 0; slotIndex < workerCount; slotIndex++) {
      if (assignments.length >= MAX_VISIBLE_WORKERS) break;

      let home: ResidenceState | null = null;
      let bestDistanceSq = Infinity;
      for (const residence of activeResidences) {
        if ((remainingPopulationByResidence.get(residence.id) ?? 0) <= 0) continue;
        const distanceSq = (residence.x - building.x) ** 2 + (residence.z - building.z) ** 2;
        if (
          distanceSq < bestDistanceSq
          || (distanceSq === bestDistanceSq && home && residence.id < home.id)
        ) {
          home = residence;
          bestDistanceSq = distanceSq;
        }
      }

      let personIdentity: string;
      if (home) {
        const remaining = remainingPopulationByResidence.get(home.id) ?? 0;
        const claimedIndex = Math.max(0, home.population - remaining);
        remainingPopulationByResidence.set(home.id, remaining - 1);
        personIdentity = `${home.id}:person:${claimedIndex}`;
      } else {
        personIdentity = `starting-population:${fallbackPersonIndex}`;
        fallbackPersonIndex += 1;
      }

      assignments.push({
        id: `worker:${building.id}:${slotIndex}`,
        buildingId: building.id,
        slotIndex,
        homeResidenceId: home?.id ?? null,
        personIdentity,
      });
    }
  }

  return { assignments, remainingPopulationByResidence };
}

export function collectWorkerTargets(
  building: BuildingState,
  inputs: WorkerTargetInputs,
): WorkerTarget[] {
  const definition = getBuildingDefinition(building.kind);
  const radius = Math.max(0, building.workRadius || definition.workRadius);
  const targets: WorkerTarget[] = [];

  if (building.kind === 'lumber_mill' || building.kind === 'swineherd') {
    collectTreeTargets(building, radius, inputs, (phase) => phase === 'mature', targets);
  } else if (building.kind === 'reforester') {
    collectTreeTargets(
      building,
      radius,
      inputs,
      (phase) => phase === 'stump' || phase === 'growing',
      targets,
    );
  }

  if (definition.requiresQuarryStone) {
    for (const node of inputs.quarries) {
      if (node.kind !== 'quarry' || node.remaining <= 0) continue;
      pushNodeInsideExtent(building, radius, node, 'quarry', targets);
    }
  }
  if (definition.requiresGame) {
    for (const node of inputs.foragingNodes) {
      if (node.kind !== 'game' || node.remaining <= 0) continue;
      pushNodeInsideExtent(building, radius, node, 'game', targets);
    }
  }
  if (definition.requiresBerries) {
    for (const node of inputs.foragingNodes) {
      if (node.kind !== 'berries' || node.remaining <= 0) continue;
      pushNodeInsideExtent(building, radius, node, 'berries', targets);
    }
  }

  if (building.kind === 'threshing_barn') {
    for (const field of inputs.farmFields) {
      if (field.farmsteadId !== building.id || field.priority <= 0) continue;
      const center = polygonCenter(field.corners);
      targets.push({ id: field.id, kind: 'field', ...center });
    }
  }
  if (building.kind === 'pastoral_farmstead' || building.kind === 'swineherd') {
    for (const pasture of inputs.pastures) {
      if (pasture.farmsteadId !== building.id) continue;
      const center = polygonCenter(pasture.corners);
      targets.push({ id: pasture.id, kind: 'pasture', ...center });
    }
  }

  targets.sort((a, b) => {
    const distanceA = distanceSq(building, a);
    const distanceB = distanceSq(building, b);
    return distanceA - distanceB || a.id.localeCompare(b.id);
  });
  return evenlyLimitTargets(targets, MAX_TARGETS_PER_BUILDING);
}

export function workplaceYardPosition(
  building: BuildingState,
  slotIndex: number,
): PointXZ & { yaw: number } {
  const definition = getBuildingDefinition(building.kind);
  const rng = mulberry32(hashStringSeed(`work-yard:${building.id}:${slotIndex}`));
  const angle = rng() * Math.PI * 2;
  const radius = Math.max(3.2, definition.pickRadius * (0.62 + rng() * 0.16));
  const x = building.x + Math.sin(angle) * radius;
  const z = building.z + Math.cos(angle) * radius;
  return {
    x,
    z,
    yaw: Math.atan2(building.x - x, building.z - z),
  };
}

export function pickWorkerWalkPath(
  building: BuildingState,
  slotIndex: number,
  targets: readonly WorkerTarget[],
  seed: number,
): PointXZ[] | null {
  const start = workplaceYardPosition(building, slotIndex);
  const rng = mulberry32(seed ^ hashStringSeed(building.id));

  if (targets.length > 0 && rng() < 0.82) {
    const preferred = targets.filter(
      (target) => Math.sqrt(distanceSq(building, target))
        <= Math.min(Math.max(1, building.workRadius), MAX_PREFERRED_RESOURCE_WALK),
    );
    const pool = preferred.length > 0 ? preferred : targets;
    const target = pool[Math.floor(rng() * pool.length)] ?? pool[0];
    if (target) {
      const path = resourceWorkLoop(building, start, target, rng);
      if (polylineLengthXZ(path) >= 4) return path;
    }
  }

  const localPath = workplaceLoop(building, start, slotIndex, rng);
  return polylineLengthXZ(localPath) >= 4 ? localPath : null;
}

function collectTreeTargets(
  building: BuildingState,
  radius: number,
  inputs: WorkerTargetInputs,
  acceptsPhase: (phase: TreeEntityState['phase']) => boolean,
  targets: WorkerTarget[],
): void {
  if (!inputs.treeRegistry || radius <= 0) return;
  for (const tree of inputs.treeRegistry.treesInRadius(building.x, building.z, radius)) {
    const entity = inputs.trees.get(tree.id);
    if (!entity || !acceptsPhase(entity.phase)) continue;
    targets.push({ id: tree.id, kind: 'tree', x: tree.x, z: tree.z });
  }
}

function pushNodeInsideExtent(
  building: BuildingState,
  radius: number,
  node: ResourceNodeState,
  kind: Extract<WorkerTargetKind, 'quarry' | 'game' | 'berries'>,
  targets: WorkerTarget[],
): void {
  if (radius <= 0 || distanceSq(building, node) > radius * radius) return;
  targets.push({ id: node.nodeId, kind, x: node.x, z: node.z });
}

function resourceWorkLoop(
  building: BuildingState,
  start: PointXZ,
  target: WorkerTarget,
  rng: () => number,
): PointXZ[] {
  const dx = target.x - start.x;
  const dz = target.z - start.z;
  const length = Math.max(0.001, Math.hypot(dx, dz));
  const normalX = -dz / length;
  const normalZ = dx / length;
  const bend = (rng() - 0.5) * Math.min(10, length * 0.24);
  const midpoint = clampToWorkExtent(building, {
    x: (start.x + target.x) * 0.5 + normalX * bend,
    z: (start.z + target.z) * 0.5 + normalZ * bend,
  });
  const approachAngle = rng() * Math.PI * 2;
  const approachRadius = target.kind === 'tree' ? 1.8 : 2.4;
  const approach = clampToWorkExtent(building, {
    x: target.x + Math.sin(approachAngle) * approachRadius,
    z: target.z + Math.cos(approachAngle) * approachRadius,
  });
  const workStep = 1.6 + rng() * 1.4;
  const around = clampToWorkExtent(building, {
    x: target.x + Math.sin(approachAngle + Math.PI * 0.62) * workStep,
    z: target.z + Math.cos(approachAngle + Math.PI * 0.62) * workStep,
  });
  return [
    start,
    midpoint,
    approach,
    around,
    approach,
    midpoint,
    start,
  ];
}

function workplaceLoop(
  building: BuildingState,
  start: PointXZ,
  slotIndex: number,
  rng: () => number,
): PointXZ[] {
  const definition = getBuildingDefinition(building.kind);
  const radius = Math.max(4, definition.pickRadius * (0.72 + rng() * 0.24));
  const startAngle = Math.atan2(start.x - building.x, start.z - building.z);
  const direction = slotIndex % 2 === 0 ? 1 : -1;
  const points: PointXZ[] = [start];
  for (let step = 1; step <= 3; step++) {
    const angle = startAngle + direction * step * (Math.PI * 0.48) + (rng() - 0.5) * 0.2;
    points.push({
      x: building.x + Math.sin(angle) * radius,
      z: building.z + Math.cos(angle) * radius,
    });
  }
  points.push(start);
  return points;
}

function clampToWorkExtent(building: BuildingState, point: PointXZ): PointXZ {
  if (building.workRadius <= 0) return point;
  const dx = point.x - building.x;
  const dz = point.z - building.z;
  const distance = Math.hypot(dx, dz);
  const limit = Math.max(1, building.workRadius - 0.75);
  if (distance <= limit) return point;
  const scale = limit / Math.max(0.001, distance);
  return {
    x: building.x + dx * scale,
    z: building.z + dz * scale,
  };
}

function polygonCenter(corners: FarmFieldState['corners']): PointXZ {
  let x = 0;
  let z = 0;
  for (const corner of corners) {
    x += corner.x;
    z += corner.z;
  }
  return { x: x / corners.length, z: z / corners.length };
}

function evenlyLimitTargets(
  targets: readonly WorkerTarget[],
  limit: number,
): WorkerTarget[] {
  if (targets.length <= limit) return [...targets];
  const result: WorkerTarget[] = [];
  for (let index = 0; index < limit; index++) {
    const sourceIndex = Math.floor(index * targets.length / limit);
    const target = targets[sourceIndex];
    if (target) result.push(target);
  }
  return result;
}

function distanceSq(a: PointXZ, b: PointXZ): number {
  return (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
}
