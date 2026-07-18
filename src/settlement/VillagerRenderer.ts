import * as THREE from 'three';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import type {
  BuildingState,
  FarmFieldState,
  ForagingNodeState,
  PastureState,
  ResourceNodeState,
  ResidenceState,
  TreeEntityState,
  TreeLayoutEntry,
} from '../resources/types.ts';
import { polylineLengthXZ, samplePolylineXZ, type PointXZ } from '../utils/pathGeometry.ts';
import {
  CROWD_SIM_DT,
  isWithinCrowdView,
  type CrowdViewState,
} from './crowdView.ts';
import {
  SettlementCrowdRenderer,
  type CrowdRenderAgent,
  type VillagerModelVariant,
} from './SettlementCrowdRenderer.ts';
import {
  MAX_VILLAGERS_TOTAL,
  computeVillagerSlots,
  findNearestRoadEdgePath,
  pickIdleDuration,
  pickIdleOffset,
  pickVillagerAppearanceSeed,
  pickVillagerColors,
  pickVillagerHairColor,
  pickVillagerModelVariant,
  pickVillagerWalkPath,
  pickWalkSpeed,
  residenceDoorPosition,
} from './villagerPaths.ts';
import {
  allocateProductionWorkers,
  collectWorkerTargets,
  pickWorkerWalkPath,
  workplaceYardPosition,
  type WorkerTarget,
} from './workerPaths.ts';

type VillagerMode = 'idle' | 'walk';
type VillagerRole = 'resident' | 'worker';

type VillagerAgent = {
  id: string;
  role: VillagerRole;
  residenceId: string | null;
  workplaceId: string | null;
  workplaceSlot: number;
  slotIndex: number;
  mode: VillagerMode;
  path: PointXZ[];
  pathDistance: number;
  pathCursor: number;
  simPathCursor: number;
  displayPathCursor: number;
  idleRemaining: number;
  walkSpeed: number;
  appearanceSeed: number;
  modelVariant: VillagerModelVariant;
  tunicColor: number;
  skinColor: number;
  hairColor: number;
  idleOffset: { x: number; z: number; yaw: number };
  pathSeed: number;
  idleDirty: boolean;
  nearestEdge: { path: PointXZ[]; distance: number } | null;
  x: number;
  z: number;
  y: number;
  yaw: number;
  simAccumulator: number;
  frozen: boolean;
};

export type VillagerRendererOptions = {
  parent: THREE.Group;
  getHeightAt: (x: number, z: number) => number;
  getRoadDeckY?: (x: number, z: number) => number | null;
};

export class VillagerRenderer {
  private readonly renderer: SettlementCrowdRenderer;
  private readonly getHeightAt: (x: number, z: number) => number;
  private readonly getRoadDeckY: ((x: number, z: number) => number | null) | null;
  private readonly agents = new Map<string, VillagerAgent>();
  private residences = new Map<string, ResidenceState>();
  private buildings = new Map<string, BuildingState>();
  private workerTargets = new Map<string, WorkerTarget[]>();
  private roadNetwork: RoadNetwork | null = null;
  private lastView: CrowdViewState | undefined;

  constructor(options: VillagerRendererOptions) {
    this.getHeightAt = options.getHeightAt;
    this.getRoadDeckY = options.getRoadDeckY ?? null;
    this.renderer = new SettlementCrowdRenderer({ parent: options.parent });
  }

  sync(options: {
    residences: Iterable<ResidenceState>;
    buildings: Iterable<BuildingState>;
    quarries: Iterable<ResourceNodeState>;
    foragingNodes: Iterable<ForagingNodeState>;
    trees: ReadonlyMap<string, TreeEntityState>;
    treeRegistry: {
      treesInRadius(x: number, z: number, radius: number): TreeLayoutEntry[];
    } | null;
    farmFields: Iterable<FarmFieldState>;
    pastures: Iterable<PastureState>;
    roadNetwork: RoadNetwork | null;
  }): void {
    const previousResidences = this.residences;
    const previousBuildings = this.buildings;
    const residences = [...options.residences];
    const buildings = [...options.buildings];
    const quarries = [...options.quarries];
    const foragingNodes = [...options.foragingNodes];
    const farmFields = [...options.farmFields];
    const pastures = [...options.pastures];
    this.residences = new Map(residences.map((residence) => [residence.id, residence]));
    this.buildings = new Map(buildings.map((building) => [building.id, building]));
    this.roadNetwork = options.roadNetwork;

    const roster = allocateProductionWorkers(residences, buildings);
    const slots = computeVillagerSlots(
      residences,
      this.roadNetwork,
      roster.remainingPopulationByResidence,
      Math.max(0, MAX_VILLAGERS_TOTAL - roster.assignments.length),
    );
    const nextIds = new Set<string>();

    for (const [residenceId, count] of slots) {
      const residence = this.residences.get(residenceId);
      if (!residence) continue;

      const nearestEdge = this.roadNetwork
        ? findNearestRoadEdgePath(this.roadNetwork, residence.x, residence.z)
        : null;

      for (let slotIndex = 0; slotIndex < count; slotIndex++) {
        const id = `resident:${residenceId}:${slotIndex}`;
        nextIds.add(id);

        let agent = this.agents.get(id);
        if (!agent) {
          const appearanceSeed = pickVillagerAppearanceSeed(residenceId, slotIndex);
          const colors = pickVillagerColors(appearanceSeed);
          agent = {
            id,
            role: 'resident',
            residenceId,
            workplaceId: null,
            workplaceSlot: -1,
            slotIndex,
            mode: 'idle',
            path: [],
            pathDistance: 0,
            pathCursor: 0,
            simPathCursor: 0,
            displayPathCursor: 0,
            idleRemaining: pickIdleDuration(appearanceSeed),
            walkSpeed: pickWalkSpeed(appearanceSeed),
            appearanceSeed,
            modelVariant: pickVillagerModelVariant(appearanceSeed),
            tunicColor: colors.tunic,
            skinColor: colors.skin,
            hairColor: pickVillagerHairColor(appearanceSeed),
            idleOffset: pickIdleOffset(residenceId, slotIndex),
            pathSeed: appearanceSeed ^ 0x85ebca6b,
            idleDirty: true,
            nearestEdge,
            x: residence.x,
            z: residence.z,
            y: 0,
            yaw: residence.yaw,
            simAccumulator: 0,
            frozen: false,
          };
          this.agents.set(id, agent);
        } else {
          agent.role = 'resident';
          agent.residenceId = residenceId;
          agent.workplaceId = null;
          agent.workplaceSlot = -1;
          agent.nearestEdge = nearestEdge;
          const previousResidence = previousResidences.get(residenceId);
          if (
            !previousResidence
            || previousResidence.x !== residence.x
            || previousResidence.z !== residence.z
            || previousResidence.yaw !== residence.yaw
          ) {
            agent.idleDirty = true;
          }
        }
      }
    }

    const targetInputs = {
      quarries,
      foragingNodes,
      trees: options.trees,
      treeRegistry: options.treeRegistry,
      farmFields,
      pastures,
    };
    const workerBuildingIds = new Set(roster.assignments.map((assignment) => assignment.buildingId));
    this.workerTargets = new Map();
    for (const buildingId of workerBuildingIds) {
      const building = this.buildings.get(buildingId);
      if (!building) continue;
      this.workerTargets.set(buildingId, collectWorkerTargets(building, targetInputs));
    }

    for (const assignment of roster.assignments) {
      const building = this.buildings.get(assignment.buildingId);
      if (!building) continue;
      nextIds.add(assignment.id);

      const appearanceSeed = pickVillagerAppearanceSeed(assignment.personIdentity, 0);
      let agent = this.agents.get(assignment.id);
      if (!agent) {
        const colors = pickVillagerColors(appearanceSeed);
        const yard = workplaceYardPosition(building, assignment.slotIndex);
        agent = {
          id: assignment.id,
          role: 'worker',
          residenceId: assignment.homeResidenceId,
          workplaceId: assignment.buildingId,
          workplaceSlot: assignment.slotIndex,
          slotIndex: assignment.slotIndex,
          mode: 'idle',
          path: [],
          pathDistance: 0,
          pathCursor: 0,
          simPathCursor: 0,
          displayPathCursor: 0,
          idleRemaining: pickIdleDuration(appearanceSeed) * 0.55,
          walkSpeed: pickWalkSpeed(appearanceSeed),
          appearanceSeed,
          modelVariant: pickVillagerModelVariant(appearanceSeed),
          tunicColor: colors.tunic,
          skinColor: colors.skin,
          hairColor: pickVillagerHairColor(appearanceSeed),
          idleOffset: pickIdleOffset(assignment.personIdentity, assignment.slotIndex),
          pathSeed: appearanceSeed ^ 0x27d4eb2d,
          idleDirty: true,
          nearestEdge: null,
          x: yard.x,
          z: yard.z,
          y: 0,
          yaw: yard.yaw,
          simAccumulator: 0,
          frozen: false,
        };
        this.agents.set(assignment.id, agent);
      } else {
        agent.role = 'worker';
        agent.residenceId = assignment.homeResidenceId;
        agent.workplaceId = assignment.buildingId;
        agent.workplaceSlot = assignment.slotIndex;
        agent.slotIndex = assignment.slotIndex;
        agent.nearestEdge = null;
        if (agent.appearanceSeed !== appearanceSeed) {
          const colors = pickVillagerColors(appearanceSeed);
          agent.appearanceSeed = appearanceSeed;
          agent.modelVariant = pickVillagerModelVariant(appearanceSeed);
          agent.tunicColor = colors.tunic;
          agent.skinColor = colors.skin;
          agent.hairColor = pickVillagerHairColor(appearanceSeed);
          agent.walkSpeed = pickWalkSpeed(appearanceSeed);
        }
        const previousBuilding = previousBuildings.get(assignment.buildingId);
        if (
          !previousBuilding
          || previousBuilding.x !== building.x
          || previousBuilding.z !== building.z
        ) {
          agent.idleDirty = true;
        }
      }
    }

    for (const id of [...this.agents.keys()]) {
      if (nextIds.has(id)) continue;
      this.agents.delete(id);
    }

    for (const agent of this.agents.values()) {
      if (agent.mode !== 'idle' || !agent.idleDirty) continue;
      if (agent.role === 'worker') {
        const building = agent.workplaceId ? this.buildings.get(agent.workplaceId) : null;
        if (building) this.placeWorkerIdle(agent, building);
      } else {
        const residence = agent.residenceId ? this.residences.get(agent.residenceId) : null;
        if (residence) this.placeIdle(agent, residence);
      }
      agent.idleDirty = false;
    }

    this.pushRenderState();
  }

  tick(dt: number, view?: CrowdViewState): void {
    this.lastView = view;

    for (const agent of this.agents.values()) {
      if (agent.role === 'worker') {
        const workplace = agent.workplaceId ? this.buildings.get(agent.workplaceId) : null;
        if (!workplace || workplace.assignedLabor <= agent.workplaceSlot) {
          agent.frozen = true;
          continue;
        }
      } else {
        const residence = agent.residenceId ? this.residences.get(agent.residenceId) : null;
        if (!residence || residence.abandoned || residence.population <= 0) {
          agent.frozen = true;
          continue;
        }
      }

      agent.frozen = !isWithinCrowdView(agent.x, agent.z, view);
      if (agent.frozen) continue;

      agent.simAccumulator += dt;
      while (agent.simAccumulator >= CROWD_SIM_DT) {
        this.simStep(agent, CROWD_SIM_DT);
        agent.simAccumulator -= CROWD_SIM_DT;
      }

      this.interpolateDisplay(agent, dt);
      agent.x = this.readDisplayX(agent);
      agent.z = this.readDisplayZ(agent);
      agent.yaw = this.readDisplayYaw(agent);
      agent.y = this.resolveGroundY(agent.x, agent.z) + 0.02;
    }

    this.pushRenderState(view, dt);
  }

  dispose(): void {
    this.agents.clear();
    this.renderer.dispose();
  }

  private pushRenderState(view?: CrowdViewState, dt = 0): void {
    const renderAgents: CrowdRenderAgent[] = [];
    let slot = 0;
    for (const agent of this.agents.values()) {
      if (agent.role === 'worker') {
        const workplace = agent.workplaceId ? this.buildings.get(agent.workplaceId) : null;
        if (!workplace || workplace.assignedLabor <= agent.workplaceSlot) continue;
      } else {
        const residence = agent.residenceId ? this.residences.get(agent.residenceId) : null;
        if (!residence || residence.abandoned || residence.population <= 0) continue;
      }
      renderAgents.push({
        id: agent.id,
        slot: slot++,
        x: agent.x,
        y: agent.y,
        z: agent.z,
        yaw: agent.yaw,
        appearanceSeed: agent.appearanceSeed,
        variant: agent.modelVariant,
        mode: agent.mode,
        tunicColor: agent.tunicColor,
        skinColor: agent.skinColor,
        hairColor: agent.hairColor,
        active: true,
      });
    }
    this.renderer.syncAgents(renderAgents, view ?? this.lastView, dt);
  }

  private simStep(agent: VillagerAgent, dt: number): void {
    if (agent.mode === 'idle') {
      agent.idleRemaining -= dt;
      if (agent.idleRemaining <= 0) {
        if (agent.role === 'worker') {
          this.tryBeginWorkerWalk(agent);
        } else {
          const residence = agent.residenceId ? this.residences.get(agent.residenceId) : null;
          if (residence) this.tryBeginWalk(agent, residence);
        }
      }
      return;
    }

    agent.simPathCursor += agent.walkSpeed * dt;
    agent.pathCursor = agent.simPathCursor;
    if (agent.simPathCursor >= agent.pathDistance) {
      if (agent.role === 'worker') {
        this.resetWorkerToIdle(agent);
      } else {
        const residence = agent.residenceId ? this.residences.get(agent.residenceId) : null;
        if (residence) this.resetToIdle(agent, residence);
      }
    }
  }

  private interpolateDisplay(agent: VillagerAgent, dt: number): void {
    if (agent.mode === 'idle') return;
    const blend = 1 - Math.exp(-dt * 18);
    agent.displayPathCursor += (agent.simPathCursor - agent.displayPathCursor) * blend;
  }

  private readDisplayX(agent: VillagerAgent): number {
    if (agent.mode === 'idle') return agent.x;
    const sample = samplePolylineXZ(agent.path, agent.displayPathCursor);
    return sample?.x ?? agent.x;
  }

  private readDisplayZ(agent: VillagerAgent): number {
    if (agent.mode === 'idle') return agent.z;
    const sample = samplePolylineXZ(agent.path, agent.displayPathCursor);
    return sample?.z ?? agent.z;
  }

  private readDisplayYaw(agent: VillagerAgent): number {
    if (agent.mode === 'idle') {
      if (agent.role === 'worker') return agent.yaw;
      const residence = agent.residenceId ? this.residences.get(agent.residenceId) : null;
      return residence ? residence.yaw + agent.idleOffset.yaw : agent.yaw;
    }
    const sample = samplePolylineXZ(agent.path, agent.displayPathCursor);
    return sample?.yaw ?? agent.yaw;
  }

  private tryBeginWalk(agent: VillagerAgent, residence: ResidenceState): void {
    if (!this.roadNetwork || this.roadNetwork.edges.size === 0) {
      agent.idleRemaining = pickIdleDuration(agent.pathSeed);
      return;
    }

    const path = pickVillagerWalkPath(
      residence,
      [...this.residences.values()],
      this.roadNetwork,
      agent.pathSeed,
      agent.nearestEdge,
    );
    agent.pathSeed = (agent.pathSeed * 1_664_525) ^ 0x7feb352d;

    const pathDistance = path ? polylineLengthXZ(path) : 0;
    if (!path || pathDistance < 4) {
      agent.idleRemaining = pickIdleDuration(agent.pathSeed);
      return;
    }

    agent.mode = 'walk';
    agent.path = path;
    agent.pathDistance = pathDistance;
    agent.pathCursor = 0;
    agent.simPathCursor = 0;
    agent.displayPathCursor = 0;
    agent.idleDirty = false;
  }

  private tryBeginWorkerWalk(agent: VillagerAgent): void {
    const building = agent.workplaceId ? this.buildings.get(agent.workplaceId) : null;
    if (!building) return;
    const targets = this.workerTargets.get(building.id) ?? [];
    const path = pickWorkerWalkPath(
      building,
      agent.workplaceSlot,
      targets,
      agent.pathSeed,
    );
    agent.pathSeed = (agent.pathSeed * 1_664_525) ^ 0x165667b1;

    const pathDistance = path ? polylineLengthXZ(path) : 0;
    if (!path || pathDistance < 4) {
      agent.idleRemaining = pickIdleDuration(agent.pathSeed) * 0.5;
      return;
    }

    agent.mode = 'walk';
    agent.path = path;
    agent.pathDistance = pathDistance;
    agent.pathCursor = 0;
    agent.simPathCursor = 0;
    agent.displayPathCursor = 0;
    agent.idleDirty = false;
  }

  private resetToIdle(agent: VillagerAgent, residence: ResidenceState): void {
    agent.mode = 'idle';
    agent.path = [];
    agent.pathDistance = 0;
    agent.pathCursor = 0;
    agent.simPathCursor = 0;
    agent.displayPathCursor = 0;
    agent.idleRemaining = pickIdleDuration(agent.pathSeed);
    agent.idleDirty = true;
    this.placeIdle(agent, residence);
    agent.idleDirty = false;
  }

  private resetWorkerToIdle(agent: VillagerAgent): void {
    const building = agent.workplaceId ? this.buildings.get(agent.workplaceId) : null;
    agent.mode = 'idle';
    agent.path = [];
    agent.pathDistance = 0;
    agent.pathCursor = 0;
    agent.simPathCursor = 0;
    agent.displayPathCursor = 0;
    agent.idleRemaining = pickIdleDuration(agent.pathSeed) * 0.45;
    agent.idleDirty = true;
    if (building) this.placeWorkerIdle(agent, building);
    agent.idleDirty = false;
  }

  private placeIdle(agent: VillagerAgent, residence: ResidenceState): void {
    const door = residenceDoorPosition(residence);
    const sin = Math.sin(residence.yaw);
    const cos = Math.cos(residence.yaw);
    const offsetX = agent.idleOffset.x * cos - agent.idleOffset.z * sin;
    const offsetZ = agent.idleOffset.x * sin + agent.idleOffset.z * cos;
    agent.x = door.x + offsetX;
    agent.z = door.z + offsetZ;
    agent.y = this.resolveGroundY(agent.x, agent.z) + 0.02;
    agent.yaw = residence.yaw + agent.idleOffset.yaw;
  }

  private placeWorkerIdle(agent: VillagerAgent, building: BuildingState): void {
    const yard = workplaceYardPosition(building, agent.workplaceSlot);
    agent.x = yard.x;
    agent.z = yard.z;
    agent.y = this.resolveGroundY(agent.x, agent.z) + 0.02;
    agent.yaw = yard.yaw;
  }

  private resolveGroundY(x: number, z: number): number {
    const deckY = this.getRoadDeckY?.(x, z);
    if (deckY != null) return deckY;
    return this.getHeightAt(x, z);
  }
}
