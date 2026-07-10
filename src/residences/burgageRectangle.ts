import type { Point2 } from '../utils/polygonGeometry.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import { distancePointToPolylineXZ } from '../utils/pathGeometry.ts';
import { MIN_ZONE_DEPTH } from './burgageLayout.ts';

export type RectangleCorners = {
  a: Point2;
  b: Point2;
  c: Point2;
  d: Point2;
};

const MIN_FRONTAGE_LENGTH = 4;

function normalize2(v: Point2): Point2 {
  const length = Math.hypot(v.x, v.z);
  if (length <= 1e-6) return { x: 0, z: 1 };
  return { x: v.x / length, z: v.z / length };
}

function subtract2(a: Point2, b: Point2): Point2 {
  return { x: a.x - b.x, z: a.z - b.z };
}

function add2(a: Point2, b: Point2): Point2 {
  return { x: a.x + b.x, z: a.z + b.z };
}

function scale2(v: Point2, scalar: number): Point2 {
  return { x: v.x * scalar, z: v.z * scalar };
}

function midpoint2(a: Point2, b: Point2): Point2 {
  return { x: (a.x + b.x) * 0.5, z: (a.z + b.z) * 0.5 };
}

function nearestRoadDistance(x: number, z: number, roadNetwork: RoadNetwork): number {
  const paths = [...roadNetwork.edges.values()].map((edge) => edge.sampledPath);
  if (paths.length === 0) return Infinity;
  let minDistance = Infinity;
  for (const path of paths) {
    minDistance = Math.min(minDistance, distancePointToPolylineXZ(x, z, path));
  }
  return minDistance;
}

/** Perpendicular into the lot (away from the road along the frontage edge). */
export function inwardNormalForFrontage(
  frontStart: Point2,
  frontEnd: Point2,
  roadNetwork: RoadNetwork,
): Point2 {
  const frontDir = normalize2(subtract2(frontEnd, frontStart));
  const left = { x: -frontDir.z, z: frontDir.x };
  const right = { x: frontDir.z, z: -frontDir.x };
  const mid = midpoint2(frontStart, frontEnd);
  const probe = 7;
  const leftDist = nearestRoadDistance(mid.x + left.x * probe, mid.z + left.z * probe, roadNetwork);
  const rightDist = nearestRoadDistance(mid.x + right.x * probe, mid.z + right.z * probe, roadNetwork);
  return leftDist >= rightDist ? left : right;
}

export function depthFromBackPoint(
  frontStart: Point2,
  _frontEnd: Point2,
  backPoint: Point2,
  inward: Point2,
): number {
  const fromStart = subtract2(backPoint, frontStart);
  const depth = fromStart.x * inward.x + fromStart.z * inward.z;
  return Math.max(MIN_ZONE_DEPTH, depth);
}

/** Frontage A-B on road; C and D complete the rectangle behind the frontage. */
export function rectangleFromFrontageAndDepth(
  frontStart: Point2,
  frontEnd: Point2,
  depth: number,
  inward: Point2,
): RectangleCorners {
  const offset = scale2(inward, depth);
  return {
    a: frontStart,
    b: frontEnd,
    c: add2(frontEnd, offset),
    d: add2(frontStart, offset),
  };
}

export function rectangleFromFrontageAndBackPoint(
  frontStart: Point2,
  frontEnd: Point2,
  backPoint: Point2,
  roadNetwork: RoadNetwork,
): RectangleCorners | null {
  const frontLength = Math.hypot(frontEnd.x - frontStart.x, frontEnd.z - frontStart.z);
  if (frontLength < MIN_FRONTAGE_LENGTH) return null;
  const inward = inwardNormalForFrontage(frontStart, frontEnd, roadNetwork);
  const depth = depthFromBackPoint(frontStart, frontEnd, backPoint, inward);
  return rectangleFromFrontageAndDepth(frontStart, frontEnd, depth, inward);
}

export function rectangleCornersToPoints(corners: RectangleCorners): Point2[] {
  return [corners.a, corners.b, corners.c, corners.d];
}
