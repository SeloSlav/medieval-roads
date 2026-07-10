import * as THREE from 'three';
import type { BuildingKind } from '../resources/types.ts';
import { createBuildingMesh } from './BuildingMeshes.ts';
import { disposeObject3D } from '../utils/dispose.ts';

const PREVIEW_COLORS = {
  valid: 0x00cc66,
  invalid: 0xff4444,
} as const;

const PREVIEW_OPACITY = 0.48;
const PREVIEW_RENDER_ORDER = 12;

export function createBuildingPreviewMesh(kind: BuildingKind): THREE.Group {
  const source = createBuildingMesh(kind);
  return tintPreviewGroup(source, PREVIEW_COLORS.valid, PREVIEW_OPACITY);
}

export function updateBuildingPreviewAppearance(group: THREE.Group, valid: boolean): void {
  tintPreviewGroupInPlace(group, valid ? PREVIEW_COLORS.valid : PREVIEW_COLORS.invalid, PREVIEW_OPACITY);
}

function tintPreviewGroup(source: THREE.Group, colorHex: number, opacity: number): THREE.Group {
  const clone = source.clone(true);
  tintPreviewGroupInPlace(clone, colorHex, opacity);
  return clone;
}

function tintPreviewGroupInPlace(group: THREE.Object3D, colorHex: number, opacity: number): void {
  const color = new THREE.Color(colorHex);
  group.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;

    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const previewMaterials = materials.map(() =>
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        depthTest: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    disposeMaterials(mesh.material);
    mesh.material = previewMaterials.length === 1 ? previewMaterials[0]! : previewMaterials;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = PREVIEW_RENDER_ORDER;
  });
  group.frustumCulled = false;
  group.renderOrder = PREVIEW_RENDER_ORDER;
}

function disposeMaterials(material: THREE.Material | THREE.Material[]): void {
  const materials = Array.isArray(material) ? material : [material];
  for (const entry of materials) entry.dispose();
}

export function disposeBuildingPreviewMesh(group: THREE.Group): void {
  disposeObject3D(group, true);
}
