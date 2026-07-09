import * as THREE from 'three';
import type { RiverField } from '../rivers/RiverField.ts';
import { sampleBaseTerrainHeight } from './TerrainHeight.ts';

export type TerrainBounds = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

export class Terrain {
  readonly size = 1080;
  readonly playableSize = 820;
  readonly resolution = 385;
  readonly bounds: TerrainBounds;
  readonly mesh: THREE.Mesh;

  static fullBounds(size = 1080): TerrainBounds {
    const half = size * 0.5;
    return { minX: -half, maxX: half, minZ: -half, maxZ: half };
  }

  constructor(material: THREE.Material, riverField?: RiverField) {
    const half = this.playableSize * 0.5;
    this.bounds = { minX: -half, maxX: half, minZ: -half, maxZ: half };
    this.mesh = new THREE.Mesh(this.createGeometry(riverField), material);
    this.mesh.name = 'Continuous terrain heightfield';
    this.mesh.receiveShadow = true;
    this.mesh.userData.terrain = true;
  }

  getHeightAt(x: number, z: number): number {
    return sampleBaseTerrainHeight(x, z);
  }

  getPointAt(x: number, z: number, offset = 0): THREE.Vector3 {
    return new THREE.Vector3(x, this.getHeightAt(x, z) + offset, z);
  }

  clampXZ(x: number, z: number): { x: number; z: number } {
    return {
      x: THREE.MathUtils.clamp(x, this.bounds.minX, this.bounds.maxX),
      z: THREE.MathUtils.clamp(z, this.bounds.minZ, this.bounds.maxZ),
    };
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

  private createGeometry(riverField?: RiverField): THREE.BufferGeometry {
    const positions: number[] = [];
    const uvs: number[] = [];
    const colors: number[] = [];
    const shoreBlends: number[] = [];
    const roadWearBlends: number[] = [];
    const indices: number[] = [];
    const step = this.size / (this.resolution - 1);
    const half = this.size * 0.5;

    for (let zIndex = 0; zIndex < this.resolution; zIndex++) {
      for (let xIndex = 0; xIndex < this.resolution; xIndex++) {
        const x = -half + xIndex * step;
        const z = -half + zIndex * step;
        positions.push(x, this.getHeightAt(x, z), z);
        const uv = this.getTerrainUv(x, z);
        uvs.push(uv.x, uv.y);
        colors.push(...this.getTerrainBlendWeights(x, z));
        shoreBlends.push(riverField?.sampleMudBlendAt(x, z) ?? 0);
        roadWearBlends.push(0);
      }
    }

    for (let zIndex = 0; zIndex < this.resolution - 1; zIndex++) {
      for (let xIndex = 0; xIndex < this.resolution - 1; xIndex++) {
        const a = zIndex * this.resolution + xIndex;
        const b = a + 1;
        const c = a + this.resolution;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setIndex(indices);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('uv2', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute('shoreBlend', new THREE.Float32BufferAttribute(shoreBlends, 1));
    geometry.setAttribute('roadWearBlend', new THREE.Float32BufferAttribute(roadWearBlends, 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
  }

  private getTerrainBlendWeights(x: number, z: number): [number, number, number] {
    // Vertex color channels are blend weights, not tints: R=meadow, G=dense, B=dry.
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

  private getTerrainUv(x: number, z: number): THREE.Vector2 {
    const scale = 48;
    const rotatedX = x * 0.67 - z * 0.74;
    const rotatedZ = x * 0.74 + z * 0.67;
    const warpX = this.fbm(x * 0.0048 + 13.2, z * 0.0048 - 7.4, 4) * 0.38 + this.fbm(x * 0.018 - 71.5, z * 0.018 + 19.8, 3) * 0.055;
    const warpZ = this.fbm(x * 0.0053 - 28.6, z * 0.0053 + 44.1, 4) * 0.38 + this.fbm(x * 0.016 + 53.7, z * 0.016 - 38.2, 3) * 0.055;
    return new THREE.Vector2(rotatedX / scale + warpX, rotatedZ / (scale * 1.17) + warpZ);
  }

  private getEdgeHillFactor(x: number, z: number): number {
    const edgeDistance = Math.max(Math.abs(x), Math.abs(z));
    const hillStart = this.playableSize * 0.44;
    const hillEnd = this.size * 0.5;
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
