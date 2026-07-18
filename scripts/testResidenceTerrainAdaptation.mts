import assert from 'node:assert/strict';
import { BuildingTerrainLayout } from '../src/buildings/BuildingTerrainLayout.ts';
import { sampleTerrainFenceBays } from '../src/residences/BurgageFencing.ts';
import { residenceFootprintHeightDelta } from '../src/residences/burgagePlacementValidation.ts';

const almostEqual = (actual: number, expected: number, epsilon = 1e-6): void => {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
};

const slopeHeight = (x: number, z: number): number => x * 0.2 + z * 0.05;
const residence = { x: 0, z: 0, yaw: 0 };
const layout = BuildingTerrainLayout.fromSettlement([], [residence], slopeHeight);

assert.equal(layout.sites.length, 1, 'a residence should contribute one terrain pad');
const centerNatural = slopeHeight(0, 0);
const centerLeveled = centerNatural + layout.getPlatformRaise(0, 0, centerNatural);
const innerNatural = slopeHeight(-3, -3.5);
const innerLeveled = innerNatural + layout.getPlatformRaise(-3, -3.5, innerNatural);
almostEqual(
  centerLeveled,
  innerLeveled,
  1e-5,
);
almostEqual(
  layout.getPlatformRaise(20, 20, slopeHeight(20, 20)),
  0,
);
const extremeLayout = BuildingTerrainLayout.fromSettlement([], [residence], (x) => x * 2);
assert.ok(
  extremeLayout.getPlatformRaise(0, 0, 0) <= 2.4,
  'legacy residences on extreme slopes should not create unbounded earthen platforms',
);

const bays = sampleTerrainFenceBays(
  { x: 0, z: 0 },
  { x: 5, z: 0 },
  (x) => x * 0.25,
);
assert.equal(bays.length, 3, 'a five-meter fence should be split into three terrain bays');
for (let index = 0; index < bays.length; index++) {
  const bay = bays[index];
  assert.ok(
    Math.hypot(bay.end.x - bay.start.x, bay.end.z - bay.start.z) <= 2.2,
    'no terrain-following rail bay should exceed post spacing',
  );
  almostEqual(bay.startGroundHeight, bay.start.x * 0.25);
  almostEqual(bay.endGroundHeight, bay.end.x * 0.25);
  if (index > 0) {
    almostEqual(bays[index - 1].end.x, bay.start.x);
    almostEqual(bays[index - 1].endGroundHeight, bay.startGroundHeight);
  }
}

almostEqual(
  residenceFootprintHeightDelta(
    { parcelIndex: 0, x: 4, z: -2, yaw: Math.PI / 3 },
    () => 7,
  ),
  0,
);
assert.ok(
  residenceFootprintHeightDelta(
    { parcelIndex: 0, x: 0, z: 0, yaw: 0 },
    (x) => x * 0.5,
  ) > 2.4,
  'the residence footprint sampler should detect an excessive cross-slope',
);

console.log('Residence terrain adaptation checks passed.');
