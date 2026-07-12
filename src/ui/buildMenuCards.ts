import type { BuildingKind } from '../generated/gameBalance.ts';
import { formatBuildingCost, getBuildingCost, residenceZoneCost } from '../resources/buildingEconomy.ts';
import { MENU_ACTION_TO_BUILDING_KIND } from './buildMenuMapping.ts';

const BUILD_CARD_ART = {
  lumber_mill: '/assets/ui/build-menu/lumber-mill.png',
  reforester: '/assets/ui/build-menu/reforester.png',
  woodcutters_lodge: '/assets/ui/build-menu/woodcutters-lodge.png',
  stone_quarry: '/assets/ui/build-menu/stonecutters-camp.png',
  well: '/assets/ui/build-menu/water-well.png',
  hunters_hall: '/assets/ui/build-menu/hunter-hall.png',
  foragers_shed: '/assets/ui/build-menu/foragers-hut.png',
  chapel: '/assets/ui/build-menu/chapel.png',
  marketplace: '/assets/ui/build-menu/market.png',
  residences: '/assets/ui/build-menu/residence.png',
} as const;

type PlacementArtKey = keyof typeof BUILD_CARD_ART;

const BUILD_CARD_COPY: Record<PlacementArtKey, {
  title: string;
  hotkey: string;
  description: string;
  cost: () => string;
}> = {
  lumber_mill: {
    title: 'Lumber mill',
    hotkey: 'L',
    description: 'Workers fell mature trees in a wide radius and stockpile timber for building.',
    cost: () => formatBuildingCost(getBuildingCost('lumber_mill')),
  },
  stone_quarry: {
    title: "Stonecutter's camp",
    hotkey: 'S',
    description: 'Quarries stone from rock outcrops within range for walls and foundations.',
    cost: () => formatBuildingCost(getBuildingCost('stone_quarry')),
  },
  reforester: {
    title: 'Reforester',
    hotkey: 'F',
    description: 'Regrows cleared woodland, turning stumps into saplings and mature forest.',
    cost: () => formatBuildingCost(getBuildingCost('reforester')),
  },
  woodcutters_lodge: {
    title: "Woodcutter's lodge",
    hotkey: 'W',
    description: 'Chops timber into firewood and hauls it to homes along connected roads.',
    cost: () => formatBuildingCost(getBuildingCost('woodcutters_lodge')),
  },
  well: {
    title: 'Well',
    hotkey: 'E',
    description: 'Draws groundwater along roads to homes within range. Yield depends on local hydrology and assigned labor.',
    cost: () => formatBuildingCost(getBuildingCost('well')),
  },
  hunters_hall: {
    title: "Hunter's hall",
    hotkey: 'K',
    description: 'Hunts game from forest trails and hauls food to homes along connected roads.',
    cost: () => formatBuildingCost(getBuildingCost('hunters_hall')),
  },
  foragers_shed: {
    title: "Forager's shed",
    hotkey: 'Y',
    description: 'Gathers berries from forest edges and delivers food via road-connected routes.',
    cost: () => formatBuildingCost(getBuildingCost('foragers_shed')),
  },
  chapel: {
    title: 'Chapel',
    hotkey: 'C',
    description: 'Village chapel on the road. Assign a priest to collect tithes from household wealth and boost road-linked homes — faster settlement, longer grace, easier recovery.',
    cost: () => formatBuildingCost(getBuildingCost('chapel')),
  },
  marketplace: {
    title: 'Marketplace',
    hotkey: 'P',
    description: 'Trade hub on the road. Buy and sell goods with neighboring villages, and link homes to sell backyard produce.',
    cost: () => formatBuildingCost(getBuildingCost('marketplace')),
  },
  residences: {
    title: 'Residence',
    hotkey: 'H',
    description: 'Draw residence plots along a road. Three clicks: frontage start, frontage end, then backyard depth.',
    cost: () => `${formatBuildingCost(residenceZoneCost(1))} per home`,
  },
};

export type PlacementBuildMenuAction =
  | 'lumber-mill'
  | 'stone-quarry'
  | 'reforester'
  | 'woodcutters-lodge'
  | 'well'
  | 'hunters-hall'
  | 'foragers-shed'
  | 'chapel'
  | 'marketplace'
  | 'residences';

export type BuildMenuAction = PlacementBuildMenuAction;

export type BuildMenuEntry = { kind: 'placement'; action: PlacementBuildMenuAction; artKey: PlacementArtKey };

/** Settlement essentials: housing, water, civic buildings, and raw-material extraction. */
export const BASIC_BUILD_MENU_ENTRIES: readonly BuildMenuEntry[] = [
  { kind: 'placement', action: 'residences', artKey: 'residences' },
  { kind: 'placement', action: 'well', artKey: 'well' },
  { kind: 'placement', action: 'chapel', artKey: 'chapel' },
  { kind: 'placement', action: 'lumber-mill', artKey: 'lumber_mill' },
  { kind: 'placement', action: 'stone-quarry', artKey: 'stone_quarry' },
];

/** Production chain: forestry, provisioning, and trade buildings. */
export const INDUSTRY_BUILD_MENU_ENTRIES: readonly BuildMenuEntry[] = [
  { kind: 'placement', action: 'reforester', artKey: 'reforester' },
  { kind: 'placement', action: 'woodcutters-lodge', artKey: 'woodcutters_lodge' },
  { kind: 'placement', action: 'hunters-hall', artKey: 'hunters_hall' },
  { kind: 'placement', action: 'foragers-shed', artKey: 'foragers_shed' },
  { kind: 'placement', action: 'marketplace', artKey: 'marketplace' },
];

export const BUILD_MENU_ENTRIES: readonly BuildMenuEntry[] = [
  ...BASIC_BUILD_MENU_ENTRIES,
  ...INDUSTRY_BUILD_MENU_ENTRIES,
];

export type BuildMenuHandlers = {
  onToggleBuilding: (kind: BuildingKind) => void;
  onToggleResidences: () => void;
};

export function renderBuildMenuCards(entries: readonly BuildMenuEntry[] = BUILD_MENU_ENTRIES): string {
  return entries.map(renderBuildMenuEntry).join('');
}

export function resolveBuildMenuHotkey(
  key: string,
  entries: readonly BuildMenuEntry[] = BUILD_MENU_ENTRIES,
): BuildMenuAction | null {
  const normalized = key.toLowerCase();
  for (const entry of entries) {
    const hotkey = BUILD_CARD_COPY[entry.artKey].hotkey.toLowerCase();
    if (hotkey === normalized) {
      return entry.action;
    }
  }
  return null;
}

export function runBuildMenuAction(
  action: BuildMenuAction,
  handlers: BuildMenuHandlers,
  closeMenu: () => void,
): void {
  closeMenu();
  if (action === 'residences') {
    handlers.onToggleResidences();
    return;
  }
  const kind = MENU_ACTION_TO_BUILDING_KIND[action];
  handlers.onToggleBuilding(kind);
}

function renderBuildMenuEntry(entry: BuildMenuEntry): string {
  const copy = BUILD_CARD_COPY[entry.artKey];
  const cost = copy.cost();
  return `
          <button type="button" class="construction-card" data-action="${entry.action}" data-hotkey="${copy.hotkey}" aria-label="${copy.title} (${copy.hotkey})">
            <img class="construction-card__art" src="${BUILD_CARD_ART[entry.artKey]}" alt="" draggable="false" />
            <span class="construction-card__hotkey" aria-hidden="true">${copy.hotkey}</span>
            <span class="construction-card__tooltip" role="tooltip">
              <span class="construction-card__tooltip-title">${copy.title} (${copy.hotkey})</span>
              <span class="construction-card__tooltip-desc">${copy.description}</span>
              <span class="construction-card__tooltip-cost">Cost: ${cost}</span>
            </span>
          </button>`;
}
