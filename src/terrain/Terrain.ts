import * as THREE from 'three';

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

  constructor(material: THREE.Material) {
    const half = this.playableSize * 0.5;
    this.bounds = { minX: -half, maxX: half, minZ: -half, maxZ: half };
    this.mesh = new THREE.Mesh(this.createGeometry(), material);
    this.mesh.name = 'Continuous terrain heightfield';
    this.mesh.receiveShadow = true;
    this.mesh.userData.terrain = true;
  }

  getHeightAt(x: number, z: number): number {
    const n1 = this.fbm(x * 0.014, z * 0.014, 4) * 5.6;
    const n2 = this.fbm(x * 0.04 + 18.4, z * 0.04 - 9.2, 3) * 1.2;
    const broad = Math.sin(x * 0.012 + z * 0.005) * 1.35 + Math.cos(z * 0.011) * 1.0;
    const basin = -Math.exp(-(x * x + z * z) / 52000) * 1.4;
    return n1 + n2 + broad + basin + this.getEdgeHillHeight(x, z);
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
  }

  private createGeometry(): THREE.BufferGeometry {
    const positions: number[] = [];
    const uvs: number[] = [];
    const colors: number[] = [];
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
        colors.push(...this.getTerrainBlendTint(x, z));
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
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
  }

  private getTerrainBlendTint(x: number, z: number): [number, number, number] {
    const warpX = this.fbm(x * 0.006 + 41.1, z * 0.006 - 17.8, 4) * 22;
    const warpZ = this.fbm(x * 0.006 - 12.5, z * 0.006 + 73.2, 4) * 22;
    const wx = x + warpX;
    const wz = z + warpZ;
    const dirtNoise = this.fbm(wx * 0.019, wz * 0.019, 4) + 0.5;
    const liveNoise = this.fbm(wx * 0.0135 + 101.3, wz * 0.0135 - 55.8, 4) + 0.5;
    const deadNoise = this.fbm(wx * 0.0095 + 31.7, wz * 0.0095 - 19.4, 4) + 0.5;
    const gravelNoise = this.fbm(wx * 0.031 - 47.2, wz * 0.031 + 22.1, 4) + 0.5;
    const hillT = this.getEdgeHillFactor(x, z);
    const rawDirt = this.smoothstep(0.6, 0.84, dirtNoise) + 0.024 + hillT * 0.1;
    const rawDead = this.smoothstep(0.56, 0.82, deadNoise) + 0.03 + hillT * 0.18;
    const rawLive = this.smoothstep(0.14, 0.58, liveNoise) + 0.34 - hillT * 0.14;
    const primarySum = Math.max(rawDirt + rawDead + rawLive, 0.0001);
    const dirtWeight = rawDirt / primarySum;
    const deadWeight = rawDead / primarySum;
    const liveWeight = rawLive / primarySum;
    const gravelOfDirt = this.smoothstep(0.64, 0.86, gravelNoise) * 0.28;
    const gravelWeight = dirtWeight * gravelOfDirt;
    const visibleDirtWeight = dirtWeight * (1 - gravelOfDirt);
    const macro = this.fbm(wx * 0.007 + 8, wz * 0.007 + 29, 4) + 0.5;
    const mottled = this.fbm(wx * 0.034 - 9.5, wz * 0.034 + 4.8, 3) + 0.5;
    const macroMul = 0.88 + macro * 0.18 + mottled * 0.08 - hillT * 0.06;

    const live: [number, number, number] = [0.94, 1.05, 0.87];
    const dead: [number, number, number] = [1.06, 1.0, 0.82];
    const dirt: [number, number, number] = [1.05, 0.91, 0.74];
    const gravel: [number, number, number] = [0.96, 0.96, 0.91];
    return [
      (live[0] * liveWeight + dead[0] * deadWeight + dirt[0] * visibleDirtWeight + gravel[0] * gravelWeight) * macroMul,
      (live[1] * liveWeight + dead[1] * deadWeight + dirt[1] * visibleDirtWeight + gravel[1] * gravelWeight) * macroMul,
      (live[2] * liveWeight + dead[2] * deadWeight + dirt[2] * visibleDirtWeight + gravel[2] * gravelWeight) * macroMul,
    ];
  }

  private getTerrainUv(x: number, z: number): THREE.Vector2 {
    const scale = 42;
    const rotatedX = x * 0.82 - z * 0.57;
    const rotatedZ = x * 0.57 + z * 0.82;
    const warp = this.fbm(x * 0.008 + 13.2, z * 0.008 - 7.4, 3) * 0.36;
    return new THREE.Vector2(rotatedX / scale + warp, rotatedZ / scale - warp * 0.62);
  }

  private getEdgeHillHeight(x: number, z: number): number {
    const t = this.getEdgeHillFactor(x, z);
    if (t <= 0) return 0;

    const ridge = this.fbm(x * 0.0085 + 37.5, z * 0.0085 - 22.4, 5) + 0.5;
    const detail = this.fbm(x * 0.026 - 6.2, z * 0.026 + 9.7, 3) + 0.5;
    const shoulder = t * t * (14 + ridge * 26);
    const crest = t * t * t * t * (14 + detail * 18);
    return shoulder + crest;
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


