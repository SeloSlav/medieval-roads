import * as THREE from 'three';
import type { MeshStandardNodeMaterial } from 'three/webgpu';
import type { Terrain } from '../terrain/Terrain.ts';
import { RiverField } from './RiverField.ts';
import { createRiverBankMeshes } from './RiverBankMesh.ts';
import { createRiverReeds } from './RiverReeds.ts';
import { createRiverShoreStones } from './RiverShoreStones.ts';
import { createRiverWaterMesh, disposeSharedRiverWaterMaterial } from './RiverWaterMesh.ts';
import type { RockObstacle } from '../utils/pathGeometry.ts';

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
  shoreRockPlacements: ReadonlyArray<RockObstacle>;
  isBlockedAt: (x: number, z: number) => boolean;
  tick: (dt: number, timeSec: number) => void;
  dispose: () => void;
};

export function createRiverSystem(
  terrain: Terrain,
  riverField: RiverField,
  maxAnisotropy: number,
  bankMaterial: MeshStandardNodeMaterial,
): RiverSystem {
  const group = new THREE.Group();
  group.name = 'River system';

  const rockMaterial = createRiverRockMaterial(maxAnisotropy);
  const rockShadowMaterials = createPropShadowMaterials();
  const rng = mulberry32(0x71ee1212);
  const waterController = createRiverWaterMesh(group, terrain, riverField);
  const shoreStones = createRiverShoreStones(terrain, riverField, rockMaterial, rockShadowMaterials, rng);
  const bankMeshes = createRiverBankMeshes(terrain, riverField, bankMaterial);
  const reeds = createRiverReeds(terrain, riverField, rng);
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
    shoreRockPlacements: shoreStones.placements,
    isBlockedAt: (x, z) => riverField.isBlockedForProps(x, z),
    tick: (dt, timeSec) => waterController?.tick(dt, timeSec),
    dispose,
  };
}

function createRiverRockMaterial(maxAnisotropy: number): THREE.MeshStandardMaterial {
  const loader = new THREE.TextureLoader();
  const loadMap = (url: string, srgb = false): THREE.Texture => {
    const texture = loader.load(url);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = Math.max(1, Math.min(16, maxAnisotropy));
    if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  };

  const material = new THREE.MeshStandardMaterial({
    map: loadMap('/assets/textures/props/mossy_rock/albedo.png', true),
    normalMap: loadMap('/assets/textures/props/mossy_rock/normal.png'),
    roughnessMap: loadMap('/assets/textures/props/mossy_rock/roughness.png'),
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
