import * as THREE from 'three';
import type { RoadEdge } from './RoadEdge.ts';
import type { JunctionType, RoadNode } from './RoadNode.ts';

export type SnapTarget =
  | { kind: 'node'; nodeId: string; point: THREE.Vector3; distance: number }
  | { kind: 'segment'; edgeId: string; point: THREE.Vector3; distance: number; t: number };

export type RoadNetworkSnapshot = {
  nextNodeId: number;
  nextEdgeId: number;
  nodes: Array<{ id: string; position: [number, number, number] }>;
    edges: Array<{
    id: string;
    startNodeId: string;
    endNodeId: string;
    width: number;
    controlPoints: Array<[number, number, number]>;
    sampledPath: Array<[number, number, number]>;
    length: number;
    revision: number;
    bridgeSpans?: Array<{
      rampStart: number;
      deckStart: number;
      deckEnd: number;
      rampEnd: number;
      deckY: number;
    }>;
  }>;
};

type RouteEvent = {
  distance: number;
  point: THREE.Vector3;
  nodeId: string;
};

const CLOSED_ENDPOINT_DISTANCE = 1.25;

export class RoadNetwork {
  readonly nodes = new Map<string, RoadNode>();
  readonly edges = new Map<string, RoadEdge>();
  private nextNodeId = 1;
  private nextEdgeId = 1;

  findSnap(point: THREE.Vector3, maxDistance = 5.2): SnapTarget | null {
    let best: SnapTarget | null = null;
    for (const node of this.nodes.values()) {
      const distance = distanceXZ(point, node.position);
      if (distance <= maxDistance && (!best || distance < best.distance)) {
        best = { kind: 'node', nodeId: node.id, point: node.position.clone(), distance };
      }
    }
    for (const edge of this.edges.values()) {
      const samples = getEdgePath(edge);
      for (let i = 0; i < samples.length - 1; i++) {
        const projection = projectPointToSegmentXZ(point, samples[i], samples[i + 1]);
        if (projection.distance <= maxDistance && (!best || projection.distance < best.distance)) {
          const t = (i + projection.t) / Math.max(1, samples.length - 1);
          best = { kind: 'segment', edgeId: edge.id, point: projection.point, distance: projection.distance, t };
        }
      }
    }
    return best;
  }

  addRoadPath(rawPoints: THREE.Vector3[], width = 4.2): string[] {
    const points = simplifyPath(rawPoints.map((point) => point.clone()), 0.85);
    if (points.length < 2 || routeLength(points) < 2.5) return [];

    let startNodeId = this.resolveEndpoint(points, 0);
    let endNodeId = this.resolveEndpoint(points, points.length - 1);
    const events = this.resolveCrossings(points, new Set([startNodeId, endNodeId].filter(Boolean) as string[]));
    const route = insertEvents(points, events);
    const connectionIndices = new Map<number, string>();
    const endIndex = route.length - 1;
    const isClosedRoute = distanceXZ(route[0], route[endIndex]) <= CLOSED_ENDPOINT_DISTANCE;

    if (isClosedRoute && (!startNodeId || !endNodeId || startNodeId === endNodeId)) {
      const sharedNodeId = startNodeId ?? endNodeId;
      if (sharedNodeId) {
        const node = this.nodes.get(sharedNodeId);
        if (node) {
          route[0].copy(node.position);
          route[endIndex].copy(node.position);
        }
        startNodeId = sharedNodeId;
        endNodeId = sharedNodeId;
      }
    }

    if (startNodeId) connectionIndices.set(0, startNodeId);
    else {
      const node = this.createNode(route[0]);
      startNodeId = node.id;
      connectionIndices.set(0, node.id);
      if (isClosedRoute && !endNodeId) {
        endNodeId = node.id;
        route[endIndex].copy(node.position);
      }
    }

    if (endNodeId) connectionIndices.set(endIndex, endNodeId);
    else connectionIndices.set(endIndex, this.createNode(route[endIndex]).id);

    for (const event of events) {
      const index = route.findIndex((point) => distanceXZ(point, event.point) < 0.05);
      if (index > 0 && index < route.length - 1) connectionIndices.set(index, event.nodeId);
    }

    const sortedConnectionIndices = [...connectionIndices.keys()].sort((a, b) => a - b);
    const addedEdges: string[] = [];
    for (let i = 0; i < sortedConnectionIndices.length - 1; i++) {
      const fromIndex = sortedConnectionIndices[i];
      const toIndex = sortedConnectionIndices[i + 1];
      const controls = route.slice(fromIndex, toIndex + 1);
      if (routeLength(controls) < 1.5) continue;
      const edge = this.createEdge(connectionIndices.get(fromIndex)!, connectionIndices.get(toIndex)!, controls, width);
      addedEdges.push(edge.id);
    }

    this.pruneOrphans();
    this.classifyJunctions();
    return addedEdges;
  }

  deleteEdge(edgeId: string): boolean {
    const edge = this.edges.get(edgeId);
    if (!edge) return false;
    this.removeEdge(edgeId);
    this.pruneOrphans();
    this.classifyJunctions();
    return true;
  }

  snapshot(): RoadNetworkSnapshot {
    return {
      nextNodeId: this.nextNodeId,
      nextEdgeId: this.nextEdgeId,
      nodes: [...this.nodes.values()].map((node) => ({
        id: node.id,
        position: [node.position.x, node.position.y, node.position.z],
      })),
      edges: [...this.edges.values()].map((edge) => ({
        id: edge.id,
        startNodeId: edge.startNodeId,
        endNodeId: edge.endNodeId,
        width: edge.width,
        controlPoints: edge.controlPoints.map(vectorToTuple),
        sampledPath: edge.sampledPath.map(vectorToTuple),
        length: edge.length,
        revision: edge.revision,
        bridgeSpans: edge.materialData?.bridgeSpans,
      })),
    };
  }

  restore(snapshot: RoadNetworkSnapshot): void {
    this.nodes.clear();
    this.edges.clear();
    this.nextNodeId = snapshot.nextNodeId;
    this.nextEdgeId = snapshot.nextEdgeId;
    for (const node of snapshot.nodes) {
      this.nodes.set(node.id, {
        id: node.id,
        position: tupleToVector(node.position),
        edgeIds: new Set(),
        junctionType: 'endpoint',
      });
    }
    for (const edge of snapshot.edges) {
      this.edges.set(edge.id, {
        id: edge.id,
        startNodeId: edge.startNodeId,
        endNodeId: edge.endNodeId,
        width: edge.width,
        controlPoints: edge.controlPoints.map(tupleToVector),
        sampledPath: edge.sampledPath.map(tupleToVector),
        length: edge.length,
        editableState: 'normal',
        materialData: {
          surface: 'medieval_dirt',
          bridgeSpans: edge.bridgeSpans,
        },
        revision: edge.revision,
      });
      this.nodes.get(edge.startNodeId)?.edgeIds.add(edge.id);
      this.nodes.get(edge.endNodeId)?.edgeIds.add(edge.id);
    }
    this.classifyJunctions();
  }

  getConnectedEdges(node: RoadNode): RoadEdge[] {
    return [...node.edgeIds].map((id) => this.edges.get(id)).filter((edge): edge is RoadEdge => Boolean(edge));
  }

  private resolveEndpoint(points: THREE.Vector3[], index: number): string | null {
    const snap = this.findSnap(points[index], 5.4);
    if (!snap) return null;
    if (snap.kind === 'node') {
      points[index].copy(snap.point);
      return snap.nodeId;
    }
    const node = this.splitEdgeAtPoint(snap.edgeId, snap.point);
    points[index].copy(node.position);
    return node.id;
  }

  private resolveCrossings(points: THREE.Vector3[], protectedNodeIds: Set<string>): RouteEvent[] {
    const events: RouteEvent[] = [];
    const cumulative = cumulativeDistances(points);
    const edgeEntries = [...this.edges.values()];
    for (let routeIndex = 0; routeIndex < points.length - 1; routeIndex++) {
      const a = points[routeIndex];
      const b = points[routeIndex + 1];
      for (const edge of edgeEntries) {
        if (!this.edges.has(edge.id)) continue;
        if (protectedNodeIds.has(edge.startNodeId) || protectedNodeIds.has(edge.endNodeId)) continue;
        const samples = getEdgePath(edge);
        for (let sampleIndex = 0; sampleIndex < samples.length - 1; sampleIndex++) {
          const hit = segmentIntersectionXZ(a, b, samples[sampleIndex], samples[sampleIndex + 1]);
          if (!hit) continue;
          const routeDistance = cumulative[routeIndex] + distanceXZ(a, b) * hit.tA;
          if (routeDistance < 4 || cumulative[cumulative.length - 1] - routeDistance < 4) continue;
          if (events.some((event) => distanceXZ(event.point, hit.point) < 3)) continue;
          const nearNode = this.findNearestNode(hit.point, 3.5);
          const node = nearNode ?? this.splitEdgeAtPoint(edge.id, hit.point);
          events.push({ distance: routeDistance, point: node.position.clone(), nodeId: node.id });
          break;
        }
      }
    }
    return events.sort((a, b) => a.distance - b.distance);
  }

  private splitEdgeAtPoint(edgeId: string, point: THREE.Vector3): RoadNode {
    const edge = this.edges.get(edgeId);
    if (!edge) return this.createNode(point);
    const existing = this.findNearestNode(point, 1.25);
    if (existing) return existing;

    const path = getEdgePath(edge);
    const split = nearestPathIndex(path, point);
    const node = this.createNode(split.point);
    const first = path.slice(0, split.index + 1);
    const second = path.slice(split.index + 1);
    first.push(node.position.clone());
    second.unshift(node.position.clone());
    this.removeEdge(edge.id);
    if (routeLength(first) > 1) this.createEdge(edge.startNodeId, node.id, first, edge.width);
    if (routeLength(second) > 1) this.createEdge(node.id, edge.endNodeId, second, edge.width);
    return node;
  }

  private createNode(position: THREE.Vector3): RoadNode {
    const node: RoadNode = {
      id: `n${this.nextNodeId++}`,
      position: position.clone(),
      edgeIds: new Set(),
      junctionType: 'endpoint',
    };
    this.nodes.set(node.id, node);
    return node;
  }

  private createEdge(startNodeId: string, endNodeId: string, controlPoints: THREE.Vector3[], width: number): RoadEdge {
    const edge: RoadEdge = {
      id: `e${this.nextEdgeId++}`,
      startNodeId,
      endNodeId,
      controlPoints: controlPoints.map((point) => point.clone()),
      width,
      sampledPath: controlPoints.map((point) => point.clone()),
      length: routeLength(controlPoints),
      editableState: 'normal',
      materialData: { surface: 'medieval_dirt' },
      revision: 1,
    };
    this.edges.set(edge.id, edge);
    this.nodes.get(startNodeId)?.edgeIds.add(edge.id);
    this.nodes.get(endNodeId)?.edgeIds.add(edge.id);
    return edge;
  }

  private removeEdge(edgeId: string): void {
    const edge = this.edges.get(edgeId);
    if (!edge) return;
    this.nodes.get(edge.startNodeId)?.edgeIds.delete(edgeId);
    this.nodes.get(edge.endNodeId)?.edgeIds.delete(edgeId);
    this.edges.delete(edgeId);
  }

  private pruneOrphans(): void {
    for (const [id, node] of this.nodes) {
      if (node.edgeIds.size === 0) this.nodes.delete(id);
    }
  }

  private classifyJunctions(): void {
    for (const node of this.nodes.values()) {
      node.junctionType = classify(node.edgeIds.size);
    }
  }

  private findNearestNode(point: THREE.Vector3, maxDistance: number): RoadNode | null {
    let best: RoadNode | null = null;
    let bestDistance = Infinity;
    for (const node of this.nodes.values()) {
      const distance = distanceXZ(point, node.position);
      if (distance <= maxDistance && distance < bestDistance) {
        best = node;
        bestDistance = distance;
      }
    }
    return best;
  }
}

function classify(count: number): JunctionType {
  if (count <= 1) return 'endpoint';
  if (count === 2) return 'bend';
  if (count === 3) return 't-junction';
  if (count === 4) return 'cross-junction';
  return 'complex';
}

function getEdgePath(edge: RoadEdge): THREE.Vector3[] {
  return edge.sampledPath.length >= 2 ? edge.sampledPath : edge.controlPoints;
}

function simplifyPath(points: THREE.Vector3[], minDistance: number): THREE.Vector3[] {
  if (points.length <= 2) return points;
  const result = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    if (distanceXZ(points[i], result[result.length - 1]) >= minDistance) result.push(points[i]);
  }
  result.push(points[points.length - 1]);
  return result;
}

function cumulativeDistances(points: THREE.Vector3[]): number[] {
  const result = [0];
  for (let i = 1; i < points.length; i++) result.push(result[i - 1] + distanceXZ(points[i - 1], points[i]));
  return result;
}

function insertEvents(points: THREE.Vector3[], events: RouteEvent[]): THREE.Vector3[] {
  if (events.length === 0) return points.map((point) => point.clone());
  const result: THREE.Vector3[] = [];
  const cumulative = cumulativeDistances(points);
  let eventIndex = 0;
  for (let i = 0; i < points.length - 1; i++) {
    result.push(points[i].clone());
    while (eventIndex < events.length && events[eventIndex].distance > cumulative[i] && events[eventIndex].distance <= cumulative[i + 1]) {
      result.push(events[eventIndex].point.clone());
      eventIndex++;
    }
  }
  result.push(points[points.length - 1].clone());
  return simplifyPath(result, 0.1);
}

function nearestPathIndex(path: THREE.Vector3[], point: THREE.Vector3): { index: number; point: THREE.Vector3 } {
  let best = { index: 0, point: path[0].clone(), distance: Infinity };
  for (let i = 0; i < path.length - 1; i++) {
    const projection = projectPointToSegmentXZ(point, path[i], path[i + 1]);
    if (projection.distance < best.distance) {
      best = { index: i, point: projection.point, distance: projection.distance };
    }
  }
  return { index: best.index, point: best.point };
}

function projectPointToSegmentXZ(point: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): { point: THREE.Vector3; distance: number; t: number } {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const lengthSq = abx * abx + abz * abz;
  const t = lengthSq <= 1e-6 ? 0 : THREE.MathUtils.clamp(((point.x - a.x) * abx + (point.z - a.z) * abz) / lengthSq, 0, 1);
  const projected = new THREE.Vector3(
    THREE.MathUtils.lerp(a.x, b.x, t),
    THREE.MathUtils.lerp(a.y, b.y, t),
    THREE.MathUtils.lerp(a.z, b.z, t)
  );
  return { point: projected, distance: distanceXZ(point, projected), t };
}

function segmentIntersectionXZ(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3): { point: THREE.Vector3; tA: number; tB: number } | null {
  const rX = b.x - a.x;
  const rZ = b.z - a.z;
  const sX = d.x - c.x;
  const sZ = d.z - c.z;
  const denom = rX * sZ - rZ * sX;
  if (Math.abs(denom) < 1e-5) return null;
  const cax = c.x - a.x;
  const caz = c.z - a.z;
  const t = (cax * sZ - caz * sX) / denom;
  const u = (cax * rZ - caz * rX) / denom;
  if (t <= 0.02 || t >= 0.98 || u <= 0.02 || u >= 0.98) return null;
  const y = THREE.MathUtils.lerp(a.y, b.y, t);
  return { point: new THREE.Vector3(a.x + rX * t, y, a.z + rZ * t), tA: t, tB: u };
}

function routeLength(points: THREE.Vector3[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i++) length += distanceXZ(points[i - 1], points[i]);
  return length;
}

function distanceXZ(a: THREE.Vector3, b: THREE.Vector3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function vectorToTuple(vector: THREE.Vector3): [number, number, number] {
  return [vector.x, vector.y, vector.z];
}

function tupleToVector(tuple: [number, number, number]): THREE.Vector3 {
  return new THREE.Vector3(tuple[0], tuple[1], tuple[2]);
}
