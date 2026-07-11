import { getBuildingCost } from '../buildingEconomy.ts';
import type { InspectableTarget } from '../types.ts';
import {
  buildChapelInspectorEconomyView,
  formatChapelCommunityBoosts,
  formatChapelExpenseLabel,
} from '../../economy/economyInspectorViews.ts';
import { isChapelStaffed } from '../../logistics/landmarkAccess.ts';
import { CHAPEL_COFFER_CAPACITY } from '../../generated/gameBalance.ts';
import {
  buildingCostRows,
  buildingDemolishHint,
  buildingLaborView,
  buildingRoadAccessRow,
} from './buildingCommon.ts';
import type { InspectorRenderContext, InspectorView } from './renderInspectableTarget.ts';

export const CHAPEL_COFFER_COLLECT_ACTION = 'collect-chapel-coffer';

function formatLinkedHomeStatus(connectedHomes: number, linkedPopulation: number, staffed: boolean): string {
  if (!staffed) {
    return 'Assign a priest to open parish services';
  }
  if (connectedHomes <= 0) {
    return 'Priest ready — awaiting road-linked homes';
  }
  return `Serving ${connectedHomes} road-linked home${connectedHomes === 1 ? '' : 's'} (${linkedPopulation} villagers)`;
}

export function isChapelCofferCollectAction(button: HTMLElement): boolean {
  return button.closest(`[data-action="${CHAPEL_COFFER_COLLECT_ACTION}"]`) != null;
}

export function renderChapelInspector(
  target: Extract<InspectableTarget, { kind: 'building' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { building } = target;
  const label = context.worldQueries.getBuildingLabel(building.kind);
  const cost = getBuildingCost(building.kind);
  const staffed = isChapelStaffed(building);
  const connectedHomes = context.worldQueries.countRoadConnectedResidences(building, false);
  const linkedPopulation = context.worldQueries.countRoadConnectedPopulation(building);
  const { settlementBoost, abandonmentGrace } = formatChapelCommunityBoosts();
  const economy = buildChapelInspectorEconomyView(
    building,
    linkedPopulation,
    CHAPEL_COFFER_CAPACITY,
    CHAPEL_COFFER_COLLECT_ACTION,
  );
  const cofferLabel = `${economy.cofferGold.toFixed(1)} / ${economy.cofferCapacity} gold${economy.cofferFull ? ' · full — overflow to treasury' : ''}`;
  const collectPanelHtml = economy.cofferGold > 0.05
    ? `
    <div class="inspector-action-panel">
      <p class="inspector-action-panel__hint">Tithes are held in the parish coffer until you collect them into treasury.</p>
      <button type="button" class="inspector-action-panel__button" data-action="${CHAPEL_COFFER_COLLECT_ACTION}">
        Collect coffer (${economy.cofferGold.toFixed(1)} gold)
      </button>
    </div>
  `
    : undefined;

  return {
    eyebrow: 'Building',
    title: label,
    statusText: formatLinkedHomeStatus(connectedHomes, linkedPopulation, staffed),
    statusState: staffed && connectedHomes > 0 ? 'ok' : staffed ? 'idle' : 'draft',
    detailsHtml: `
      ${buildingCostRows(building.kind, cost)}
      ${buildingRoadAccessRow(context.worldQueries, building)}
      <li><span>Purpose</span><span>Parish hub — tithes, settlement, resilience, and easier recovery</span></li>
      <li><span>Priest</span><span>${staffed ? 'Serving the parish' : 'Unstaffed — benefits inactive'}</span></li>
      <li><span>Coffer</span><span>${cofferLabel}</span></li>
      <li><span>Linked homes</span><span>${connectedHomes}</span></li>
      <li><span>Linked population</span><span>${linkedPopulation}</span></li>
      <li><span>Tithe yield</span><span>${staffed ? economy.titheLabel : '—'}</span></li>
      <li><span>Parish expenses</span><span>${formatChapelExpenseLabel(economy.expense, staffed)}</span></li>
      <li><span>Attendance</span><span>${staffed ? economy.attendanceLabel : '—'}</span></li>
      <li><span>Settlement</span><span>${settlementBoost} faster when staffed & linked</span></li>
      <li><span>Shortages</span><span>${abandonmentGrace} longer before abandonment</span></li>
      <li><span>Recovery</span><span>${economy.recoveryLabel}</span></li>
    `,
    demolish: {
      visible: true,
      hint: buildingDemolishHint(building.kind),
    },
    labor: buildingLaborView(building, context.populationStats),
    supplementalPanelHtml: collectPanelHtml,
  };
}
