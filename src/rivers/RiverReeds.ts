import * as THREE from 'three';
import type { Terrain } from '../terrain/Terrain.ts';
import type { RiverField } from './RiverField.ts';

const REED_DENSITY = 0.72;

type ShoreNode = {
  x: number;
  z: number;
  outwardX: number;
  outwardZ: number;
};

export type RiverReedInstances = {
  group: THREE.Group;
  mesh: THREE.InstancedMesh;
  dispose: () => void;
};

export function createRiverReeds(
  terrain: Terrain,
  riverField: RiverField,
  rng: () => number,
): RiverReedInstances {
  const shoreNodes = collectShoreNodes(riverField);
  const placements: Array<{ x: number; z: number; scale: number; yaw: number }> = [];

  for (const node of shoreNodes) {
    if (rng() > REED_DENSITY) continue;
    const count = 2 + Math.floor(rng() * 4);
    const tangentX = -node.outwardZ;
    const tangentZ = node.outwardX;

    for (let i = 0; i < count; i++) {
      const along = (rng() - 0.5) * 1.8;
      const outward = 0.35 + rng() * 2.4;
      placements.push({
        x: node.x + tangentX * along + node.outwardX * outward,
        z: node.z + tangentZ * along + node.outwardZ * outward,
        scale: 0.55 + rng() * 0.95,
        yaw: rng() * Math.PI,
      });
    }
  }

  const geometry = createReedGeometry();
  const material = new THREE.MeshStandardMaterial({
    color: 0x7a8f52,
    roughness: 0.94,
    metalness: 0,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.InstancedMesh(geometry, material, placements.length);
  mesh.name = 'River reeds';
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scaleVector = new THREE.Vector3();
  const color = new THREE.Color();

  placements.forEach((placement, index) => {
    const y = terrain.getHeightAt(placement.x, placement.z);
    position.set(placement.x, y + 0.02, placement.z);
    quaternion.setFromEuler(new THREE.Euler((rng() - 0.5) * 0.12, placement.yaw, (rng() - 0.5) * 0.1));
    scaleVector.set(0.08 + placement.scale * 0.04, placement.scale, 0.08 + placement.scale * 0.04);
    matrix.compose(position, quaternion, scaleVector);
    mesh.setMatrixAt(index, matrix);
    color.setHSL(0.24 + (rng() - 0.5) * 0.03, 0.38 + rng() * 0.12, 0.34 + rng() * 0.1);
    mesh.setColorAt(index, color);
  });

  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  const group = new THREE.Group();
  group.name = 'River reeds';
  group.add(mesh);

  return {
    group,
    mesh,
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}

function collectShoreNodes(riverField: RiverField): ShoreNode[] {
  const { resolution, startX, startZ, stepX, stepZ } = riverField;
  const nodes: ShoreNode[] = [];

  for (let iz = 0; iz < resolution; iz++) {
    for (let ix = 0; ix < resolution; ix++) {
      if (riverField.isRenderedWetAtGrid(ix, iz)) continue;

      let outwardX = 0;
      let outwardZ = 0;
      let wetNeighbors = 0;
      const neighborDirs: Array<[number, number, number, number]> = [
        [1, 0, -1, 0],
        [-1, 0, 1, 0],
        [0, 1, 0, -1],
        [0, -1, 0, 1],
      ];

      for (const [dx, dz, ox, oz] of neighborDirs) {
        if (!riverField.isRenderedWetAtGrid(ix + dx, iz + dz)) continue;
        outwardX += ox;
        outwardZ += oz;
        wetNeighbors += 1;
      }
      if (wetNeighbors === 0) continue;

      const len = Math.hypot(outwardX, outwardZ) || 1;
      nodes.push({
        x: startX + ix * stepX,
        z: startZ + iz * stepZ,
        outwardX: outwardX / len,
        outwardZ: outwardZ / len,
      });
    }
  }

  return nodes;
}

function createReedGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const blades = 2;

  for (let blade = 0; blade < blades; blade++) {
    const angle = (blade / blades) * Math.PI;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const base = positions.length / 3;

    positions.push(0, 0, 0, cos * 0.06, 0.42, sin * 0.06, cos * 0.1, 0.88, sin * 0.1);
    normals.push(0, 1, 0, 0, 0.8, 0, 0, 0.65, 0);
    indices.push(base, base + 1, base + 2);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.computeBoundingSphere();
  return geometry;
}
