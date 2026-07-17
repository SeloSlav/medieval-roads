import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { addMesh, timberMaterial } from '../buildings/buildingMaterials.ts';
import type { DeliveryCargoKind } from './deliveryTrips.ts';
import { cargoColor } from './deliveryTrips.ts';

const MODEL_URL = '/assets/models/delivery-cart/quaternius-medieval-cart.glb';
const MODEL_TARGET_HEIGHT = 1.56;

const WHEEL_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0x3a2d22,
  roughness: 0.9,
  metalness: 0,
});

const CARGO_MATERIALS = new Map<DeliveryCargoKind, THREE.MeshStandardMaterial>();

const CANOPY_PALETTES = [
  { primary: 0x8a3228, cloth: 0xd8c9a6 },
  { primary: 0x4a5c44, cloth: 0xd1c7a9 },
  { primary: 0x3d4a62, cloth: 0xc8c0a9 },
  { primary: 0x7a5e46, cloth: 0xd8c7a0 },
] as const;

export type DeliveryCartModelSource = {
  scene: THREE.Group;
  bounds: THREE.Box3;
  sourceHeight: number;
};

export type DeliveryCartMeshOptions = {
  appearanceSeed?: number;
  source?: DeliveryCartModelSource | null;
};

function cargoMaterial(kind: DeliveryCargoKind): THREE.MeshStandardMaterial {
  let material = CARGO_MATERIALS.get(kind);
  if (!material) {
    const color = cargoColor(kind);
    material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.72,
      metalness: 0.04,
      emissive: color,
      emissiveIntensity: 0.06,
    });
    CARGO_MATERIALS.set(kind, material);
  }
  return material;
}

function addCargo(group: THREE.Group, kind: DeliveryCargoKind): void {
  const material = cargoMaterial(kind);

  switch (kind) {
    case 'firewood':
      addMesh(group, new THREE.BoxGeometry(0.9, 0.42, 0.55), material, new THREE.Vector3(0, 0.72, 0.05));
      addMesh(
        group,
        new THREE.CylinderGeometry(0.1, 0.1, 0.85, 6),
        timberMaterial('weathered'),
        new THREE.Vector3(-0.18, 0.78, 0.05),
        new THREE.Euler(0, 0, Math.PI * 0.5),
      );
      break;
    case 'water':
      addMesh(group, new THREE.CylinderGeometry(0.28, 0.3, 0.55, 10), material, new THREE.Vector3(0, 0.78, 0));
      addMesh(
        group,
        new THREE.TorusGeometry(0.3, 0.04, 6, 12),
        timberMaterial('dark'),
        new THREE.Vector3(0, 1.02, 0),
        new THREE.Euler(Math.PI * 0.5, 0, 0),
      );
      break;
    case 'food':
      addMesh(group, new THREE.BoxGeometry(0.62, 0.34, 0.48), material, new THREE.Vector3(-0.12, 0.7, 0));
      addMesh(group, new THREE.BoxGeometry(0.48, 0.28, 0.4), material, new THREE.Vector3(0.28, 0.76, 0.08));
      break;
    case 'grain':
      addMesh(group, new THREE.BoxGeometry(0.72, 0.38, 0.52), material, new THREE.Vector3(0, 0.72, 0));
      addMesh(group, new THREE.BoxGeometry(0.34, 0.22, 0.34), material, new THREE.Vector3(-0.22, 0.84, 0.12));
      break;
    case 'flour':
      addMesh(group, new THREE.BoxGeometry(0.58, 0.46, 0.42), material, new THREE.Vector3(0, 0.74, 0));
      addMesh(group, new THREE.BoxGeometry(0.36, 0.12, 0.36), material, new THREE.Vector3(0.18, 0.92, -0.08));
      break;
    case 'ale':
      addMesh(group, new THREE.CylinderGeometry(0.24, 0.26, 0.62, 10), material, new THREE.Vector3(0, 0.78, 0));
      addMesh(
        group,
        new THREE.TorusGeometry(0.24, 0.035, 6, 12),
        timberMaterial('dark'),
        new THREE.Vector3(0, 1.04, 0),
        new THREE.Euler(Math.PI * 0.5, 0, 0),
      );
      break;
    case 'preservedFood':
      addMesh(group, new THREE.BoxGeometry(0.56, 0.3, 0.44), material, new THREE.Vector3(-0.1, 0.72, 0));
      addMesh(group, new THREE.BoxGeometry(0.42, 0.24, 0.36), material, new THREE.Vector3(0.24, 0.78, 0.06));
      break;
    case 'honey':
      addMesh(group, new THREE.CylinderGeometry(0.22, 0.24, 0.48, 8), material, new THREE.Vector3(0, 0.76, 0));
      break;
    case 'wine':
      addMesh(group, new THREE.CylinderGeometry(0.18, 0.22, 0.58, 8), material, new THREE.Vector3(0, 0.78, 0));
      addMesh(group, new THREE.SphereGeometry(0.12, 8, 6), material, new THREE.Vector3(0, 1.08, 0));
      break;
    case 'timber':
      addMesh(
        group,
        new THREE.CylinderGeometry(0.11, 0.11, 0.82, 8),
        timberMaterial('weathered'),
        new THREE.Vector3(-0.2, 0.78, 0.04),
        new THREE.Euler(0, 0, Math.PI * 0.5),
      );
      addMesh(
        group,
        new THREE.CylinderGeometry(0.1, 0.1, 0.78, 8),
        timberMaterial('mid'),
        new THREE.Vector3(0.08, 0.8, -0.02),
        new THREE.Euler(0.08, 0.2, Math.PI * 0.5),
      );
      addMesh(
        group,
        new THREE.CylinderGeometry(0.095, 0.095, 0.74, 8),
        timberMaterial('light'),
        new THREE.Vector3(0.24, 0.76, 0.06),
        new THREE.Euler(-0.06, -0.15, Math.PI * 0.5),
      );
      break;
    case 'stone':
      addMesh(group, new THREE.DodecahedronGeometry(0.28, 0), material, new THREE.Vector3(-0.24, 0.72, 0.08));
      addMesh(group, new THREE.DodecahedronGeometry(0.24, 0), material, new THREE.Vector3(0.18, 0.74, -0.08));
      addMesh(group, new THREE.DodecahedronGeometry(0.2, 0), material, new THREE.Vector3(0.26, 0.91, 0.12));
      break;
    default: {
      const unreachable: never = kind;
      throw new Error(`Unknown cargo kind: ${unreachable}`);
    }
  }
}

export function deliveryCartMeshName(
  kind: DeliveryCargoKind,
  hasModelSource: boolean,
): string {
  return `DeliveryCart:${kind}:${hasModelSource ? 'quaternius' : 'fallback'}`;
}

export function createDeliveryCartMesh(
  kind: DeliveryCargoKind,
  options: DeliveryCartMeshOptions = {},
): THREE.Group {
  const group = new THREE.Group();
  const source = options.source ?? null;
  group.name = deliveryCartMeshName(kind, source != null);
  group.userData.deliveryCartAsset = source ? 'quaternius-medieval-cart' : 'procedural-fallback';

  if (source) {
    addQuaterniusCart(group, source, options.appearanceSeed ?? 0);
  } else {
    addProceduralCart(group);
  }

  const cargoRoot = new THREE.Group();
  cargoRoot.name = `Cart cargo: ${kind}`;
  if (source) {
    cargoRoot.scale.setScalar(0.76);
    cargoRoot.position.set(0, 0.08, 0.08);
  }
  addCargo(cargoRoot, kind);
  group.add(cargoRoot);
  return group;
}

export async function loadDeliveryCartModelSource(): Promise<DeliveryCartModelSource> {
  const gltf = await new GLTFLoader().loadAsync(MODEL_URL);
  const bounds = new THREE.Box3().setFromObject(gltf.scene);
  const sourceHeight = bounds.max.y - bounds.min.y;
  if (!Number.isFinite(sourceHeight) || sourceHeight <= 0.001) {
    throw new Error(`Invalid delivery cart model bounds for ${MODEL_URL}`);
  }
  return { scene: gltf.scene, bounds, sourceHeight };
}

export function disposeDeliveryCartMesh(group: THREE.Group): void {
  const ownedMaterials = new Set<THREE.Material>(
    Array.isArray(group.userData.ownedCartMaterials)
      ? group.userData.ownedCartMaterials as THREE.Material[]
      : [],
  );
  group.traverse((object) => {
    const mesh = object as THREE.Mesh;
    mesh.geometry?.dispose();
  });
  for (const material of ownedMaterials) material.dispose();
}

export function disposeDeliveryCartModelSource(source: DeliveryCartModelSource): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  source.scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    const meshMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of meshMaterials) {
      if (!material) continue;
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) textures.add(value);
      }
    }
  });
  for (const texture of textures) texture.dispose();
  for (const material of materials) material.dispose();
  for (const geometry of geometries) geometry.dispose();
}

function addQuaterniusCart(
  group: THREE.Group,
  source: DeliveryCartModelSource,
  appearanceSeed: number,
): void {
  const model = source.scene.clone(true);
  model.name = 'Quaternius medieval canopy cart';
  const palette = CANOPY_PALETTES[
    Math.abs(appearanceSeed) % CANOPY_PALETTES.length
  ] ?? CANOPY_PALETTES[0];
  const ownedMaterials: THREE.Material[] = [];

  model.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry = mesh.geometry.clone();
    const sourceMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const materials = sourceMaterials.map((material) => {
      const clone = material.clone();
      const standard = clone as THREE.MeshStandardMaterial;
      const materialName = material.name.toLowerCase();
      if (standard.color && materialName === 'red') standard.color.setHex(palette.primary);
      if (standard.color && materialName === 'beige') standard.color.setHex(palette.cloth);
      if (standard.color) {
        standard.roughness = 0.9;
        standard.metalness = materialName.includes('stone') ? 0.08 : 0;
      }
      ownedMaterials.push(clone);
      return clone;
    });
    mesh.material = Array.isArray(mesh.material) ? materials : materials[0]!;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
  });

  const scale = MODEL_TARGET_HEIGHT / source.sourceHeight;
  model.scale.setScalar(scale);
  model.position.y = -source.bounds.min.y * scale + 0.01;
  group.userData.ownedCartMaterials = ownedMaterials;
  group.add(model);
}

function addProceduralCart(group: THREE.Group): void {
  const frame = timberMaterial('mid');
  addMesh(group, new THREE.BoxGeometry(1.15, 0.14, 0.72), frame, new THREE.Vector3(0, 0.42, 0));
  addMesh(group, new THREE.BoxGeometry(0.12, 0.55, 0.72), frame, new THREE.Vector3(-0.48, 0.68, 0));
  addMesh(group, new THREE.BoxGeometry(0.12, 0.42, 0.72), frame, new THREE.Vector3(0.48, 0.62, 0));

  const wheelGeometry = new THREE.CylinderGeometry(0.22, 0.22, 0.12, 12);
  addMesh(
    group,
    wheelGeometry,
    WHEEL_MATERIAL,
    new THREE.Vector3(-0.42, 0.22, 0.34),
    new THREE.Euler(Math.PI * 0.5, 0, 0),
  );
  addMesh(
    group,
    wheelGeometry.clone(),
    WHEEL_MATERIAL,
    new THREE.Vector3(-0.42, 0.22, -0.34),
    new THREE.Euler(Math.PI * 0.5, 0, 0),
  );
  addMesh(
    group,
    wheelGeometry.clone(),
    WHEEL_MATERIAL,
    new THREE.Vector3(0.42, 0.22, 0.34),
    new THREE.Euler(Math.PI * 0.5, 0, 0),
  );
  addMesh(
    group,
    wheelGeometry.clone(),
    WHEEL_MATERIAL,
    new THREE.Vector3(0.42, 0.22, -0.34),
    new THREE.Euler(Math.PI * 0.5, 0, 0),
  );
}
