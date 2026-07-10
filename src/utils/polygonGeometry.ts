export type Point2 = {
  x: number;
  z: number;
};

export function distance2(a: Point2, b: Point2): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function midpoint2(a: Point2, b: Point2): Point2 {
  return { x: (a.x + b.x) * 0.5, z: (a.z + b.z) * 0.5 };
}

export function lerp2(a: Point2, b: Point2, t: number): Point2 {
  return {
    x: a.x + (b.x - a.x) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

export function splitEdge2(start: Point2, end: Point2, segments: number): Point2[] {
  const points: Point2[] = [];
  for (let i = 0; i <= segments; i++) {
    points.push(lerp2(start, end, i / segments));
  }
  return points;
}

export function polygonArea2(points: Point2[]): number {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const next = points[(i + 1) % points.length];
    sum += points[i].x * next.z - next.x * points[i].z;
  }
  return Math.abs(sum) * 0.5;
}

export function isPointInPolygon2(point: Point2, polygon: Point2[]): boolean {
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

export function cross2(a: Point2, b: Point2, c: Point2): number {
  return (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
}

/** True when four corners form a simple convex quad in winding order. */
export function isConvexQuad2(a: Point2, b: Point2, c: Point2, d: Point2): boolean {
  const signs = [
    Math.sign(cross2(a, b, c)),
    Math.sign(cross2(b, c, d)),
    Math.sign(cross2(c, d, a)),
    Math.sign(cross2(d, a, b)),
  ];
  if (signs.some((value) => value === 0)) return false;
  return signs.every((value) => value === signs[0]);
}

export function normalize2(v: Point2): Point2 {
  const length = Math.hypot(v.x, v.z);
  if (length <= 1e-6) return { x: 0, z: 0 };
  return { x: v.x / length, z: v.z / length };
}

export function subtract2(a: Point2, b: Point2): Point2 {
  return { x: a.x - b.x, z: a.z - b.z };
}

export function add2(a: Point2, b: Point2): Point2 {
  return { x: a.x + b.x, z: a.z + b.z };
}

export function scale2(v: Point2, scalar: number): Point2 {
  return { x: v.x * scalar, z: v.z * scalar };
}

export function perpendicularLeft2(v: Point2): Point2 {
  return { x: -v.z, z: v.x };
}

export function perpendicularRight2(v: Point2): Point2 {
  return { x: v.z, z: -v.x };
}

export function distancePointToSegment2(point: Point2, segStart: Point2, segEnd: Point2): number {
  const abx = segEnd.x - segStart.x;
  const abz = segEnd.z - segStart.z;
  const lengthSq = abx * abx + abz * abz;
  const t = lengthSq <= 1e-6
    ? 0
    : Math.max(0, Math.min(1, ((point.x - segStart.x) * abx + (point.z - segStart.z) * abz) / lengthSq));
  const px = segStart.x + abx * t;
  const pz = segStart.z + abz * t;
  return Math.hypot(point.x - px, point.z - pz);
}

export function polygonCentroid2(polygon: Point2[]): Point2 {
  let x = 0;
  let z = 0;
  for (const point of polygon) {
    x += point.x;
    z += point.z;
  }
  const count = polygon.length;
  return { x: x / count, z: z / count };
}

export function pointStrictlyInsidePolygon2(
  point: Point2,
  polygon: Point2[],
  boundaryEpsilon = 0.12,
): boolean {
  if (!isPointInPolygon2(point, polygon)) return false;
  for (let i = 0; i < polygon.length; i++) {
    const start = polygon[i];
    const end = polygon[(i + 1) % polygon.length];
    if (distancePointToSegment2(point, start, end) <= boundaryEpsilon) return false;
  }
  return true;
}

export function segmentsIntersectProperly2(
  a1: Point2,
  a2: Point2,
  b1: Point2,
  b2: Point2,
  epsilon: number,
): boolean {
  const d1 = cross2(b1, b2, a1);
  const d2 = cross2(b1, b2, a2);
  const d3 = cross2(a1, a2, b1);
  const d4 = cross2(a1, a2, b2);
  return (
    ((d1 > epsilon && d2 < -epsilon) || (d1 < -epsilon && d2 > epsilon))
    && ((d3 > epsilon && d4 < -epsilon) || (d3 < -epsilon && d4 > epsilon))
  );
}

/** True when two convex polygons share interior area (touching at edges/corners is allowed). */
export function convexPolygonsOverlap2(
  a: Point2[],
  b: Point2[],
  boundaryEpsilon = 0.12,
): boolean {
  const samplesA = [...a, polygonCentroid2(a)];
  const samplesB = [...b, polygonCentroid2(b)];

  for (const point of samplesA) {
    if (pointStrictlyInsidePolygon2(point, b, boundaryEpsilon)) return true;
  }
  for (const point of samplesB) {
    if (pointStrictlyInsidePolygon2(point, a, boundaryEpsilon)) return true;
  }

  for (let i = 0; i < a.length; i++) {
    const a1 = a[i];
    const a2 = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j++) {
      const b1 = b[j];
      const b2 = b[(j + 1) % b.length];
      if (segmentsIntersectProperly2(a1, a2, b1, b2, boundaryEpsilon)) return true;
    }
  }

  return false;
}

export function orientedRectCorners2(
  center: Point2,
  yaw: number,
  halfWidth: number,
  halfDepth: number,
): Point2[] {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return [
    { x: -halfWidth, z: -halfDepth },
    { x: halfWidth, z: -halfDepth },
    { x: halfWidth, z: halfDepth },
    { x: -halfWidth, z: halfDepth },
  ].map((local) => ({
    x: center.x + local.x * cos - local.z * sin,
    z: center.z + local.x * sin + local.z * cos,
  }));
}

export function orientedFootprintFits(
  center: Point2,
  yaw: number,
  halfWidth: number,
  halfDepth: number,
  polygon: Point2[],
): boolean {
  const corners = orientedRectCorners2(center, yaw, halfWidth, halfDepth);
  return corners.every((corner) => isPointInPolygon2(corner, polygon));
}
