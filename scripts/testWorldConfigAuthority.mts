import assert from 'node:assert/strict';
import type { WorldConfig } from '../src/generated/types.ts';
import {
  assertWorldGenerationCompatible,
  decodeMapSize,
  encodeMapSize,
  generationMatchesServer,
  MAP_SIZE_BY_CODE,
  MAP_SIZE_CODES,
  settingsToConfigurePayload,
  shouldRequireWorldRegeneration,
  WorldGenerationMismatchError,
  worldConfigRowToGeneration,
} from '../src/world/worldConfigAuthority.ts';
import { DEFAULT_WORLD_GENERATION_SETTINGS } from '../src/world/worldGenerationSettings.ts';

assert.equal(encodeMapSize('medium'), MAP_SIZE_CODES.medium);
assert.equal(decodeMapSize(2), MAP_SIZE_BY_CODE[2]);
assert.equal(MAP_SIZE_CODES.small, 0);
assert.equal(MAP_SIZE_CODES.large, 2);

const row = {
  id: 0,
  seed: BigInt(0xdeadbeef),
  nextBuildingId: BigInt(1),
  simTick: BigInt(0),
  mapSize: 1,
  topography: 42,
  hydrology: 55,
  forestDensity: 66,
  configured: true,
} satisfies WorldConfig;

const generation = worldConfigRowToGeneration(row);
assert.equal(generation.seed, 0xdeadbeef);
assert.equal(generation.mapSize, 'medium');
assert.equal(generation.topography, 42);
assert.equal(generation.configured, true);

assert.equal(
  generationMatchesServer(generation, DEFAULT_WORLD_GENERATION_SETTINGS),
  false,
);

const payload = settingsToConfigurePayload(DEFAULT_WORLD_GENERATION_SETTINGS);
assert.equal(payload.mapSize, MAP_SIZE_CODES.medium);
assert.equal(payload.seed, BigInt(DEFAULT_WORLD_GENERATION_SETTINGS.seed));

assert.throws(
  () => assertWorldGenerationCompatible(
    DEFAULT_WORLD_GENERATION_SETTINGS,
    generation,
    42,
  ),
  WorldGenerationMismatchError,
);

assert.doesNotThrow(
  () => assertWorldGenerationCompatible(
    DEFAULT_WORLD_GENERATION_SETTINGS,
    { ...generation, configured: false },
    42,
  ),
);

assert.doesNotThrow(
  () => assertWorldGenerationCompatible(
    DEFAULT_WORLD_GENERATION_SETTINGS,
    generation,
    0,
  ),
);

const unconfigured = { ...generation, configured: false };
assert.equal(
  shouldRequireWorldRegeneration(unconfigured, 0, DEFAULT_WORLD_GENERATION_SETTINGS),
  false,
);

const smallWorld = { ...DEFAULT_WORLD_GENERATION_SETTINGS, mapSize: 'small' as const };
assert.equal(
  shouldRequireWorldRegeneration(unconfigured, 42, smallWorld),
  false,
);

assert.equal(
  shouldRequireWorldRegeneration(generation, 0, DEFAULT_WORLD_GENERATION_SETTINGS),
  true,
);

assert.equal(
  shouldRequireWorldRegeneration(generation, 0, null),
  true,
);

assert.equal(
  shouldRequireWorldRegeneration(generation, 42, DEFAULT_WORLD_GENERATION_SETTINGS),
  false,
);

assert.equal(
  shouldRequireWorldRegeneration(
    { ...DEFAULT_WORLD_GENERATION_SETTINGS, configured: true },
    0,
    DEFAULT_WORLD_GENERATION_SETTINGS,
  ),
  false,
);

assert.equal(
  shouldRequireWorldRegeneration(
    { ...DEFAULT_WORLD_GENERATION_SETTINGS, configured: false },
    0,
    DEFAULT_WORLD_GENERATION_SETTINGS,
  ),
  false,
);

assert.equal(
  shouldRequireWorldRegeneration(
    { ...DEFAULT_WORLD_GENERATION_SETTINGS, mapSize: 'medium', configured: true },
    42,
    smallWorld,
  ),
  false,
);

console.log('world config authority tests passed');
