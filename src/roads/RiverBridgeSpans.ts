import * as THREE from 'three';

export type BridgeSpan = {
  rampStart: number;
  deckStart: number;
  deckEnd: number;
  rampEnd: number;
  deckY: number;
  /** Flat approach on dry ground before the incline begins. */
  approachHold?: number;
};

export type BridgeSamplingContext = {
  isWaterAt: (x: number, z: number) => boolean;
  getTerrainY: (x: number, z: number) => number;
  getWaterSurfaceY: (x: number, z: number) => number;
};

/** Minimum flat road on the bank before the bridge starts climbing. */
export const BRIDGE_APPROACH_HOLD = 3.2;
export const BRIDGE_RAMP_MIN = 10;
export const BRIDGE_RAMP_MAX = 22;
/** Max rise/run for approach ramps (~5°). */
export const BRIDGE_MAX_RAMP_GRADE = 0.09;
export const BRIDGE_DECK_CLEARANCE = 0.28;
export const MAX_BRIDGE_SPAN_LENGTH = 58;
const MIN_WET_RUN_LENGTH = 1.8;

export function detectBridgeSpans(sampledPath: THREE.Vector3[], ctx: BridgeSamplingContext): BridgeSpan[] {
  if (sampledPath.length < 2) return [];

  const distances = cumulativeDistances(sampledPath);
  const wet = sampledPath.map((point) => ctx.isWaterAt(point.x, point.z));
  const spans: BridgeSpan[] = [];

  let index = 0;
  while (index < wet.length) {
    if (!wet[index]) {
      index++;
      continue;
    }

    const wetStart = index;
    while (index < wet.length && wet[index]) index++;
    const wetEnd = index - 1;

    const deckStartDist = distances[wetStart];
    const deckEndDist = distances[wetEnd];
    if (deckEndDist - deckStartDist < MIN_WET_RUN_LENGTH) continue;

    let peakWaterY = 0;
    for (let i = wetStart; i <= wetEnd; i++) {
      const point = sampledPath[i];
      peakWaterY = Math.max(peakWaterY, ctx.getWaterSurfaceY(point.x, point.z));
    }

    const deckY = peakWaterY + BRIDGE_DECK_CLEARANCE;
    const entryRampLen = computeRampLength(sampledPath, distances, deckStartDist, deckY, ctx, -1);
    const exitRampLen = computeRampLength(sampledPath, distances, deckEndDist, deckY, ctx, 1);
    const pathEnd = distances[distances.length - 1] ?? deckEndDist;

    spans.push({
      rampStart: Math.max(0, deckStartDist - entryRampLen),
      deckStart: deckStartDist,
      deckEnd: deckEndDist,
      rampEnd: Math.min(pathEnd, deckEndDist + exitRampLen),
      deckY,
      approachHold: BRIDGE_APPROACH_HOLD,
    });
  }

  return spans;
}

export function maxWetRunLength(sampledPath: THREE.Vector3[], isWaterAt: (x: number, z: number) => boolean): number {
  if (sampledPath.length < 2) return 0;
  const distances = cumulativeDistances(sampledPath);
  const wet = sampledPath.map((point) => isWaterAt(point.x, point.z));

  let best = 0;
  let index = 0;
  while (index < wet.length) {
    if (!wet[index]) {
      index++;
      continue;
    }
    const start = index;
    while (index < wet.length && wet[index]) index++;
    const end = index - 1;
    best = Math.max(best, distances[end] - distances[start]);
  }
  return best;
}

export function bridgeBlendAtDistance(distance: number, spans: BridgeSpan[]): number {
  let blend = 0;
  for (const span of spans) {
    if (distance < span.rampStart || distance > span.rampEnd) continue;

    const climbStart = span.rampStart + (span.approachHold ?? BRIDGE_APPROACH_HOLD);
    if (distance < climbStart) continue;

    if (distance >= span.deckStart && distance <= span.deckEnd) {
      blend = Math.max(blend, 1);
      continue;
    }
    if (distance < span.deckStart) {
      blend = Math.max(blend, smootherstep(climbStart, span.deckStart, distance));
      continue;
    }
    const descendEnd = span.rampEnd - (span.approachHold ?? BRIDGE_APPROACH_HOLD);
    blend = Math.max(blend, 1 - smootherstep(span.deckEnd, descendEnd, distance));
  }
  return blend;
}

export function applyBridgeHeightsToPath(
  path: THREE.Vector3[],
  spans: BridgeSpan[],
  ctx: BridgeSamplingContext,
  yOffset: number,
): Float32Array {
  const blends = new Float32Array(path.length);
  if (spans.length === 0) return blends;

  const distances = cumulativeDistances(path);
  for (let i = 0; i < path.length; i++) {
    const blend = bridgeBlendAtDistance(distances[i], spans);
    blends[i] = blend;
    if (blend <= 0) continue;

    const terrainY = ctx.getTerrainY(path[i].x, path[i].z);
    let deckY = terrainY;
    for (const span of spans) {
      if (distances[i] < span.rampStart || distances[i] > span.rampEnd) continue;
      deckY = Math.max(deckY, span.deckY);
    }
    path[i].y = THREE.MathUtils.lerp(terrainY, deckY, blend) + yOffset;
  }
  return blends;
}

export function samplePathAtDistance(
  path: THREE.Vector3[],
  distances: number[],
  targetDistance: number,
): { point: THREE.Vector3; tangent: THREE.Vector3 } | null {
  if (path.length < 2) return null;
  const total = distances[distances.length - 1] ?? 0;
  const distance = THREE.MathUtils.clamp(targetDistance, 0, total);

  for (let i = 0; i < path.length - 1; i++) {
    const start = distances[i];
    const end = distances[i + 1];
    if (distance < start || distance > end) continue;
    const span = end - start;
    const t = span <= 1e-6 ? 0 : (distance - start) / span;
    const point = path[i].clone().lerp(path[i + 1], t);
    const tangent = new THREE.Vector3(path[i + 1].x - path[i].x, 0, path[i + 1].z - path[i].z);
    if (tangent.lengthSq() < 1e-6) tangent.set(1, 0, 0);
    else tangent.normalize();
    return { point, tangent };
  }

  const last = path[path.length - 1];
  return { point: last.clone(), tangent: new THREE.Vector3(1, 0, 0) };
}

function computeRampLength(
  path: THREE.Vector3[],
  distances: number[],
  waterEdgeDistance: number,
  deckY: number,
  ctx: BridgeSamplingContext,
  direction: -1 | 1,
): number {
  const probeDistance = Math.max(0, waterEdgeDistance + direction * BRIDGE_APPROACH_HOLD);
  const sample = samplePathAtDistance(path, distances, probeDistance);
  const terrainY = sample
    ? ctx.getTerrainY(sample.point.x, sample.point.z)
    : ctx.getTerrainY(path[0].x, path[0].z);

  const rise = Math.max(0.12, deckY - terrainY);
  const gradeLength = rise / BRIDGE_MAX_RAMP_GRADE;
  const climbLength = Math.max(4.5, gradeLength);
  return THREE.MathUtils.clamp(BRIDGE_APPROACH_HOLD + climbLength, BRIDGE_RAMP_MIN, BRIDGE_RAMP_MAX);
}

function cumulativeDistances(path: THREE.Vector3[]): number[] {
  const result = [0];
  for (let i = 1; i < path.length; i++) {
    result.push(result[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z));
  }
  return result;
}

function smootherstep(edge0: number, edge1: number, value: number): number {
  const t = THREE.MathUtils.clamp((value - edge0) / Math.max(0.001, edge1 - edge0), 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
}
