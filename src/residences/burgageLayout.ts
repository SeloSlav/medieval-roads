import type { Point2 } from '../utils/polygonGeometry.ts';
import { residenceZoneCost } from '../resources/buildingEconomy.ts';

export type BurgageZoneCorners = {
  a: Point2;
  b: Point2;
  c: Point2;
  d: Point2;
};

export type BurgageFrontageEdge = 0 | 1 | 2 | 3;

export type BurgageParcelLayout = {
  index: number;
  polygon: Point2[];
  frontLeft: Point2;
  frontRight: Point2;
  area: number;
  backyardArea: number;
};

export type ResidencePlacement = {
  parcelIndex: number;
  x: number;
  z: number;
  yaw: number;
};

export type BurgageLayoutResult = {
  frontageLength: number;
  maxPlotCount: number;
  plotCount: number;
  parcels: BurgageParcelLayout[];
  residences: ResidencePlacement[];
  totalCost: { timber: number; stone: number };
};

export const MIN_PLOT_FRONTAGE = 8;
export const HOUSE_SETBACK = 3.5;
export const MAIN_HOUSE_WIDTH = 6.6;
export const MAIN_HOUSE_DEPTH = 7.4;
export const RESIDENCE_PICK_RADIUS = 5.5;
export const MIN_PARCEL_DEPTH = MAIN_HOUSE_DEPTH + HOUSE_SETBACK + 2.5;
export const MIN_ZONE_DEPTH = MIN_PARCEL_DEPTH;
/** Usable garden/livestock strip behind the house footprint. */
export const MAX_BACKYARD_DEPTH = 12;
export const MAX_ZONE_DEPTH = MAIN_HOUSE_DEPTH + HOUSE_SETBACK + MAX_BACKYARD_DEPTH;
export const MAX_ROAD_FRONTAGE_DISTANCE = 16;

const CORNER_KEYS = ['a', 'b', 'c', 'd'] as const;
const EDGE_PAIRS: ReadonlyArray<readonly [keyof BurgageZoneCorners, keyof BurgageZoneCorners]> = [
  ['a', 'b'],
  ['b', 'c'],
  ['c', 'd'],
  ['d', 'a'],
];

export function cornersToArray(corners: BurgageZoneCorners): Point2[] {
  return [corners.a, corners.b, corners.c, corners.d];
}

export function getZoneEdge(
  corners: BurgageZoneCorners,
  edge: BurgageFrontageEdge,
): [Point2, Point2] {
  const [startKey, endKey] = EDGE_PAIRS[edge];
  return [corners[startKey], corners[endKey]];
}

export function oppositeFrontageEdge(edge: BurgageFrontageEdge): BurgageFrontageEdge {
  return ((edge + 2) % 4) as BurgageFrontageEdge;
}

export function rotateFrontageEdge(edge: BurgageFrontageEdge): BurgageFrontageEdge {
  return ((edge + 1) % 4) as BurgageFrontageEdge;
}

export function suggestPlotCount(frontageLength: number): number {
  return Math.max(1, Math.floor(frontageLength / MIN_PLOT_FRONTAGE));
}

export function residenceZoneCostForLayout(residenceCount: number): { timber: number; stone: number } {
  return residenceZoneCost(residenceCount);
}

export function computeBurgageLayout(
  corners: BurgageZoneCorners,
  frontageEdge: BurgageFrontageEdge,
  requestedPlotCount: number,
): BurgageLayoutResult | null {
  const zoneCorners = cornersToArray(corners);
  if (!isValidZoneShape(zoneCorners)) return null;

  const [frontStart, frontEnd] = getZoneEdge(corners, frontageEdge);
  const frontageLength = Math.hypot(frontEnd.x - frontStart.x, frontEnd.z - frontStart.z);
  if (frontageLength < MIN_PLOT_FRONTAGE) return null;

  const maxPlotCount = suggestPlotCount(frontageLength);
  const plotCount = Math.max(1, Math.min(maxPlotCount, Math.round(requestedPlotCount)));

  const [rearEnd, rearStart] = getZoneEdge(corners, oppositeFrontageEdge(frontageEdge));
  const frontSplits = splitEdge(frontStart, frontEnd, plotCount);
  const rearSplits = splitEdge(rearStart, rearEnd, plotCount);

  const parcels: BurgageParcelLayout[] = [];
  const residences: ResidencePlacement[] = [];

  for (let i = 0; i < plotCount; i++) {
    const frontLeft = frontSplits[i];
    const frontRight = frontSplits[i + 1];
    const rearRight = rearSplits[i + 1];
    const rearLeft = rearSplits[i];
    const polygon = [frontLeft, frontRight, rearRight, rearLeft];
    const parcelFrontage = Math.hypot(frontRight.x - frontLeft.x, frontRight.z - frontLeft.z);
    if (parcelFrontage < MIN_PLOT_FRONTAGE * 0.92) continue;

    const parcelDepth = Math.min(
      distancePointToSegment(frontLeft, rearLeft, rearRight),
      distancePointToSegment(frontRight, rearLeft, rearRight),
    );
    if (parcelDepth < MIN_PARCEL_DEPTH) continue;

    const frontMid = midpoint(frontLeft, frontRight);
    const frontDir = normalize({
      x: frontRight.x - frontLeft.x,
      z: frontRight.z - frontLeft.z,
    });
    const inward = pickInwardNormal(frontMid, frontDir, polygon);
    const houseCenter = {
      x: frontMid.x + inward.x * (HOUSE_SETBACK + MAIN_HOUSE_DEPTH * 0.5),
      z: frontMid.z + inward.z * (HOUSE_SETBACK + MAIN_HOUSE_DEPTH * 0.5),
    };
    // Mesh door sits on local +Z; rotate so +Z points toward the road (-inward).
    const yaw = Math.atan2(inward.x, -inward.z);
    if (!footprintFits(houseCenter, yaw, polygon)) continue;

    const houseArea = MAIN_HOUSE_WIDTH * MAIN_HOUSE_DEPTH;
    const parcelArea = polygonArea(polygon);
    parcels.push({
      index: i,
      polygon,
      frontLeft,
      frontRight,
      area: parcelArea,
      backyardArea: Math.max(0, parcelArea - houseArea),
    });
    residences.push({
      parcelIndex: i,
      x: houseCenter.x,
      z: houseCenter.z,
      yaw,
    });
  }

  if (residences.length === 0) return null;

  return {
    frontageLength,
    maxPlotCount,
    plotCount: residences.length,
    parcels,
    residences,
    totalCost: residenceZoneCostForLayout(residences.length),
  };
}

/** Try the requested plot count, then fewer, until at least one cottage fits. */
export function resolveBurgageLayout(
  corners: BurgageZoneCorners,
  frontageEdge: BurgageFrontageEdge,
  requestedPlotCount: number,
): BurgageLayoutResult | null {
  const [frontStart, frontEnd] = getZoneEdge(corners, frontageEdge);
  const frontageLength = Math.hypot(frontEnd.x - frontStart.x, frontEnd.z - frontStart.z);
  const maxPlotCount = suggestPlotCount(frontageLength);
  const startCount = Math.max(1, Math.min(maxPlotCount, Math.round(requestedPlotCount)));
  for (let plotCount = startCount; plotCount >= 1; plotCount -= 1) {
    const layout = computeBurgageLayout(corners, frontageEdge, plotCount);
    if (layout && layout.residences.length > 0) return layout;
  }
  return null;
}

export function measureZoneDepth(corners: BurgageZoneCorners, frontageEdge: BurgageFrontageEdge): number {
  const [frontStart, frontEnd] = getZoneEdge(corners, frontageEdge);
  const [rearStart, rearEnd] = getZoneEdge(corners, oppositeFrontageEdge(frontageEdge));
  return Math.min(
    distancePointToSegment(frontStart, rearStart, rearEnd),
    distancePointToSegment(frontEnd, rearStart, rearEnd),
  );
}

function isValidZoneShape(corners: Point2[]): boolean {
  if (corners.length !== 4) return false;
  const [a, b, c, d] = corners;
  return isConvexQuad(a, b, c, d) && polygonArea([a, b, c, d]) >= MIN_PLOT_FRONTAGE * MIN_PARCEL_DEPTH;
}

function splitEdge(start: Point2, end: Point2, segments: number): Point2[] {
  const points: Point2[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    points.push({
      x: start.x + (end.x - start.x) * t,
      z: start.z + (end.z - start.z) * t,
    });
  }
  return points;
}

function midpoint(a: Point2, b: Point2): Point2 {
  return { x: (a.x + b.x) * 0.5, z: (a.z + b.z) * 0.5 };
}

function normalize(v: Point2): Point2 {
  const length = Math.hypot(v.x, v.z);
  if (length <= 1e-6) return { x: 0, z: 1 };
  return { x: v.x / length, z: v.z / length };
}

function polygonArea(points: Point2[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const next = points[(i + 1) % points.length];
    sum += points[i].x * next.z - next.x * points[i].z;
  }
  return Math.abs(sum) * 0.5;
}

function cross(a: Point2, b: Point2, c: Point2): number {
  return (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
}

function isConvexQuad(a: Point2, b: Point2, c: Point2, d: Point2): boolean {
  const signs = [Math.sign(cross(a, b, c)), Math.sign(cross(b, c, d)), Math.sign(cross(c, d, a)), Math.sign(cross(d, a, b))];
  if (signs.some((value) => value === 0)) return false;
  return signs.every((value) => value === signs[0]);
}

function distancePointToSegment(point: Point2, segStart: Point2, segEnd: Point2): number {
  const abx = segEnd.x - segStart.x;
  const abz = segEnd.z - segStart.z;
  const lengthSq = abx * abx + abz * abz;
  const t = lengthSq <= 1e-6 ? 0 : Math.max(0, Math.min(1, ((point.x - segStart.x) * abx + (point.z - segStart.z) * abz) / lengthSq));
  const px = segStart.x + abx * t;
  const pz = segStart.z + abz * t;
  return Math.hypot(point.x - px, point.z - pz);
}

function pickInwardNormal(frontMid: Point2, frontDir: Point2, polygon: Point2[]): Point2 {
  const left = { x: -frontDir.z, z: frontDir.x };
  const right = { x: frontDir.z, z: -frontDir.x };
  const leftProbe = { x: frontMid.x + left.x, z: frontMid.z + left.z };
  return isPointInPolygon(leftProbe, polygon) ? left : right;
}

function isPointInPolygon(point: Point2, polygon: Point2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const zi = polygon[i].z;
    const xj = polygon[j].x;
    const zj = polygon[j].z;
    const intersects =
      zi > point.z !== zj > point.z
      && point.x < ((xj - xi) * (point.z - zi)) / (zj - zi + 1e-9) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function footprintFits(center: Point2, yaw: number, polygon: Point2[]): boolean {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const halfW = MAIN_HOUSE_WIDTH * 0.5;
  const halfD = MAIN_HOUSE_DEPTH * 0.5;
  const locals = [
    { x: -halfW, z: -halfD },
    { x: halfW, z: -halfD },
    { x: halfW, z: halfD },
    { x: -halfW, z: halfD },
  ];
  return locals.every((local) => {
    const world = {
      x: center.x + local.x * cos - local.z * sin,
      z: center.z + local.x * sin + local.z * cos,
    };
    return isPointInPolygon(world, polygon);
  });
}

export function autoFrontageEdge(
  _corners: BurgageZoneCorners,
  roadDistance: (edge: BurgageFrontageEdge) => number,
): BurgageFrontageEdge {
  let bestEdge: BurgageFrontageEdge = 0;
  let bestDistance = Infinity;
  for (let edge = 0; edge < 4; edge++) {
    const distance = roadDistance(edge as BurgageFrontageEdge);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestEdge = edge as BurgageFrontageEdge;
    }
  }
  return bestEdge;
}

export function edgeMidpoint(corners: BurgageZoneCorners, edge: BurgageFrontageEdge): Point2 {
  const [start, end] = getZoneEdge(corners, edge);
  return midpoint(start, end);
}

export function cornersFromPoints(points: Point2[]): BurgageZoneCorners | null {
  if (points.length !== 4) return null;
  return { a: points[0], b: points[1], c: points[2], d: points[3] };
}

/** Vertical lot dividers between adjacent burgage parcels (front edge to rear edge). */
export function getParcelDividerSegments(layout: BurgageLayoutResult): Array<[Point2, Point2]> {
  const segments: Array<[Point2, Point2]> = [];
  for (let i = 0; i < layout.parcels.length - 1; i++) {
    const parcel = layout.parcels[i];
    segments.push([parcel.frontRight, parcel.polygon[2]]);
  }
  return segments;
}

function fenceEdgeKey(a: Point2, b: Point2): string {
  const ax = a.x.toFixed(2);
  const az = a.z.toFixed(2);
  const bx = b.x.toFixed(2);
  const bz = b.z.toFixed(2);
  if (ax < bx || (ax === bx && az <= bz)) return `${ax},${az}|${bx},${bz}`;
  return `${bx},${bz}|${ax},${az}`;
}

/** Unique parcel perimeter edges — shared lot lines appear once between neighbors. */
export function getParcelFenceSegments(layout: BurgageLayoutResult): Array<[Point2, Point2]> {
  const seen = new Map<string, [Point2, Point2]>();
  for (const parcel of layout.parcels) {
    const poly = parcel.polygon;
    for (let i = 0; i < poly.length; i++) {
      const start = poly[i];
      const end = poly[(i + 1) % poly.length];
      const key = fenceEdgeKey(start, end);
      if (!seen.has(key)) seen.set(key, [start, end]);
    }
  }
  return [...seen.values()];
}

export { CORNER_KEYS };
