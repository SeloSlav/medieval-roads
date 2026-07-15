import * as THREE from 'three';
import type { BackyardGardenKind } from '../generated/gameBalance.ts';
import {
  sharedBuildingDetailMaterial,
  sharedBuildingMaterial,
} from '../buildings/buildingMaterials.ts';
import { prepareBuildingGeometryUvs } from '../buildings/buildingMetricUvs.ts';
import { mulberry32 } from '../utils/random.ts';
import type { BackyardPlantCatalog } from '../vegetation/seedthree/backyardPlantAssets.ts';

export type BackyardGardenMeshOptions = {
  width?: number;
  depth?: number;
  seed?: number;
  plants?: BackyardPlantCatalog | null;
};

const MATERIALS = {
  soil: new THREE.MeshStandardMaterial({ color: 0x4b3828, roughness: 0.97 }),
  darkSoil: new THREE.MeshStandardMaterial({ color: 0x35271d, roughness: 0.98 }),
  path: new THREE.MeshStandardMaterial({ color: 0x8a795f, roughness: 0.98 }),
  grass: new THREE.MeshStandardMaterial({ color: 0x607b42, roughness: 0.96 }),
  timber: sharedBuildingMaterial('timberMid'),
  darkTimber: sharedBuildingMaterial('timberDark'),
  wicker: sharedBuildingMaterial('timberLight'),
  stone: sharedBuildingMaterial('masonryMid'),
  leaf: new THREE.MeshStandardMaterial({ color: 0x527a3d, roughness: 0.9 }),
  leafLight: new THREE.MeshStandardMaterial({ color: 0x739650, roughness: 0.9 }),
  herb: new THREE.MeshStandardMaterial({ color: 0x66834e, roughness: 0.91 }),
  herbSilver: new THREE.MeshStandardMaterial({ color: 0x829078, roughness: 0.92 }),
  apple: new THREE.MeshStandardMaterial({ color: 0xb94332, roughness: 0.76 }),
  appleGold: new THREE.MeshStandardMaterial({ color: 0xd99b3a, roughness: 0.76 }),
  cherry: new THREE.MeshStandardMaterial({ color: 0x7f1f2f, roughness: 0.72 }),
  cabbage: new THREE.MeshStandardMaterial({ color: 0x759c5c, roughness: 0.9 }),
  squash: new THREE.MeshStandardMaterial({ color: 0x4d7939, roughness: 0.9 }),
  terracotta: new THREE.MeshStandardMaterial({ color: 0x9b4c36, roughness: 0.88 }),
  water: sharedBuildingDetailMaterial('water'),
} as const;

const FLOWER_MATERIALS = [
  new THREE.MeshStandardMaterial({ color: 0xb83f55, roughness: 0.78 }),
  new THREE.MeshStandardMaterial({ color: 0xdc7582, roughness: 0.78 }),
  new THREE.MeshStandardMaterial({ color: 0xe6c8a0, roughness: 0.8 }),
  new THREE.MeshStandardMaterial({ color: 0x8663a8, roughness: 0.8 }),
  new THREE.MeshStandardMaterial({ color: 0xd9a43c, roughness: 0.8 }),
] as const;

function addMesh(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  x: number,
  y: number,
  z: number,
  rotation = new THREE.Euler(),
  scale = new THREE.Vector3(1, 1, 1),
  name?: string,
): THREE.Mesh {
  const mesh = new THREE.Mesh(prepareBuildingGeometryUvs(geometry, material), material);
  mesh.position.set(x, y, z);
  mesh.rotation.copy(rotation);
  mesh.scale.copy(scale);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  if (name) mesh.name = name;
  parent.add(mesh);
  return mesh;
}

function addSoilBed(
  group: THREE.Group,
  x: number,
  z: number,
  width: number,
  depth: number,
  bordered = true,
): void {
  addMesh(group, new THREE.BoxGeometry(width, 0.1, depth), MATERIALS.soil, x, 0.05, z);
  if (!bordered) return;
  const rail = 0.11;
  addMesh(group, new THREE.BoxGeometry(width + 0.18, 0.18, rail), MATERIALS.timber, x, 0.1, z - depth * 0.5);
  addMesh(group, new THREE.BoxGeometry(width + 0.18, 0.18, rail), MATERIALS.timber, x, 0.1, z + depth * 0.5);
  addMesh(group, new THREE.BoxGeometry(rail, 0.18, depth), MATERIALS.timber, x - width * 0.5, 0.1, z);
  addMesh(group, new THREE.BoxGeometry(rail, 0.18, depth), MATERIALS.timber, x + width * 0.5, 0.1, z);
}

function addSteppingStones(group: THREE.Group, z0: number, z1: number, seed: number): void {
  const rng = mulberry32(seed ^ 0x51a77e);
  const count = Math.max(2, Math.floor(Math.abs(z1 - z0) / 0.75));
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    addMesh(
      group,
      new THREE.CylinderGeometry(0.28 + rng() * 0.08, 0.31, 0.07, 7),
      MATERIALS.stone,
      (rng() - 0.5) * 0.22,
      0.055,
      THREE.MathUtils.lerp(z0, z1, t),
      new THREE.Euler(0, rng() * Math.PI, 0),
    );
  }
}

function addLowWattleFence(group: THREE.Group, width: number, z: number, seed: number): void {
  const postCount = Math.max(4, Math.floor(width / 1.25));
  const span = width * 0.88;
  for (let i = 0; i < postCount; i++) {
    const x = -span * 0.5 + (span * i) / (postCount - 1);
    addMesh(
      group,
      new THREE.CylinderGeometry(0.045, 0.06, 0.68, 6),
      MATERIALS.darkTimber,
      x,
      0.34,
      z,
      new THREE.Euler(0, 0, (i % 2 ? 1 : -1) * 0.035),
    );
  }
  for (let row = 0; row < 3; row++) {
    addMesh(
      group,
      new THREE.CylinderGeometry(0.035, 0.035, span, 6),
      MATERIALS.wicker,
      0,
      0.18 + row * 0.17,
      z + (row % 2 ? 0.025 : -0.025),
      new THREE.Euler(0, 0, Math.PI * 0.5 + (row - 1) * 0.012),
    );
  }
  group.userData.wattleSeed = seed;
}

function addBasket(group: THREE.Group, x: number, z: number, filled: boolean, fruit: THREE.Material): void {
  addMesh(group, new THREE.CylinderGeometry(0.3, 0.23, 0.32, 10, 1, true), MATERIALS.wicker, x, 0.17, z);
  addMesh(group, new THREE.TorusGeometry(0.27, 0.035, 5, 12), MATERIALS.darkTimber, x, 0.45, z, new THREE.Euler(Math.PI * 0.5, 0, 0));
  if (!filled) return;
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2;
    addMesh(group, new THREE.IcosahedronGeometry(0.095, 1), fruit, x + Math.cos(angle) * 0.14, 0.36, z + Math.sin(angle) * 0.14);
  }
}

function addFallbackTree(anchor: THREE.Group, kind: 'apple' | 'cherry', seed: number): void {
  const rng = mulberry32(seed);
  const height = kind === 'apple' ? 3.7 : 4.1;
  addMesh(anchor, new THREE.CylinderGeometry(0.14, 0.24, height * 0.55, 7), MATERIALS.darkTimber, 0, height * 0.275, 0);
  const lobes = kind === 'apple' ? 5 : 6;
  for (let i = 0; i < lobes; i++) {
    const angle = (i / lobes) * Math.PI * 2 + rng();
    const radius = i === 0 ? 0 : 0.62 + rng() * 0.28;
    addMesh(
      anchor,
      new THREE.IcosahedronGeometry(0.74 + rng() * 0.18, 1),
      i % 3 === 0 ? MATERIALS.leafLight : MATERIALS.leaf,
      Math.cos(angle) * radius,
      height * (0.64 + rng() * 0.18),
      Math.sin(angle) * radius,
      new THREE.Euler(rng(), rng(), rng()),
      new THREE.Vector3(1, 0.8, 1),
    );
  }
}

function addFruitTree(
  group: THREE.Group,
  plantKind: 'apple' | 'cherry',
  x: number,
  z: number,
  variant: number,
  seed: number,
  plants: BackyardPlantCatalog | null,
): void {
  const anchor = new THREE.Group();
  anchor.name = `${plantKind === 'apple' ? 'AppleTree' : 'CherryTree'}:${variant}`;
  anchor.position.set(x, 0, z);
  anchor.rotation.y = mulberry32(seed)() * Math.PI * 2;
  group.add(anchor);

  if (plants) anchor.add(plants.clone(plantKind, variant));
  else addFallbackTree(anchor, plantKind, seed);

  const rng = mulberry32(seed ^ 0x9e3779b9);
  const material = plantKind === 'apple' ? (variant % 3 === 2 ? MATERIALS.appleGold : MATERIALS.apple) : MATERIALS.cherry;
  const count = plantKind === 'apple' ? 10 : 14;
  for (let i = 0; i < count; i++) {
    const angle = rng() * Math.PI * 2;
    const radius = 0.45 + rng() * 0.8;
    const y = (plantKind === 'apple' ? 2.1 : 2.35) + rng() * 1.25;
    const fruitRadius = plantKind === 'apple' ? 0.095 : 0.062;
    addMesh(anchor, new THREE.IcosahedronGeometry(fruitRadius, 1), material, Math.cos(angle) * radius, y, Math.sin(angle) * radius);
    if (plantKind === 'cherry' && i % 3 === 0) {
      addMesh(anchor, new THREE.IcosahedronGeometry(fruitRadius, 1), material, Math.cos(angle) * radius + 0.08, y - 0.07, Math.sin(angle) * radius + 0.03);
    }
  }
}

function addOrchard(
  group: THREE.Group,
  kind: 'apple' | 'cherry',
  width: number,
  depth: number,
  seed: number,
  plants: BackyardPlantCatalog | null,
): void {
  addMesh(group, new THREE.BoxGeometry(width, 0.045, depth), MATERIALS.grass, 0, 0.022, 0);
  const shallow = depth < 3.9;
  const treeCount = width > 5.3 && depth > 4.6 ? 3 : 2;
  const positions = treeCount === 3
    ? [[-width * 0.27, -depth * 0.18], [width * 0.24, -depth * 0.08], [0, depth * 0.28]]
    : [[-width * 0.25, shallow ? 0 : -depth * 0.12], [width * 0.25, shallow ? 0 : depth * 0.16]];
  positions.forEach(([x, z], index) => addFruitTree(group, kind, x!, z!, index, seed + index * 997, plants));
  addLowWattleFence(group, width, depth * 0.47, seed);
  addBasket(group, width * 0.34, -depth * 0.34, true, kind === 'apple' ? MATERIALS.apple : MATERIALS.cherry);
  addSteppingStones(group, -depth * 0.46, depth * 0.34, seed);
}

function addCabbage(group: THREE.Group, x: number, z: number, seed: number): void {
  const rng = mulberry32(seed);
  for (let layer = 0; layer < 5; layer++) {
    const angle = (layer / 5) * Math.PI * 2;
    addMesh(
      group,
      new THREE.SphereGeometry(0.18, 7, 5),
      layer % 2 ? MATERIALS.cabbage : MATERIALS.leafLight,
      x + Math.cos(angle) * 0.1,
      0.21 + rng() * 0.035,
      z + Math.sin(angle) * 0.1,
      new THREE.Euler(0, angle, 0),
      new THREE.Vector3(1.2, 0.42, 0.72),
    );
  }
}

function addBeanTrellis(group: THREE.Group, x: number, z: number, length: number): void {
  const topY = 1.35;
  for (const dx of [-length * 0.5, 0, length * 0.5]) {
    addMesh(group, new THREE.CylinderGeometry(0.035, 0.05, topY, 6), MATERIALS.darkTimber, x + dx, topY * 0.5, z, new THREE.Euler(0, 0, dx * 0.025));
  }
  addMesh(group, new THREE.CylinderGeometry(0.035, 0.035, length + 0.12, 6), MATERIALS.darkTimber, x, topY, z, new THREE.Euler(0, 0, Math.PI * 0.5), undefined, 'BeanTrellis');
  for (let i = 0; i < 11; i++) {
    const dx = -length * 0.48 + (length * 0.96 * i) / 10;
    addMesh(group, new THREE.SphereGeometry(0.12, 6, 4), i % 2 ? MATERIALS.leaf : MATERIALS.squash, x + dx, 0.3 + (i % 4) * 0.28, z, new THREE.Euler(0, i, 0), new THREE.Vector3(1, 0.55, 0.45));
  }
}

function addVegetableGarden(group: THREE.Group, width: number, depth: number, seed: number): void {
  addMesh(group, new THREE.BoxGeometry(width, 0.04, depth), MATERIALS.path, 0, 0.02, 0);
  const bedCount = width > 5.4 ? 3 : 2;
  const gap = 0.42;
  const bedWidth = (width - gap * (bedCount + 1)) / bedCount;
  const bedDepth = Math.max(1.2, depth - 0.65);
  for (let bed = 0; bed < bedCount; bed++) {
    const x = -width * 0.5 + gap + bedWidth * 0.5 + bed * (bedWidth + gap);
    addSoilBed(group, x, 0, bedWidth, bedDepth);
    if (bed === bedCount - 1 && depth > 3.2) {
      addBeanTrellis(group, x, 0, bedWidth * 0.75);
      continue;
    }
    const cols = Math.max(2, Math.floor(bedWidth / 0.52));
    const rows = Math.max(2, Math.floor(bedDepth / 0.65));
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        addCabbage(
          group,
          x - ((cols - 1) * 0.48) * 0.5 + col * 0.48,
          -((rows - 1) * 0.61) * 0.5 + row * 0.61,
          seed + bed * 101 + row * 17 + col,
        );
      }
    }
  }
  addBasket(group, width * 0.38, -depth * 0.38, false, MATERIALS.apple);
}

function addRoseShrub(
  group: THREE.Group,
  x: number,
  z: number,
  index: number,
  seed: number,
  plants: BackyardPlantCatalog | null,
): void {
  const anchor = new THREE.Group();
  anchor.name = `RoseBush:${index}`;
  anchor.position.set(x, 0, z);
  anchor.rotation.y = mulberry32(seed)() * Math.PI * 2;
  group.add(anchor);
  if (plants) anchor.add(plants.clone('rose', index));
  else {
    for (let branch = 0; branch < 7; branch++) {
      const angle = (branch / 7) * Math.PI * 2;
      addMesh(anchor, new THREE.CylinderGeometry(0.018, 0.03, 0.75, 5), MATERIALS.darkTimber, Math.cos(angle) * 0.16, 0.38, Math.sin(angle) * 0.16, new THREE.Euler(Math.cos(angle) * 0.2, 0, -Math.sin(angle) * 0.2));
      addMesh(anchor, new THREE.IcosahedronGeometry(0.24, 1), branch % 2 ? MATERIALS.leaf : MATERIALS.leafLight, Math.cos(angle) * 0.27, 0.62 + (branch % 3) * 0.12, Math.sin(angle) * 0.27, undefined, new THREE.Vector3(1, 0.7, 1));
    }
  }
  const flower = FLOWER_MATERIALS[index % 3]!;
  for (let bloom = 0; bloom < 8; bloom++) {
    const angle = (bloom / 8) * Math.PI * 2 + index * 0.37;
    addMesh(anchor, new THREE.IcosahedronGeometry(0.095, 1), flower, Math.cos(angle) * (0.3 + (bloom % 2) * 0.18), 0.64 + (bloom % 3) * 0.17, Math.sin(angle) * (0.3 + (bloom % 2) * 0.18));
  }
}

function addFlowerGarden(
  group: THREE.Group,
  width: number,
  depth: number,
  seed: number,
  plants: BackyardPlantCatalog | null,
): void {
  addMesh(group, new THREE.BoxGeometry(width, 0.04, depth), MATERIALS.grass, 0, 0.02, 0);
  const sideWidth = Math.max(1.25, width * 0.34);
  addSoilBed(group, -width * 0.29, 0, sideWidth, depth * 0.82, false);
  addSoilBed(group, width * 0.29, 0, sideWidth, depth * 0.82, false);
  const roseCount = width > 5.2 ? 4 : 3;
  for (let i = 0; i < roseCount; i++) {
    const side = i % 2 ? 1 : -1;
    const row = Math.floor(i / 2);
    addRoseShrub(group, side * width * 0.28, (row - 0.5) * Math.min(1.75, depth * 0.35), i, seed + i * 311, plants);
  }
  const rng = mulberry32(seed ^ 0xaf413);
  for (let i = 0; i < Math.max(12, Math.floor(width * depth * 0.7)); i++) {
    const side = i % 2 ? 1 : -1;
    const x = side * (width * 0.16 + rng() * width * 0.26);
    const z = (rng() - 0.5) * depth * 0.72;
    const h = 0.22 + rng() * 0.28;
    addMesh(group, new THREE.CylinderGeometry(0.012, 0.018, h, 5), MATERIALS.herb, x, h * 0.5 + 0.08, z);
    addMesh(group, new THREE.IcosahedronGeometry(0.07 + rng() * 0.035, 1), FLOWER_MATERIALS[(i + 3) % FLOWER_MATERIALS.length]!, x, h + 0.08, z);
  }
  addSteppingStones(group, -depth * 0.45, depth * 0.42, seed);
}

function addHerbClump(group: THREE.Group, x: number, z: number, kind: number, seed: number): void {
  const rng = mulberry32(seed);
  const material = kind % 2 ? MATERIALS.herbSilver : MATERIALS.herb;
  const stalks = 5 + (kind % 3);
  for (let i = 0; i < stalks; i++) {
    const angle = (i / stalks) * Math.PI * 2;
    const h = 0.25 + rng() * 0.3;
    addMesh(group, new THREE.CylinderGeometry(0.012, 0.018, h, 5), material, x + Math.cos(angle) * 0.11, 0.16 + h * 0.5, z + Math.sin(angle) * 0.11, new THREE.Euler(Math.cos(angle) * 0.16, 0, -Math.sin(angle) * 0.16));
    addMesh(group, new THREE.SphereGeometry(0.095, 6, 4), material, x + Math.cos(angle) * 0.17, 0.18 + h, z + Math.sin(angle) * 0.17, undefined, new THREE.Vector3(1, 0.45, 0.65));
    if (kind === 2 && i % 2 === 0) addMesh(group, new THREE.IcosahedronGeometry(0.045, 0), FLOWER_MATERIALS[3], x + Math.cos(angle) * 0.17, 0.25 + h, z + Math.sin(angle) * 0.17);
  }
}

function addDryingRack(group: THREE.Group, x: number, z: number): void {
  for (const dx of [-0.55, 0.55]) {
    addMesh(group, new THREE.CylinderGeometry(0.035, 0.05, 1.2, 6), MATERIALS.darkTimber, x + dx, 0.6, z);
  }
  addMesh(group, new THREE.CylinderGeometry(0.035, 0.035, 1.25, 6), MATERIALS.darkTimber, x, 1.16, z, new THREE.Euler(0, 0, Math.PI * 0.5), undefined, 'HerbDryingRack');
  for (let i = 0; i < 4; i++) {
    const dx = -0.42 + i * 0.28;
    addMesh(group, new THREE.CylinderGeometry(0.035, 0.08, 0.5, 6), i % 2 ? MATERIALS.herbSilver : MATERIALS.herb, x + dx, 0.82, z, new THREE.Euler(0, 0, Math.PI));
  }
}

function addHerbGarden(group: THREE.Group, width: number, depth: number, seed: number): void {
  addMesh(group, new THREE.BoxGeometry(width, 0.04, depth), MATERIALS.path, 0, 0.02, 0);
  const rackSpace = depth > 3.7 ? 1.15 : 0;
  const plotDepth = Math.max(1.1, depth - 0.65 - rackSpace);
  const plotZ = rackSpace > 0 ? -rackSpace * 0.35 : 0;
  const plotW = (width - 0.85) * 0.5;
  for (let side = 0; side < 2; side++) {
    const x = (side ? 1 : -1) * (plotW * 0.5 + 0.18);
    addSoilBed(group, x, plotZ, plotW, plotDepth);
    const cols = Math.max(2, Math.floor(plotW / 0.65));
    const rows = Math.max(2, Math.floor(plotDepth / 0.72));
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        addHerbClump(group, x - ((cols - 1) * 0.58) * 0.5 + col * 0.58, plotZ - ((rows - 1) * 0.66) * 0.5 + row * 0.66, (side + row + col) % 3, seed + side * 101 + row * 13 + col);
      }
    }
  }
  if (rackSpace > 0) addDryingRack(group, 0, depth * 0.36);
  addMesh(group, new THREE.CylinderGeometry(0.21, 0.28, 0.42, 10), MATERIALS.terracotta, -width * 0.4, 0.22, -depth * 0.38);
}

export function createBackyardGardenMesh(
  kind: BackyardGardenKind,
  options: BackyardGardenMeshOptions = {},
): THREE.Group {
  const width = THREE.MathUtils.clamp(options.width ?? 5.4, 3.8, 7.2);
  const depth = THREE.MathUtils.clamp(options.depth ?? 4.6, 1.8, 8.2);
  const seed = options.seed ?? 1;
  const plants = options.plants ?? null;
  const group = new THREE.Group();
  group.name = `BackyardGarden:${kind}`;
  group.userData.gardenKind = kind;
  group.userData.footprint = { width, depth };
  group.userData.usesSeedThree = Boolean(plants);

  switch (kind) {
    case 'apple_orchard':
      addOrchard(group, 'apple', width, depth, seed, plants);
      break;
    case 'cherry_orchard':
      addOrchard(group, 'cherry', width, depth, seed, plants);
      break;
    case 'vegetable_garden':
      addVegetableGarden(group, width, depth, seed);
      break;
    case 'flower_garden':
      addFlowerGarden(group, width, depth, seed, plants);
      break;
    case 'herb_garden':
      addHerbGarden(group, width, depth, seed);
      break;
    default: {
      const unreachable: never = kind;
      throw new Error(`Unknown backyard garden kind: ${unreachable}`);
    }
  }

  return group;
}

/** Dispose only geometry owned by a garden instance; SeedThree clones share prototypes. */
export function disposeBackyardGardenMesh(group: THREE.Group): void {
  group.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || mesh.userData.backyardSharedGeometry) return;
    mesh.geometry.dispose();
  });
}
