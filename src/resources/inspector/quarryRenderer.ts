import type { InspectableTarget } from '../types.ts';
import type { InspectorRenderContext, InspectorView } from './renderInspectableTarget.ts';
import { hiddenDemolish, hiddenLabor } from './renderInspectableTarget.ts';

export function renderQuarryInspector(
  target: Extract<InspectableTarget, { kind: 'quarry' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { definition, state } = target;
  const nearestRoad = context.worldQueries.getNearestRoadNodeDistance(definition.x, definition.z);

  return {
    eyebrow: 'Quarry',
    title: definition.label,
    statusText: state.remaining > 0
      ? `${Math.round(state.remaining)} / ${Math.round(state.maxYield)} stone remaining`
      : 'Depleted — no stone left',
    statusState: state.remaining > 0 ? 'active' : 'idle',
    detailsHtml: `
      <li><span>Nearest road</span><span>${nearestRoad == null ? 'None nearby' : `${nearestRoad.toFixed(1)} m`}</span></li>
      <li><span>Labor</span><span>Assign at a stonecutter's camp</span></li>
    `,
    demolish: hiddenDemolish(),
    labor: hiddenLabor(),
  };
}
