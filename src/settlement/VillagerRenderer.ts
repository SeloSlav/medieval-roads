import * as THREE from 'three';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import type { ResidenceState } from '../resources/types.ts';
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

type VillagerMode = 'idle' | 'walk';

type VillagerAgent = {
  id: string;
  residenceId: string;
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
  private roadNetwork: RoadNetwork | null = null;
  private lastView: CrowdViewState | undefined;

  constructor(options: VillagerRendererOptions) {
    this.getHeightAt = options.getHeightAt;
    this.getRoadDeckY = options.getRoadDeckY ?? null;
    this.renderer = new SettlementCrowdRenderer({ parent: options.parent });
  }

  sync(options: {
    residences: Iterable<ResidenceState>;
    roadNetwork: RoadNetwork | null;
  }): void {
    this.residences = new Map([...options.residences].map((residence) => [residence.id, residence]));
    this.roadNetwork = options.roadNetwork;

    const slots = computeVillagerSlots([...this.residences.values()], this.roadNetwork);
    const nextIds = new Set<string>();

    for (const [residenceId, count] of slots) {
      const residence = this.residences.get(residenceId);
      if (!residence) continue;

      const nearestEdge = this.roadNetwork
        ? findNearestRoadEdgePath(this.roadNetwork, residence.x, residence.z)
        : null;

      for (let slotIndex = 0; slotIndex < count; slotIndex++) {
        const id = `${residenceId}:${slotIndex}`;
        nextIds.add(id);

        let agent = this.agents.get(id);
        if (!agent) {
          const appearanceSeed = pickVillagerAppearanceSeed(residenceId, slotIndex);
          const colors = pickVillagerColors(appearanceSeed);
          agent = {
            id,
            residenceId,
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
          agent.nearestEdge = nearestEdge;
          agent.idleDirty = true;
        }
      }
    }

    for (const id of [...this.agents.keys()]) {
      if (nextIds.has(id)) continue;
      this.agents.delete(id);
    }

    for (const agent of this.agents.values()) {
      const residence = this.residences.get(agent.residenceId);
      if (!residence || agent.mode !== 'idle') continue;
      if (!agent.idleDirty) continue;
      this.placeIdle(agent, residence);
      agent.idleDirty = false;
    }

    this.pushRenderState();
  }

  tick(dt: number, view?: CrowdViewState): void {
    this.lastView = view;

    for (const agent of this.agents.values()) {
      const residence = this.residences.get(agent.residenceId);
      if (!residence || residence.abandoned || residence.population <= 0) {
        agent.frozen = true;
        continue;
      }

      agent.frozen = !isWithinCrowdView(agent.x, agent.z, view);
      if (agent.frozen) continue;

      agent.simAccumulator += dt;
      while (agent.simAccumulator >= CROWD_SIM_DT) {
        this.simStep(agent, residence, CROWD_SIM_DT);
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
      const residence = this.residences.get(agent.residenceId);
      if (!residence || residence.abandoned || residence.population <= 0) continue;
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

  private simStep(agent: VillagerAgent, residence: ResidenceState, dt: number): void {
    if (agent.mode === 'idle') {
      agent.idleRemaining -= dt;
      if (agent.idleRemaining <= 0) {
        this.tryBeginWalk(agent, residence);
      }
      return;
    }

    agent.simPathCursor += agent.walkSpeed * dt;
    agent.pathCursor = agent.simPathCursor;
    if (agent.simPathCursor >= agent.pathDistance) {
      this.resetToIdle(agent, residence);
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
      const residence = this.residences.get(agent.residenceId);
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

  private resolveGroundY(x: number, z: number): number {
    const deckY = this.getRoadDeckY?.(x, z);
    if (deckY != null) return deckY;
    return this.getHeightAt(x, z);
  }
}
