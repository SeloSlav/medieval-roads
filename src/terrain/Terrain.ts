import * as THREE from 'three';
import type { RiverField } from '../rivers/RiverField.ts';
import type { QuarryLayout } from '../quarries/QuarryLayout.ts';
import { sampleBaseTerrainHeight } from './TerrainHeight.ts';
import { sampleTerrainMeshHeight } from './TerrainMeshHeight.ts';
import { yieldToMain } from '../utils/yieldToMain.ts';

export type TerrainBounds = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

const TERRAIN_ROWS_PER_YIELD = 40;

export class Terrain {
  readonly size = 1080;
  readonly playableSize = 820;
  readonly resolution = 769;
  readonly bounds: TerrainBounds;
  readonly mesh: THREE.Mesh;
  private dirtZoomGateAttr!: THREE.BufferAttribute;

  static fullBounds(size = 1080): TerrainBounds {
    const half = size * 0.5;
    return { minX: -half, maxX: half, minZ: -half, maxZ: half };
  }

  static async create(
    material: THREE.Material,
    riverField?: RiverField,
    quarryLayout?: QuarryLayout,
    onProgress?: (completedRows: number, totalRows: number) => void,
  ): Promise<Terrain> {
    const geometry = await Terrain.buildGeometryAsync(riverField, quarryLayout, onProgress);
    return new Terrain(material, geometry);
  }

  private constructor(material: THREE.Material, geometry: THREE.BufferGeometry) {
    const half = this.playableSize * 0.5;
    this.bounds = { minX: -half, maxX: half, minZ: -half, maxZ: half };
    this.dirtZoomGateAttr = geometry.getAttribute('dirtZoomGate') as THREE.BufferAttribute;
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = 'Continuous terrain heightfield';
    this.mesh.receiveShadow = true;
    this.mesh.userData.terrain = true;
  }

  getHeightAt(x: number, z: number): number {
    return sampleTerrainMeshHeight(this.mesh.geometry, x, z, this.resolution, this.size);
  }

  getPointAt(x: number, z: number, offset = 0): THREE.Vector3 {
    return new THREE.Vector3(x, this.getHeightAt(x, z) + offset, z);
  }

  getPointAtInto(x: number, z: number, target: THREE.Vector3, offset = 0): THREE.Vector3 {
    return target.set(x, this.getHeightAt(x, z) + offset, z);
  }

  clampXZ(x: number, z: number): { x: number; z: number } {
    return {
      x: THREE.MathUtils.clamp(x, this.bounds.minX, this.bounds.maxX),
      z: THREE.MathUtils.clamp(z, this.bounds.minZ, this.bounds.maxZ),
    };
  }

  setDirtZoomGate(value: number): void {
    const array = this.dirtZoomGateAttr.array as Float32Array;
    array.fill(value);
    this.dirtZoomGateAttr.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    const { material } = this.mesh;
    if (Array.isArray(material)) {
      for (const entry of material) entry.dispose();
    } else {
      material.dispose();
    }
  }

  private static async buildGeometryAsync(
    riverField: RiverField | undefined,
    quarryLayout: QuarryLayout | undefined,
    onProgress?: (completedRows: number, totalRows: number) => void,
  ): Promise<THREE.BufferGeometry> {
    const resolution = 769;
    const size = 1080;
    const vertexCount = resolution * resolution;
    const positions = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    const colors = new Float32Array(vertexCount * 3);
    const shoreBlends = new Float32Array(vertexCount);
    const roadWearBlends = new Float32Array(vertexCount);
    const quarryPadBlends = new Float32Array(vertexCount);
    const dirtZoomGates = new Float32Array(vertexCount);
    const step = size / (resolution - 1);
    const half = size * 0.5;
    const builder = new TerrainVertexBuilder();

    for (let zIndex = 0; zIndex < resolution; zIndex++) {
      const rowOffset = zIndex * resolution;
      for (let xIndex = 0; xIndex < resolution; xIndex++) {
        const vertexIndex = rowOffset + xIndex;
        const x = -half + xIndex * step;
        const z = -half + zIndex * step;
        const positionOffset = vertexIndex * 3;
        positions[positionOffset] = x;
        positions[positionOffset + 1] = sampleBaseTerrainHeight(x, z);
        positions[positionOffset + 2] = z;

        const uv = builder.getTerrainUv(x, z);
        const uvOffset = vertexIndex * 2;
        uvs[uvOffset] = uv[0];
        uvs[uvOffset + 1] = uv[1];

        const weights = builder.getTerrainBlendWeights(x, z);
        const colorOffset = vertexIndex * 3;
        colors[colorOffset] = weights[0];
        colors[colorOffset + 1] = weights[1];
        colors[colorOffset + 2] = weights[2];

        shoreBlends[vertexIndex] = riverField?.sampleMudBlendAt(x, z) ?? 0;
        roadWearBlends[vertexIndex] = 0;
        quarryPadBlends[vertexIndex] = quarryLayout?.getPadBlend(x, z) ?? 0;
        dirtZoomGates[vertexIndex] = 0;
      }

      onProgress?.(zIndex + 1, resolution);
      if ((zIndex + 1) % TERRAIN_ROWS_PER_YIELD === 0) {
        await yieldToMain();
      }
    }

    const quadCount = (resolution - 1) * (resolution - 1);
    const indices = new Uint32Array(quadCount * 6);
    let indexOffset = 0;
    for (let zIndex = 0; zIndex < resolution - 1; zIndex++) {
      for (let xIndex = 0; xIndex < resolution - 1; xIndex++) {
        const a = zIndex * resolution + xIndex;
        const b = a + 1;
        const c = a + resolution;
        const d = c + 1;
        indices[indexOffset++] = a;
        indices[indexOffset++] = c;
        indices[indexOffset++] = b;
        indices[indexOffset++] = b;
        indices[indexOffset++] = c;
        indices[indexOffset++] = d;
      }
    }

    await yieldToMain();

    const geometry = new THREE.BufferGeometry();
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setAttribute('uv2', new THREE.BufferAttribute(uvs, 2));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('shoreBlend', new THREE.BufferAttribute(shoreBlends, 1));
    geometry.setAttribute('roadWearBlend', new THREE.BufferAttribute(roadWearBlends, 1));
    geometry.setAttribute('quarryPadBlend', new THREE.BufferAttribute(quarryPadBlends, 1));
    geometry.setAttribute('dirtZoomGate', new THREE.BufferAttribute(dirtZoomGates, 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
  }
}

class TerrainVertexBuilder {
  getTerrainBlendWeights(x: number, z: number): [number, number, number] {
    const warpX = this.fbm(x * 0.006 + 41.1, z * 0.006 - 17.8, 4) * 22;
    const warpZ = this.fbm(x * 0.006 - 12.5, z * 0.006 + 73.2, 4) * 22;
    const wx = x + warpX;
    const wz = z + warpZ;
    const meadowNoise = this.fbm(wx * 0.011 + 101.3, wz * 0.011 - 55.8, 4) + 0.5;
    const denseNoise = this.fbm(wx * 0.015, wz * 0.015, 4) + 0.5;
    const dryNoise = this.fbm(wx * 0.0075 + 31.7, wz * 0.0075 - 19.4, 4) + 0.5;
    const hillT = this.getEdgeHillFactor(x, z);
    const rawMeadow = this.smoothstep(0.08, 0.54, meadowNoise) + 0.52 - hillT * 0.14;
    const rawDense = this.smoothstep(0.72, 0.94, denseNoise) * 0.38 + 0.1 + hillT * 0.26;
    const rawDry = this.smoothstep(0.72, 0.94, dryNoise) * 0.3 + 0.14 + hillT * 0.12;
    const sum = Math.max(rawMeadow + rawDense + rawDry, 0.0001);
    return [rawMeadow / sum, rawDense / sum, rawDry / sum];
  }

  getTerrainUv(x: number, z: number): [number, number] {
    const scale = 48;
    const rotatedX = x * 0.67 - z * 0.74;
    const rotatedZ = x * 0.74 + z * 0.67;
    const warpX = this.fbm(x * 0.0048 + 13.2, z * 0.0048 - 7.4, 4) * 0.38 + this.fbm(x * 0.018 - 71.5, z * 0.018 + 19.8, 3) * 0.055;
    const warpZ = this.fbm(x * 0.0053 - 28.6, z * 0.0053 + 44.1, 4) * 0.38 + this.fbm(x * 0.016 + 53.7, z * 0.016 - 38.2, 3) * 0.055;
    return [rotatedX / scale + warpX, rotatedZ / (scale * 1.17) + warpZ];
  }

  private getEdgeHillFactor(x: number, z: number): number {
    const edgeDistance = Math.max(Math.abs(x), Math.abs(z));
    const hillStart = 820 * 0.44;
    const hillEnd = 1080 * 0.5;
    return this.smoothstep(hillStart, hillEnd, edgeDistance);
  }

  private smoothstep(edge0: number, edge1: number, value: number): number {
    const t = THREE.MathUtils.clamp((value - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  private fbm(x: number, z: number, octaves: number): number {
    let value = 0;
    let amplitude = 0.5;
    let frequency = 1;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      value += this.valueNoise(x * frequency, z * frequency) * amplitude;
      norm += amplitude;
      amplitude *= 0.5;
      frequency *= 2;
    }
    return value / norm - 0.5;
  }

  private valueNoise(x: number, z: number): number {
    const x0 = Math.floor(x);
    const z0 = Math.floor(z);
    const tx = x - x0;
    const tz = z - z0;
    const sx = tx * tx * (3 - 2 * tx);
    const sz = tz * tz * (3 - 2 * tz);
    const a = this.hash(x0, z0);
    const b = this.hash(x0 + 1, z0);
    const c = this.hash(x0, z0 + 1);
    const d = this.hash(x0 + 1, z0 + 1);
    return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, sx), THREE.MathUtils.lerp(c, d, sx), sz);
  }

  private hash(x: number, z: number): number {
    const n = Math.sin(x * 127.1 + z * 311.7) * 43758.5453123;
    return n - Math.floor(n);
  }
}
