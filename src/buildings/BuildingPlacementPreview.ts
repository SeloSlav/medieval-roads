import * as THREE from 'three';
import type { BuildingKind } from '../resources/types.ts';
import { getBuildingPadParams } from './BuildingTerrainLayout.ts';
import { disposeObject3D } from '../utils/dispose.ts';

const PREVIEW_COLORS = {
  valid: 0x00cc66,
  invalid: 0xff4444,
} as const;

const PREVIEW_OPACITY = 0.48;
const PREVIEW_RENDER_ORDER = 12;

const PREVIEW_HEIGHT: Record<BuildingKind, number> = {
  lumber_mill: 6.3,
  reforester: 5.5,
  woodcutters_lodge: 5.6,
  stone_quarry: 6.4,
  well: 4.7,
  hunters_hall: 5.7,
  foragers_shed: 4.9,
  chapel: 9.5,
  marketplace: 5.3,
  threshing_barn: 7.1,
  monastery: 9.8,
  brewery: 6.7,
  smokehouse: 6.9,
  granary: 6.9,
  apiary: 4.8,
  watermill: 7.2,
  carpenter: 5.8,
  ferry_landing: 4.8,
  vineyard: 4.2,
};

export function createBuildingPreviewMesh(kind: BuildingKind): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Building preview';
  group.add(createPreviewSilhouette(kind, PREVIEW_COLORS.valid, PREVIEW_OPACITY));
  group.frustumCulled = false;
  group.renderOrder = PREVIEW_RENDER_ORDER;
  return group;
}

export function updateBuildingPreviewAppearance(group: THREE.Group, valid: boolean): void {
  const color = valid ? PREVIEW_COLORS.valid : PREVIEW_COLORS.invalid;
  group.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const material = mesh.material;
    if (!(material instanceof THREE.MeshBasicMaterial)) return;
    material.color.setHex(color);
  });
}

export function disposeBuildingPreviewMesh(group: THREE.Group): void {
  disposeObject3D(group, true);
}

function createPreviewSilhouette(kind: BuildingKind, colorHex: number, opacity: number): THREE.Mesh {
  const params = getBuildingPadParams(kind);
  const scale = params.innerFade * 0.92;
  const height = PREVIEW_HEIGHT[kind];
  const geometry = createPreviewFootprintGeometry(kind, params, scale, height);
  const material = new THREE.MeshBasicMaterial({
    color: colorHex,
    transparent: true,
    opacity,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = height * 0.5;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  mesh.renderOrder = PREVIEW_RENDER_ORDER;
  return mesh;
}

function createPreviewFootprintGeometry(
  kind: BuildingKind,
  params: ReturnType<typeof getBuildingPadParams>,
  scale: number,
  height: number,
): THREE.BufferGeometry {
  switch (kind) {
    case 'stone_quarry':
      return new THREE.CylinderGeometry(params.radiusX * scale, params.radiusX * scale, height, 24);
    case 'lumber_mill':
      return new THREE.BoxGeometry(params.radiusX * 2 * scale, height, params.radiusZ * 2 * scale);
    case 'reforester':
    case 'woodcutters_lodge':
    case 'well':
    case 'hunters_hall':
    case 'foragers_shed':
    case 'chapel':
    case 'marketplace':
    case 'threshing_barn':
    case 'monastery':
    case 'brewery':
    case 'smokehouse':
    case 'granary':
    case 'apiary':
    case 'watermill':
    case 'carpenter':
    case 'ferry_landing':
    case 'vineyard':
      return new THREE.BoxGeometry(params.radiusX * 2 * scale, height, params.radiusZ * 2 * scale);
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}
