import * as THREE from 'three';
import { Terrain } from '../terrain/Terrain.ts';
import type { RoadEdge } from './RoadEdge.ts';
import { RoadMaterialFactory } from './RoadMaterialFactory.ts';
import type { RoadNetwork } from './RoadNetwork.ts';
import { trimPathAtEndpoint } from './roadEndpoint.ts';
import {
  applyBridgeHeightsToPath,
  detectBridgeSpans,
  type BridgeSamplingContext,
  type BridgeSpan,
} from './RiverBridgeSpans.ts';
import { buildBridgeSupports } from './BridgeSupports.ts';

const CORE_Y_OFFSET = 0.12;
/** Slightly above core so the transparent shoulder clears the terrain depth buffer. */
const BLEND_Y_OFFSET = 0.16;
const BRIDGE_Y_OFFSET = 0.22;
const CORE_EDGE_JITTER = 0.22;
/** How far the feathered shoulder extends under the opaque core to avoid visible seams. */
const BLEND_INNER_OVERLAP = 0.14;

type RoadCrossSection = {
  leftCore: THREE.Vector3;
  rightCore: THREE.Vector3;
  normal: THREE.Vector3;
  bridgeBlend: number;
};

export class RoadMeshBuilder {
  private readonly terrain: Terrain;
  private readonly materials: RoadMaterialFactory;
  private readonly bridgeCtx: BridgeSamplingContext | null;

  constructor(terrain: Terrain, materials: RoadMaterialFactory, bridgeCtx?: BridgeSamplingContext) {
    this.terrain = terrain;
    this.materials = materials;
    this.bridgeCtx = bridgeCtx ?? null;
  }

  buildEdge(edge: RoadEdge, network: RoadNetwork): THREE.Group {
    const sampled = this.sampleEdge(edge);
    edge.sampledPath = sampled;
    edge.length = pathLength(sampled);

    const ribbonPath = sampled.map((point) => point.clone());
    const spans = this.resolveBridgeSpans(ribbonPath, edge);
    const bridgeBlends = spans.length > 0
      ? applyBridgeHeightsToPath(ribbonPath, spans, this.requireBridgeCtx(), CORE_Y_OFFSET)
      : new Float32Array(ribbonPath.length);

    const startNode = network.nodes.get(edge.startNodeId);
    const endNode = network.nodes.get(edge.endNodeId);
    const startIsEndpoint = startNode?.edgeIds.size === 1;
    const endIsEndpoint = endNode?.edgeIds.size === 1;
    if (startNode && startIsEndpoint) trimPathAtEndpoint(ribbonPath, edge.startNodeId, edge, edge.width);
    if (endNode && endIsEndpoint) trimPathAtEndpoint(ribbonPath, edge.endNodeId, edge, edge.width);

    const group = new THREE.Group();
    group.name = `Road edge ${edge.id}`;
    group.userData.edgeId = edge.id;

    const crossSections = this.buildCrossSections(ribbonPath, edge.width, edge.id, true, bridgeBlends);
    const hasBridge = spans.length > 0;
    const core = this.buildRibbonFromSections(crossSections, ribbonPath, this.materials.road, bridgeBlends);
    core.name = `Road core ${edge.id}`;
    core.userData.edgeId = edge.id;
    core.castShadow = false;
    core.receiveShadow = true;
    core.renderOrder = hasBridge ? 13 : 11;
    group.add(core);

    const edgeBlend = this.buildEdgeBlend(crossSections, ribbonPath, edge.width, edge.id, {
      fadeStart: startIsEndpoint,
      fadeEnd: endIsEndpoint,
    });
    edgeBlend.name = `Road edge blend ${edge.id}`;
    edgeBlend.userData.edgeId = edge.id;
    edgeBlend.castShadow = false;
    edgeBlend.receiveShadow = true;
    edgeBlend.renderOrder = hasBridge ? 12 : 10;
    group.add(edgeBlend);

    if (hasBridge && this.bridgeCtx) {
      const supports = buildBridgeSupports(ribbonPath, edge.width, spans, this.bridgeCtx, this.materials.bridgeSupport);
      if (supports) group.add(supports);
    }

    edge.mesh = group;
    return group;
  }

  buildPreview(points: THREE.Vector3[], width: number, valid: boolean): THREE.Mesh | null {
    const sampled = this.samplePath(points, 1.25);
    if (sampled.length < 2) return null;

    const ribbonPath = sampled.map((point) => point.clone());
    const spans = this.bridgeCtx ? detectBridgeSpans(ribbonPath, this.bridgeCtx) : [];
    const hasBridge = spans.length > 0;
    if (hasBridge) {
      applyBridgeHeightsToPath(ribbonPath, spans, this.requireBridgeCtx(), 0.13);
    }

    const material = !valid
      ? this.materials.previewInvalid
      : hasBridge
        ? this.materials.previewBridge
        : this.materials.previewValid;
    return this.buildSimpleRibbon(ribbonPath, width, material, 0, 'preview', false);
  }

  buildSelection(edge: RoadEdge): THREE.Mesh | null {
    const path = edge.sampledPath.length >= 2 ? edge.sampledPath : edge.controlPoints;
    if (path.length < 2) return null;
    const mesh = this.buildSimpleRibbon(path, edge.width + 0.9, this.materials.selection, 0.18, `${edge.id}-selection`, false);
    mesh.renderOrder = 20;
    return mesh;
  }

  samplePath(points: THREE.Vector3[], spacing: number): THREE.Vector3[] {
    return this.samplePoints(points, spacing);
  }

  private sampleEdge(edge: RoadEdge): THREE.Vector3[] {
    return this.samplePoints(edge.controlPoints, 1.15);
  }

  private samplePoints(points: THREE.Vector3[], spacing: number): THREE.Vector3[] {
    if (points.length < 2) return [];
    const length = pathLength(points);
    const curvatureBoost = estimateCurvature(points) * 8;
    const divisions = THREE.MathUtils.clamp(Math.ceil(length / spacing + curvatureBoost), 8, 240);
    const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.45);
    const sampled: THREE.Vector3[] = [];
    for (let i = 0; i <= divisions; i++) {
      const p = curve.getPoint(i / divisions);
      sampled.push(this.terrain.getPointAt(p.x, p.z, 0));
    }
    return sampled;
  }

  private resolveBridgeSpans(path: THREE.Vector3[], edge: RoadEdge): BridgeSpan[] {
    if (!this.bridgeCtx) return edge.materialData?.bridgeSpans ?? [];
    const spans = detectBridgeSpans(path, this.bridgeCtx);
    edge.materialData = {
      surface: 'medieval_dirt',
      bridgeSpans: spans.length > 0 ? spans : undefined,
    };
    return spans;
  }

  private requireBridgeCtx(): BridgeSamplingContext {
    if (!this.bridgeCtx) throw new Error('Bridge sampling context is not configured.');
    return this.bridgeCtx;
  }

  private buildCrossSections(
    path: THREE.Vector3[],
    width: number,
    seed: string,
    irregular: boolean,
    bridgeBlends: Float32Array,
  ): RoadCrossSection[] {
    const half = width * 0.5;
    const sections: RoadCrossSection[] = [];

    for (let i = 0; i < path.length; i++) {
      const tangent = tangentAt(path, i);
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
      const leftJitter = irregular ? smoothEdgeJitter(seed, i, 0) * CORE_EDGE_JITTER : 0;
      const rightJitter = irregular ? smoothEdgeJitter(seed, i, 1) * CORE_EDGE_JITTER : 0;
      const leftCore = path[i].clone().addScaledVector(normal, half + leftJitter);
      const rightCore = path[i].clone().addScaledVector(normal, -half + rightJitter);
      const bridgeBlend = bridgeBlends[i] ?? 0;
      const centerY = path[i].y;
      const leftTerrainY = this.terrain.getHeightAt(leftCore.x, leftCore.z) + CORE_Y_OFFSET;
      const rightTerrainY = this.terrain.getHeightAt(rightCore.x, rightCore.z) + CORE_Y_OFFSET;
      leftCore.y = THREE.MathUtils.lerp(leftTerrainY, centerY, bridgeBlend);
      rightCore.y = THREE.MathUtils.lerp(rightTerrainY, centerY, bridgeBlend);
      sections.push({ leftCore, rightCore, normal, bridgeBlend });
    }

    return sections;
  }

  private buildRibbonFromSections(
    crossSections: RoadCrossSection[],
    path: THREE.Vector3[],
    material: THREE.Material,
    bridgeBlends: Float32Array,
  ): THREE.Mesh {
    const positions: number[] = [];
    const uvs: number[] = [];
    const bridgeAttrs: number[] = [];
    const indices: number[] = [];
    const distances = cumulativeDistances(path);

    for (let i = 0; i < crossSections.length; i++) {
      const { leftCore, rightCore } = crossSections[i];
      positions.push(leftCore.x, leftCore.y, leftCore.z, rightCore.x, rightCore.y, rightCore.z);
      uvs.push(0, distances[i] / 5.8, 1, distances[i] / 5.8);
      const blend = bridgeBlends[i] ?? crossSections[i].bridgeBlend;
      bridgeAttrs.push(blend, blend);
    }

    for (let i = 0; i < path.length - 1; i++) {
      const a = i * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setIndex(indices);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('uv2', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('bridgeBlend', new THREE.Float32BufferAttribute(bridgeAttrs, 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return new THREE.Mesh(geometry, material);
  }

  private buildSimpleRibbon(
    path: THREE.Vector3[],
    width: number,
    material: THREE.Material,
    _yOffset: number,
    seed: string,
    irregular: boolean,
  ): THREE.Mesh {
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const distances = cumulativeDistances(path);
    const half = width * 0.5;

    for (let i = 0; i < path.length; i++) {
      const tangent = tangentAt(path, i);
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
      const jitter = irregular ? smoothEdgeJitter(seed, i, 0) * CORE_EDGE_JITTER : 0;
      const left = path[i].clone().addScaledVector(normal, half + jitter);
      const right = path[i].clone().addScaledVector(normal, -half + smoothEdgeJitter(seed, i, 1) * (irregular ? CORE_EDGE_JITTER : 0));
      const baseY = path[i].y;
      left.y = baseY;
      right.y = baseY;
      positions.push(left.x, left.y, left.z, right.x, right.y, right.z);
      uvs.push(0, distances[i] / 5.8, 1, distances[i] / 5.8);
    }

    for (let i = 0; i < path.length - 1; i++) {
      const a = i * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setIndex(indices);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('uv2', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return new THREE.Mesh(geometry, material);
  }

  private buildEdgeBlend(
    crossSections: RoadCrossSection[],
    path: THREE.Vector3[],
    width: number,
    seed: string,
    endpointFade: { fadeStart: boolean; fadeEnd: boolean } = { fadeStart: false, fadeEnd: false },
  ): THREE.Mesh {
    const positions: number[] = [];
    const uvs: number[] = [];
    const bridgeAttrs: number[] = [];
    const indices: number[] = [];
    const distances = cumulativeDistances(path);
    const pathLen = distances[distances.length - 1] ?? 0;
    const shoulderMid = width * 0.48;
    const shoulderOuter = width * 0.92;
    const fadeSpan = width * 0.55;

    for (let i = 0; i < crossSections.length; i++) {
      const { leftCore, rightCore, normal, bridgeBlend } = crossSections[i];
      const leftOuterJitter = smoothEdgeJitter(seed, i, 2) * 0.52;
      const rightOuterJitter = smoothEdgeJitter(seed, i, 3) * 0.52;
      const leftInner = this.blendVertexAt(leftCore, normal, -BLEND_INNER_OVERLAP, bridgeBlend);
      const rightInner = this.blendVertexAt(rightCore, normal, BLEND_INNER_OVERLAP, bridgeBlend);
      const leftMid = this.blendVertexAt(leftCore, normal, shoulderMid + leftOuterJitter * 0.62, bridgeBlend);
      const leftFar = this.blendVertexAt(leftCore, normal, shoulderOuter + leftOuterJitter, bridgeBlend);
      const rightMid = this.blendVertexAt(rightCore, normal, -(shoulderMid + rightOuterJitter * 0.62), bridgeBlend);
      const rightFar = this.blendVertexAt(rightCore, normal, -(shoulderOuter + rightOuterJitter), bridgeBlend);
      for (const p of [leftFar, leftMid, leftInner, rightInner, rightMid, rightFar]) {
        positions.push(p.x, p.y, p.z);
      }
      const v = distances[i] / 5.8;
      let mouthFade = 1;
      if (endpointFade.fadeStart) mouthFade = Math.min(mouthFade, smoothFade(distances[i], fadeSpan));
      if (endpointFade.fadeEnd) mouthFade = Math.min(mouthFade, smoothFade(pathLen - distances[i], fadeSpan));
      uvs.push(0, v, 0.42 * mouthFade, v, 1 * mouthFade, v, 1 * mouthFade, v, 0.42 * mouthFade, v, 0, v);
      for (let j = 0; j < 6; j++) bridgeAttrs.push(bridgeBlend);
    }

    for (let i = 0; i < path.length - 1; i++) {
      const a = i * 6;
      indices.push(a, a + 6, a + 1, a + 1, a + 6, a + 7);
      indices.push(a + 1, a + 7, a + 2, a + 2, a + 7, a + 8);
      indices.push(a + 3, a + 9, a + 4, a + 4, a + 9, a + 10);
      indices.push(a + 4, a + 10, a + 5, a + 5, a + 10, a + 11);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setIndex(indices);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('uv2', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('bridgeBlend', new THREE.Float32BufferAttribute(bridgeAttrs, 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return new THREE.Mesh(geometry, this.materials.roadEdge);
  }

  /** Re-sample terrain height at the shoulder XZ so sloped edges don't intersect the ground mesh. */
  private blendVertexAt(
    core: THREE.Vector3,
    normal: THREE.Vector3,
    lateralOffset: number,
    bridgeBlend: number,
  ): THREE.Vector3 {
    const point = core.clone().addScaledVector(normal, lateralOffset);
    const terrainY = this.terrain.getHeightAt(point.x, point.z) + BLEND_Y_OFFSET;
    point.y = THREE.MathUtils.lerp(terrainY, core.y + (BRIDGE_Y_OFFSET - CORE_Y_OFFSET) * bridgeBlend, bridgeBlend);
    return point;
  }
}

function tangentAt(path: THREE.Vector3[], index: number): THREE.Vector3 {
  const prev = path[Math.max(0, index - 1)];
  const next = path[Math.min(path.length - 1, index + 1)];
  const tangent = new THREE.Vector3(next.x - prev.x, 0, next.z - prev.z);
  if (tangent.lengthSq() < 1e-6) return new THREE.Vector3(1, 0, 0);
  return tangent.normalize();
}

function cumulativeDistances(path: THREE.Vector3[]): number[] {
  const result = [0];
  for (let i = 1; i < path.length; i++) result.push(result[i - 1] + path[i - 1].distanceTo(path[i]));
  return result;
}

function pathLength(path: THREE.Vector3[]): number {
  let length = 0;
  for (let i = 1; i < path.length; i++) length += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
  return length;
}

function estimateCurvature(points: THREE.Vector3[]): number {
  let curvature = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const a = new THREE.Vector2(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z).normalize();
    const b = new THREE.Vector2(points[i + 1].x - points[i].x, points[i + 1].z - points[i].z).normalize();
    curvature += Math.acos(THREE.MathUtils.clamp(a.dot(b), -1, 1));
  }
  return curvature;
}

function edgeJitter(seed: string, index: number, side: number): number {
  const seedValue = [...seed].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return Math.sin(index * 1.734 + side * 11.91 + seedValue * 0.137) * 0.65 + Math.sin(index * 0.431 + seedValue) * 0.35;
}

function smoothEdgeJitter(seed: string, index: number, side: number): number {
  return edgeJitter(seed, index - 1, side) * 0.24
    + edgeJitter(seed, index, side) * 0.52
    + edgeJitter(seed, index + 1, side) * 0.24;
}

function smoothFade(distance: number, span: number): number {
  const t = THREE.MathUtils.clamp(distance / Math.max(0.001, span), 0, 1);
  return t * t * (3 - 2 * t);
}
