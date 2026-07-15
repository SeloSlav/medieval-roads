import * as THREE from 'three';
import type { BuildingKind } from '../resources/types.ts';
import { MAIN_HOUSE_DEPTH, MAIN_HOUSE_WIDTH } from '../residences/burgageLayout.ts';
import { TREE_SHADOW_CAST_LAYER } from '../scene/SceneLayers.ts';
import { getBuildingPadParams } from './BuildingTerrainLayout.ts';

export const BUILDING_SHADOW_PROXY_FLAG = 'buildingShadowProxy';

const BUILDING_SHADOW_HEIGHT: Record<BuildingKind, number> = {
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

const RESIDENCE_SHADOW_HEIGHT = 7.7;

const shadowCastMaterial = new THREE.MeshStandardMaterial({
  transparent: true,
  opacity: 0,
  colorWrite: false,
  depthWrite: false,
});

const shadowDepthMaterial = new THREE.MeshDepthMaterial({
  depthPacking: THREE.RGBADepthPacking,
});

export function createBuildingShadowProxy(kind: BuildingKind): THREE.Mesh {
  const params = getBuildingPadParams(kind);
  const scale = params.innerFade * 0.92;
  const height = BUILDING_SHADOW_HEIGHT[kind];
  const geometry = createBuildingShadowGeometry(kind, params, scale, height);
  return createShadowProxyMesh(geometry, height);
}

export function createResidenceShadowProxy(tier: 1 | 2 | 3 = 1): THREE.Mesh {
  const scale = tier === 1 ? 0.82 : tier === 3 ? 1.22 : 1;
  const height = tier === 1 ? 5.1 : tier === 3 ? 8.3 : RESIDENCE_SHADOW_HEIGHT;
  const geometry = new THREE.BoxGeometry(MAIN_HOUSE_WIDTH * 0.92 * scale, height, MAIN_HOUSE_DEPTH * 0.92 * (tier === 3 ? 1.14 : scale));
  return createShadowProxyMesh(geometry, height);
}

export function isBuildingShadowProxy(object: THREE.Object3D): boolean {
  return object.userData[BUILDING_SHADOW_PROXY_FLAG] === true;
}

function createShadowProxyMesh(geometry: THREE.BufferGeometry, height: number): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, shadowCastMaterial);
  mesh.name = 'Building shadow proxy';
  mesh.position.y = height * 0.5;
  mesh.layers.set(TREE_SHADOW_CAST_LAYER);
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  mesh.customDepthMaterial = shadowDepthMaterial;
  mesh.userData[BUILDING_SHADOW_PROXY_FLAG] = true;
  return mesh;
}

function createBuildingShadowGeometry(
  kind: BuildingKind,
  params: ReturnType<typeof getBuildingPadParams>,
  scale: number,
  height: number,
): THREE.BufferGeometry {
  switch (kind) {
    case 'stone_quarry':
      return new THREE.CylinderGeometry(params.radiusX * scale, params.radiusX * scale, height, 16);
    case 'lumber_mill':
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
