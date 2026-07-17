import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import {
  createDeliveryCartMesh,
  deliveryCartMeshName,
  disposeDeliveryCartMesh,
  type DeliveryCartModelSource,
} from '../src/logistics/deliveryCartMesh.ts';
import {
  pickVillagerHairColor,
  pickVillagerModelVariant,
} from '../src/settlement/villagerPaths.ts';

(globalThis as typeof globalThis & { self: typeof globalThis }).self = globalThis;

async function parseGlb(path: string) {
  const bytes = fs.readFileSync(path);
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return new Promise<Awaited<ReturnType<GLTFLoader['loadAsync']>>>((resolve, reject) => {
    new GLTFLoader().parse(buffer, '', resolve, reject);
  });
}

const villagerAssets = [
  {
    variant: 'man',
    path: 'public/assets/models/villagers/quaternius-villager-man.glb',
  },
  {
    variant: 'woman',
    path: 'public/assets/models/villagers/quaternius-villager-woman.glb',
  },
] as const;

for (const asset of villagerAssets) {
  const gltf = await parseGlb(asset.path);
  const clips = gltf.animations.map((clip) => clip.name.toLowerCase());
  assert.ok(
    clips.some((name) => name.endsWith('_idle') || name.endsWith('|idle')),
    `${asset.variant} villager must retain an authored idle animation`,
  );
  assert.ok(
    clips.some((name) => name.endsWith('_walk') || name.endsWith('|walk')),
    `${asset.variant} villager must retain an authored walk animation`,
  );

  let sourceMesh: THREE.SkinnedMesh | null = null;
  gltf.scene.traverse((object) => {
    if (!sourceMesh && (object as THREE.SkinnedMesh).isSkinnedMesh) {
      sourceMesh = object as THREE.SkinnedMesh;
    }
  });
  assert.ok(sourceMesh, `${asset.variant} villager must contain a skinned mesh`);

  const clone = cloneSkinned(gltf.scene);
  let cloneMesh: THREE.SkinnedMesh | null = null;
  clone.traverse((object) => {
    if (!cloneMesh && (object as THREE.SkinnedMesh).isSkinnedMesh) {
      cloneMesh = object as THREE.SkinnedMesh;
    }
  });
  assert.ok(cloneMesh, `${asset.variant} runtime clone must remain skinned`);
  assert.notEqual(
    cloneMesh.skeleton,
    sourceMesh.skeleton,
    `${asset.variant} runtime clone needs an independent rig`,
  );
}

const variants = Array.from({ length: 256 }, (_, index) =>
  pickVillagerModelVariant(index * 7919)
);
assert.ok(variants.includes('man'), 'deterministic villagers should include men');
assert.ok(variants.includes('woman'), 'deterministic villagers should include women');
assert.equal(pickVillagerModelVariant(12345), pickVillagerModelVariant(12345));
assert.equal(pickVillagerHairColor(67890), pickVillagerHairColor(67890));

const cartGltf = await parseGlb(
  'public/assets/models/delivery-cart/quaternius-medieval-cart.glb',
);
const materialNames = new Set<string>();
let cartMeshCount = 0;
cartGltf.scene.traverse((object) => {
  const mesh = object as THREE.Mesh;
  if (!mesh.isMesh) return;
  cartMeshCount += 1;
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const material of materials) materialNames.add(material.name);
});
assert.ok(cartMeshCount >= 5, 'Quaternius cart should retain its composed low-poly mesh');
for (const name of ['Wood', 'Red', 'Beige', 'DarkWood']) {
  assert.ok(materialNames.has(name), `cart should retain the ${name} material layer`);
}

const cartBounds = new THREE.Box3().setFromObject(cartGltf.scene);
const cartSource: DeliveryCartModelSource = {
  scene: cartGltf.scene,
  bounds: cartBounds,
  sourceHeight: cartBounds.max.y - cartBounds.min.y,
};
const cartA = createDeliveryCartMesh('firewood', {
  appearanceSeed: 12,
  source: cartSource,
});
const cartB = createDeliveryCartMesh('water', {
  appearanceSeed: 13,
  source: cartSource,
});
assert.equal(cartA.name, deliveryCartMeshName('firewood', true));
assert.equal(cartA.userData.deliveryCartAsset, 'quaternius-medieval-cart');
assert.notEqual(
  cartA.getObjectByName('Cart cargo: firewood'),
  undefined,
  'authored cart chassis should preserve the cargo-specific overlay',
);
assert.notEqual(
  cartB.getObjectByName('Cart cargo: water'),
  undefined,
  'all delivery kinds should preserve their readable load',
);
disposeDeliveryCartMesh(cartA);
disposeDeliveryCartMesh(cartB);

const villagerLicense = fs.readFileSync(
  'public/assets/models/villagers/LICENSE.txt',
  'utf8',
);
assert.match(villagerLicense, /CC0 1\.0/);
assert.match(villagerLicense, /fjHyMd5Wxw/);
assert.match(villagerLicense, /zMyPlQXBzq/);

const cartLicense = fs.readFileSync(
  'public/assets/models/delivery-cart/LICENSE.txt',
  'utf8',
);
assert.match(cartLicense, /CC0 1\.0/);
assert.match(cartLicense, /l7bDe7ak6j/);

console.log('villager and delivery-cart asset tests passed');
