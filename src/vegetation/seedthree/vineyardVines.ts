import * as THREE from 'three';
import { sharedBuildingDetailMaterial } from '../../buildings/buildingMaterials.ts';
import type { RendererBackendKind } from '../../scene/RendererBackend.ts';
import type { SeedThreeGroundCoverTextures } from './seedThreeGroundCover.ts';

export type VineyardVinePlacement = {
  x: number;
  y: number;
  z: number;
  fruiting: boolean;
  seed: number;
};

const SWEETGUM_LEAF_URLS = {
  albedo: new URL('../../../vendor/seedthree/assets/leaves/sweetgum_single_albedo.png', import.meta.url).href,
  normal: new URL('../../../vendor/seedthree/assets/leaves/sweetgum_single_normal.png', import.meta.url).href,
  roughness: new URL('../../../vendor/seedthree/assets/leaves/sweetgum_single_roughness.png', import.meta.url).href,
  translucency: new URL('../../../vendor/seedthree/assets/leaves/sweetgum_single_translucency.png', import.meta.url).href,
} as const;

let vineTextures: SeedThreeGroundCoverTextures | null = null;
let vineMaterial: THREE.Material | null = null;
let vineLoadPromise: Promise<void> | null = null;

/**
 * Loads one shared SeedThree leaf set for every placed vineyard. SeedThree does
 * not ship a literal Vitis asset; its lobed sweetgum leaf is the closest
 * botanical silhouette and reads convincingly at the game's working scale.
 */
export function initializeVineyardVineResources(
  maxAnisotropy: number,
  rendererBackend: RendererBackendKind,
): Promise<void> {
  if (vineTextures && vineMaterial) return Promise.resolve();
  if (vineLoadPromise) return vineLoadPromise;

  vineLoadPromise = import('./seedThreeGroundCover.ts').then(async ({
    createSeedThreeGroundCoverMaterial,
    loadSeedThreeGroundCoverTextures,
  }) => {
    const textures = await loadSeedThreeGroundCoverTextures(SWEETGUM_LEAF_URLS, maxAnisotropy);
    vineTextures = textures;
    vineMaterial = rendererBackend === 'webgl'
      ? new THREE.MeshStandardMaterial({
          name: 'SeedThree cultivated grapevine foliage',
          map: textures.albedo,
          roughnessMap: textures.roughness,
          alphaTest: 0.38,
          side: THREE.DoubleSide,
          roughness: 0.96,
          metalness: 0,
          vertexColors: true,
          color: 0xecf4dd,
          emissive: 0x3d5a28,
          emissiveIntensity: 1.05,
        })
      : createSeedThreeGroundCoverMaterial(
          'SeedThree cultivated grapevine foliage',
          textures,
          rendererBackend,
          [0.38, 0.5, 0.18],
          0.08,
        );
    vineMaterial.forceSinglePass = true;
    vineMaterial.userData.sharedBuildingMaterial = true;
  })
    .catch((error) => {
      vineLoadPromise = null;
      throw error;
    });
  return vineLoadPromise;
}

export function disposeVineyardVineResources(): void {
  vineMaterial?.dispose();
  if (vineTextures) {
    vineTextures.albedo.dispose();
    vineTextures.normal?.dispose();
    vineTextures.roughness?.dispose();
    vineTextures.translucency?.dispose();
  }
  vineMaterial = null;
  vineTextures = null;
  vineLoadPromise = null;
}

/** Builds one two-draw-call foliage-and-fruit set for a complete vineyard. */
export function createSeedThreeVineyardVines(
  placements: ReadonlyArray<VineyardVinePlacement>,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'SeedThree cultivated grapevines';

  const capacity = Math.max(placements.length, 1);
  const leafGeometry = createVineyardCardClumpGeometry({
    quads: 9,
    width: 0.38,
    tiltMin: 0.14,
    tiltSpan: 0.38,
    heightMin: 0.42,
    heightSpan: 0.2,
    baseSpread: 0.56,
  });
  const attributes = addVineyardInstanceAttributes(leafGeometry, capacity);
  const leaves = new THREE.InstancedMesh(
    leafGeometry,
    vineMaterial ?? sharedBuildingDetailMaterial('foliage'),
    capacity,
  );
  leaves.name = 'SeedThree cultivated grapevine cards';
  leaves.count = placements.length;
  leaves.castShadow = false;
  leaves.receiveShadow = true;
  leaves.renderOrder = 3;
  leaves.frustumCulled = false;

  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const tint = new THREE.Color();
  const wind = new THREE.Vector3();

  placements.forEach((placement, index) => {
    const yaw = (hash01(placement.seed + 0.7) - 0.5) * 0.28;
    const lean = (hash01(placement.seed + 1.9) - 0.5) * 0.15;
    position.set(placement.x, placement.y, placement.z);
    quaternion.setFromEuler(new THREE.Euler(lean, yaw, lean * -0.45, 'YXZ'));
    const width = 0.98 + hash01(placement.seed + 4.3) * 0.2;
    const height = 0.94 + hash01(placement.seed + 8.1) * 0.14;
    scale.set(width, height, 0.86 + hash01(placement.seed + 5.6) * 0.16);
    matrix.compose(position, quaternion, scale);
    leaves.setMatrixAt(index, matrix);

    const tintR = 0.86 + hash01(placement.seed + 3.2) * 0.12;
    const tintG = 0.88 + hash01(placement.seed + 7.4) * 0.12;
    const tintB = 0.76 + hash01(placement.seed + 9.7) * 0.12;
    attributes.tint.setXYZ(index, tintR, tintG, tintB);
    attributes.anchor.setXYZ(index, position.x, position.y, position.z);
    vineyardWindVector(yaw, scale, wind);
    attributes.wind.setXYZ(index, wind.x, wind.y, wind.z);
    tint.setRGB(tintR, tintG, tintB);
    leaves.setColorAt(index, tint);
  });

  leaves.instanceMatrix.needsUpdate = true;
  attributes.tint.needsUpdate = true;
  attributes.anchor.needsUpdate = true;
  attributes.wind.needsUpdate = true;
  if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true;
  group.add(leaves);

  const fruitingVines = placements.filter((placement) => placement.fruiting);
  const berriesPerVine = 5;
  const grapeCapacity = Math.max(fruitingVines.length * berriesPerVine, 1);
  const grapeGeometry = new THREE.DodecahedronGeometry(0.095, 0);
  const grapes = new THREE.InstancedMesh(
    grapeGeometry,
    sharedBuildingDetailMaterial('paintBlue'),
    grapeCapacity,
  );
  grapes.name = 'Instanced grape clusters';
  grapes.count = fruitingVines.length * berriesPerVine;
  grapes.castShadow = false;
  grapes.receiveShadow = true;
  grapes.frustumCulled = false;

  let grapeIndex = 0;
  for (const placement of fruitingVines) {
    for (let berry = 0; berry < berriesPerVine; berry++) {
      const angle = berry * 2.39996 + hash01(placement.seed + 12.5) * Math.PI * 2;
      const radius = berry === 0 ? 0 : 0.105;
      position.set(
        placement.x + 0.23 + Math.cos(angle) * radius,
        placement.y + 0.18 - berry * 0.055,
        placement.z + 0.16 + Math.sin(angle) * radius,
      );
      scale.set(0.86, 1.08, 0.86);
      matrix.compose(position, quaternion.identity(), scale);
      grapes.setMatrixAt(grapeIndex++, matrix);
    }
  }
  grapes.instanceMatrix.needsUpdate = true;
  group.add(grapes);
  return group;
}

function hash01(seed: number): number {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

type VineyardCardGeometrySpec = {
  quads: number;
  width: number;
  tiltMin: number;
  tiltSpan: number;
  heightMin: number;
  heightSpan: number;
  baseSpread: number;
};

function createVineyardCardClumpGeometry(spec: VineyardCardGeometrySpec): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let base = 0;

  for (let quad = 0; quad < spec.quads; quad++) {
    const azimuth = (quad / spec.quads) * Math.PI * 2 + (hash01(quad + 1.7) - 0.5) * 0.95;
    const tilt = spec.tiltMin + hash01(quad + 7.1) * spec.tiltSpan;
    const height = spec.heightMin + hash01(quad + 3.3) * spec.heightSpan;
    const width = spec.width * (0.76 + hash01(quad + 11.4) * 0.52);
    const centerX = (hash01(quad + 5.2) - 0.5) * spec.baseSpread * 2;
    const centerY = hash01(quad + 15.8) * 0.3;
    const centerZ = (hash01(quad + 18.4) - 0.5) * 0.28;
    const ca = Math.cos(azimuth);
    const sa = Math.sin(azimuth);
    const upX = Math.sin(tilt) * ca;
    const upY = Math.cos(tilt);
    const upZ = Math.sin(tilt) * sa;
    const rightX = -sa;
    const rightZ = ca;

    for (const [localX, localY] of [
      [-0.5 * width, 0],
      [0.5 * width, 0],
      [0.5 * width, 1],
      [-0.5 * width, 1],
    ] as const) {
      positions.push(
        centerX + rightX * localX + upX * localY * height,
        centerY + upY * localY * height,
        centerZ + rightZ * localX + upZ * localY * height,
      );
      normals.push(0, 1, 0);
      uvs.push(localX / width + 0.5, localY);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    base += 4;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

function addVineyardInstanceAttributes(geometry: THREE.BufferGeometry, capacity: number) {
  const tint = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  const anchor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  const wind = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  geometry.setAttribute('aTint', tint);
  geometry.setAttribute('aAnchorPos', anchor);
  geometry.setAttribute('aWindVec', wind);
  return { tint, anchor, wind };
}

function vineyardWindVector(yaw: number, scale: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  out.set(Math.cos(yaw) * 0.78 - Math.sin(yaw) * 0.62, 0, Math.sin(yaw) * 0.78 + Math.cos(yaw) * 0.62);
  if (scale.x !== 0) out.x /= scale.x;
  if (scale.y !== 0) out.y /= scale.y;
  if (scale.z !== 0) out.z /= scale.z;
  return out;
}
