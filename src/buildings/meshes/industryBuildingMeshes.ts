import * as THREE from 'three';
import {
  addMesh,
  metalMaterial,
  residenceFacadeMaterial,
  sharedBuildingDetailMaterial,
  shingleMaterial,
  stoneMaterial,
  tileMaterial,
  timberMaterial,
} from '../buildingMaterials.ts';
import { addTriangularGableWall } from '../meshPrimitives.ts';
import { addLogPile } from '../logPile.ts';
import {
  addDarkOpening,
  addGableShell,
  addPlankDoor,
  addSmallWindow,
} from './buildingMeshKit.ts';

function addMillRoof(group: THREE.Group, length: number, width: number, wallTop: number): void {
  const halfL = length * 0.5;
  const halfW = width * 0.5;
  const ridgeHeight = 2.35;
  const pitch = Math.atan2(ridgeHeight, halfW);
  const slopeLen = halfW / Math.cos(pitch) + 0.3;

  for (const side of [-1, 1] as const) {
    addMesh(
      group,
      new THREE.BoxGeometry(length + 0.6, 0.14, slopeLen),
      tileMaterial(side > 0 ? 0 : 1),
      new THREE.Vector3(0, wallTop + ridgeHeight * 0.48, side * halfW * 0.46),
      new THREE.Euler(side > 0 ? pitch : -pitch, 0, 0),
    );
    for (let row = 0; row < 4; row++) {
      const t = (row + 0.5) / 4.8;
      addMesh(
        group,
        new THREE.BoxGeometry(length + 0.62, 0.055, 0.07),
        tileMaterial(row % 2 === 0 ? 0 : 1),
        new THREE.Vector3(0, wallTop + ridgeHeight * t + 0.02, side * halfW * (1 - t)),
        new THREE.Euler(side > 0 ? pitch : -pitch, 0, 0),
      );
    }
  }
  addMesh(
    group,
    new THREE.BoxGeometry(length + 0.78, 0.2, 0.28),
    tileMaterial(2),
    new THREE.Vector3(0, wallTop + ridgeHeight + 0.04, 0),
  );
  for (const xSign of [-1, 1] as const) {
    addTriangularGableWall(
      group,
      'x',
      xSign * (halfL - 0.07),
      halfW,
      wallTop,
      ridgeHeight,
      0.16,
      timberMaterial('weathered'),
    );
  }
}

function addSawmillRig(group: THREE.Group): void {
  addMesh(
    group,
    new THREE.BoxGeometry(4.4, 0.28, 1.9),
    timberMaterial('dark'),
    new THREE.Vector3(0.6, 0.92, 2.25),
  );
  addMesh(
    group,
    new THREE.CylinderGeometry(1.05, 1.05, 0.09, 24),
    metalMaterial('steel'),
    new THREE.Vector3(0.4, 1.92, 2.25),
    new THREE.Euler(Math.PI * 0.5, 0, 0),
  );
  for (const x of [-1.35, 2.55]) {
    addMesh(
      group,
      new THREE.BoxGeometry(0.2, 2.6, 0.2),
      timberMaterial('dark'),
      new THREE.Vector3(x, 1.55, 2.25),
    );
  }
  addMesh(
    group,
    new THREE.BoxGeometry(4.1, 0.18, 0.18),
    timberMaterial('weathered'),
    new THREE.Vector3(0.6, 2.82, 2.25),
  );
  addMesh(
    group,
    new THREE.CylinderGeometry(0.58, 0.58, 0.16, 16),
    metalMaterial('iron'),
    new THREE.Vector3(2.2, 1.0, 1.24),
    new THREE.Euler(Math.PI * 0.5, 0, 0),
  );
}

function createMillTimberStockpile(): THREE.Group {
  const stockpile = new THREE.Group();
  stockpile.name = 'TimberStockpile';
  stockpile.visible = false;
  const positions = [
    [-6.2, -4.15],
    [-3.1, -4.15],
    [0, -4.15],
    [3.1, -4.15],
    [6.2, -4.15],
  ] as const;
  for (let i = 0; i < positions.length; i++) {
    const segment = new THREE.Group();
    segment.name = 'TimberStockSegment';
    const [x, z] = positions[i];
    addLogPile(segment, x, z, 0, i % 2 === 0 ? 4 : 3, 2.65, 0.24);
    stockpile.add(segment);
  }
  return stockpile;
}

/** Long stone-and-oak saw hall. Yard timber is populated from actual mill storage. */
export function createLumberMillMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Lumber mill';
  const length = 16.8;
  const width = 6.6;
  const stoneHeight = 0.72;
  const wallHeight = 3.2;
  const halfL = length * 0.5;
  const halfW = width * 0.5;
  const wallTop = stoneHeight + wallHeight;

  addMesh(
    group,
    new THREE.BoxGeometry(length + 0.42, stoneHeight, width + 0.42),
    stoneMaterial('light'),
    new THREE.Vector3(0, stoneHeight * 0.5, 0),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(length - 0.18, wallHeight, width - 0.18),
    timberMaterial('weathered'),
    new THREE.Vector3(0, stoneHeight + wallHeight * 0.5, 0),
  );
  for (let x = -halfL + 0.55; x <= halfL - 0.45; x += 2.35) {
    for (const z of [-halfW + 0.06, halfW - 0.06]) {
      addMesh(
        group,
        new THREE.BoxGeometry(0.23, wallHeight, 0.23),
        timberMaterial('dark'),
        new THREE.Vector3(x, stoneHeight + wallHeight * 0.5, z),
      );
    }
  }
  addMesh(
    group,
    new THREE.BoxGeometry(length + 0.08, 0.17, width + 0.08),
    timberMaterial('dark'),
    new THREE.Vector3(0, wallTop - 0.08, 0),
  );
  addMillRoof(group, length, width, wallTop);

  addDarkOpening(group, 0, stoneHeight + 1.45, halfW + 0.01, 4.8, 2.72);
  addSawmillRig(group);
  for (const x of [-halfL + 1.5, halfL - 1.5]) {
    addSmallWindow(group, x, stoneHeight + 1.85, halfW + 0.03, 0.8, 1.05);
  }
  addPlankDoor(group, -halfL + 1.0, stoneHeight + 0.04, halfW + 0.04, 0.92, 1.9);

  // Deep eave over the intake bay makes the road-facing working side unmistakable.
  for (const x of [-2.7, 2.7]) {
    addMesh(
      group,
      new THREE.BoxGeometry(0.18, 2.5, 0.18),
      timberMaterial('dark'),
      new THREE.Vector3(x, 1.25, halfW + 1.05),
    );
  }
  addMesh(
    group,
    new THREE.BoxGeometry(6.0, 0.13, 2.1),
    tileMaterial(1),
    new THREE.Vector3(0, 2.62, halfW + 0.72),
    new THREE.Euler(-0.16, 0, 0),
  );

  group.add(createMillTimberStockpile());
  return group;
}

function addNurseryPergola(group: THREE.Group, halfW: number): void {
  const centerX = halfW + 1.35;
  for (const x of [centerX - 0.75, centerX + 0.75]) {
    for (const z of [-1.6, 1.6]) {
      addMesh(
        group,
        new THREE.BoxGeometry(0.14, 2.0, 0.14),
        timberMaterial('dark'),
        new THREE.Vector3(x, 1.0, z),
      );
    }
  }
  for (let z = -1.55; z <= 1.55; z += 0.52) {
    addMesh(
      group,
      new THREE.BoxGeometry(1.8, 0.08, 0.1),
      timberMaterial('weathered'),
      new THREE.Vector3(centerX, 2.0, z),
    );
  }
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i < 4; i++) {
      addMesh(
        group,
        new THREE.ConeGeometry(0.22, 0.72 + i * 0.05, 7),
        sharedBuildingDetailMaterial('foliage'),
        new THREE.Vector3(centerX + (row - 0.5) * 0.72, 0.36, -1.15 + i * 0.75),
      );
    }
  }
}

/** Woodland nursery hut with a slatted sapling pergola. */
export function createReforesterHutMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Reforester hut';
  const shell = addGableShell(group, {
    width: 6.0,
    depth: 5.45,
    stoneHeight: 0.58,
    wallHeight: 2.52,
    ridgeHeight: 2.35,
    wallMaterial: timberMaterial('weathered'),
    roofMaterial: shingleMaterial(),
  });
  addPlankDoor(group, -0.9, 0.62, shell.frontZ + 0.02, 0.94, 1.86);
  addSmallWindow(group, 1.25, 1.64, shell.frontZ + 0.02, 0.76, 0.92);
  addNurseryPergola(group, shell.halfW);
  return group;
}

function addChoppingShelter(group: THREE.Group, halfW: number): void {
  const centerX = halfW + 1.0;
  for (const x of [centerX - 0.62, centerX + 0.62]) {
    for (const z of [-1.25, 1.25]) {
      addMesh(
        group,
        new THREE.BoxGeometry(0.16, 2.0, 0.16),
        timberMaterial('dark'),
        new THREE.Vector3(x, 1.0, z),
      );
    }
  }
  addMesh(
    group,
    new THREE.BoxGeometry(1.65, 0.12, 3.0),
    shingleMaterial(),
    new THREE.Vector3(centerX, 2.06, 0),
    new THREE.Euler(0, 0, -0.13),
  );
  addMesh(
    group,
    new THREE.CylinderGeometry(0.46, 0.52, 0.56, 10),
    timberMaterial('dark'),
    new THREE.Vector3(centerX, 0.28, 0.28),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(0.1, 0.82, 0.12),
    timberMaterial('light'),
    new THREE.Vector3(centerX + 0.1, 0.93, 0.28),
    new THREE.Euler(0, 0, -0.28),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(0.46, 0.08, 0.26),
    metalMaterial('steel'),
    new THREE.Vector3(centerX + 0.2, 1.34, 0.28),
    new THREE.Euler(0, 0, -0.28),
  );
}

/** Firewood workshop with a stone-and-lime lodge and dedicated chopping shelter. */
export function createWoodcuttersLodgeMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = "Woodcutter's lodge";
  const shell = addGableShell(group, {
    width: 6.75,
    depth: 5.9,
    stoneHeight: 0.72,
    wallHeight: 2.62,
    ridgeHeight: 2.22,
    wallMaterial: residenceFacadeMaterial('lightOrange'),
    roofMaterial: shingleMaterial(),
  });
  addPlankDoor(group, -1.25, 0.76, shell.frontZ + 0.02, 1.0, 1.9);
  addSmallWindow(group, 1.35, 1.82, shell.frontZ + 0.02, 0.82, 1.0);
  addChoppingShelter(group, shell.halfW);
  return group;
}
