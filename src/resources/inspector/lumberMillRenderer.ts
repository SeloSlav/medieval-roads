import { getBuildingCost } from '../buildingEconomy.ts';
import { getBuildingDefinition } from '../buildings.ts';
import { laborScaledInterval } from '../resourceTotals.ts';
import type { InspectableTarget } from '../types.ts';
import {
  buildingCostRows,
  buildingDemolishHint,
  buildingLaborView,
  buildingRoadAccessRow,
  buildingStorageRows,
  buildingWorkRadiusRow,
  treeCountRows,
} from './buildingCommon.ts';
import { getBuildingProcessorStatus } from './buildingProcessorStatus.ts';
import type { InspectorRenderContext, InspectorView } from './renderInspectableTarget.ts';

export function renderLumberMillInspector(
  target: Extract<InspectableTarget, { kind: 'building' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { building, matureTrees, stumpTrees, growingTrees } = target;
  const label = context.worldQueries.getBuildingLabel(building.kind);
  const cost = getBuildingCost(building.kind);
  const definition = getBuildingDefinition(building.kind);
  const processorStatus = getBuildingProcessorStatus(building, context.worldQueries, { matureTrees });
  const cycleSeconds = laborScaledInterval(definition.harvestInterval, building.assignedLabor);

  return {
    eyebrow: 'Building',
    title: label,
    statusText: processorStatus?.statusText ?? 'Idle',
    statusState: processorStatus?.statusState ?? 'idle',
    detailsHtml: `
      ${buildingCostRows(building.kind, cost)}
      ${buildingRoadAccessRow(context.worldQueries, building)}
      ${processorStatus?.waterDetailHtml ?? ''}
      ${buildingWorkRadiusRow(building.kind)}
      <li><span>Harvest interval</span><span>${building.assignedLabor > 0 ? `${cycleSeconds.toFixed(1)}s` : `${definition.harvestInterval}s`} (${building.assignedLabor} workers)</span></li>
      ${treeCountRows(matureTrees, stumpTrees, growingTrees)}
      ${buildingStorageRows(building, building.kind)}
    `,
    demolish: {
      visible: true,
      hint: buildingDemolishHint(building.kind),
    },
    labor: buildingLaborView(building, context.populationStats),
  };
}
