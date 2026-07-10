import type { GameState } from '../resources/types.ts';
import {
  collectRoadFootprintObstacles,
  computeAutoSegmentCurve,
} from './roadFootprintObstacles.ts';

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
  const obstacles = collectRoadFootprintObstacles(state, roadHalfWidth);
  return computeAutoSegmentCurve(start, end, obstacles, maxCurve);
}
