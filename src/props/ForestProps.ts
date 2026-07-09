import * as THREE from 'three';
import type { Terrain } from '../terrain/Terrain.ts';

const UP = new THREE.Vector3(0, 1, 0);
const TAU = Math.PI * 2;

type ForestMaterialSet = {
  bark: THREE.MeshStandardMaterial;
  leaves: THREE.MeshStandardMaterial[];
  needles: THREE.MeshStandardMaterial[];
  rock: THREE.MeshStandardMaterial;
  textures: THREE.Texture[];
};

type TreePlacement = {
  x: number;
  z: number;
  species: 'broadleaf' | 'conifer';
  scale: number;
};

export function createForestProps(terrain: Terrain, maxAnisotropy: number): THREE.Group {
  const rng = mulberry32(0x5eedf0a5);
  const materials = createForestMaterials(maxAnisotropy);
  const forest = new THREE.Group();
  forest.name = 'Road-scale forest props';
  forest.userData.disposeResources = () => disposeForestMaterials(materials);
  const treePlacements = createTreePlacements(rng);
  const broadleafPlacements = treePlacements.filter((placement) => placement.species === 'broadleaf');
  const coniferPlacements = treePlacements.filter((placement) => placement.species === 'conifer');

  for (const placement of broadleafPlacements) {
    const y = terrain.getHeightAt(placement.x, placement.z);
    const tree = createBroadleafTree(placement.scale, materials, rng);
    tree.position.set(placement.x, y, placement.z);
    tree.rotation.y = rng() * TAU;
    forest.add(tree);
  }

  forest.add(createConiferForest(coniferPlacements, terrain, materials, rng));
  forest.add(createRockField(createRockPlacements(rng), terrain, materials.rock, rng));

  return forest;
}

function createForestMaterials(maxAnisotropy: number): ForestMaterialSet {
  const loader = new THREE.TextureLoader();
  const textures: THREE.Texture[] = [];
  const loadMap = (url: string, srgb = false): THREE.Texture => {
    const texture = loader.load(url);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = Math.max(1, Math.min(16, maxAnisotropy));
    if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
    textures.push(texture);
    return texture;
  };

  const bark = new THREE.MeshStandardMaterial({
    map: loadMap('/assets/textures/props/oak_bark/albedo.png', true),
    normalMap: loadMap('/assets/textures/props/oak_bark/normal.png'),
    roughnessMap: loadMap('/assets/textures/props/oak_bark/roughness.png'),
    color: 0x8a694f,
    roughness: 0.94,
    metalness: 0,
  });
  bark.normalScale.set(0.75, 0.75);

  const rock = new THREE.MeshStandardMaterial({
    map: loadMap('/assets/textures/props/mossy_rock/albedo.png', true),
    normalMap: loadMap('/assets/textures/props/mossy_rock/normal.png'),
    roughnessMap: loadMap('/assets/textures/props/mossy_rock/roughness.png'),
    color: 0xb6b3a4,
    roughness: 0.9,
    metalness: 0,
  });
  rock.normalScale.set(0.55, 0.55);

  return {
    bark,
    rock,
    leaves: [
      new THREE.MeshStandardMaterial({ color: 0x496f35, roughness: 0.96, metalness: 0 }),
      new THREE.MeshStandardMaterial({ color: 0x5f7f3f, roughness: 0.97, metalness: 0 }),
      new THREE.MeshStandardMaterial({ color: 0x6b6e35, roughness: 0.98, metalness: 0 }),
      new THREE.MeshStandardMaterial({ color: 0x7a6f3c, roughness: 0.98, metalness: 0 }),
    ],
    needles: [
      new THREE.MeshStandardMaterial({ color: 0x3d6540, roughness: 0.98, metalness: 0, side: THREE.DoubleSide }),
      new THREE.MeshStandardMaterial({ color: 0x4c7448, roughness: 0.98, metalness: 0, side: THREE.DoubleSide }),
    ],
    textures,
  };
}

function createTreePlacements(rng: () => number): TreePlacement[] {
  const placements: TreePlacement[] = [
    { x: -36, z: 18, species: 'broadleaf', scale: 1.18 },
    { x: 34, z: 22, species: 'broadleaf', scale: 1.08 },
    { x: -54, z: -18, species: 'conifer', scale: 1.2 },
    { x: 58, z: -12, species: 'broadleaf', scale: 1.28 },
    { x: -18, z: 48, species: 'broadleaf', scale: 1.04 },
    { x: 22, z: 52, species: 'conifer', scale: 1.14 },
    { x: -76, z: 36, species: 'broadleaf', scale: 1.34 },
    { x: 82, z: 34, species: 'conifer', scale: 1.18 },
  ];

  for (let i = 0; i < 66; i++) {
    const angle = i * 2.399963 + rng() * 0.55;
    const radius = 34 + Math.pow(rng(), 0.7) * 330;
    const x = Math.cos(angle) * radius + (rng() - 0.5) * 22;
    const z = Math.sin(angle) * radius + (rng() - 0.5) * 22;
    if (Math.hypot(x, z) < 22) continue;
    placements.push({
      x,
      z,
      species: rng() > 0.72 ? 'conifer' : 'broadleaf',
      scale: 0.82 + rng() * 0.68,
    });
  }

  return placements;
}

function createRockPlacements(rng: () => number): Array<{ x: number; z: number; scale: number }> {
  const placements: Array<{ x: number; z: number; scale: number }> = [
    { x: -18, z: 16, scale: 1.35 },
    { x: 17, z: -24, scale: 1.15 },
    { x: 42, z: 8, scale: 1.65 },
    { x: -48, z: -4, scale: 1.4 },
  ];

  for (let i = 0; i < 58; i++) {
    const angle = i * 1.713 + rng() * 0.8;
    const radius = 24 + rng() * 330;
    placements.push({
      x: Math.cos(angle) * radius + (rng() - 0.5) * 24,
      z: Math.sin(angle) * radius + (rng() - 0.5) * 24,
      scale: 0.75 + rng() * 1.8,
    });
  }

  return placements;
}

function createBroadleafTree(scale: number, materials: ForestMaterialSet, rng: () => number): THREE.Group {
  const tree = new THREE.Group();
  tree.name = 'L-system broadleaf tree';
  const height = (11.5 + rng() * 6.5) * scale;
  const trunkRadius = (0.38 + rng() * 0.28) * scale;
  const lean = new THREE.Vector3((rng() - 0.5) * 0.16, 1, (rng() - 0.5) * 0.16).normalize();

  growBranch({
    group: tree,
    start: new THREE.Vector3(0, 0, 0),
    direction: lean,
    length: height * (0.55 + rng() * 0.1),
    radius: trunkRadius,
    depth: 0,
    maxDepth: 1,
    materials,
    rng,
  });

  addRootFlares(tree, trunkRadius, materials.bark, rng);
  return tree;
}

function growBranch(args: {
  group: THREE.Group;
  start: THREE.Vector3;
  direction: THREE.Vector3;
  length: number;
  radius: number;
  depth: number;
  maxDepth: number;
  materials: ForestMaterialSet;
  rng: () => number;
}): void {
  const { group, start, direction, length, radius, depth, maxDepth, materials, rng } = args;
  const segments = depth === 0 ? 5 : 3;
  let cursor = start.clone();
  let dir = direction.clone().normalize();

  for (let i = 0; i < segments; i++) {
    const t0 = i / segments;
    const t1 = (i + 1) / segments;
    const bend = new THREE.Vector3((rng() - 0.5) * 0.17, (rng() - 0.5) * 0.04, (rng() - 0.5) * 0.17);
    if (depth > 0) bend.y -= 0.02;
    dir.add(bend).normalize();
    const next = cursor.clone().addScaledVector(dir, (length / segments) * (0.92 + rng() * 0.18));
    const r0 = radius * (1 - t0 * 0.48);
    const r1 = Math.max(radius * (1 - t1 * 0.56), radius * 0.34);
    group.add(createTaperedBranch(cursor, next, r0, r1, materials.bark, depth === 0 ? 8 : 6, depth <= 1));

    if (depth < maxDepth && i >= (depth === 0 ? 1 : 0)) {
      const branchCount = depth === 0 ? 2 + Math.floor(rng() * 2) : 1;
      for (let b = 0; b < branchCount; b++) {
        if (rng() < 0.35 && depth > 0) continue;
        const yaw = (b / branchCount) * TAU + rng() * TAU * 0.25;
        const side = new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw));
        const branchDir = dir
          .clone()
          .multiplyScalar(depth === 0 ? 0.42 : 0.28)
          .add(side.multiplyScalar(0.78 + rng() * 0.25))
          .addScaledVector(UP, 0.32 - depth * 0.05)
          .normalize();
        growBranch({
          group,
          start: next.clone(),
          direction: branchDir,
          length: length * (0.44 + rng() * 0.16),
          radius: r1 * (0.54 + rng() * 0.12),
          depth: depth + 1,
          maxDepth,
          materials,
          rng,
        });
      }
    }

    cursor = next;
  }

  if (depth >= 1) addLeafClusters(group, cursor, length, materials.leaves, rng);
}

function addLeafClusters(
  group: THREE.Group,
  center: THREE.Vector3,
  branchLength: number,
  leafMaterials: THREE.MeshStandardMaterial[],
  rng: () => number,
): void {
  const count = 2 + Math.floor(rng() * 2);
  for (let i = 0; i < count; i++) {
    const size = branchLength * (0.16 + rng() * 0.09);
    const leaf = new THREE.Mesh(createBlobGeometry(rng), pick(leafMaterials, rng));
    leaf.position.copy(center).add(new THREE.Vector3((rng() - 0.5) * size, (rng() - 0.35) * size * 0.6, (rng() - 0.5) * size));
    leaf.scale.set(size * (1.5 + rng() * 0.5), size * (0.8 + rng() * 0.35), size * (1.25 + rng() * 0.45));
    leaf.rotation.set(rng() * TAU, rng() * TAU, rng() * TAU);
    leaf.castShadow = false;
    leaf.receiveShadow = true;
    group.add(leaf);
  }
}

function addRootFlares(group: THREE.Group, trunkRadius: number, material: THREE.Material, rng: () => number): void {
  const count = 4 + Math.floor(rng() * 3);
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * TAU + rng() * 0.35;
    const start = new THREE.Vector3(Math.cos(angle) * trunkRadius * 0.28, 0.08, Math.sin(angle) * trunkRadius * 0.28);
    const end = new THREE.Vector3(
      Math.cos(angle) * trunkRadius * (1.6 + rng() * 0.5),
      0.02,
      Math.sin(angle) * trunkRadius * (1.6 + rng() * 0.5),
    );
    const flare = createTaperedBranch(start, end, trunkRadius * 0.32, trunkRadius * 0.08, material, 6, false);
    flare.name = 'root flare';
    group.add(flare);
  }
}

function createTaperedBranch(
  start: THREE.Vector3,
  end: THREE.Vector3,
  radiusStart: number,
  radiusEnd: number,
  material: THREE.Material,
  radialSegments: number,
  castShadow = true,
): THREE.Mesh {
  const length = start.distanceTo(end);
  const geometry = new THREE.CylinderGeometry(radiusEnd, radiusStart, length, radialSegments, 1, false);
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute | undefined;
  if (uv) {
    const repeat = Math.max(1, length / 2.2);
    for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * repeat);
  }
  geometry.translate(0, length * 0.5, 0);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(start);
  mesh.quaternion.setFromUnitVectors(UP, end.clone().sub(start).normalize());
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  return mesh;
}

function createBlobGeometry(rng: () => number): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(1, 2);
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const point = new THREE.Vector3();
  const seed = rng() * 32;
  for (let i = 0; i < position.count; i++) {
    point.fromBufferAttribute(position, i);
    const direction = point.clone().normalize();
    point.multiplyScalar(0.82 + stableSurfaceNoise(direction, seed) * 0.34);
    position.setXYZ(i, point.x, point.y, point.z);
  }
  geometry.computeVertexNormals();
  return geometry;
}

function createConiferForest(
  placements: TreePlacement[],
  terrain: Terrain,
  materials: ForestMaterialSet,
  rng: () => number,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Instanced pine forest';
  if (placements.length === 0) return group;

  const trunkGeometry = new THREE.CylinderGeometry(0.28, 1, 1, 8, 1, false);
  const tierGeometry = createPineTierGeometry();
  const trunkMesh = new THREE.InstancedMesh(trunkGeometry, materials.bark, placements.length);
  const layerCounts = placements.map(() => 7 + Math.floor(rng() * 2));
  const totalLayers = layerCounts.reduce((sum, count) => sum + count, 0);
  const foliageMesh = new THREE.InstancedMesh(tierGeometry, materials.needles[0], totalLayers);
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const scaleVector = new THREE.Vector3();
  const position = new THREE.Vector3();
  const color = new THREE.Color();
  let layerIndex = 0;

  trunkMesh.name = 'Instanced pine trunks';
  trunkMesh.castShadow = true;
  trunkMesh.receiveShadow = true;
  foliageMesh.name = 'Instanced pine needle tiers';
  foliageMesh.castShadow = false;
  foliageMesh.receiveShadow = true;

  placements.forEach((placement, treeIndex) => {
    const rootY = terrain.getHeightAt(placement.x, placement.z);
    const height = (13 + rng() * 5.4) * placement.scale;
    const trunkRadius = (0.26 + rng() * 0.12) * placement.scale;
    const lean = new THREE.Vector3((rng() - 0.5) * 0.055, 1, (rng() - 0.5) * 0.055).normalize();
    const trunkTop = new THREE.Vector3(placement.x, rootY, placement.z).addScaledVector(lean, height);
    composeBranchMatrix(new THREE.Vector3(placement.x, rootY, placement.z), trunkTop, trunkRadius, matrix, quaternion, scaleVector, position);
    trunkMesh.setMatrixAt(treeIndex, matrix);

    const layers = layerCounts[treeIndex];
    const yawOffset = rng() * TAU;
    for (let i = 0; i < layers; i++) {
      const t = i / (layers - 1);
      const whorl = 0.18 + t * 0.75;
      const tierRadius = (3.45 * Math.pow(1 - t, 1.12) + 0.48) * placement.scale * (0.94 + rng() * 0.12);
      const tierHeight = (2.15 * (1 - t * 0.34) + 0.2) * placement.scale;
      const sway = (1 - t) * 0.55;
      position.set(
        placement.x + lean.x * height * whorl + Math.cos(yawOffset + i * 1.74) * sway * rng(),
        rootY + height * whorl,
        placement.z + lean.z * height * whorl + Math.sin(yawOffset + i * 1.74) * sway * rng(),
      );
      quaternion.setFromEuler(new THREE.Euler((rng() - 0.5) * 0.075, yawOffset + i * 0.83, (rng() - 0.5) * 0.075));
      scaleVector.set(tierRadius, tierHeight, tierRadius * (0.9 + rng() * 0.16));
      matrix.compose(position, quaternion, scaleVector);
      foliageMesh.setMatrixAt(layerIndex, matrix);
      color.set(t < 0.45 ? 0x3f6b43 : 0x56784f).offsetHSL((rng() - 0.5) * 0.025, 0, (rng() - 0.5) * 0.05);
      foliageMesh.setColorAt(layerIndex, color);
      layerIndex++;
    }
  });

  trunkMesh.instanceMatrix.needsUpdate = true;
  foliageMesh.instanceMatrix.needsUpdate = true;
  if (foliageMesh.instanceColor) foliageMesh.instanceColor.needsUpdate = true;
  group.add(trunkMesh, foliageMesh);
  return group;
}

function composeBranchMatrix(
  start: THREE.Vector3,
  end: THREE.Vector3,
  radius: number,
  matrix: THREE.Matrix4,
  quaternion: THREE.Quaternion,
  scaleVector: THREE.Vector3,
  position: THREE.Vector3,
): void {
  const direction = end.clone().sub(start);
  const length = direction.length();
  position.copy(start).addScaledVector(direction, 0.5);
  quaternion.setFromUnitVectors(UP, direction.normalize());
  scaleVector.set(radius, length, radius);
  matrix.compose(position, quaternion, scaleVector);
}

function createPineTierGeometry(): THREE.BufferGeometry {
  const arms = 12;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let ring = 0; ring < 2; ring++) {
    for (let i = 0; i < arms; i++) {
      const span = TAU / arms;
      const angle = (i / arms) * TAU + ring * span * 0.5;
      const direction = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
      const bend = stableSurfaceNoise(direction, 10.3 + ring) - 0.5;
      const ringScale = ring === 0 ? 1 : 0.68;
      const outerRadius = (0.9 + stableSurfaceNoise(direction, 16.8 + ring) * 0.16) * ringScale;
      const spread = ring === 0 ? 0.38 : 0.32;
      const leftAngle = angle - span * (spread + stableSurfaceNoise(direction, 22.1 + ring) * 0.08);
      const rightAngle = angle + span * (spread + stableSurfaceNoise(direction, 28.6 + ring) * 0.08);
      const midRadius = outerRadius * (0.56 + stableSurfaceNoise(direction, 32.4 + ring) * 0.06);
      const innerRadius = 0.1 + stableSurfaceNoise(direction, 37.9 + ring) * 0.04;
      const rootY = (ring === 0 ? 0.34 : 0.44) + bend * 0.05;
      const midY = (ring === 0 ? -0.05 : 0.04) - stableSurfaceNoise(direction, 42.7 + ring) * 0.07;
      const tipY = (ring === 0 ? -0.43 : -0.24) - stableSurfaceNoise(direction, 47.5 + ring) * 0.14;
      const base = positions.length / 3;

      positions.push(
        Math.cos(angle) * innerRadius,
        rootY,
        Math.sin(angle) * innerRadius,
        Math.cos(leftAngle) * midRadius,
        midY,
        Math.sin(leftAngle) * midRadius,
        Math.cos(angle + bend * 0.08) * outerRadius,
        tipY,
        Math.sin(angle + bend * 0.08) * outerRadius,
        Math.cos(rightAngle) * midRadius,
        midY,
        Math.sin(rightAngle) * midRadius,
      );
      uvs.push(0.5, 1, 0, 0.42, 0.5, 0, 1, 0.42);
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function createRockField(
  placements: Array<{ x: number; z: number; scale: number }>,
  terrain: Terrain,
  material: THREE.Material,
  rng: () => number,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Instanced mossy boulder field';
  const variants = [createBoulderGeometry(1.3), createBoulderGeometry(7.7), createBoulderGeometry(13.2)];
  const buckets = variants.map(() => [] as Array<{ x: number; z: number; scale: number }>);
  placements.forEach((placement, index) => buckets[index % buckets.length].push(placement));
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scaleVector = new THREE.Vector3();

  buckets.forEach((bucket, variantIndex) => {
    if (bucket.length === 0) return;
    const mesh = new THREE.InstancedMesh(variants[variantIndex], material, bucket.length);
    mesh.name = `Instanced mossy boulders ${variantIndex + 1}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    bucket.forEach((rock, rockIndex) => {
      const y = terrain.getHeightAt(rock.x, rock.z);
      position.set(rock.x, y + rock.scale * 0.18, rock.z);
      quaternion.setFromEuler(new THREE.Euler((rng() - 0.5) * 0.18, rng() * TAU, (rng() - 0.5) * 0.18));
      scaleVector.set(
        rock.scale * (1.08 + rng() * 0.68),
        rock.scale * (0.46 + rng() * 0.28),
        rock.scale * (0.9 + rng() * 0.55),
      );
      matrix.compose(position, quaternion, scaleVector);
      mesh.setMatrixAt(rockIndex, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
  });

  return group;
}

function createBoulderGeometry(seed: number): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(1, 2);
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const uvs: number[] = [];
  const point = new THREE.Vector3();

  for (let i = 0; i < position.count; i++) {
    point.fromBufferAttribute(position, i).normalize();
    const ridge =
      0.82 +
      stableSurfaceNoise(point, seed) * 0.28 +
      Math.sin(point.x * 7.1 + point.z * 3.3 + seed) * 0.06;
    point.multiplyScalar(ridge);
    point.y *= 0.5 + stableSurfaceNoise(point, seed + 4.1) * 0.16;
    if (point.y < -0.24) point.y = THREE.MathUtils.lerp(point.y, -0.28, 0.58);
    position.setXYZ(i, point.x, point.y, point.z);
    uvs.push(Math.atan2(point.z, point.x) / TAU + 0.5, point.y * 0.42 + 0.5);
  }

  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function stableSurfaceNoise(point: THREE.Vector3, seed: number): number {
  const value = Math.sin(point.x * 127.1 + point.y * 311.7 + point.z * 74.7 + seed * 19.19) * 43758.5453123;
  return value - Math.floor(value);
}

function pick<T>(items: T[], rng: () => number): T {
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))];
}

function disposeForestMaterials(materials: ForestMaterialSet): void {
  materials.bark.dispose();
  materials.rock.dispose();
  materials.leaves.forEach((material) => material.dispose());
  materials.needles.forEach((material) => material.dispose());
  materials.textures.forEach((texture) => texture.dispose());
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
