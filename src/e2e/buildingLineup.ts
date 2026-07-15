import * as THREE from 'three';
import { createBuildingMesh } from '../buildings/BuildingMeshes.ts';
import { initializeBuildingMaterialLibrary } from '../buildings/buildingMaterials.ts';
import { BUILDING_KINDS } from '../generated/gameBalance.ts';
import { getBuildingDefinition } from '../resources/buildings.ts';

declare global {
  interface Window {
    __BUILDING_LINEUP_READY__?: boolean;
  }
}

const COLS = 7;
const ROWS = 3;
const root = document.querySelector<HTMLElement>('#lineup-root');
const labels = document.querySelector<HTMLElement>('#labels');
if (!root || !labels) throw new Error('Building lineup host is missing.');

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
root.prepend(renderer.domElement);

const views = BUILDING_KINDS.map((kind) => {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xa6b29a);
  scene.fog = new THREE.Fog(0xa6b29a, 32, 74);

  const building = createBuildingMesh(kind);
  building.rotation.y = -0.1;
  building.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });
  scene.add(building);

  const bounds = new THREE.Box3().setFromObject(building);
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  building.position.sub(new THREE.Vector3(center.x, bounds.min.y, center.z));

  const groundRadius = Math.max(11, Math.max(size.x, size.z) * 0.92);
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(groundRadius, 64),
    new THREE.MeshStandardMaterial({ color: 0x66794b, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI * 0.5;
  ground.position.y = -0.035;
  ground.receiveShadow = true;
  scene.add(ground);

  const path = new THREE.Mesh(
    new THREE.PlaneGeometry(Math.max(2.4, size.x * 0.27), groundRadius * 1.4),
    new THREE.MeshStandardMaterial({ color: 0x8e7d61, roughness: 1 }),
  );
  path.rotation.x = -Math.PI * 0.5;
  path.position.set(0, -0.025, groundRadius * 0.52);
  path.receiveShadow = true;
  scene.add(path);

  scene.add(new THREE.HemisphereLight(0xdbe5df, 0x4c3b2b, 2.25));
  const sun = new THREE.DirectionalLight(0xfff0cf, 3.25);
  sun.position.set(-12, 20, 13);
  sun.castShadow = true;
  sun.shadow.mapSize.set(512, 512);
  sun.shadow.camera.left = -18;
  sun.shadow.camera.right = 18;
  sun.shadow.camera.top = 18;
  sun.shadow.camera.bottom = -18;
  scene.add(sun);

  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 160);
  const largest = Math.max(size.x, size.y * 1.2, size.z);
  const distance = Math.max(13, largest / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5))) * 1.24);
  const direction = new THREE.Vector3(0.72, 0.56, 1).normalize();
  const lookY = Math.max(1.2, size.y * 0.43);
  camera.position.copy(direction.multiplyScalar(distance)).add(new THREE.Vector3(0, lookY, 0));
  camera.lookAt(0, lookY, 0);

  const cell = document.createElement('div');
  cell.className = 'cell';
  const label = document.createElement('div');
  label.className = 'label';
  label.textContent = getBuildingDefinition(kind).label;
  cell.append(label);
  labels.append(cell);
  return { scene, camera };
});

for (let index = views.length; index < COLS * ROWS; index++) {
  const cell = document.createElement('div');
  cell.className = 'cell';
  labels.append(cell);
}

function render(): void {
  const width = root!.clientWidth;
  const height = root!.clientHeight;
  renderer.setSize(width, height, false);
  renderer.setScissorTest(true);
  renderer.setClearColor(0x1a1e16, 1);
  renderer.clear();

  const cellWidth = width / COLS;
  const cellHeight = height / ROWS;
  for (let index = 0; index < views.length; index++) {
    const view = views[index]!;
    const col = index % COLS;
    const row = Math.floor(index / COLS);
    const x = Math.floor(col * cellWidth);
    const y = Math.floor(height - (row + 1) * cellHeight);
    const w = Math.ceil(cellWidth);
    const h = Math.ceil(cellHeight);
    view.camera.aspect = w / h;
    view.camera.updateProjectionMatrix();
    renderer.setViewport(x, y, w, h);
    renderer.setScissor(x, y, w, h);
    renderer.render(view.scene, view.camera);
  }
  renderer.setScissorTest(false);
}

await initializeBuildingMaterialLibrary(renderer.capabilities.getMaxAnisotropy());
render();
await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
render();
window.__BUILDING_LINEUP_READY__ = true;
document.body.dataset.ready = 'true';
window.addEventListener('resize', render);
