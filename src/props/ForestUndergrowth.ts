import * as THREE from 'three';
import type { Terrain } from '../terrain/Terrain.ts';
import { TREE_SHADOW_CAST_LAYER } from './ForestProps.ts';
import type { RendererBackendKind } from '../scene/RendererBackend.ts';
import {
  CENTRAL_CLEARING_RADIUS,
  type ForestCore,
  type ForestSpawnConfig,
  forestDensityAt,
  hasMinimumDistance,
  isInsidePlayableExtent,
  pick,
  samplePointInForestCore,
  samplePointInPlayableExtent,
} from './forestField.ts';

const TAU = Math.PI * 2;

/** Canopy pines are ~14–18 m; these targets are world-space metres at placement scale 1. */
const BUSH_TARGET_WIDTH = 1.55;
const BUSH_TARGET_HEIGHT = 0.95;

export type UndergrowthKind = 'bush' | 'fern';

export type UndergrowthPlacement = {
  x: number;
  z: number;
  kind: UndergrowthKind;
  scale: number;
  yaw: number;
  meshIndex: number;
};

export type UndergrowthMaterials = {
  bush: THREE.MeshStandardMaterial;
  fern: THREE.MeshStandardMaterial;
  shadowCast: THREE.MeshStandardMaterial;
  bushShadowDepth: THREE.MeshDepthMaterial;
  fernShadowDepth: THREE.MeshDepthMaterial;
};

export type UndergrowthInstances = {
  group: THREE.Group;
  bushMesh: THREE.InstancedMesh;
  fernMesh: THREE.InstancedMesh;
  bushShadowMesh: THREE.InstancedMesh;
  fernShadowMesh: THREE.InstancedMesh;
  placements: UndergrowthPlacement[];
  bushMatrices: THREE.Matrix4[];
  fernMatrices: THREE.Matrix4[];
};

export function createUndergrowthMaterials(
  _maxAnisotropy: number,
  _rendererBackend: RendererBackendKind | undefined,
  _sharedTextures: THREE.Texture[],
): UndergrowthMaterials {
  const bush = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.9,
    metalness: 0,
    side: THREE.DoubleSide,
    vertexColors: true,
  });

  const fern = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.9,
    metalness: 0,
    side: THREE.DoubleSide,
    vertexColors: true,
  });

  return {
    bush,
    fern,
    shadowCast: new THREE.MeshStandardMaterial({
      transparent: true,
      opacity: 0,
      colorWrite: false,
      depthWrite: false,
    }),
    bushShadowDepth: new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
    }),
    fernShadowDepth: new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
    }),
  };
}

export function createUndergrowthPlacements(
  rng: () => number,
  forestCores: ForestCore[],
  spawnConfig: ForestSpawnConfig,
  isBlockedAt?: (x: number, z: number) => boolean,
): UndergrowthPlacement[] {
  const placements: UndergrowthPlacement[] = [];
  let attempts = 0;

  while (placements.length < spawnConfig.undergrowthTargetCount && attempts < spawnConfig.undergrowthTargetCount * 36) {
    attempts++;
    const core = rng() < 0.84 ? pick(forestCores, rng) : undefined;
    const sampled = core
      ? samplePointInForestCore(core, rng)
      : samplePointInPlayableExtent(rng, spawnConfig.extent);
    const { x, z } = sampled;

    if (!isInsidePlayableExtent(x, z, spawnConfig.extent)) continue;
    if (Math.hypot(x, z) < CENTRAL_CLEARING_RADIUS + rng() * 12) continue;

    const density = forestDensityAt(x, z, forestCores, spawnConfig.extent);
    if (density < 0.22 || rng() > density * 1.08) continue;

    const kind: UndergrowthKind = rng() < 0.58 + density * 0.12 ? 'bush' : 'fern';
    const minDistance = kind === 'bush' ? THREE.MathUtils.lerp(1.6, 1.0, density) : THREE.MathUtils.lerp(1.3, 0.8, density);
    if (!hasMinimumDistance(placements, x, z, minDistance)) continue;
    if (isBlockedAt?.(x, z)) continue;

    const scale =
      kind === 'bush'
        ? THREE.MathUtils.lerp(0.95, 1.65, Math.pow(rng(), 0.78)) * THREE.MathUtils.lerp(0.92, 1.1, density)
        : THREE.MathUtils.lerp(1.05, 1.85, Math.pow(rng(), 0.72)) * THREE.MathUtils.lerp(0.9, 1.12, density);

    placements.push({ x, z, kind, scale, yaw: rng() * TAU, meshIndex: -1 });
  }

  return placements;
}

export function buildUndergrowthInstances(
  placements: UndergrowthPlacement[],
  terrain: Terrain,
  materials: UndergrowthMaterials,
  rng: () => number,
): UndergrowthInstances {
  const group = new THREE.Group();
  group.name = 'Forest undergrowth';

  const bushPlacements = placements.filter((p) => p.kind === 'bush');
  const fernPlacements = placements.filter((p) => p.kind === 'fern');

  const bushGeometry = createBroadleafBushGeometry();
  const fernGeometry = createFernClumpGeometry();
  const bushShadowGeometry = createBushShadowGeometry();
  const fernShadowGeometry = fernGeometry.clone();

  const bushMesh = createFoliageInstancedMesh(bushGeometry, materials.bush, bushPlacements.length, 'Instanced bushes');
  const fernMesh = createFoliageInstancedMesh(fernGeometry, materials.fern, fernPlacements.length, 'Instanced ferns');
  const bushShadowMesh = createShadowInstancedMesh(
    bushShadowGeometry,
    materials.shadowCast,
    materials.bushShadowDepth,
    bushPlacements.length,
    'Instanced bush shadows',
  );
  const fernShadowMesh = createShadowInstancedMesh(
    fernShadowGeometry,
    materials.shadowCast,
    materials.fernShadowDepth,
    fernPlacements.length,
    'Instanced fern shadows',
  );

  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scaleVector = new THREE.Vector3();
  const color = new THREE.Color();
  const bushMatrices = bushPlacements.map(() => new THREE.Matrix4());
  const fernMatrices = fernPlacements.map(() => new THREE.Matrix4());

  bushPlacements.forEach((placement, index) => {
    placement.meshIndex = index;
    composeUndergrowthMatrix(placement, terrain, rng, matrix, quaternion, position, scaleVector);
    bushMesh.setMatrixAt(index, matrix);
    bushShadowMesh.setMatrixAt(index, matrix);
    bushMatrices[index].copy(matrix);
    color.setHSL(0.28 + (rng() - 0.5) * 0.03, 0.38 + rng() * 0.12, 0.3 + rng() * 0.08);
    bushMesh.setColorAt(index, color);
  });

  fernPlacements.forEach((placement, index) => {
    placement.meshIndex = index;
    composeUndergrowthMatrix(placement, terrain, rng, matrix, quaternion, position, scaleVector);
    fernMesh.setMatrixAt(index, matrix);
    fernShadowMesh.setMatrixAt(index, matrix);
    fernMatrices[index].copy(matrix);
    color.setHSL(0.31 + (rng() - 0.5) * 0.04, 0.5 + rng() * 0.14, 0.34 + rng() * 0.1);
    fernMesh.setColorAt(index, color);
  });

  bushMesh.instanceMatrix.needsUpdate = true;
  fernMesh.instanceMatrix.needsUpdate = true;
  bushShadowMesh.instanceMatrix.needsUpdate = true;
  fernShadowMesh.instanceMatrix.needsUpdate = true;
  if (bushMesh.instanceColor) bushMesh.instanceColor.needsUpdate = true;
  if (fernMesh.instanceColor) fernMesh.instanceColor.needsUpdate = true;

  group.add(bushMesh, fernMesh, bushShadowMesh, fernShadowMesh);

  return {
    group,
    bushMesh,
    fernMesh,
    bushShadowMesh,
    fernShadowMesh,
    placements,
    bushMatrices,
    fernMatrices,
  };
}

export function disposeUndergrowthInstances(instances: UndergrowthInstances, materials: UndergrowthMaterials): void {
  instances.bushMesh.geometry.dispose();
  instances.fernMesh.geometry.dispose();
  instances.bushShadowMesh.geometry.dispose();
  instances.fernShadowMesh.geometry.dispose();
  materials.bush.dispose();
  materials.fern.dispose();
  materials.shadowCast.dispose();
  materials.bushShadowDepth.dispose();
  materials.fernShadowDepth.dispose();
}

function createFoliageInstancedMesh(
  geometry: THREE.BufferGeometry,
  material: THREE.MeshStandardMaterial,
  count: number,
  name: string,
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.name = name;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  return mesh;
}

function createShadowInstancedMesh(
  geometry: THREE.BufferGeometry,
  shadowCast: THREE.MeshStandardMaterial,
  shadowDepth: THREE.MeshDepthMaterial,
  count: number,
  name: string,
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, shadowCast, count);
  mesh.name = name;
  mesh.layers.set(TREE_SHADOW_CAST_LAYER);
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  mesh.customDepthMaterial = shadowDepth;
  return mesh;
}

function composeUndergrowthMatrix(
  placement: UndergrowthPlacement,
  terrain: Terrain,
  rng: () => number,
  matrix: THREE.Matrix4,
  quaternion: THREE.Quaternion,
  position: THREE.Vector3,
  scaleVector: THREE.Vector3,
): void {
  const y = terrain.getHeightAt(placement.x, placement.z);
  position.set(placement.x, y, placement.z);
  quaternion.setFromEuler(
    new THREE.Euler(
      (rng() - 0.5) * 0.04,
      placement.yaw,
      (rng() - 0.5) * 0.04,
    ),
  );
  const heightScale = placement.kind === 'bush' ? 0.82 + rng() * 0.12 : 0.96 + rng() * 0.14;
  scaleVector.set(placement.scale, placement.scale * heightScale, placement.scale);
  matrix.compose(position, quaternion, scaleVector);
}

/**
 * Broadleaf understory shrub — wide, low, matte green leaf masses with visible brown twigs.
 * No conifer needle texture; silhouette is horizontal not conical.
 */
function createBroadleafBushGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  const leafGreen = new THREE.Color(0x4a6340);
  const leafHighlight = new THREE.Color(0x5a7550);
  const leafShadow = new THREE.Color(0x3a5032);
  const twigBrown = new THREE.Color(0x5c4a38);

  const moundBlobs = [
    { x: 0, y: 0.32, z: 0, sx: 0.72, sy: 0.38, sz: 0.72 },
    { x: 0.28, y: 0.24, z: 0.14, sx: 0.48, sy: 0.28, sz: 0.44 },
    { x: -0.26, y: 0.26, z: -0.12, sx: 0.46, sy: 0.26, sz: 0.42 },
    { x: 0.1, y: 0.38, z: -0.24, sx: 0.42, sy: 0.22, sz: 0.38 },
    { x: -0.14, y: 0.34, z: 0.26, sx: 0.4, sy: 0.24, sz: 0.4 },
    { x: 0.32, y: 0.18, z: -0.2, sx: 0.36, sy: 0.2, sz: 0.32 },
    { x: -0.3, y: 0.2, z: 0.18, sx: 0.34, sy: 0.19, sz: 0.34 },
  ];

  const blobTemplate = new THREE.IcosahedronGeometry(1, 2);
  for (const blob of moundBlobs) {
    appendScaledBlob(positions, normals, colors, indices, blobTemplate, blob, pickLeafColor(leafGreen, leafHighlight, leafShadow, blob.x + blob.z));
  }
  blobTemplate.dispose();

  const padCount = 12;
  for (let i = 0; i < padCount; i++) {
    const angle = (i / padCount) * TAU;
    const dist = 0.42 + (i % 3) * 0.1;
    const padY = 0.38 + (i % 4) * 0.08;
    appendLeafPad(
      positions,
      normals,
      colors,
      indices,
      Math.cos(angle) * dist,
      padY,
      Math.sin(angle) * dist,
      angle,
      0.38 + (i % 2) * 0.08,
      i % 3 === 0 ? leafHighlight : leafGreen,
    );
  }

  const twigCount = 7;
  for (let i = 0; i < twigCount; i++) {
    const angle = (i / twigCount) * TAU + 0.25;
    const length = 0.48 + (i % 2) * 0.14;
    appendTwig(
      positions,
      normals,
      colors,
      indices,
      Math.cos(angle) * 0.08,
      0.22 + (i % 3) * 0.06,
      Math.sin(angle) * 0.08,
      Math.cos(angle),
      Math.sin(angle),
      length,
      twigBrown,
    );
  }

  return finalizeColoredGeometry(positions, normals, colors, indices);
}

function createFernClumpGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const frondGreen = new THREE.Color(0x567842);
  const frondLight = new THREE.Color(0x6a8f52);
  const stemBrown = new THREE.Color(0x4a5c36);

  const frondCount = 9;
  for (let i = 0; i < frondCount; i++) {
    const angle = (i / frondCount) * TAU + (i % 2 === 0 ? 0.1 : -0.08);
    const length = 0.88 + (i % 3) * 0.14;
    const arch = 1.05 + (i % 4) * 0.12;
    addPinnateFrond(
      positions,
      normals,
      colors,
      indices,
      angle,
      length,
      arch,
      i % 2 === 0 ? frondLight : frondGreen,
      stemBrown,
    );
  }

  return finalizeColoredGeometry(positions, normals, colors, indices);
}

function createBushShadowGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.SphereGeometry(1, 10, 8, 0, TAU, 0, Math.PI * 0.52);
  geometry.scale(BUSH_TARGET_WIDTH * 0.42, BUSH_TARGET_HEIGHT * 0.38, BUSH_TARGET_WIDTH * 0.42);
  geometry.translate(0, BUSH_TARGET_HEIGHT * 0.22, 0);
  geometry.computeVertexNormals();
  return geometry;
}

function pickLeafColor(base: THREE.Color, highlight: THREE.Color, shadow: THREE.Color, hash: number): THREE.Color {
  const t = Math.abs(Math.sin(hash * 12.9898)) % 1;
  if (t < 0.28) return shadow.clone();
  if (t > 0.72) return highlight.clone();
  return base.clone();
}

function appendScaledBlob(
  positions: number[],
  normals: number[],
  colors: number[],
  indices: number[],
  template: THREE.BufferGeometry,
  blob: { x: number; y: number; z: number; sx: number; sy: number; sz: number },
  color: THREE.Color,
): void {
  const geometry = template.clone();
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const temp = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    temp.fromBufferAttribute(position, i);
    temp.x = temp.x * blob.sx + blob.x;
    temp.y = temp.y * blob.sy + blob.y;
    temp.z = temp.z * blob.sz + blob.z;
    position.setXYZ(i, temp.x, temp.y, temp.z);
  }
  geometry.computeVertexNormals();
  appendColoredGeometry(positions, normals, colors, indices, geometry, color);
  geometry.dispose();
}

function appendLeafPad(
  positions: number[],
  normals: number[],
  colors: number[],
  indices: number[],
  x: number,
  y: number,
  z: number,
  yaw: number,
  padSize: number,
  color: THREE.Color,
): void {
  const geometry = new THREE.IcosahedronGeometry(1, 1);
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const temp = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    temp.fromBufferAttribute(position, i);
    const lx = temp.x * padSize * 1.15;
    const ly = temp.y * padSize * 0.22;
    const lz = temp.z * padSize * 1.15;
    temp.set(lx * cos - lz * sin + x, ly + y, lx * sin + lz * cos + z);
    position.setXYZ(i, temp.x, temp.y, temp.z);
  }
  geometry.computeVertexNormals();
  appendColoredGeometry(positions, normals, colors, indices, geometry, color);
  geometry.dispose();
}

function appendTwig(
  positions: number[],
  normals: number[],
  colors: number[],
  indices: number[],
  startX: number,
  startY: number,
  startZ: number,
  dirX: number,
  dirZ: number,
  length: number,
  color: THREE.Color,
): void {
  const geometry = new THREE.CylinderGeometry(0.028, 0.038, length, 5, 1, false);
  geometry.rotateX(Math.PI * 0.5);
  geometry.rotateY(Math.atan2(dirX, dirZ));
  geometry.translate(startX + dirX * length * 0.45, startY + 0.06, startZ + dirZ * length * 0.45);
  appendColoredGeometry(positions, normals, colors, indices, geometry, color);
  geometry.dispose();
}

function addPinnateFrond(
  positions: number[],
  normals: number[],
  colors: number[],
  indices: number[],
  angle: number,
  length: number,
  archHeight: number,
  leafColor: THREE.Color,
  stemColor: THREE.Color,
): void {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const lateral = new THREE.Vector3(-sin, 0, cos).normalize();
  const forward = new THREE.Vector3(cos, 0.22, sin).normalize();
  const leafletCount = 9;

  for (let i = 0; i < leafletCount; i++) {
    const t = (i + 1) / (leafletCount + 1);
    const along = t * length;
    const centerX = cos * along;
    const centerZ = sin * along;
    const centerY = Math.sin(t * Math.PI) * archHeight * 0.88 + 0.06;
    const leafletLen = THREE.MathUtils.lerp(0.34, 0.16, t) * (0.92 + (i % 2) * 0.1);
    const leafletWidth = leafletLen * 0.55;

    addFernLeaflet(
      positions,
      normals,
      colors,
      indices,
      centerX,
      centerY,
      centerZ,
      lateral,
      forward,
      leafletLen,
      leafletWidth,
      1,
      leafColor,
    );
    addFernLeaflet(
      positions,
      normals,
      colors,
      indices,
      centerX,
      centerY,
      centerZ,
      lateral,
      forward,
      leafletLen,
      leafletWidth,
      -1,
      leafColor,
    );
  }

  addFernStem(positions, normals, colors, indices, cos, sin, length, archHeight, stemColor);
}

function addFernLeaflet(
  positions: number[],
  normals: number[],
  colors: number[],
  indices: number[],
  centerX: number,
  centerY: number,
  centerZ: number,
  lateral: THREE.Vector3,
  forward: THREE.Vector3,
  length: number,
  width: number,
  side: number,
  color: THREE.Color,
): void {
  const baseIndex = positions.length / 3;
  const base = new THREE.Vector3(centerX, centerY, centerZ);
  const tip = base
    .clone()
    .addScaledVector(lateral, side * length * 0.62)
    .addScaledVector(forward, length * 0.42)
    .add(new THREE.Vector3(0, length * 0.18, 0));
  const mid = base.clone().addScaledVector(lateral, side * length * 0.32).add(new THREE.Vector3(0, length * 0.08, 0));
  const sideOffset = lateral.clone().multiplyScalar(side * width * 0.5);

  const verts = [
    base.clone().sub(sideOffset),
    mid.clone().add(sideOffset),
    tip.clone(),
    mid.clone().sub(sideOffset),
  ];

  for (const v of verts) {
    positions.push(v.x, v.y, v.z);
    normals.push(0, 0.85, 0);
    colors.push(color.r, color.g, color.b);
  }
  indices.push(baseIndex, baseIndex + 1, baseIndex + 2, baseIndex, baseIndex + 2, baseIndex + 3);
}

function addFernStem(
  positions: number[],
  normals: number[],
  colors: number[],
  indices: number[],
  cos: number,
  sin: number,
  length: number,
  archHeight: number,
  color: THREE.Color,
): void {
  const segments = 6;
  let prevX = 0;
  let prevY = 0.05;
  let prevZ = 0;

  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    const x = cos * length * t;
    const z = sin * length * t;
    const y = Math.sin(t * Math.PI) * archHeight * 0.72 + 0.05;
    const baseIndex = positions.length / 3;
    const stemHalf = 0.032 * (1 - t * 0.28);
    const px = -sin * stemHalf;
    const pz = cos * stemHalf;

    const corners = [
      [prevX - px, prevY, prevZ - pz],
      [prevX + px, prevY, prevZ + pz],
      [x + px, y, z + pz],
      [x - px, y, z - pz],
    ];
    for (const [vx, vy, vz] of corners) {
      positions.push(vx, vy, vz);
      normals.push(0, 1, 0);
      colors.push(color.r, color.g, color.b);
    }
    indices.push(baseIndex, baseIndex + 1, baseIndex + 2, baseIndex, baseIndex + 2, baseIndex + 3);
    prevX = x;
    prevY = y;
    prevZ = z;
  }
}

function appendColoredGeometry(
  positions: number[],
  normals: number[],
  colors: number[],
  indices: number[],
  geometry: THREE.BufferGeometry,
  color: THREE.Color,
): number {
  const vertexOffset = positions.length / 3;
  const partPositions = geometry.getAttribute('position') as THREE.BufferAttribute;
  const partNormals = geometry.getAttribute('normal') as THREE.BufferAttribute;

  for (let i = 0; i < partPositions.count; i++) {
    positions.push(partPositions.getX(i), partPositions.getY(i), partPositions.getZ(i));
    normals.push(partNormals.getX(i), partNormals.getY(i), partNormals.getZ(i));
    colors.push(color.r, color.g, color.b);
  }

  const partIndex = geometry.getIndex();
  if (partIndex) {
    for (let i = 0; i < partIndex.count; i++) {
      indices.push(partIndex.getX(i) + vertexOffset);
    }
  }

  return vertexOffset + partPositions.count;
}

function finalizeColoredGeometry(
  positions: number[],
  normals: number[],
  colors: number[],
  indices: number[],
): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
