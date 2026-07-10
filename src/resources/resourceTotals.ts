import {
  ABANDON_AFTER_DEFICIT_TICKS,
  BUILDING_DEFINITIONS,
  BUILDING_STORAGE_CAPS,
  POPULATION_PER_RESIDENCE,
  RESIDENCE_FIREWOOD_CAPACITY,
  RESIDENCE_FIREWOOD_PER_PERSON_PER_SEC,
  SIM_TICK_SECONDS,
  STARTING_POPULATION,
  type StorageCaps,
} from '../generated/gameBalance.ts';
import type { BuildingKind, BuildingState, GameState, ResidenceState } from './types.ts';
import {
  formatFirewoodRunwayDays,
  GAME_DAY_SECONDS,
  residenceFirewoodRunwayDays,
  residenceFirewoodRunwaySeconds,
} from '../logistics/firewoodLogistics.ts';

export {
  ABANDON_AFTER_DEFICIT_TICKS,
  formatFirewoodRunwayDays,
  GAME_DAY_SECONDS,
  POPULATION_PER_RESIDENCE,
  residenceFirewoodRunwayDays,
  residenceFirewoodRunwaySeconds,
  RESIDENCE_FIREWOOD_CAPACITY,
  RESIDENCE_FIREWOOD_PER_PERSON_PER_SEC,
  SIM_TICK_SECONDS,
  STARTING_POPULATION,
};

export type { StorageCaps };

export type ResourceTotals = {
  timber: number;
  stone: number;
  firewood: number;
  water: number;
};

export type PopulationStats = {
  total: number;
  assigned: number;
  available: number;
};

export function buildingStorageCaps(kind: BuildingKind): StorageCaps {
  return BUILDING_STORAGE_CAPS[kind];
}

export function buildingAcceptsLabor(kind: BuildingKind): boolean {
  return BUILDING_DEFINITIONS[kind].acceptsLabor;
}

export function buildingMaxLabor(kind: BuildingKind): number {
  const definition = BUILDING_DEFINITIONS[kind];
  return definition.acceptsLabor ? definition.maxLabor : 0;
}

export function laborScaledInterval(baseInterval: number, assignedLabor: number): number {
  if (assignedLabor <= 0 || baseInterval <= 0) return baseInterval;
  return baseInterval / assignedLabor;
}

let cachedState: GameState | null = null;
let cachedTotals: ResourceTotals | null = null;

export function computeResourceTotals(state: GameState): ResourceTotals {
  if (cachedState === state && cachedTotals) {
    return cachedTotals;
  }

  let timber = state.stockpile.timber;
  let stone = state.stockpile.stone;
  let firewood = state.stockpile.firewood;

  for (const building of state.buildings.values()) {
    timber += building.timber;
    stone += building.stone;
    firewood += building.firewood;
  }

  for (const residence of state.residences.values()) {
    firewood += residence.firewoodStock;
  }

  cachedTotals = {
    timber,
    stone,
    firewood,
    water: state.stockpile.water,
  };
  cachedState = state;
  return cachedTotals;
}

export function computePopulationStats(state: GameState): PopulationStats {
  let fromResidences = 0;
  for (const residence of state.residences.values()) {
    if (residence.abandoned) continue;
    fromResidences += residence.population;
  }

  const total = STARTING_POPULATION + fromResidences;
  let assigned = 0;
  for (const building of state.buildings.values()) {
    assigned += building.assignedLabor;
  }

  return {
    total,
    assigned,
    available: Math.max(0, total - assigned),
  };
}

export function maxAssignableLabor(
  building: BuildingState,
  stats: PopulationStats,
): number {
  const assignedElsewhere = stats.assigned - building.assignedLabor;
  const fromPool = Math.max(0, stats.total - assignedElsewhere);
  return Math.min(fromPool, buildingMaxLabor(building.kind));
}

export function residenceNeedsStatus(residence: ResidenceState): {
  label: string;
  state: 'active' | 'idle' | 'warning' | 'abandoned';
} {
  if (residence.abandoned) {
    return { label: 'Abandoned — firewood needs unmet', state: 'abandoned' };
  }
  if (residence.population === 0) {
    return { label: 'Unoccupied', state: 'idle' };
  }
  if (residence.needsDeficitTicks > 0) {
    const remainingTicks = Math.max(0, ABANDON_AFTER_DEFICIT_TICKS - residence.needsDeficitTicks);
    const remainingSeconds = remainingTicks * SIM_TICK_SECONDS;
    return {
      label: `Low firewood — abandons in ${formatShortDuration(remainingSeconds)}`,
      state: 'warning',
    };
  }

  const runwayDays = residenceFirewoodRunwayDays(residence);
  if (runwayDays == null) {
    return { label: 'Needs met', state: 'active' };
  }

  if (runwayDays <= 0.25) {
    return {
      label: 'Out of firewood — awaiting delivery',
      state: 'warning',
    };
  }
  if (runwayDays < 1) {
    return {
      label: `Low firewood — ${formatFirewoodRunwayDays(runwayDays)} left`,
      state: 'warning',
    };
  }
  if (runwayDays < 3) {
    return {
      label: `Firewood low — ${formatFirewoodRunwayDays(runwayDays)} left`,
      state: 'warning',
    };
  }
  return {
    label: `Needs met — ${formatFirewoodRunwayDays(runwayDays)} of firewood`,
    state: 'active',
  };
}

function formatShortDuration(seconds: number): string {
  if (seconds >= 120) {
    const minutes = Math.max(1, Math.round(seconds / 60));
    return `~${minutes} min`;
  }
  return `~${Math.max(1, Math.round(seconds))}s`;
}
