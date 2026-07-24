import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateBuildingPlacement } from '../src/buildings/BuildingPlacementValidation.ts';
import {
  GAME_MIN_BREEDING_POPULATION,
  MUSHROOMS_PER_HARVEST,
} from '../src/generated/gameBalance.ts';
import {
  foragingSeason,
  isForagingHarvestAvailable,
  isForagingRegrowthSeason,
} from '../src/foraging/foragingSeason.ts';
import { forestDensityAt } from '../src/props/forestField.ts';
import { MUSHROOM_ICON_SVG } from '../src/map/resourceMapIconGlyphs.ts';
import { createWorldLayout } from '../src/resources/WorldLayout.ts';
import { WorldLayoutRegistry } from '../src/resources/WorldLayoutRegistry.ts';
import {
  RESOURCE_KINDS,
  createEmptyStockpile,
  type BuildingState,
  type ForagingNodeState,
  type ResidenceState,
} from '../src/resources/types.ts';
import { resolveWorldDimensions } from '../src/world/worldGenerationSettings.ts';
import { collectWorkerTargets } from '../src/settlement/workerPaths.ts';

assert.ok(RESOURCE_KINDS.includes('mushrooms'));
assert.equal(createEmptyStockpile().mushrooms, 0);
assert.ok(MUSHROOMS_PER_HARVEST > 0);
assert.equal(GAME_MIN_BREEDING_POPULATION, 2);

assert.equal(foragingSeason(1), 'winter');
assert.equal(foragingSeason(4), 'spring');
assert.equal(foragingSeason(7), 'summer');
assert.equal(foragingSeason(10), 'autumn');
assert.equal(isForagingHarvestAvailable('berries', 1), false);
assert.equal(isForagingHarvestAvailable('mushrooms', 12), false);
assert.equal(isForagingHarvestAvailable('game', 1), true);
assert.equal(isForagingRegrowthSeason('berries', 4), true);
assert.equal(isForagingRegrowthSeason('mushrooms', 7), true);
assert.equal(isForagingRegrowthSeason('mushrooms', 10), false);

for (const mapSize of ['small', 'medium', 'large'] as const) {
  const layout = createWorldLayout({
    seed: 0x51ac71 ^ mapSize.length,
    mapSize,
    topography: 50,
    hydrology: 50,
    forestDensity: 50,
  });
  const dimensions = resolveWorldDimensions(mapSize);
  const mushrooms = layout.foragingLayout.sites.filter((site) => site.kind === 'mushrooms');
  const berries = layout.foragingLayout.sites.filter((site) => site.kind === 'berries');
  assert.equal(mushrooms.length, 2, `${mapSize} maps should have two mushroom beds`);
  assert.equal(berries.length, 2, `${mapSize} maps should have two berry patches`);

  const mushroomDensity = average(mushrooms.map((site) => forestDensityAt(
    site.x,
    site.z,
    layout.forestCores,
    dimensions.playableHalf,
    dimensions.terrainSize,
  )));
  const berryDensity = average(berries.map((site) => forestDensityAt(
    site.x,
    site.z,
    layout.forestCores,
    dimensions.playableHalf,
    dimensions.terrainSize,
  )));
  assert.ok(
    mushroomDensity > berryDensity + 0.15,
    `${mapSize} mushroom beds should sit substantially deeper in the forest than berries`,
  );
}

const layout = createWorldLayout();
const registry = WorldLayoutRegistry.fromWorldLayout(layout);
const mushroomDefinitions = registry.definitionList.filter((node) => node.kind === 'mushrooms');
assert.equal(mushroomDefinitions.length, 2);
assert.ok(mushroomDefinitions.every((node) => node.resource === 'mushrooms'));
assert.ok(mushroomDefinitions.every((node) => node.label.includes('Deep-forest')));

const mushroomStates: ForagingNodeState[] = mushroomDefinitions.map((node) => ({
  nodeId: node.id,
  kind: 'mushrooms',
  resource: 'mushrooms',
  remaining: node.maxYield,
  maxYield: node.maxYield,
  x: node.x,
  z: node.z,
}));
const firstMushroom = mushroomStates[0];
assert.deepEqual(
  validateBuildingPlacement('foragers_shed', firstMushroom.x + 12, firstMushroom.z, {
    buildings: [] as BuildingState[],
    residences: [] as ResidenceState[],
    burgageZones: [],
    farmFields: [],
    pastures: [],
    quarries: [],
    foragingNodes: mushroomStates,
    stockpile: { timber: 10_000, stone: 10_000 },
    isWaterAt: () => false,
    getNaturalHeightAt: () => 0,
  }),
  { ok: true },
  'the existing forager shed must accept a mushroom bed in its work extent',
);
assert.deepEqual(
  validateBuildingPlacement('foragers_shed', firstMushroom.x + 12, firstMushroom.z, {
    buildings: [] as BuildingState[],
    residences: [] as ResidenceState[],
    burgageZones: [],
    farmFields: [],
    pastures: [],
    quarries: [],
    foragingNodes: mushroomStates.map((node) => ({ ...node, remaining: 0 })),
    stockpile: { timber: 10_000, stone: 10_000 },
    isWaterAt: () => false,
    getNaturalHeightAt: () => 0,
  }),
  { ok: true },
  'an empty seasonal patch must remain a valid persistent forager location',
);

const forager = {
  id: 'forager-test',
  kind: 'foragers_shed',
  x: firstMushroom.x + 12,
  z: firstMushroom.z,
  workRadius: 48,
  constructionComplete: true,
} as BuildingState;
const workerTargetInputs = {
  quarries: [],
  foragingNodes: mushroomStates,
  trees: new Map(),
  treeRegistry: null,
  farmFields: [],
  pastures: [],
};
assert.equal(
  collectWorkerTargets(forager, { ...workerTargetInputs, foragingMonth: 1 }).length,
  0,
  'forager actors should remain idle while mushroom beds are dormant in winter',
);
assert.ok(
  collectWorkerTargets(forager, { ...workerTargetInputs, foragingMonth: 4 })
    .some((target) => target.kind === 'mushrooms'),
  'forager actors should walk to mushroom beds during the growing season',
);

assert.ok(MUSHROOM_ICON_SVG.includes('currentColor'));
assert.ok(!MUSHROOM_ICON_SVG.includes('<image'));
assert.ok(MUSHROOM_ICON_SVG.includes('foraging-map-icon-glyph--mushrooms'));

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const lifecycle = readFileSync(
  `${projectRoot}server/src/simulation/foraging_respawn.rs`,
  'utf8',
);
assert.match(lifecycle, /population_growth_per_second/);
assert.match(lifecycle, /migrate_disrupted_game_habitats/);
assert.doesNotMatch(lifecycle, /\.delete\(/, 'persistent wild-resource nodes must never be deleted');

const foodSupplier = readFileSync(
  `${projectRoot}server/src/simulation/food_supplier.rs`,
  'utf8',
);
assert.match(foodSupplier, /&\["berries",\s*"mushrooms"\]/);
assert.match(foodSupplier, /GAME_ANIMALS_PER_HARVEST/);

const granary = readFileSync(
  `${projectRoot}server/src/simulation/expanded_economy.rs`,
  'utf8',
);
assert.match(
  granary,
  /CommodityKind::Food,\s*&\["hunters_hall",\s*"foragers_shed",\s*"fishing_camp",\s*"swineherd"\]/s,
  'the granary should collect road-linked wild-food surplus',
);

const mushroomVisuals = readFileSync(
  `${projectRoot}src/foraging/MushroomPatchVisuals.ts`,
  'utf8',
);
assert.match(mushroomVisuals, /InstancedMesh/);
assert.match(mushroomVisuals, /CLOSE_WORLD_MAX_CAMERA_DISTANCE/);
assert.match(mushroomVisuals, /placement\.visibilityNoise\s*<\s*ratio/);

const berryVisuals = readFileSync(
  `${projectRoot}src/foraging/BerryPatchVisuals.ts`,
  'utf8',
);
assert.match(berryVisuals, /raspberry_patch_albedo\.png/);
assert.match(berryVisuals, /raspberryMatrices/);
assert.doesNotMatch(berryVisuals, /createHarvestableBerryGeometry|appendBerryIcosahedron|Bright red harvestable/);
assert.ok(existsSync(
  `${projectRoot}public/assets/textures/vegetation/raspberry_patch_albedo.png`,
));

const undergrowthVisuals = readFileSync(
  `${projectRoot}src/props/ForestUndergrowth.ts`,
  'utf8',
);
assert.match(
  undergrowthVisuals,
  /juniper_scrub_albedo\.png/,
  'ordinary juniper undergrowth must keep its original texture',
);

const deerVisuals = readFileSync(
  `${projectRoot}src/foraging/DeerWildlifeVisuals.ts`,
  'utf8',
);
assert.match(deerVisuals, /actorIndex\s*<\s*visiblePopulation/);
assert.match(deerVisuals, /node\.x\s*-\s*visual\.motion\.homeX/);

console.log('foraging ecology tests passed');

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
}
