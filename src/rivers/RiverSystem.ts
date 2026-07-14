import * as THREE from 'three';
import type { MeshStandardNodeMaterial } from 'three/webgpu';
import type { MossyRockTextureSet } from '../utils/propTextureLoad.ts';
import type { Terrain } from '../terrain/Terrain.ts';
import { RiverField } from './RiverField.ts';
import { createRiverBankMeshes } from './RiverBankMesh.ts';
import { createRiverReeds, type RiverReedField } from './RiverReeds.ts';
import { createRiverShoreStones } from './RiverShoreStones.ts';
import { createRiverWaterMesh, disposeSharedRiverWaterMaterial } from './RiverWaterMesh.ts';
import type { RockObstacle } from '../utils/pathGeometry.ts';
import type { RendererBackendKind } from '../scene/RendererBackend.ts';

function createPropShadowMaterials(): {
  shadowCast: THREE.MeshStandardMaterial;
  shadowDepth: THREE.MeshDepthMaterial;
} {
  return {
    shadowCast: new THREE.MeshStandardMaterial({
      transparent: true,
      opacity: 0,
      colorWrite: false,
      depthWrite: false,
    }),
    shadowDepth: new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
    }),
  };
}

export type RiverSystem = {
  field: RiverField;
  group: THREE.Group;
  reedsGroup: THREE.Group;
  shoreRockPlacements: ReadonlyArray<RockObstacle>;
  isBlockedAt: (x: number, z: number) => boolean;
  isGrassBlockedAt: (x: number, z: number) => boolean;
  updateCameraState: (
    cameraPosition: THREE.Vector3,
    cameraTarget: THREE.Vector3,
    cameraDistance: number,
    firstPersonActive?: boolean,
  ) => void;
  tick: (dt: number, timeSec: number) => void;
  dispose: () => void;
};

export async function createRiverSystem(
  terrain: Terrain,
  riverField: RiverField,
  bankMaterial: MeshStandardNodeMaterial,
  rockTextures: MossyRockTextureSet,
  maxAnisotropy: number,
  rendererBackend: RendererBackendKind,
): Promise<RiverSystem> {
  const group = new THREE.Group();
  group.name = 'River system';

  const rockMaterial = createRiverRockMaterial(rockTextures);
  const rockShadowMaterials = createPropShadowMaterials();
  const rng = mulberry32(0x71ee1212);
  const waterController = createRiverWaterMesh(group, terrain, riverField);
  const shoreStones = createRiverShoreStones(terrain, riverField, rockMaterial, rockShadowMaterials, rng);
  const bankMeshes = createRiverBankMeshes(terrain, riverField, bankMaterial);
  const reeds: RiverReedField = await createRiverReeds(
    terrain,
    riverField,
    mulberry32(0x8eed1212),
    maxAnisotropy,
    rendererBackend,
  );
  group.add(shoreStones.group, bankMeshes, reeds.group);

  const dispose = () => {
    waterController?.dispose();
    disposeSharedRiverWaterMaterial();
    rockMaterial.dispose();
    rockMaterial.map?.dispose();
    rockMaterial.normalMap?.dispose();
    rockMaterial.roughnessMap?.dispose();
    rockShadowMaterials.shadowCast.dispose();
    rockShadowMaterials.shadowDepth.dispose();
    reeds.dispose();
  };

  return {
    field: riverField,
    group,
    reedsGroup: reeds.group,
    shoreRockPlacements: shoreStones.placements,
    isBlockedAt: (x, z) => riverField.isBlockedForProps(x, z),
    isGrassBlockedAt: (x, z) => riverField.isGrassBlockedAt(x, z),
    updateCameraState: (cameraPosition, cameraTarget, cameraDistance, firstPersonActive) => {
      reeds.updateCameraState(cameraPosition, cameraTarget, cameraDistance, firstPersonActive);
    },
    tick: (dt, timeSec) => waterController?.tick(dt, timeSec),
    dispose,
  };
}

function createRiverRockMaterial(rockTextures: MossyRockTextureSet): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    map: rockTextures.map,
    normalMap: rockTextures.normalMap,
    roughnessMap: rockTextures.roughnessMap,
    color: 0xb0aea0,
    roughness: 0.92,
    metalness: 0,
  });
  material.normalScale.set(0.55, 0.55);
  return material;
}

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
