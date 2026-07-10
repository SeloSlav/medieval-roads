import type { RoadNetwork } from './RoadNetwork.ts';
import { distancePointToPolylineXZ } from '../utils/pathGeometry.ts';
import type { BuildingState, ResidenceState } from '../resources/types.ts';
import { BUILDING_ROAD_ACCESS_DISTANCE, BURGAGE_ROAD_FRONTAGE_DISTANCE } from '../generated/gameBalance.ts';

export { BUILDING_ROAD_ACCESS_DISTANCE, BURGAGE_ROAD_FRONTAGE_DISTANCE };

type RoadGraph = {
  nodes: Map<string, { x: number; z: number }>;
  adjacency: Map<string, string[]>;
  edgePaths: Array<{ startNodeId: string; endNodeId: string; path: Array<{ x: number; z: number }> }>;
};

export function nearestRoadDistance(x: number, z: number, network: RoadNetwork): number {
  return network.nearestPointDistance(x, z);
}

export function hasRoadAccess(
  x: number,
  z: number,
  network: RoadNetwork,
  maxDistance = BUILDING_ROAD_ACCESS_DISTANCE,
): boolean {
  return nearestRoadDistance(x, z, network) <= maxDistance;
}

const ROAD_SURFACE_MARGIN = 0.15;

/** True when a point lies on paved road surface (not merely near a road). */
export function isOnRoadSurface(x: number, z: number, network: RoadNetwork): boolean {
  for (const edge of network.edges.values()) {
    if (edge.sampledPath.length < 2) continue;
    const distance = distancePointToPolylineXZ(x, z, edge.sampledPath);
    if (distance <= edge.width * 0.5 + ROAD_SURFACE_MARGIN) return true;
  }

  for (const node of network.nodes.values()) {
    let maxHalfWidth = 0;
    for (const edgeId of node.edgeIds) {
      const edge = network.edges.get(edgeId);
      if (edge) maxHalfWidth = Math.max(maxHalfWidth, edge.width * 0.5);
    }
    if (maxHalfWidth <= 0) continue;
    const nodeDistance = Math.hypot(x - node.position.x, z - node.position.z);
    if (nodeDistance <= maxHalfWidth + ROAD_SURFACE_MARGIN) return true;
  }

  return false;
}

export function areRoadConnected(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  network: RoadNetwork,
  maxSnap = BUILDING_ROAD_ACCESS_DISTANCE,
): boolean {
  const graph = buildRoadGraph(network);
  const nodesA = snapToRoadNodes(graph, ax, az, maxSnap);
  const nodesB = snapToRoadNodes(graph, bx, bz, maxSnap);
  if (!nodesA || !nodesB) return false;
  return shareComponent(graph.adjacency, nodesA, nodesB);
}

export function findRoadConnectedBuildings(
  origin: { x: number; z: number },
  buildings: Iterable<BuildingState>,
  network: RoadNetwork,
  predicate?: (building: BuildingState) => boolean,
): BuildingState[] {
  const matches: BuildingState[] = [];
  for (const building of buildings) {
    if (predicate && !predicate(building)) continue;
    if (!areRoadConnected(origin.x, origin.z, building.x, building.z, network)) continue;
    matches.push(building);
  }
  matches.sort((a, b) => sortByDistance(origin, a, b));
  return matches;
}

export function findRoadConnectedResidences(
  origin: { x: number; z: number },
  residences: Iterable<ResidenceState>,
  network: RoadNetwork,
  predicate?: (residence: ResidenceState) => boolean,
): ResidenceState[] {
  const matches: ResidenceState[] = [];
  for (const residence of residences) {
    if (predicate && !predicate(residence)) continue;
    if (!areRoadConnected(origin.x, origin.z, residence.x, residence.z, network)) continue;
    matches.push(residence);
  }
  matches.sort((a, b) => sortByDistance(origin, a, b));
  return matches;
}

export function formatRoadAccess(distance: number): string {
  if (!Number.isFinite(distance)) return 'No road nearby';
  if (distance <= BUILDING_ROAD_ACCESS_DISTANCE) {
    return `Connected (${distance.toFixed(1)} m to road)`;
  }
  return `Not connected (${distance.toFixed(1)} m to nearest road)`;
}

function buildRoadGraph(network: RoadNetwork): RoadGraph {
  const nodes = new Map<string, { x: number; z: number }>();
  for (const node of network.nodes.values()) {
    nodes.set(node.id, { x: node.position.x, z: node.position.z });
  }

  const adjacency = new Map<string, string[]>();
  const edgePaths: RoadGraph['edgePaths'] = [];

  for (const edge of network.edges.values()) {
    edgePaths.push({
      startNodeId: edge.startNodeId,
      endNodeId: edge.endNodeId,
      path: edge.sampledPath.map((point) => ({ x: point.x, z: point.z })),
    });

    const startNeighbors = adjacency.get(edge.startNodeId) ?? [];
    startNeighbors.push(edge.endNodeId);
    adjacency.set(edge.startNodeId, startNeighbors);

    const endNeighbors = adjacency.get(edge.endNodeId) ?? [];
    endNeighbors.push(edge.startNodeId);
    adjacency.set(edge.endNodeId, endNeighbors);
  }

  return { nodes, adjacency, edgePaths };
}

function snapToRoadNodes(
  graph: RoadGraph,
  x: number,
  z: number,
  maxSnap: number,
): string[] | null {
  let bestDistance = maxSnap;
  let bestNodes: string[] = [];

  for (const [id, node] of graph.nodes) {
    const distance = Math.hypot(x - node.x, z - node.z);
    if (distance > bestDistance + 1e-6) continue;
    if (distance < bestDistance - 1e-6) {
      bestDistance = distance;
      bestNodes = [id];
    } else if (Math.abs(distance - bestDistance) <= 1e-6) {
      bestNodes.push(id);
    }
  }

  for (const edge of graph.edgePaths) {
    if (edge.path.length < 2) continue;
    const distance = distanceToPath(x, z, edge.path);
    if (distance > bestDistance + 1e-6) continue;
    if (distance < bestDistance - 1e-6) {
      bestDistance = distance;
      bestNodes = [edge.startNodeId, edge.endNodeId];
    }
  }

  if (bestNodes.length === 0) return null;
  return [...new Set(bestNodes)];
}

function shareComponent(
  adjacency: Map<string, string[]>,
  startNodes: string[],
  targetNodes: string[],
): boolean {
  const targets = new Set(targetNodes);
  const visited = new Set<string>();
  const queue = [...startNodes];

  while (queue.length > 0) {
    const node = queue.shift();
    if (!node || visited.has(node)) continue;
    visited.add(node);
    if (targets.has(node)) return true;
    for (const neighbor of adjacency.get(node) ?? []) {
      if (!visited.has(neighbor)) queue.push(neighbor);
    }
  }

  return false;
}

function distanceToPath(x: number, z: number, path: Array<{ x: number; z: number }>): number {
  let best = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    best = Math.min(best, distanceToSegment(x, z, path[i], path[i + 1]));
  }
  return best;
}

function distanceToSegment(
  px: number,
  pz: number,
  a: { x: number; z: number },
  b: { x: number; z: number },
): number {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const lengthSq = abx * abx + abz * abz;
  const t = lengthSq <= 1e-9
    ? 0
    : Math.min(1, Math.max(0, ((px - a.x) * abx + (pz - a.z) * abz) / lengthSq));
  const cx = a.x + abx * t;
  const cz = a.z + abz * t;
  return Math.hypot(px - cx, pz - cz);
}

function sortByDistance(
  origin: { x: number; z: number },
  a: { x: number; z: number },
  b: { x: number; z: number },
): number {
  return Math.hypot(a.x - origin.x, a.z - origin.z) - Math.hypot(b.x - origin.x, b.z - origin.z);
}
