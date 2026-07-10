import type { RiverCorridor, RiverLayout } from './RiverLayout.ts';
import { hashF64 } from './riverHash.ts';

export type RiverCrossingGap = {
  corridorIndex: number;
  progress: number;
  centerX: number;
  centerZ: number;
  clearRadius: number;
};

const MAIN_CORRIDOR_COUNT = 4;
const GAPS_PER_CORRIDOR = 3;
const GAP_CLEAR_RADIUS = 26;
const MIN_GAP_PROGRESS = 0.14;
const MAX_GAP_PROGRESS = 0.86;

export function buildRiverShoreCrossingGaps(layout: RiverLayout): RiverCrossingGap[] {
  const gaps: RiverCrossingGap[] = [];

  for (let corridorIndex = 0; corridorIndex < Math.min(MAIN_CORRIDOR_COUNT, layout.corridors.length); corridorIndex++) {
    const corridor = layout.corridors[corridorIndex];
    const gapCount = GAPS_PER_CORRIDOR + (hashF64(layout.seed ^ 0x6055, corridorIndex, 0) > 0.62 ? 1 : 0);

    for (let gapIndex = 0; gapIndex < gapCount; gapIndex++) {
      const slot = (gapIndex + 1) / (gapCount + 1);
      const baseProgress = MIN_GAP_PROGRESS + slot * (MAX_GAP_PROGRESS - MIN_GAP_PROGRESS);
      const jitter = (hashF64(layout.seed ^ 0x60ad, corridorIndex, gapIndex + 1) - 0.5) * 0.09;
      const progress = Math.max(MIN_GAP_PROGRESS, Math.min(MAX_GAP_PROGRESS, baseProgress + jitter));
      const center = corridorPointAtProgress(corridor, progress);
      if (!center) continue;

      gaps.push({
        corridorIndex,
        progress,
        centerX: center.x,
        centerZ: center.z,
        clearRadius: GAP_CLEAR_RADIUS,
      });
    }
  }

  return gaps;
}

/** True when a shore point sits inside a rare river-crossing clearance zone. */
export function isInRiverShoreCrossingGap(
  layout: RiverLayout,
  gaps: RiverCrossingGap[],
  x: number,
  z: number,
): boolean {
  if (gaps.length === 0) return false;

  const hit = sampleNearestCorridor(layout, x, z);
  if (!hit) return false;

  const shoreMin = hit.halfWidth * 0.42;
  const shoreMax = hit.halfWidth * 1.35;
  if (hit.distance < shoreMin || hit.distance > shoreMax) return false;

  for (const gap of gaps) {
    if (gap.corridorIndex !== hit.corridorIndex) continue;
    const distSq = (x - gap.centerX) ** 2 + (z - gap.centerZ) ** 2;
    if (distSq <= gap.clearRadius * gap.clearRadius) return true;
    if (Math.abs(hit.progress - gap.progress) <= 0.055) return true;
  }

  return false;
}

function corridorPointAtProgress(
  corridor: RiverCorridor,
  targetProgress: number,
): { x: number; z: number } | null {
  const points = corridor.points;
  if (points.length === 0) return null;

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (targetProgress < a.progress || targetProgress > b.progress) continue;
    const span = b.progress - a.progress;
    const t = span <= 1e-6 ? 0 : (targetProgress - a.progress) / span;
    return {
      x: a.x + (b.x - a.x) * t,
      z: a.z + (b.z - a.z) * t,
    };
  }

  const last = points[points.length - 1];
  return { x: last.x, z: last.z };
}

function sampleNearestCorridor(
  layout: RiverLayout,
  x: number,
  z: number,
): { corridorIndex: number; distance: number; halfWidth: number; progress: number } | null {
  let best:
    | { corridorIndex: number; distance: number; halfWidth: number; progress: number }
    | null = null;

  for (let corridorIndex = 0; corridorIndex < layout.corridors.length; corridorIndex++) {
    const corridor = layout.corridors[corridorIndex];
    const points = corridor.points;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      const hit = distanceToSegment(x, z, a.x, a.z, b.x, b.z);
      if (best && hit.distance >= best.distance) continue;
      best = {
        corridorIndex,
        distance: hit.distance,
        halfWidth: a.halfWidth + (b.halfWidth - a.halfWidth) * hit.t,
        progress: a.progress + (b.progress - a.progress) * hit.t,
      };
    }
  }

  if (!best || best.distance > best.halfWidth * 1.35) return null;
  return best;
}

function distanceToSegment(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): { distance: number; t: number } {
  const abx = bx - ax;
  const abz = bz - az;
  const lengthSq = abx * abx + abz * abz;
  const t = lengthSq <= 1e-6 ? 0 : Math.max(0, Math.min(1, ((px - ax) * abx + (pz - az) * abz) / lengthSq));
  const cx = ax + abx * t;
  const cz = az + abz * t;
  return { distance: Math.hypot(px - cx, pz - cz), t };
}
