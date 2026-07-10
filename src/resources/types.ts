import type { RoadNetworkSnapshot } from '../roads/RoadNetwork.ts';

export const RESOURCE_KINDS = ['stone', 'wood', 'water'] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

export const RESOURCE_NODE_KINDS = ['quarry'] as const;
export type ResourceNodeKind = (typeof RESOURCE_NODE_KINDS)[number];

export const TREE_PHASES = ['stump', 'growing', 'mature'] as const;
export type TreePhase = (typeof TREE_PHASES)[number];

export const BUILDING_KINDS = ['lumber_mill', 'reforester', 'woodcutters_lodge', 'stone_quarry'] as const;
export type BuildingKind = (typeof BUILDING_KINDS)[number];

export type ResourceNodeDefinition = {
  id: string;
  kind: ResourceNodeKind;
  resource: ResourceKind;
  x: number;
  z: number;
  label: string;
  maxYield: number;
  pickRadius: number;
  quarryKind?: 'large' | 'small';
};

export type QuarryNodeState = {
  nodeId: string;
  kind: ResourceNodeKind;
  resource: ResourceKind;
  remaining: number;
  maxYield: number;
  x: number;
  z: number;
};

export type TreeLayoutEntry = {
  id: string;
  layoutIndex: number;
  x: number;
  z: number;
  woodYield: number;
  form: 'narrow' | 'broad' | 'young' | 'midstory';
  species: string;
  scale: number;
};

export type TreeEntityState = {
  treeId: string;
  layoutIndex: number;
  phase: TreePhase;
  growthProgress: number;
};

export type BuildingState = {
  id: string;
  kind: BuildingKind;
  x: number;
  z: number;
  workRadius: number;
  actionCooldown: number;
};

export type BurgageFrontageEdge = 0 | 1 | 2 | 3;

export type BurgageZoneState = {
  id: string;
  cornerA: { x: number; z: number };
  cornerB: { x: number; z: number };
  cornerC: { x: number; z: number };
  cornerD: { x: number; z: number };
  frontageEdge: BurgageFrontageEdge;
  plotCount: number;
};

export type ResidenceState = {
  id: string;
  zoneId: string;
  parcelIndex: number;
  x: number;
  z: number;
  yaw: number;
};

export type ResourceStockpile = Record<ResourceKind, number>;

export type GameStateSnapshotV1 = {
  version: 1;
  seed: number;
  tick: number;
  stockpile: ResourceStockpile;
  nodes: QuarryNodeState[];
  roads: RoadNetworkSnapshot;
};

export type GameStateSnapshot = {
  version: 2;
  seed: number;
  tick: number;
  stockpile: ResourceStockpile;
  quarries: QuarryNodeState[];
  trees: TreeEntityState[];
  buildings: BuildingState[];
  roads: RoadNetworkSnapshot;
};

export type GameState = {
  seed: number;
  tick: number;
  stockpile: ResourceStockpile;
  quarries: Map<string, QuarryNodeState>;
  trees: Map<string, TreeEntityState>;
  buildings: Map<string, BuildingState>;
  burgageZones: Map<string, BurgageZoneState>;
  residences: Map<string, ResidenceState>;
  nextBuildingId: number;
};

export type InspectableTarget =
  | {
      kind: 'quarry';
      definition: ResourceNodeDefinition;
      state: QuarryNodeState;
    }
  | {
      kind: 'building';
      building: BuildingState;
      matureTrees: number;
      stumpTrees: number;
      growingTrees: number;
    }
  | {
      kind: 'river';
      x: number;
      z: number;
      shoreDistance: number;
      onWater: boolean;
    }
  | {
      kind: 'residence';
      residence: ResidenceState;
      zone: BurgageZoneState;
      residenceCount: number;
    };

export function createEmptyStockpile(): ResourceStockpile {
  return { stone: 0, wood: 0, water: 0 };
}

export function isResourceKind(value: string): value is ResourceKind {
  return (RESOURCE_KINDS as readonly string[]).includes(value);
}

export function isBuildingKind(value: string): value is BuildingKind {
  return (BUILDING_KINDS as readonly string[]).includes(value);
}

export function isTreePhase(value: string): value is TreePhase {
  return (TREE_PHASES as readonly string[]).includes(value);
}
