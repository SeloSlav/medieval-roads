import { BUILDING_ROAD_ACCESS_DISTANCE } from '../generated/gameBalance.ts';
import { roadPathRoute } from '../logistics/roadLogistics.ts';
import { MAIN_HOUSE_DEPTH } from '../residences/burgageLayout.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import type { ResidenceState } from '../resources/types.ts';
import {
  polylineLengthXZ,
  samplePolylineXZ,
  type PointXZ,
} from '../utils/pathGeometry.ts';
import { hashStringSeed, mulberry32 } from '../utils/random.ts';
import type { VillagerModelVariant } from './SettlementCrowdRenderer.ts';

export type { PointXZ as RoadPoint };

/** Hard ceiling for visible crowd agents in a developed city. */
export const MAX_VILLAGERS_TOTAL = 1024;
export const MAX_VILLAGERS_PER_RESIDENCE = 8;
/** One visible agent per N residents (representative density). */
export const POPULATION_DENSITY_RATIO = 5;
/** Minimum road metres allocated per walking agent. */
export const MIN_ROAD_METERS_PER_AGENT = 8;

export function residenceDoorPosition(residence: ResidenceState): PointXZ {
  const doorOffset = MAIN_HOUSE_DEPTH * 0.5 - 0.1;
  const sin = Math.sin(residence.yaw);
  const cos = Math.cos(residence.yaw);
  return {
    x: residence.x + sin * doorOffset,
    z: residence.z + cos * doorOffset,
  };
}

export function computeRoadSlotBudget(network: RoadNetwork | null): number {
  if (!network || network.edges.size === 0) return MAX_VILLAGERS_TOTAL;
  let totalLength = 0;
  for (const edge of network.edges.values()) {
    totalLength += edge.length;
  }
  return Math.min(MAX_VILLAGERS_TOTAL, Math.max(8, Math.floor(totalLength / MIN_ROAD_METERS_PER_AGENT)));
}

export function computeVillagerSlots(
  residences: readonly ResidenceState[],
  roadNetwork: RoadNetwork | null = null,
): Map<string, number> {
  const slots = new Map<string, number>();
  let total = 0;

  for (const residence of residences) {
    if (residence.abandoned || residence.population <= 0) continue;
    const count = Math.min(
      MAX_VILLAGERS_PER_RESIDENCE,
      Math.max(1, Math.ceil(residence.population / POPULATION_DENSITY_RATIO)),
    );
    slots.set(residence.id, count);
    total += count;
  }

  const roadBudget = computeRoadSlotBudget(roadNetwork);
  const cap = Math.min(MAX_VILLAGERS_TOTAL, roadBudget);
  if (total <= cap) return slots;

  const entries = [...slots.entries()].sort((a, b) => b[1] - a[1]);
  const trimmed = new Map<string, number>();
  let remaining = cap;
  for (const [id, count] of entries) {
    if (remaining <= 0) break;
    const kept = Math.min(count, remaining);
    trimmed.set(id, kept);
    remaining -= kept;
  }
  return trimmed;
}

export function findNearestRoadEdgePath(
  network: RoadNetwork,
  x: number,
  z: number,
): { path: PointXZ[]; distance: number } | null {
  const nearest = network.getSpatialIndex().findNearestEdgePath(x, z, BUILDING_ROAD_ACCESS_DISTANCE);
  if (!nearest) return null;
  return {
    path: nearest.path.map((point) => ({ x: point.x, z: point.z })),
    distance: nearest.distance,
  };
}

export function pickVillagerWalkPath(
  residence: ResidenceState,
  residences: readonly ResidenceState[],
  network: RoadNetwork,
  seed: number,
  nearestEdge: { path: PointXZ[]; distance: number } | null,
): PointXZ[] | null {
  const rng = mulberry32(seed);
  const door = residenceDoorPosition(residence);

  if (nearestEdge && nearestEdge.distance <= BUILDING_ROAD_ACCESS_DISTANCE && rng() < 0.72) {
    const wander = pickLocalRoadWander(door, nearestEdge, seed);
    if (wander) return wander;
  }

  const candidates = residences.filter(
    (other) =>
      other.id !== residence.id
      && !other.abandoned
      && other.population > 0,
  );
  if (candidates.length > 0) {
    const shuffled = [...candidates].sort(() => rng() - 0.5);
    for (const target of shuffled.slice(0, 4)) {
      const targetDoor = residenceDoorPosition(target);
      const route = roadPathRoute(network, door.x, door.z, targetDoor.x, targetDoor.z);
      if (!route || route.distance < 6 || route.distance > 140) continue;
      return route.polyline;
    }
  }

  return pickLocalRoadWander(door, nearestEdge, seed);
}

function pickLocalRoadWander(
  door: PointXZ,
  nearestEdge: { path: PointXZ[]; distance: number } | null,
  seed: number,
): PointXZ[] | null {
  if (!nearestEdge || nearestEdge.distance > BUILDING_ROAD_ACCESS_DISTANCE) return null;

  const rng = mulberry32(seed ^ 0x9e3779b9);
  const totalLength = polylineLengthXZ(nearestEdge.path);
  if (totalLength < 8) return null;

  const wanderLength = 12 + rng() * 18;
  const startDistance = rng() * Math.max(1, totalLength - wanderLength);
  const endDistance = Math.min(totalLength, startDistance + wanderLength);
  const start = samplePolylineXZ(nearestEdge.path, startDistance);
  const end = samplePolylineXZ(nearestEdge.path, endDistance);
  if (!start || !end) return null;

  return [
    door,
    { x: start.x, z: start.z },
    { x: end.x, z: end.z },
    { x: start.x, z: start.z },
    door,
  ];
}

export function pickIdleOffset(residenceId: string, slotIndex: number): { x: number; z: number; yaw: number } {
  const rng = mulberry32(hashStringSeed(`${residenceId}:${slotIndex}`));
  const radius = 0.35 + rng() * 0.85;
  const angle = rng() * Math.PI * 2;
  return {
    x: Math.sin(angle) * radius,
    z: Math.cos(angle) * radius,
    yaw: angle + Math.PI + (rng() - 0.5) * 0.6,
  };
}

export function pickWalkSpeed(seed: number): number {
  const rng = mulberry32(seed);
  return 1.05 + rng() * 0.35;
}

export function pickIdleDuration(seed: number): number {
  const rng = mulberry32(seed);
  return 2.5 + rng() * 6.5;
}

export function pickVillagerAppearanceSeed(residenceId: string, slotIndex: number): number {
  return hashStringSeed(`villager:${residenceId}:${slotIndex}`);
}

export function pickVillagerColors(seed: number): { tunic: number; skin: number } {
  const rng = mulberry32(seed);
  const tunics = [0x6b4e38, 0x4a5c44, 0x5c4636, 0x3d4a62, 0x7a5e46, 0x556b48] as const;
  const skins = [0xd4a574, 0xc9956a, 0xe0b080, 0xbf8860] as const;
  const tunic = tunics[Math.floor(rng() * tunics.length)] ?? tunics[0];
  const skin = skins[Math.floor(rng() * skins.length)] ?? skins[0];
  return { tunic, skin };
}

/** Stable presentation gender so replicated villagers never flicker between models. */
export function pickVillagerModelVariant(seed: number): VillagerModelVariant {
  const rng = mulberry32(seed ^ 0x9e3779b9);
  return rng() < 0.5 ? 'man' : 'woman';
}

export function pickVillagerHairColor(seed: number): number {
  const rng = mulberry32(seed ^ 0x6c8e9cf5);
  const hair = [0x2f2119, 0x4a3022, 0x6b4b2d, 0x8a713e, 0x3b302b] as const;
  return hair[Math.floor(rng() * hair.length)] ?? hair[0];
}
