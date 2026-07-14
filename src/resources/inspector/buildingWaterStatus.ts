import type { BuildingState } from '../types.ts';
import type { WorldQueries } from '../WorldQueries.ts';

export type WellWaterAssessment = {
  required: number;
  connectedWells: BuildingState[];
  wellsWithWater: number;
  hasLinkedWell: boolean;
  hasWaterAvailable: boolean;
  wellSummary: string;
};

export function assessWellWaterSupply(
  building: BuildingState,
  worldQueries: WorldQueries,
  requiredPerCycle: number,
): WellWaterAssessment | null {
  if (requiredPerCycle <= 0) return null;

  const connectedWells = worldQueries.getRoadConnectedWells(building);
  const wellsWithWater = connectedWells.filter((well) => well.water > 0).length;
  const nearestWell = connectedWells[0];
  const nearestWellDistance = nearestWell
    ? worldQueries.getRoadPathDistance(building.x, building.z, nearestWell.x, nearestWell.z)
    : null;
  const drySuffix = connectedWells.length > 0 && wellsWithWater === 0 ? ', all dry' : '';
  const wellSummary = connectedWells.length === 0
    ? 'None — build a well and connect by road'
    : `${connectedWells.length} by road${nearestWellDistance != null ? ` (nearest ${nearestWellDistance.toFixed(0)} m)` : ''}${drySuffix}`;

  return {
    required: requiredPerCycle,
    connectedWells,
    wellsWithWater,
    hasLinkedWell: connectedWells.length > 0,
    hasWaterAvailable: building.water + 1e-6 >= requiredPerCycle || wellsWithWater > 0,
    wellSummary,
  };
}

export function formatWellWaterDetailRows(
  assessment: WellWaterAssessment | null,
  noneLabel?: string,
): string {
  if (!assessment) {
    return noneLabel ? `<li><span>Water use</span><span>${noneLabel}</span></li>` : '';
  }
  return `<li><span>Road-linked wells</span><span>${assessment.wellSummary}</span></li><li><span>Water per cycle</span><span>${assessment.required}</span></li>`;
}

export function wellWaterStatusIssue(assessment: WellWaterAssessment | null): string | null {
  if (!assessment) return null;
  if (!assessment.hasLinkedWell) {
    return 'Idle — needs a road-connected well to operate';
  }
  if (!assessment.hasWaterAvailable) {
    return `Waiting for water — needs ${assessment.required} per cycle`;
  }
  return null;
}
