import * as THREE from 'three';
import {
  addMesh,
  metalMaterial,
  residenceFacadeMaterial,
  sharedBuildingDetailMaterial,
  shingleMaterial,
  stoneMaterial,
  timberMaterial,
} from '../buildingMaterials.ts';
import {
  addBarrel,
  addGableShell,
  addPlankDoor,
  addSmallWindow,
} from './buildingMeshKit.ts';

const waterMaterial = sharedBuildingDetailMaterial('water');

/** Limestone village well beneath a steep, weatherproof shingle cap. */
export function createWellMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Well';

  addMesh(
    group,
    new THREE.CylinderGeometry(2.0, 2.12, 0.22, 12),
    stoneMaterial('mortar'),
    new THREE.Vector3(0, 0.11, 0),
  );
  addMesh(
    group,
    new THREE.CylinderGeometry(1.18, 1.28, 0.95, 14, 1, true),
    stoneMaterial('light'),
    new THREE.Vector3(0, 0.69, 0),
  );
  addMesh(
    group,
    new THREE.CylinderGeometry(0.92, 0.92, 0.08, 16),
    waterMaterial,
    new THREE.Vector3(0, 0.88, 0),
  );
  addMesh(
    group,
    new THREE.TorusGeometry(1.22, 0.16, 7, 16),
    stoneMaterial('mid'),
    new THREE.Vector3(0, 1.17, 0),
    new THREE.Euler(Math.PI * 0.5, 0, 0),
  );

  for (const x of [-1.42, 1.42]) {
    addMesh(
      group,
      new THREE.BoxGeometry(0.24, 3.15, 0.24),
      timberMaterial('dark'),
      new THREE.Vector3(x, 1.72, 0),
    );
  }
  addMesh(
    group,
    new THREE.CylinderGeometry(0.13, 0.13, 3.15, 9),
    timberMaterial('weathered'),
    new THREE.Vector3(0, 2.23, 0),
    new THREE.Euler(0, 0, Math.PI * 0.5),
  );
  addMesh(
    group,
    new THREE.CylinderGeometry(0.32, 0.32, 0.7, 10),
    timberMaterial('mid'),
    new THREE.Vector3(0, 2.23, 0),
    new THREE.Euler(0, 0, Math.PI * 0.5),
  );
  addMesh(
    group,
    new THREE.CylinderGeometry(0.025, 0.025, 1.15, 6),
    timberMaterial('dark'),
    new THREE.Vector3(0, 1.63, 0),
  );
  addMesh(
    group,
    new THREE.CylinderGeometry(0.27, 0.22, 0.42, 10),
    metalMaterial('iron'),
    new THREE.Vector3(0, 1.03, 0),
  );

  addMesh(
    group,
    new THREE.ConeGeometry(2.52, 1.78, 4),
    shingleMaterial(),
    new THREE.Vector3(0, 3.72, 0),
    new THREE.Euler(0, Math.PI * 0.25, 0),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(3.1, 0.16, 0.16),
    timberMaterial('dark'),
    new THREE.Vector3(0, 3.0, 0),
  );
  return group;
}

function addStoneChimney(group: THREE.Group, x: number, z: number, height: number): void {
  addMesh(
    group,
    new THREE.BoxGeometry(0.72, height, 0.72),
    stoneMaterial('mid'),
    new THREE.Vector3(x, height * 0.5 + 2.55, z),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(0.88, 0.16, 0.88),
    stoneMaterial('light'),
    new THREE.Vector3(x, 2.55 + height, z),
  );
}

function addDryingLeanTo(group: THREE.Group, halfW: number): void {
  const centerX = halfW + 1.15;
  for (const x of [centerX - 0.72, centerX + 0.72]) {
    for (const z of [-1.72, 1.72]) {
      addMesh(
        group,
        new THREE.BoxGeometry(0.16, 2.1, 0.16),
        timberMaterial('dark'),
        new THREE.Vector3(x, 1.05, z),
      );
    }
  }
  addMesh(
    group,
    new THREE.BoxGeometry(1.85, 0.13, 3.95),
    shingleMaterial(),
    new THREE.Vector3(centerX, 2.22, 0),
    new THREE.Euler(0, 0, -0.16),
  );
  for (const z of [-1.25, -0.42, 0.42, 1.25]) {
    addMesh(
      group,
      new THREE.BoxGeometry(1.18, 0.09, 0.09),
      timberMaterial('weathered'),
      new THREE.Vector3(centerX, 1.52, z),
    );
    for (const x of [centerX - 0.33, centerX + 0.33]) {
      addMesh(
        group,
        new THREE.ConeGeometry(0.14, 0.58, 7),
        timberMaterial('mid'),
        new THREE.Vector3(x, 1.2, z),
        new THREE.Euler(Math.PI, 0, 0),
      );
    }
  }
}

/** Broad hunting hall with a deep side rack and unmistakable stone chimney. */
export function createHuntersHallMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = "Hunter's hall";
  const shell = addGableShell(group, {
    width: 7.7,
    depth: 6.45,
    stoneHeight: 0.82,
    wallHeight: 2.55,
    ridgeHeight: 2.3,
    wallMaterial: residenceFacadeMaterial('grey'),
    roofMaterial: shingleMaterial(),
    stoneGroundFloor: true,
  });
  addPlankDoor(group, -1.38, 0.86, shell.frontZ + 0.02, 1.05, 1.92);
  addSmallWindow(group, 1.25, 1.82, shell.frontZ + 0.02, 0.86, 1.0);
  addStoneChimney(group, -2.45, -1.4, 2.75);
  addDryingLeanTo(group, shell.halfW);
  return group;
}

function addHerbPorch(group: THREE.Group, frontZ: number): void {
  const porchZ = frontZ + 1.0;
  for (const x of [-2.0, 2.0]) {
    addMesh(
      group,
      new THREE.BoxGeometry(0.14, 2.1, 0.14),
      timberMaterial('dark'),
      new THREE.Vector3(x, 1.05, porchZ),
    );
  }
  addMesh(
    group,
    new THREE.BoxGeometry(4.35, 0.12, 2.05),
    shingleMaterial(),
    new THREE.Vector3(0, 2.18, porchZ - 0.18),
    new THREE.Euler(-0.14, 0, 0),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(4.0, 0.1, 0.1),
    timberMaterial('weathered'),
    new THREE.Vector3(0, 1.72, porchZ),
  );
  for (let i = 0; i < 7; i++) {
    addMesh(
      group,
      new THREE.ConeGeometry(0.16, 0.55 + (i % 2) * 0.12, 7),
      sharedBuildingDetailMaterial('foliage'),
      new THREE.Vector3(-1.55 + i * 0.52, 1.4, porchZ),
      new THREE.Euler(Math.PI, 0, 0),
    );
  }
  for (const x of [-1.4, 1.45]) {
    addMesh(
      group,
      new THREE.CylinderGeometry(0.38, 0.27, 0.42, 10),
      timberMaterial('light'),
      new THREE.Vector3(x, 0.23, porchZ + 0.15),
    );
    addMesh(
      group,
      new THREE.TorusGeometry(0.33, 0.025, 5, 10),
      timberMaterial('dark'),
      new THREE.Vector3(x, 0.45, porchZ + 0.15),
      new THREE.Euler(Math.PI * 0.5, 0, 0),
    );
  }
}

/** Compact gathering shed whose herb-drying porch reads clearly from above. */
export function createForagersShedMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = "Forager's shed";
  const shell = addGableShell(group, {
    width: 5.45,
    depth: 4.65,
    stoneHeight: 0.55,
    wallHeight: 2.34,
    ridgeHeight: 2.0,
    wallMaterial: residenceFacadeMaterial('yellow'),
    roofMaterial: shingleMaterial(),
  });
  addPlankDoor(group, -0.95, 0.59, shell.frontZ + 0.02, 0.9, 1.8);
  addSmallWindow(group, 1.08, 1.54, shell.frontZ + 0.02, 0.72, 0.86);
  addHerbPorch(group, shell.frontZ);
  addBarrel(group, shell.halfW - 0.35, -shell.halfD + 0.35, 0.82);
  return group;
}
