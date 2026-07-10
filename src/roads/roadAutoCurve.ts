import type { GameState } from '../resources/types.ts';
import {
  collectRoadFootprintObstaclesInBounds,
  computeAutoSegmentCurve,
  RoadFootprintObstacleIndex,
} from './roadFootprintObstacles.ts';
import type { PathBoundsXZ } from '../utils/pathGeometry.ts';

export function mergeManualAndAutoCurve(manualCurve: number, autoCurve: number): number {
  if (Math.abs(autoCurve) < 0.05) return manualCurve;
  if (Math.sign(manualCurve) === Math.sign(autoCurve) || Math.abs(manualCurve) < 0.05) {
    return autoCurve + manualCurve * 0.3;
  }
  return autoCurve;
}

export function computePendingRoadAutoCurve(
  start: { x: number; z: number },
  end: { x: number; z: number },
  state: GameState | undefined,
  roadHalfWidth: number,
  maxCurve: number,
): number {
  if (!state) return 0;
  const queryPadding = Math.max(roadHalfWidth + 2, maxCurve * 0.65);
  const bounds = segmentBounds(start, end, queryPadding);
  const obstacles = collectRoadFootprintObstaclesInBounds(state, roadHalfWidth, bounds);
  if (obstacles.length === 0) return 0;
  const index = new RoadFootprintObstacleIndex(obstacles);
  const nearby = index.querySegment(start, end, queryPadding);
  return computeAutoSegmentCurve(start, end, nearby, maxCurve);
}

function segmentBounds(
  start: { x: number; z: number },
  end: { x: number; z: number },
  padding: number,
): PathBoundsXZ {
  return {
    minX: Math.min(start.x, end.x) - padding,
    maxX: Math.max(start.x, end.x) + padding,
    minZ: Math.min(start.z, end.z) - padding,
    maxZ: Math.max(start.z, end.z) + padding,
  };
}
