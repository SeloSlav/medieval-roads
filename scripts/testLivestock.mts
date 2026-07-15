import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { createBuildingMesh } from '../src/buildings/BuildingMeshes.ts';
import { getBuildingExtent } from '../src/buildings/buildingExtents.ts';
import { createCattleVisualDistribution } from '../src/farming/LivestockVisuals.ts';
import {
  BACKYARD_GARDEN_DEFINITIONS,
  BUILDING_DEFINITIONS,
  BUILDING_KINDS,
  CATTLE_FERTILITY_BONUS,
  CATTLE_MAX_FERTILIZED_FIELDS,
  CATTLE_PLOUGH_WORK_MULTIPLIER,
  LIVESTOCK_MIN_PASTURE_AREA,
  SHEEP_GRAIN_PER_UNSUPPORTED_HEAD,
  SWINE_GRAIN_PER_UNSUPPORTED_HEAD,
  SWINE_MATURE_TREES_PER_HEAD,
} from '../src/generated/gameBalance.ts';

(globalThis as typeof globalThis & { self: typeof globalThis }).self = globalThis;

assert.ok(BUILDING_KINDS.includes('pastoral_farmstead'));
assert.ok(BUILDING_KINDS.includes('swineherd'));
assert.equal(BUILDING_DEFINITIONS.pastoral_farmstead.workRadius, 110);
assert.equal(BUILDING_DEFINITIONS.swineherd.workRadius, 120);
assert.equal(BUILDING_DEFINITIONS.swineherd.requiresMatureTrees, true);
assert.ok(LIVESTOCK_MIN_PASTURE_AREA >= 48, 'pastures must remain meaningful drawn parcels');
assert.ok(CATTLE_FERTILITY_BONUS > 0, 'cattle must directly restore field fertility');
assert.equal(CATTLE_MAX_FERTILIZED_FIELDS, 2, 'cattle field support must remain capped');
assert.ok(CATTLE_PLOUGH_WORK_MULTIPLIER < 1, 'ox power must reduce plough work');
assert.ok(
  SWINE_GRAIN_PER_UNSUPPORTED_HEAD > SHEEP_GRAIN_PER_UNSUPPORTED_HEAD,
  'grain-only pig keeping must remain deliberately inefficient',
);
assert.ok(SWINE_MATURE_TREES_PER_HEAD > 0, 'swine capacity must depend on live mature trees');
assert.ok(BACKYARD_GARDEN_DEFINITIONS.hen_yard, 'hen yard must remain a backyard choice');

assert.deepEqual(createCattleVisualDistribution(3), ['cow', 'cow', 'cow']);
assert.deepEqual(createCattleVisualDistribution(6), ['bull', 'cow', 'cow', 'cow', 'cow', 'cow']);
assert.equal(
  createCattleVisualDistribution(18).filter((kind) => kind === 'bull').length,
  1,
  'large displayed herds should still contain one bull rather than an unnatural 50/50 split',
);

assert.deepEqual(
  getBuildingExtent('pastoral_farmstead', BUILDING_DEFINITIONS.pastoral_farmstead.workRadius),
  { type: 'work', label: 'Pasture work extent', radius: 110 },
);
assert.deepEqual(
  getBuildingExtent('swineherd', BUILDING_DEFINITIONS.swineherd.workRadius),
  { type: 'work', label: 'Pannage work extent', radius: 120 },
);

for (const kind of ['pastoral_farmstead', 'swineherd'] as const) {
  const model = createBuildingMesh(kind);
  let meshCount = 0;
  model.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) meshCount += 1;
  });
  assert.ok(meshCount >= 20, `${kind} should have a distinctive composed production mesh`);
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  assert.ok(size.x > 6 && size.y > 2 && size.z > 4, `${kind} should have a readable building footprint`);
}

const livestockAssets = [
  { label: 'cow', path: 'public/assets/models/livestock/quaternius-cow.glb', idle: 'idle', graze: 'eating', walk: 'walk' },
  { label: 'bull', path: 'public/assets/models/livestock/quaternius-bull.glb', idle: 'idle', graze: 'eating', walk: 'walk' },
  { label: 'sheep', path: 'public/assets/models/livestock/quaternius-sheep.glb', idle: 'idle', graze: 'idle_eating', walk: 'walk' },
  { label: 'pig', path: 'public/assets/models/livestock/quaternius-pig.glb', idle: 'idle', graze: 'idle_eating', walk: 'walk' },
  { label: 'chicken', path: 'public/assets/models/livestock/quaternius-chicken.glb', idle: 'idle', graze: null, walk: 'walk' },
] as const;

for (const asset of livestockAssets) {
  const bytes = fs.readFileSync(asset.path);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const gltf = await new Promise<Awaited<ReturnType<GLTFLoader['loadAsync']>>>((resolve, reject) => {
    new GLTFLoader().parse(buffer, '', resolve, reject);
  });
  const clipNames = gltf.animations.map((clip) => clip.name.toLowerCase());
  const hasClip = (name: string) => clipNames.some((clip) => clip === name || clip.endsWith(`|${name}`));
  assert.ok(hasClip(asset.idle), `${asset.label} should retain a rigged idle animation`);
  assert.ok(hasClip(asset.walk), `${asset.label} should retain a rigged walk animation`);
  if (asset.graze) assert.ok(hasClip(asset.graze), `${asset.label} should retain a grazing/eating animation`);

  let sourceMesh: THREE.SkinnedMesh | null = null;
  gltf.scene.traverse((object) => {
    if (!sourceMesh && (object as THREE.SkinnedMesh).isSkinnedMesh) sourceMesh = object as THREE.SkinnedMesh;
  });
  assert.ok(sourceMesh, `${asset.label} should contain an articulated skinned mesh`);
  const clone = cloneSkinned(gltf.scene);
  let cloneMesh: THREE.SkinnedMesh | null = null;
  clone.traverse((object) => {
    if (!cloneMesh && (object as THREE.SkinnedMesh).isSkinnedMesh) cloneMesh = object as THREE.SkinnedMesh;
  });
  assert.ok(cloneMesh, `${asset.label} runtime clones should remain skinned`);
  assert.notEqual(cloneMesh.skeleton, sourceMesh.skeleton, `${asset.label} clones need independent rigs`);
}

const license = fs.readFileSync('public/assets/models/livestock/LICENSE.txt', 'utf8');
for (const label of ['cow', 'bull', 'sheep', 'pig', 'chicken']) {
  assert.match(license.toLowerCase(), new RegExp(label), `${label} provenance should be documented`);
}
assert.match(license, /CC0 1\.0/, 'livestock assets should retain their CC0 license record');

const serverLivestock = fs.readFileSync('server/src/simulation/livestock.rs', 'utf8');
assert.match(serverLivestock, /mature_tree_count[\s\S]*SWINE_MATURE_TREES_PER_HEAD/, 'pannage capacity should use mature trees');
assert.match(serverLivestock, /CATTLE_MAX_FERTILIZED_FIELDS/, 'cattle support should cap fertilized fields');
const farmSimulation = fs.readFileSync('server/src/simulation/expanded_economy.rs', 'utf8');
assert.match(farmSimulation, /field\.stage == STAGE_PLOUGHING \{ plough_multiplier \} else \{ 1\.0 \}/, 'ox power should apply only to ploughing');
assert.match(farmSimulation, /fertility_after_harvest[\s\S]*manure_bonus/, 'cattle manure should directly improve field fertility');
assert.doesNotMatch(serverLivestock, /RESOURCE_MANURE|manure commodity/i, 'manure must remain a direct field effect, not a new commodity');

console.log('livestock gameplay and asset tests passed');
