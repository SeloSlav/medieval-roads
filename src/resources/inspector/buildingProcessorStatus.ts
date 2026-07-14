import {
  BREWERY_GRAIN_PER_CYCLE,
  BREWERY_WATER_PER_CYCLE,
  GRANARY_FIREWOOD_PER_CYCLE,
  GRANARY_FLOUR_PER_CYCLE,
  GRANARY_WATER_PER_CYCLE,
  MILL_WATER_PER_HARVEST,
  MONASTERY_GRAIN_PER_CYCLE,
  MONASTERY_UNLINKED_PRODUCTIVITY,
  SMOKEHOUSE_FIREWOOD_PER_CYCLE,
  SMOKEHOUSE_FOOD_PER_CYCLE,
  WATERMILL_GRAIN_PER_CYCLE,
} from '../../generated/gameBalance.ts';
import { getBuildingDefinition } from '../buildings.ts';
import { buildingStorageCaps } from '../resourceTotals.ts';
import type { BuildingKind, BuildingState } from '../types.ts';
import type { WorldQueries } from '../WorldQueries.ts';
import {
  assessWellWaterSupply,
  formatWellWaterDetailRows,
  wellWaterStatusIssue,
  type WellWaterAssessment,
} from './buildingWaterStatus.ts';

export type BuildingProcessorContext = {
  matureTrees?: number;
};

export type BuildingProcessorStatus = {
  statusText: string;
  statusState: 'active' | 'idle' | 'warning';
  waterDetailHtml: string;
  showWorkExtentWarning: boolean;
};

type StockKey = 'timber' | 'firewood' | 'stone' | 'water' | 'food' | 'grain' | 'flour' | 'ale' | 'preservedFood';

type InputRequirement = {
  key: StockKey;
  label: string;
  required: number;
  deliveryHint?: string;
};

type ProcessorProfile = {
  requiresLabor: boolean;
  waterPerCycle: number;
  inputs: InputRequirement[];
  output: StockKey | null;
  operatingLabel: string;
  idleNoWorkersLabel: string;
};

const PROCESSOR_PROFILES: Partial<Record<BuildingKind, ProcessorProfile>> = {
  granary: {
    requiresLabor: true,
    waterPerCycle: GRANARY_WATER_PER_CYCLE,
    inputs: [
      { key: 'flour', label: 'flour', required: GRANARY_FLOUR_PER_CYCLE, deliveryHint: 'mill deliveries may supply' },
      { key: 'firewood', label: 'firewood', required: GRANARY_FIREWOOD_PER_CYCLE, deliveryHint: 'lodge deliveries may supply' },
    ],
    output: 'food',
    operatingLabel: 'Baking staple food',
    idleNoWorkersLabel: 'Idle — assign workers to bake food',
  },
  brewery: {
    requiresLabor: true,
    waterPerCycle: BREWERY_WATER_PER_CYCLE,
    inputs: [
      { key: 'grain', label: 'grain', required: BREWERY_GRAIN_PER_CYCLE, deliveryHint: 'farm deliveries may supply' },
    ],
    output: 'ale',
    operatingLabel: 'Brewing ale',
    idleNoWorkersLabel: 'Idle — assign workers to brew ale',
  },
  smokehouse: {
    requiresLabor: true,
    waterPerCycle: 0,
    inputs: [
      { key: 'food', label: 'food', required: SMOKEHOUSE_FOOD_PER_CYCLE, deliveryHint: 'granary deliveries may supply' },
      { key: 'firewood', label: 'firewood', required: SMOKEHOUSE_FIREWOOD_PER_CYCLE, deliveryHint: 'lodge deliveries may supply' },
    ],
    output: 'preservedFood',
    operatingLabel: 'Smoking and preserving food',
    idleNoWorkersLabel: 'Idle — assign workers to preserve food',
  },
  watermill: {
    requiresLabor: true,
    waterPerCycle: 0,
    inputs: [
      { key: 'grain', label: 'grain', required: WATERMILL_GRAIN_PER_CYCLE, deliveryHint: 'threshing barn deliveries may supply' },
    ],
    output: 'flour',
    operatingLabel: 'Milling grain into flour',
    idleNoWorkersLabel: 'Idle — assign workers to run the mill',
  },
};

function stockAmount(building: BuildingState, key: StockKey): number {
  return building[key];
}

function isOutputFull(building: BuildingState, kind: BuildingKind, output: StockKey): boolean {
  const caps = buildingStorageCaps(kind);
  const cap = caps[output];
  if (cap == null || cap <= 0) return false;
  return stockAmount(building, output) >= cap - 0.001;
}

function firstMissingInput(building: BuildingState, inputs: InputRequirement[]): InputRequirement | null {
  for (const input of inputs) {
    if (stockAmount(building, input.key) + 1e-6 < input.required) {
      return input;
    }
  }
  return null;
}

function formatMissingInput(input: InputRequirement): string {
  const hint = input.deliveryHint ? ` — ${input.deliveryHint}` : '';
  return `Waiting for ${input.label} — needs ${input.required} per cycle${hint}`;
}

function buildProcessorStatus(
  building: BuildingState,
  profile: ProcessorProfile,
  waterAssessment: WellWaterAssessment | null,
): BuildingProcessorStatus {
  const staffed = !profile.requiresLabor || building.assignedLabor > 0;
  const waterDetailHtml = formatWellWaterDetailRows(
    waterAssessment,
    profile.waterPerCycle <= 0 ? 'None — uses river power or dry process' : undefined,
  );

  if (profile.requiresLabor && building.assignedLabor === 0) {
    return {
      statusText: profile.idleNoWorkersLabel,
      statusState: 'idle',
      waterDetailHtml,
      showWorkExtentWarning: false,
    };
  }

  const waterIssue = wellWaterStatusIssue(waterAssessment);
  if (waterIssue) {
    return {
      statusText: waterIssue,
      statusState: 'warning',
      waterDetailHtml,
      showWorkExtentWarning: true,
    };
  }

  if (profile.output && isOutputFull(building, building.kind, profile.output)) {
    return {
      statusText: 'Storage full — not producing',
      statusState: 'idle',
      waterDetailHtml,
      showWorkExtentWarning: staffed,
    };
  }

  const missingInput = firstMissingInput(building, profile.inputs);
  if (missingInput) {
    return {
      statusText: formatMissingInput(missingInput),
      statusState: 'warning',
      waterDetailHtml,
      showWorkExtentWarning: true,
    };
  }

  return {
    statusText: profile.operatingLabel,
    statusState: 'active',
    waterDetailHtml,
    showWorkExtentWarning: false,
  };
}

function getLumberMillStatus(
  building: BuildingState,
  worldQueries: WorldQueries,
  matureTrees: number,
): BuildingProcessorStatus {
  const storageCaps = buildingStorageCaps('lumber_mill');
  const waterAssessment = assessWellWaterSupply(building, worldQueries, MILL_WATER_PER_HARVEST);
  const requiresWater = MILL_WATER_PER_HARVEST > 0;
  const storageFull = storageCaps.timber > 0 && building.timber >= storageCaps.timber - 0.001;
  const waterDetailHtml = formatWellWaterDetailRows(
    waterAssessment,
    'None — timber is air-seasoned',
  );

  if (building.assignedLabor === 0) {
    return {
      statusText: 'Idle — assign labor to harvest timber',
      statusState: 'idle',
      waterDetailHtml,
      showWorkExtentWarning: false,
    };
  }

  const waterIssue = requiresWater ? wellWaterStatusIssue(waterAssessment) : null;
  if (waterIssue) {
    return {
      statusText: waterIssue,
      statusState: 'warning',
      waterDetailHtml,
      showWorkExtentWarning: true,
    };
  }

  if (storageFull) {
    return {
      statusText: `Storage full — not harvesting (${matureTrees} mature trees in range)`,
      statusState: 'idle',
      waterDetailHtml,
      showWorkExtentWarning: true,
    };
  }

  if (matureTrees > 0) {
    return {
      statusText: `Harvesting — ${matureTrees} mature trees in range`,
      statusState: 'active',
      waterDetailHtml,
      showWorkExtentWarning: false,
    };
  }

  return {
    statusText: 'Idle — no mature trees in range',
    statusState: 'idle',
    waterDetailHtml,
    showWorkExtentWarning: true,
  };
}

function getMonasteryStatus(building: BuildingState, worldQueries: WorldQueries): BuildingProcessorStatus {
  const linked = worldQueries.isMonasteryLinkedToChapel(building);
  const productivity = linked ? 1 : MONASTERY_UNLINKED_PRODUCTIVITY;
  const grainNeeded = MONASTERY_GRAIN_PER_CYCLE * productivity;

  if (!linked) {
    return {
      statusText: 'Reduced output — link to a staffed chapel by road',
      statusState: 'warning',
      waterDetailHtml: '',
      showWorkExtentWarning: true,
    };
  }

  if (isOutputFull(building, 'monastery', 'food')) {
    return {
      statusText: 'Storage full — charity hauls paused',
      statusState: 'idle',
      waterDetailHtml: '',
      showWorkExtentWarning: true,
    };
  }

  if (building.grain + 1e-6 < grainNeeded) {
    return {
      statusText: `Waiting for grain — needs ${grainNeeded.toFixed(1)} per cycle`,
      statusState: 'warning',
      waterDetailHtml: '',
      showWorkExtentWarning: true,
    };
  }

  const hasMarketplace = worldQueries.hasRoadPathToBuildingKind(building.x, building.z, 'marketplace');
  if (!hasMarketplace) {
    return {
      statusText: 'Serving parish — connect marketplace by road for pilgrim income',
      statusState: 'active',
      waterDetailHtml: '',
      showWorkExtentWarning: false,
    };
  }

  return {
    statusText: 'Serving parish — charity, feasts, and pilgrimages',
    statusState: 'active',
    waterDetailHtml: '',
    showWorkExtentWarning: false,
  };
}

function getFerryStatus(building: BuildingState, worldQueries: WorldQueries): BuildingProcessorStatus {
  if (building.assignedLabor === 0) {
    return {
      statusText: 'Idle — assign workers to operate the ferry',
      statusState: 'idle',
      waterDetailHtml: '',
      showWorkExtentWarning: false,
    };
  }

  const hasMarketplace = worldQueries.hasRoadPathToBuildingKind(building.x, building.z, 'marketplace');
  if (!hasMarketplace) {
    return {
      statusText: 'Idle — needs a road link to the marketplace',
      statusState: 'warning',
      waterDetailHtml: '',
      showWorkExtentWarning: true,
    };
  }

  return {
    statusText: 'Operating river crossing — regional trade income',
    statusState: 'active',
    waterDetailHtml: '',
    showWorkExtentWarning: false,
  };
}

function getSimpleLaborStatus(
  building: BuildingState,
  operatingLabel: string,
  idleLabel: string,
): BuildingProcessorStatus {
  const staffed = building.assignedLabor > 0;
  return {
    statusText: staffed ? operatingLabel : idleLabel,
    statusState: staffed ? 'active' : 'idle',
    waterDetailHtml: '',
    showWorkExtentWarning: false,
  };
}

export function getBuildingProcessorStatus(
  building: BuildingState,
  worldQueries: WorldQueries,
  context: BuildingProcessorContext = {},
): BuildingProcessorStatus | null {
  const profile = PROCESSOR_PROFILES[building.kind];
  if (profile) {
    const waterAssessment = assessWellWaterSupply(building, worldQueries, profile.waterPerCycle);
    return buildProcessorStatus(building, profile, waterAssessment);
  }

  switch (building.kind) {
    case 'lumber_mill':
      return getLumberMillStatus(building, worldQueries, context.matureTrees ?? 0);
    case 'monastery':
      return getMonasteryStatus(building, worldQueries);
    case 'ferry_landing':
      return getFerryStatus(building, worldQueries);
    case 'threshing_barn':
      return getSimpleLaborStatus(
        building,
        'Managing farm fields',
        'Idle — assign workers to work the fields',
      );
    case 'apiary':
      return getSimpleLaborStatus(
        building,
        'Foraging honey and food',
        'Idle — assign workers to tend the apiary',
      );
    case 'vineyard':
      return getSimpleLaborStatus(
        building,
        'Tending vines — wine and food',
        'Idle — assign workers to tend the vineyard',
      );
    case 'carpenter':
      return getSimpleLaborStatus(
        building,
        'Supporting construction and cartwright work',
        'Idle — assign workers to the workshop',
      );
    default: {
      const definition = getBuildingDefinition(building.kind);
      if (!definition.acceptsLabor) return null;
      return getSimpleLaborStatus(
        building,
        'Operating',
        'Awaiting workers',
      );
    }
  }
}

export function getBuildingWorkExtentHighlight(
  building: BuildingState,
  worldQueries: WorldQueries,
  context: BuildingProcessorContext = {},
): 'normal' | 'warning' {
  const status = getBuildingProcessorStatus(building, worldQueries, context);
  return status?.showWorkExtentWarning ? 'warning' : 'normal';
}
