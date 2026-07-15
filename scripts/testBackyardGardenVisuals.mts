import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createBackyardGardenMesh, disposeBackyardGardenMesh } from '../src/residences/backyardGardenMesh.ts';
import type { BackyardGardenKind } from '../src/generated/gameBalance.ts';
import { BACKYARD_PLANT_SPECIES } from '../src/vegetation/seedthree/backyardPlantPresets.ts';

const kinds: BackyardGardenKind[] = [
  'apple_orchard',
  'cherry_orchard',
  'vegetable_garden',
  'flower_garden',
  'herb_garden',
  'hen_yard',
];

const signatures: Record<BackyardGardenKind, string> = {
  apple_orchard: 'AppleTree:',
  cherry_orchard: 'CherryTree:',
  vegetable_garden: 'BeanTrellis',
  flower_garden: 'RoseBush:',
  herb_garden: 'HerbDryingRack',
  hen_yard: 'HenCoopDoor',
};

for (const kind of kinds) {
  const garden = createBackyardGardenMesh(kind, { width: 6.2, depth: 5.4, seed: 4271 });
  garden.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(garden);
  const size = bounds.getSize(new THREE.Vector3());
  const names: string[] = [];
  let meshCount = 0;
  garden.traverse((object) => {
    if (object.name) names.push(object.name);
    if ((object as THREE.Mesh).isMesh) meshCount += 1;
  });

  assert.equal(garden.userData.gardenKind, kind, `${kind} should retain its gameplay identity`);
  assert.equal(garden.userData.usesSeedThree, false, `${kind} should have a no-WebGPU fallback`);
  assert.ok(meshCount >= 12, `${kind} should be a composed scene, not a placeholder prop`);
  assert.ok(names.some((name) => name.startsWith(signatures[kind])), `${kind} should expose its signature feature`);
  assert.ok(size.x <= 7.5, `${kind} should stay inside a 6.2m parcel with modest foliage overhang`);
  assert.ok(size.z <= 7.5, `${kind} should stay inside a 5.4m backyard with modest foliage overhang`);
  assert.ok(size.y > 0.4, `${kind} should have readable vertical structure`);

  disposeBackyardGardenMesh(garden);
}

const shallow = createBackyardGardenMesh('apple_orchard', { width: 4.4, depth: 2.1, seed: 99 });
let shallowTrees = 0;
shallow.traverse((object) => {
  if (object.name.startsWith('AppleTree:')) shallowTrees += 1;
});
assert.equal(shallowTrees, 2, 'shallow plots should reduce orchard count instead of flattening trees');
disposeBackyardGardenMesh(shallow);

for (const [kind, species] of Object.entries(BACKYARD_PLANT_SPECIES)) {
  const scale = Number(species.params?.scale);
  const branches = species.params?.branches;
  assert.ok(Number.isFinite(scale) && scale > 0, `${kind} should have a finite cultivated-plant scale`);
  assert.ok(Array.isArray(branches) && branches.length === 4, `${kind} should define the complete SeedThree branch grammar`);
}
assert.ok(
  Number(BACKYARD_PLANT_SPECIES.apple.params?.scale) < Number(BACKYARD_PLANT_SPECIES.cherry.params?.scale),
  'the apple should remain lower and broader than the cherry',
);
assert.ok(
  Number(BACKYARD_PLANT_SPECIES.rose.params?.scale) < 1.5,
  'rose shrubs should remain below windowsill scale',
);

console.log('Backyard garden visual system passed.');
