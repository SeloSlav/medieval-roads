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
import { addBarrel, addDarkOpening, addGableShell, addPlankDoor, addSmallWindow } from './buildingMeshKit.ts';

const earth = sharedBuildingDetailMaterial('earth');
const crop = sharedBuildingDetailMaterial('crop');
const leaf = sharedBuildingDetailMaterial('foliage');
const wineLeaf = sharedBuildingDetailMaterial('foliage');
const grape = sharedBuildingDetailMaterial('paintBlue');
const canvas = residenceFacadeMaterial('yellow');
const copper = sharedBuildingDetailMaterial('brass');
const hiveBlue = sharedBuildingDetailMaterial('paintBlue');
const hiveRed = sharedBuildingDetailMaterial('paintRed');

function addChimney(group: THREE.Group, x: number, z: number, height = 4.8): void {
  addMesh(group, new THREE.BoxGeometry(0.72, height, 0.72), stoneMaterial('mid'), new THREE.Vector3(x, height * 0.5, z));
  addMesh(group, new THREE.BoxGeometry(0.92, 0.18, 0.92), stoneMaterial('light'), new THREE.Vector3(x, height + 0.02, z));
}

function addRaisedStore(group: THREE.Group, width: number, depth: number, centerX = 0): void {
  for (const x of [-width * 0.38, width * 0.38]) for (const z of [-depth * 0.35, depth * 0.35]) {
    addMesh(group, new THREE.BoxGeometry(0.42, 1.2, 0.42), stoneMaterial('mid'), new THREE.Vector3(centerX + x, 0.6, z));
  }
  addMesh(group, new THREE.BoxGeometry(width, 0.28, depth), timberMaterial('dark'), new THREE.Vector3(centerX, 1.18, 0));
}

function addSheaf(group: THREE.Group, x: number, z: number, scale = 1): void {
  addMesh(group, new THREE.CylinderGeometry(0.38 * scale, 0.5 * scale, 1.35 * scale, 8), crop, new THREE.Vector3(x, 0.68 * scale, z));
  addMesh(group, new THREE.TorusGeometry(0.34 * scale, 0.045 * scale, 5, 10), timberMaterial('light'), new THREE.Vector3(x, 0.72 * scale, z), new THREE.Euler(Math.PI * 0.5, 0, 0));
}

function addSack(group: THREE.Group, x: number, z: number, scale = 1): void {
  addMesh(group, new THREE.SphereGeometry(0.45 * scale, 8, 6), canvas, new THREE.Vector3(x, 0.42 * scale, z), new THREE.Euler(0, 0, -0.08), new THREE.Vector3(0.82, 1.35, 0.72));
  addMesh(group, new THREE.CylinderGeometry(0.07 * scale, 0.14 * scale, 0.24 * scale, 7), canvas, new THREE.Vector3(x, 0.94 * scale, z));
}

function addCartWheel(group: THREE.Group, x: number, y: number, z: number, radius: number): void {
  addMesh(group, new THREE.TorusGeometry(radius, 0.1, 7, 18), timberMaterial('dark'), new THREE.Vector3(x, y, z), new THREE.Euler(0, Math.PI * 0.5, 0));
  for (let i = 0; i < 8; i++) {
    addMesh(group, new THREE.BoxGeometry(0.09, radius * 1.72, 0.09), timberMaterial('weathered'), new THREE.Vector3(x, y, z), new THREE.Euler(i * Math.PI / 8, 0, Math.PI * 0.5));
  }
  addMesh(group, new THREE.CylinderGeometry(0.17, 0.17, 0.2, 9), timberMaterial('dark'), new THREE.Vector3(x, y, z), new THREE.Euler(0, 0, Math.PI * 0.5));
}

function addCross(group: THREE.Group, x: number, y: number, z: number, scale = 1): void {
  addMesh(group, new THREE.BoxGeometry(0.12 * scale, 1.05 * scale, 0.12 * scale), metalMaterial('iron'), new THREE.Vector3(x, y, z));
  addMesh(group, new THREE.BoxGeometry(0.64 * scale, 0.12 * scale, 0.12 * scale), metalMaterial('iron'), new THREE.Vector3(x, y + 0.18 * scale, z));
}


export function createThreshingBarnMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Threshing barn';
  const shell = addGableShell(group, { width: 10.8, depth: 7.2, stoneHeight: 0.58, wallHeight: 3.25, ridgeHeight: 3.0, wallMaterial: timberMaterial('weathered'), roofMaterial: tileMaterial(1) });
  addPlankDoor(group, -3.1, 0.62, shell.frontZ + 0.03, 1.25, 2.45);
  addPlankDoor(group, 0, 0.62, shell.frontZ + 0.03, 2.6, 2.7);
  addDarkOpening(group, 0, 0.66, -shell.frontZ - 0.03, 3.7, 2.85);
  for (const x of [-4.2, 4.2]) addSmallWindow(group, x, 2.35, shell.frontZ + 0.03, 0.72, 0.8);
  for (const x of [-4.5, -2.9, 3.1, 4.6]) addSheaf(group, x, -4.5, 1.05);
  // A low handcart and flails make the yard read as threshing rather than storage.
  addMesh(group, new THREE.BoxGeometry(2.5, 0.42, 1.45), timberMaterial('weathered'), new THREE.Vector3(3.1, 0.82, 4.65));
  addCartWheel(group, 1.82, 0.67, 4.65, 0.66);
  addCartWheel(group, 4.38, 0.67, 4.65, 0.66);
  for (let i = 0; i < 3; i++) addMesh(group, new THREE.CylinderGeometry(0.045, 0.045, 2.4, 6), timberMaterial('light'), new THREE.Vector3(-3.2 + i * 0.34, 0.55, 4.4), new THREE.Euler(0.12, 0, 1.18));
  return group;
}

export function createMonasteryMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Pauline monastery';
  const main = addGableShell(group, { width: 13.2, depth: 6.4, stoneHeight: 1.35, wallHeight: 3.8, ridgeHeight: 2.7, wallMaterial: residenceFacadeMaterial('white'), roofMaterial: tileMaterial(0), centerX: -1.2 });
  addPlankDoor(group, -1.2, 1.38, main.frontZ + 0.03, 1.1, 2.05);
  for (const x of [-5.8, -3.1, 0.8, 3.5]) for (const y of [2.45, 4.18]) addSmallWindow(group, x, y, main.frontZ + 0.03, 0.66, 0.9);
  const wing = addGableShell(group, { width: 5.4, depth: 8.8, stoneHeight: 1.1, wallHeight: 3.35, ridgeHeight: 2.45, wallMaterial: residenceFacadeMaterial('white'), roofMaterial: tileMaterial(1), centerX: 6.2, centerZ: 1.1 });
  addPlankDoor(group, 6.2, 1.14, wing.frontZ + 0.03, 0.94, 1.95);
  // Low arcaded cloister edge and a restrained belfry distinguish it from the parish chapel.
  for (let x = -4.9; x <= 2.6; x += 1.5) addMesh(group, new THREE.BoxGeometry(0.18, 2.15, 0.18), stoneMaterial('light'), new THREE.Vector3(x, 1.08, 4.25));
  addMesh(group, new THREE.BoxGeometry(8.0, 0.18, 1.55), tileMaterial(1), new THREE.Vector3(-1.15, 2.3, 4.25), new THREE.Euler(-0.16, 0, 0));
  addMesh(group, new THREE.BoxGeometry(2.1, 2.25, 2.1), stoneMaterial('light'), new THREE.Vector3(-1.2, 6.25, 0));
  addMesh(group, new THREE.ConeGeometry(1.55, 2.35, 4), tileMaterial(2), new THREE.Vector3(-1.2, 8.55, 0), new THREE.Euler(0, Math.PI * 0.25, 0));
  addCross(group, -1.2, 10.05, 0, 0.85);
  // Cloister shadow rhythm and a small physic garden keep the long facade from reading as a manor house.
  for (let x = -4.15; x <= 1.9; x += 1.5) addMesh(group, new THREE.BoxGeometry(1.12, 1.45, 0.08), timberMaterial('dark'), new THREE.Vector3(x, 1.22, 4.27));
  for (const [x, z] of [[-4.1, 6.0], [-1.5, 6.0], [1.1, 6.0]] as const) {
    addMesh(group, new THREE.BoxGeometry(2.0, 0.18, 1.15), earth, new THREE.Vector3(x, 0.09, z));
    for (let i = -2; i <= 2; i++) addMesh(group, new THREE.SphereGeometry(0.13, 6, 4), leaf, new THREE.Vector3(x + i * 0.38, 0.27, z));
  }
  return group;
}

export function createBreweryMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Brewery';
  const shell = addGableShell(group, { width: 8.7, depth: 6.5, stoneHeight: 1.05, wallHeight: 3.05, ridgeHeight: 2.45, wallMaterial: residenceFacadeMaterial('lightOrange'), roofMaterial: tileMaterial(0) });
  addPlankDoor(group, -1.8, 1.08, shell.frontZ + 0.03, 1.22, 2.05);
  addSmallWindow(group, 1.45, 2.35, shell.frontZ + 0.03, 0.88, 1.05);
  addChimney(group, 2.7, -1.35, 5.2);
  for (const [x, z, s] of [[-3.9, 4.1, 1], [-2.9, 4.25, 0.85], [3.5, 3.9, 1.1]] as const) addBarrel(group, x, z, s);
  // Open brewing bay with a copper mash kettle and malt sacks.
  for (const x of [2.45, 4.55]) addMesh(group, new THREE.BoxGeometry(0.18, 2.45, 0.18), timberMaterial('dark'), new THREE.Vector3(x, 1.22, 4.2));
  addMesh(group, new THREE.BoxGeometry(2.65, 0.14, 2.45), tileMaterial(1), new THREE.Vector3(3.5, 2.58, 4.1), new THREE.Euler(-0.13, 0, 0));
  addMesh(group, new THREE.SphereGeometry(0.72, 12, 8), copper, new THREE.Vector3(3.45, 0.96, 4.15), new THREE.Euler(), new THREE.Vector3(1, 1.18, 1));
  addMesh(group, new THREE.CylinderGeometry(0.16, 0.16, 1.6, 8), copper, new THREE.Vector3(3.45, 2.0, 4.15));
  addSack(group, 1.7, 4.3, 0.9);
  addSack(group, 1.15, 4.25, 0.75);
  return group;
}

export function createSmokehouseMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Smokehouse';
  const shell = addGableShell(group, { width: 6.4, depth: 5.5, stoneHeight: 1.5, wallHeight: 2.25, ridgeHeight: 2.2, wallMaterial: timberMaterial('dark'), roofMaterial: shingleMaterial(), stoneGroundFloor: true });
  addPlankDoor(group, -1.0, 1.53, shell.frontZ + 0.03, 0.92, 1.78);
  addSmallWindow(group, 1.25, 2.55, shell.frontZ + 0.03, 0.58, 0.72);
  addChimney(group, 1.85, -1.4, 5.4);
  const smoke = addMesh(group, new THREE.ConeGeometry(0.42, 1.5, 8), sharedBuildingDetailMaterial('smoke'), new THREE.Vector3(1.85, 6.2, -1.4));
  smoke.name = 'Smoke plume';
  for (let i = -2; i <= 2; i++) addMesh(group, new THREE.BoxGeometry(0.08, 0.36, 0.08), metalMaterial('iron'), new THREE.Vector3(i * 0.2, 3.15, shell.frontZ + 0.08));
  // Fuel lean-to and restrained drying rail communicate the complete preservation process.
  addMesh(group, new THREE.BoxGeometry(2.35, 0.12, 2.25), shingleMaterial(), new THREE.Vector3(-4.2, 2.05, 0), new THREE.Euler(0, 0, -0.14));
  for (const z of [-0.9, 0.9]) addMesh(group, new THREE.BoxGeometry(0.16, 2.0, 0.16), timberMaterial('dark'), new THREE.Vector3(-5.1, 1.0, z));
  for (let row = 0; row < 3; row++) for (let i = 0; i < 4; i++) addMesh(group, new THREE.CylinderGeometry(0.13, 0.16, 1.05, 8), timberMaterial(i % 2 ? 'light' : 'mid'), new THREE.Vector3(-4.1 + i * 0.42, 0.22 + row * 0.34, 0.2));
  addMesh(group, new THREE.BoxGeometry(2.55, 0.1, 0.1), timberMaterial('weathered'), new THREE.Vector3(0, 1.85, 4.0));
  for (let i = -2; i <= 2; i++) addMesh(group, new THREE.TorusGeometry(0.14, 0.045, 5, 9, Math.PI * 1.65), sharedBuildingDetailMaterial('paintRed'), new THREE.Vector3(i * 0.42, 1.46, 4.0));
  return group;
}

export function createGranaryMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Granary';
  addRaisedStore(group, 9.3, 6.1);
  const store = new THREE.Group();
  store.position.y = 1.2;
  const shell = addGableShell(store, { width: 9.5, depth: 6.3, stoneHeight: 0.34, wallHeight: 3.15, ridgeHeight: 2.55, wallMaterial: timberMaterial('weathered'), roofMaterial: tileMaterial(1) });
  addPlankDoor(store, 0, 0.38, shell.frontZ + 0.03, 1.55, 2.25);
  for (const x of [-3.3, 3.3]) addSmallWindow(store, x, 1.92, shell.frontZ + 0.03, 0.58, 0.62);
  group.add(store);
  for (let i = -4; i <= 4; i++) addMesh(group, new THREE.BoxGeometry(0.12, 1.15, 0.12), timberMaterial('dark'), new THREE.Vector3(i * 0.85, 0.58, 4.25), new THREE.Euler(0, 0, 0.08));
  for (let i = 0; i < 5; i++) addMesh(group, new THREE.BoxGeometry(1.55 - i * 0.1, 0.18, 0.46), stoneMaterial(i % 2 ? 'mid' : 'light'), new THREE.Vector3(0, 0.12 + i * 0.18, 3.55 + i * 0.34));
  addSack(group, -3.45, 3.8, 0.9);
  addSack(group, -2.75, 3.95, 0.75);
  addMesh(group, new THREE.BoxGeometry(2.4, 0.1, 0.95), timberMaterial('weathered'), new THREE.Vector3(3.05, 0.58, 3.95));
  return group;
}

export function createApiaryMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Apiary';
  const shell = addGableShell(group, { width: 5.2, depth: 4.3, stoneHeight: 0.52, wallHeight: 2.2, ridgeHeight: 1.8, wallMaterial: residenceFacadeMaterial('yellow'), roofMaterial: shingleMaterial() });
  addPlankDoor(group, -0.85, 0.55, shell.frontZ + 0.03, 0.78, 1.62);
  addSmallWindow(group, 1.1, 1.58, shell.frontZ + 0.03, 0.62, 0.72);
  for (let row = 0; row < 2; row++) for (let i = 0; i < 4; i++) {
    const x = -3.4 + i * 2.2;
    const z = -3.2 - row * 1.25;
    addMesh(group, new THREE.BoxGeometry(1.05, 0.72, 0.78), row ? (i % 2 ? hiveBlue : timberMaterial('light')) : (i % 2 ? hiveRed : residenceFacadeMaterial('yellow')), new THREE.Vector3(x, 0.58, z));
    addMesh(group, new THREE.BoxGeometry(1.22, 0.12, 0.94), tileMaterial((i % 3) as 0 | 1 | 2), new THREE.Vector3(x, 1.0, z));
    addMesh(group, new THREE.BoxGeometry(0.72, 0.06, 0.28), timberMaterial('light'), new THREE.Vector3(x, 0.25, z + 0.5));
  }
  addMesh(group, new THREE.CylinderGeometry(0.2, 0.34, 0.72, 9), metalMaterial('iron'), new THREE.Vector3(3.15, 0.38, 2.75));
  addMesh(group, new THREE.CylinderGeometry(0.08, 0.16, 0.48, 8), metalMaterial('iron'), new THREE.Vector3(3.15, 0.96, 2.75));
  addBarrel(group, 2.2, 2.85, 0.72);
  return group;
}

export function createWatermillMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Watermill';
  const shell = addGableShell(group, { width: 9.2, depth: 6.8, stoneHeight: 1.6, wallHeight: 2.75, ridgeHeight: 2.7, wallMaterial: residenceFacadeMaterial('white'), roofMaterial: tileMaterial(1), stoneGroundFloor: true });
  addPlankDoor(group, -1.7, 1.64, shell.frontZ + 0.03, 1.0, 1.9);
  addSmallWindow(group, 1.5, 2.85, shell.frontZ + 0.03, 0.78, 0.96);
  const wheelX = 5.25;
  addMesh(group, new THREE.TorusGeometry(2.15, 0.16, 8, 24), timberMaterial('dark'), new THREE.Vector3(wheelX, 2.15, 0), new THREE.Euler(0, Math.PI * 0.5, 0));
  for (let i = 0; i < 12; i++) addMesh(group, new THREE.BoxGeometry(0.13, 4.05, 0.22), timberMaterial('weathered'), new THREE.Vector3(wheelX, 2.15, 0), new THREE.Euler(i * Math.PI / 12, 0, Math.PI * 0.5));
  addMesh(group, new THREE.CylinderGeometry(0.26, 0.26, 2.2, 10), metalMaterial('iron'), new THREE.Vector3(wheelX, 2.15, 0), new THREE.Euler(0, 0, Math.PI * 0.5));
  for (let i = 0; i < 12; i++) {
    const angle = i * Math.PI / 6;
    addMesh(group, new THREE.BoxGeometry(0.4, 0.72, 1.05), timberMaterial('weathered'), new THREE.Vector3(wheelX, 2.15 + Math.sin(angle) * 2.18, Math.cos(angle) * 2.18), new THREE.Euler(angle, 0, 0));
  }
  // Millrace trough and grain handling props distinguish flour milling from saw work.
  addMesh(group, new THREE.BoxGeometry(1.6, 0.3, 7.8), stoneMaterial('mid'), new THREE.Vector3(wheelX + 0.65, 0.25, 0));
  addSack(group, -3.7, 4.05, 0.9);
  addSack(group, -3.0, 4.15, 0.72);
  addMesh(group, new THREE.BoxGeometry(1.5, 1.0, 1.35), timberMaterial('weathered'), new THREE.Vector3(-1.9, 0.52, 4.05));
  return group;
}

export function createCarpenterMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Carpenter and wheelwright';
  const shell = addGableShell(group, { width: 7.2, depth: 5.6, stoneHeight: 0.7, wallHeight: 2.7, ridgeHeight: 2.2, wallMaterial: timberMaterial('weathered'), roofMaterial: tileMaterial(1) });
  addPlankDoor(group, -1.3, 0.74, shell.frontZ + 0.03, 0.95, 1.86);
  addSmallWindow(group, 1.4, 1.85, shell.frontZ + 0.03, 0.82, 0.94);
  addMesh(group, new THREE.BoxGeometry(3.4, 0.14, 5.0), shingleMaterial(), new THREE.Vector3(5.1, 2.65, 0), new THREE.Euler(0, 0, -0.16));
  for (const z of [-2.1, 2.1]) addMesh(group, new THREE.BoxGeometry(0.18, 2.6, 0.18), timberMaterial('dark'), new THREE.Vector3(6.35, 1.3, z));
  for (let i = 0; i < 2; i++) {
    const x = 4.4 + i * 1.5;
    addCartWheel(group, x, 1.05, 1.2, 0.9 - i * 0.15);
  }
  addMesh(group, new THREE.BoxGeometry(2.8, 0.22, 1.1), timberMaterial('weathered'), new THREE.Vector3(5.05, 0.92, -1.3));
  for (let i = 0; i < 5; i++) addMesh(group, new THREE.BoxGeometry(3.0 - i * 0.12, 0.16, 0.42), timberMaterial(i % 2 ? 'light' : 'mid'), new THREE.Vector3(4.75, 0.12 + i * 0.18, -3.2));
  addMesh(group, new THREE.CylinderGeometry(0.13, 0.13, 3.1, 8), timberMaterial('dark'), new THREE.Vector3(5.12, 0.76, 0), new THREE.Euler(0, 0, Math.PI * 0.5));
  return group;
}

export function createFerryLandingMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Ferry landing';
  const shell = addGableShell(group, { width: 5.2, depth: 4.2, stoneHeight: 0.42, wallHeight: 2.05, ridgeHeight: 1.75, wallMaterial: timberMaterial('weathered'), roofMaterial: tileMaterial(1), centerX: -3.5 });
  addPlankDoor(group, -3.5, 0.45, shell.frontZ + 0.03, 0.8, 1.62);
  addSmallWindow(group, -2.15, 1.42, shell.frontZ + 0.03, 0.58, 0.68);
  for (let z = 2.7; z <= 11.5; z += 1.2) {
    addMesh(group, new THREE.BoxGeometry(4.1, 0.18, 0.95), timberMaterial(z % 2 > 1 ? 'mid' : 'weathered'), new THREE.Vector3(0, 0.58, z));
    for (const x of [-1.75, 1.75]) addMesh(group, new THREE.BoxGeometry(0.18, 1.45, 0.18), timberMaterial('dark'), new THREE.Vector3(x, 0.28, z));
  }
  const boat = new THREE.Shape(); boat.moveTo(-2.6, 0); boat.lineTo(-1.9, -0.65); boat.lineTo(1.9, -0.65); boat.lineTo(2.6, 0); boat.lineTo(1.8, 0.65); boat.lineTo(-1.8, 0.65); boat.closePath();
  const hull = new THREE.ExtrudeGeometry(boat, { depth: 0.55, bevelEnabled: false }); hull.rotateX(Math.PI * 0.5);
  addMesh(group, hull, timberMaterial('dark'), new THREE.Vector3(4.1, 0.55, 8.8));
  for (const [x, z] of [[-2.35, 2.7], [2.35, 2.7], [-2.35, 11.5], [2.35, 11.5]] as const) {
    addMesh(group, new THREE.CylinderGeometry(0.18, 0.22, 2.3, 8), timberMaterial('dark'), new THREE.Vector3(x, 1.0, z));
    addMesh(group, new THREE.TorusGeometry(0.29, 0.045, 6, 12), timberMaterial('light'), new THREE.Vector3(x, 1.45, z), new THREE.Euler(Math.PI * 0.5, 0, 0));
  }
  addBarrel(group, -1.85, 1.5, 0.72);
  return group;
}

export function createVineyardMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Vineyard terrace';
  for (let terrace = 0; terrace < 5; terrace++) {
    const z = -4.8 + terrace * 2.25;
    addMesh(group, new THREE.BoxGeometry(14.5, 0.55, 1.55), earth, new THREE.Vector3(0, terrace * 0.22, z));
    addMesh(group, new THREE.BoxGeometry(14.5, 0.42, 0.22), stoneMaterial(terrace % 2 ? 'mid' : 'mortar'), new THREE.Vector3(0, terrace * 0.22 + 0.18, z + 0.82));
    for (let x = -6.2; x <= 6.2; x += 1.55) {
      addMesh(group, new THREE.BoxGeometry(0.1, 1.65, 0.1), timberMaterial('dark'), new THREE.Vector3(x, terrace * 0.22 + 0.95, z));
      addMesh(group, new THREE.SphereGeometry(0.48, 7, 5), wineLeaf, new THREE.Vector3(x, terrace * 0.22 + 1.25, z), new THREE.Euler(), new THREE.Vector3(1.4, 0.65, 0.72));
      if ((Math.round((x + 6.2) / 1.55) + terrace) % 2 === 0) addMesh(group, new THREE.SphereGeometry(0.17, 7, 5), grape, new THREE.Vector3(x + 0.24, terrace * 0.22 + 0.92, z + 0.22), new THREE.Euler(), new THREE.Vector3(0.72, 1.3, 0.72));
    }
    addMesh(group, new THREE.CylinderGeometry(0.025, 0.025, 12.6, 5), metalMaterial('iron'), new THREE.Vector3(0, terrace * 0.22 + 1.08, z), new THREE.Euler(0, 0, Math.PI * 0.5));
  }
  const shell = addGableShell(group, { width: 4.3, depth: 3.6, stoneHeight: 0.65, wallHeight: 1.95, ridgeHeight: 1.55, wallMaterial: residenceFacadeMaterial('white'), roofMaterial: tileMaterial(0), centerX: -5.2, centerZ: 5.3 });
  addPlankDoor(group, -5.2, 0.68, shell.frontZ + 0.03, 0.76, 1.55);
  addMesh(group, new THREE.SphereGeometry(0.65, 7, 5), leaf, new THREE.Vector3(5.7, 1.0, 5.0));
  addBarrel(group, 3.1, 5.25, 0.85);
  addBarrel(group, 4.25, 5.3, 0.72);
  addMesh(group, new THREE.CylinderGeometry(0.72, 0.82, 0.92, 12), timberMaterial('weathered'), new THREE.Vector3(2.0, 0.48, 5.2));
  addMesh(group, new THREE.CylinderGeometry(0.08, 0.08, 1.85, 8), timberMaterial('dark'), new THREE.Vector3(2.0, 1.58, 5.2));
  addMesh(group, new THREE.BoxGeometry(1.15, 0.14, 0.32), timberMaterial('dark'), new THREE.Vector3(2.0, 2.45, 5.2));
  return group;
}
