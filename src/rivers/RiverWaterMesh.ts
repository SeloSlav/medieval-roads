import * as THREE from 'three';
import type { Terrain } from '../terrain/Terrain.ts';
import type { RiverField } from './RiverField.ts';
import { VirtualPipesWater2D } from './virtualPipesWater.ts';
import { disposeSharedRiverWaterMaterial, getSharedRiverWaterMaterial } from './RiverWaterMaterial.ts';
import {
  computeWaterFeatherAlpha,
  computeWaterFoamBase,
  createRiverWaterShoreMaps,
  disposeRiverWaterShoreMaps,
} from './riverWaterShoreMaps.ts';

const RIVER_WATER_DEPTH = 1.05;
const RIVER_CENTER_DEPTH_BOOST = 0.2;
const RIVER_SHORE_DEPTH_LIFT = 0.06;
const WATER_SIM_RENDER_DELTA_SCALE = 0.16;
const MAX_SIM_CATCHUP_STEPS = 2;
const WATER_CPU_UPDATE_INTERVAL_SEC = 1 / 20;
const WATER_CLIP_FEATHER = -0.62;

export { disposeSharedRiverWaterMaterial };

export type RiverWaterController = {
  tick: (dt: number, timeSec?: number) => void;
  dispose: () => void;
};

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / Math.max(1e-6, edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function hashNoise2D(x: number, z: number): number {
  const n = Math.sin(x * 127.1 + z * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

function valueNoise2D(x: number, z: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const fx = x - x0;
  const fz = z - z0;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hashNoise2D(x0, z0);
  const b = hashNoise2D(x0 + 1, z0);
  const c = hashNoise2D(x0, z0 + 1);
  const d = hashNoise2D(x0 + 1, z0 + 1);
  const ab = a + (b - a) * ux;
  const cd = c + (d - c) * ux;
  return ab + (cd - ab) * uz;
}

function sampleFloatGridBilinear(values: Float32Array, nx: number, nz: number, gx: number, gz: number): number {
  const x = Math.max(0, Math.min(nx - 1, gx));
  const z = Math.max(0, Math.min(nz - 1, gz));
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const x1 = Math.min(nx - 1, x0 + 1);
  const z1 = Math.min(nz - 1, z0 + 1);
  const tx = x - x0;
  const tz = z - z0;
  const h00 = values[z0 * nx + x0] ?? 0;
  const h10 = values[z0 * nx + x1] ?? h00;
  const h01 = values[z1 * nx + x0] ?? h00;
  const h11 = values[z1 * nx + x1] ?? h10;
  const hx0 = h00 + (h10 - h00) * tx;
  const hx1 = h01 + (h11 - h01) * tx;
  return hx0 + (hx1 - hx0) * tz;
}

function writeWaterConstrainedBoundaryFlows(sim: VirtualPipesWater2D, wetMask: Uint8Array): void {
  const { nx, ny, flowX, flowY } = sim;
  for (let y = 0; y < ny; y++) {
    const rowFX = y * (nx + 1);
    flowX[rowFX] = 0;
    flowX[rowFX + nx] = 0;
    for (let x = 1; x < nx; x++) {
      const leftWet = wetMask[y * nx + (x - 1)] > 0;
      const rightWet = wetMask[y * nx + x] > 0;
      if (!leftWet || !rightWet) flowX[rowFX + x] = 0;
    }
  }
  for (let y = 0; y <= ny; y++) {
    const rowFY = y * nx;
    if (y === 0 || y === ny) {
      for (let x = 0; x < nx; x++) flowY[rowFY + x] = 0;
      continue;
    }
    for (let x = 0; x < nx; x++) {
      const bottomWet = wetMask[(y - 1) * nx + x] > 0;
      const topWet = wetMask[y * nx + x] > 0;
      if (!bottomWet || !topWet) flowY[rowFY + x] = 0;
    }
  }
}

type GridSample = {
  i00: number;
  i10: number;
  i01: number;
  i11: number;
  tx: number;
  tz: number;
  wetCell: number;
};

function buildGridSample(gx: number, gz: number, nx: number, nz: number): GridSample {
  const x = Math.max(0, Math.min(nx - 1, gx));
  const z = Math.max(0, Math.min(nz - 1, gz));
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const x1 = Math.min(nx - 1, x0 + 1);
  const z1 = Math.min(nz - 1, z0 + 1);
  const ix = Math.max(0, Math.min(nx - 1, Math.round(gx)));
  const iz = Math.max(0, Math.min(nz - 1, Math.round(gz)));
  return {
    i00: z0 * nx + x0,
    i10: z0 * nx + x1,
    i01: z1 * nx + x0,
    i11: z1 * nx + x1,
    tx: x - x0,
    tz: z - z0,
    wetCell: iz * nx + ix,
  };
}

function sampleFromGrid(sample: GridSample, values: Float32Array): number {
  const { i00, i10, i01, i11, tx, tz } = sample;
  const h00 = values[i00] ?? 0;
  const h10 = values[i10] ?? h00;
  const h01 = values[i01] ?? h00;
  const h11 = values[i11] ?? h10;
  const hx0 = h00 + (h10 - h00) * tx;
  const hx1 = h01 + (h11 - h01) * tx;
  return hx0 + (hx1 - hx0) * tz;
}

function compactWaterVertices(params: {
  indices: number[];
  vertexGx: number[];
  vertexGz: number[];
  foamBases: number[];
  featherAlphas: number[];
  positions: Float32Array;
  nx: number;
  nz: number;
}): {
  indices: number[];
  gx: Float32Array;
  gz: Float32Array;
  foamBase: Float32Array;
  featherAlpha: Float32Array;
  positions: Float32Array;
  simDelta: Float32Array;
  gridSamples: GridSample[];
} {
  const used = new Set<number>();
  for (const index of params.indices) used.add(index);
  const sorted = Array.from(used).sort((a, b) => a - b);
  const remap = new Map<number, number>();
  sorted.forEach((oldIndex, newIndex) => remap.set(oldIndex, newIndex));

  const count = sorted.length;
  const gx = new Float32Array(count);
  const gz = new Float32Array(count);
  const foamBase = new Float32Array(count);
  const featherAlpha = new Float32Array(count);
  const positions = new Float32Array(count * 3);
  const simDelta = new Float32Array(count);
  const gridSamples = new Array<GridSample>(count);

  for (let newIndex = 0; newIndex < count; newIndex++) {
    const oldIndex = sorted[newIndex];
    const gxValue = params.vertexGx[oldIndex];
    const gzValue = params.vertexGz[oldIndex];
    gx[newIndex] = gxValue;
    gz[newIndex] = gzValue;
    foamBase[newIndex] = params.foamBases[oldIndex];
    featherAlpha[newIndex] = params.featherAlphas[oldIndex];
    positions[newIndex * 3] = params.positions[oldIndex * 3];
    positions[newIndex * 3 + 1] = params.positions[oldIndex * 3 + 1];
    positions[newIndex * 3 + 2] = params.positions[oldIndex * 3 + 2];
    gridSamples[newIndex] = buildGridSample(gxValue, gzValue, params.nx, params.nz);
  }

  return {
    indices: params.indices.map((index) => remap.get(index)!),
    gx,
    gz,
    foamBase,
    featherAlpha,
    positions,
    simDelta,
    gridSamples,
  };
}

type ClipPoint = { gx: number; gz: number; signed: number; index: number };

export function createRiverWaterMesh(
  group: THREE.Group,
  terrain: Terrain,
  riverField: RiverField,
): RiverWaterController | null {
  const nx = riverField.resolution;
  const nz = riverField.resolution;
  if (nx < 2 || nz < 2) return null;

  const shoreMaps = createRiverWaterShoreMaps(riverField);
  const organicSigned = riverField.organicSignedDistance;
  const riverMask = riverField.riverMask;

  const clipSigned = (cellIndex: number, ix: number, iz: number): number => {
    const organic = organicSigned[cellIndex] ?? -1;
    const mask = riverMask[cellIndex] ?? 0;
    if (mask < 0.38) return organic;
    if (organic > 2.8) return organic;
    const wx = riverField.startX + ix * riverField.stepX;
    const wz = riverField.startZ + iz * riverField.stepZ;
    const edgeNoise = (valueNoise2D(wx * 0.17 + 4.2, wz * 0.17 - 2.8) - 0.5) * 0.24;
    const organicShore = organic + edgeNoise * (1 - smoothstep(0, 2.2, organic));
    const interiorFloor = smoothstep(0.38, 0.72, mask) * 0.58;
    return Math.max(organicShore, interiorFloor);
  };

  const effectiveClipSignedAt = (gx: number, gz: number): number => {
    const ix = Math.max(0, Math.min(nx - 1, Math.round(gx)));
    const iz = Math.max(0, Math.min(nz - 1, Math.round(gz)));
    return clipSigned(iz * nx + ix, ix, iz);
  };

  const computeFeatherAlpha = (_gx: number, _gz: number, signed: number): number =>
    computeWaterFeatherAlpha(signed);

  const wetMask = new Uint8Array(nx * nz);
  let hasWet = false;
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const i = iz * nx + ix;
      const wet = riverField.riverMask[i] >= 0.38;
      wetMask[i] = wet ? 1 : 0;
      if (wet) hasWet = true;
    }
  }
  if (!hasWet) return null;

  const sim = new VirtualPipesWater2D({
    nx,
    ny: nz,
    dx: riverField.stepX,
    dy: riverField.stepZ,
    dt: 0.005,
    g: 2.4,
    friction: 0.06,
    viscosity: 0.1,
  });

  const baseDepth = new Float32Array(nx * nz);
  const renderSurfaceBase = new Float32Array(nx * nz);
  const stillSurface = new Float32Array(nx * nz);
  const surfaceScratch = new Float32Array(nx * nz);

  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const i = iz * nx + ix;
      const wx = riverField.startX + ix * riverField.stepX;
      const wz = riverField.startZ + iz * riverField.stepZ;
      const bed = terrain.getHeightAt(wx, wz);
      sim.terrain[i] = bed;
      if (wetMask[i]) {
        const shore = 1 - Math.min(1, Math.max(0, organicSigned[i]) / 6);
        const centerDepth = 1 - shore;
        const depth = RIVER_WATER_DEPTH + shore * RIVER_SHORE_DEPTH_LIFT + centerDepth * RIVER_CENTER_DEPTH_BOOST;
        baseDepth[i] = depth;
        sim.depth[i] = depth;
      } else {
        baseDepth[i] = 0;
        sim.depth[i] = 0;
      }
      stillSurface[i] = sim.terrain[i] + baseDepth[i];
      renderSurfaceBase[i] = stillSurface[i];
    }
  }

  const vertexGx: number[] = [];
  const vertexGz: number[] = [];
  const foamBases: number[] = [];
  const featherAlphas: number[] = [];

  const appendVertex = (
    gx: number,
    gz: number,
    signedOverride?: number,
    foamSignedOverride?: number,
  ): number => {
    const signed =
      signedOverride ??
      sampleFloatGridBilinear(organicSigned, nx, nz, gx, gz);
    const foamSigned =
      foamSignedOverride ??
      signed;
    const foamBase = Math.min(1, computeWaterFoamBase(foamSigned));
    const clipSignedAt = signedOverride ?? effectiveClipSignedAt(gx, gz);
    const index = vertexGx.length;
    vertexGx.push(gx);
    vertexGz.push(gz);
    foamBases.push(Math.min(1, foamBase));
    featherAlphas.push(computeFeatherAlpha(gx, gz, clipSignedAt));
    return index;
  };

  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const i = iz * nx + ix;
      appendVertex(ix, iz, clipSigned(i, ix, iz), organicSigned[i] ?? 0);
    }
  }

  const indices: number[] = [];
  const gridVertexIndex = (ix: number, iz: number): number => iz * nx + ix;

  const makeIntersection = (a: ClipPoint, b: ClipPoint): ClipPoint => {
    const denom = a.signed - b.signed;
    const t =
      denom === 0
        ? 0.5
        : Math.max(0, Math.min(1, (a.signed - WATER_CLIP_FEATHER) / denom));
    const gx = a.gx + (b.gx - a.gx) * t;
    const gz = a.gz + (b.gz - a.gz) * t;
    const organicAt = sampleFloatGridBilinear(organicSigned, nx, nz, gx, gz);
    return {
      gx,
      gz,
      signed: WATER_CLIP_FEATHER,
      index: appendVertex(gx, gz, WATER_CLIP_FEATHER, organicAt),
    };
  };

  const clipWaterPolygon = (input: ClipPoint[]): ClipPoint[] => {
    const output: ClipPoint[] = [];
    for (let i = 0; i < input.length; i++) {
      const current = input[i];
      const next = input[(i + 1) % input.length];
      const currentInside = current.signed >= WATER_CLIP_FEATHER;
      const nextInside = next.signed >= WATER_CLIP_FEATHER;
      if (currentInside && nextInside) {
        output.push(next);
      } else if (currentInside && !nextInside) {
        output.push(makeIntersection(current, next));
      } else if (!currentInside && nextInside) {
        output.push(makeIntersection(current, next), next);
      }
    }
    return output;
  };

  for (let iz = 0; iz < nz - 1; iz++) {
    for (let ix = 0; ix < nx - 1; ix++) {
      const bl = iz * nx + ix;
      const br = iz * nx + ix + 1;
      const tl = (iz + 1) * nx + ix;
      const tr = (iz + 1) * nx + ix + 1;
      const corners: ClipPoint[] = [
        { gx: ix, gz: iz, signed: clipSigned(bl, ix, iz), index: gridVertexIndex(ix, iz) },
        { gx: ix, gz: iz + 1, signed: clipSigned(tl, ix, iz + 1), index: gridVertexIndex(ix, iz + 1) },
        { gx: ix + 1, gz: iz + 1, signed: clipSigned(tr, ix + 1, iz + 1), index: gridVertexIndex(ix + 1, iz + 1) },
        { gx: ix + 1, gz: iz, signed: clipSigned(br, ix + 1, iz), index: gridVertexIndex(ix + 1, iz) },
      ];
      const insideCount = corners.reduce(
        (count, corner) => count + (corner.signed >= WATER_CLIP_FEATHER ? 1 : 0),
        0,
      );
      if (insideCount === 0) continue;
      if (insideCount === 4) {
        indices.push(bl, tl, br, br, tl, tr);
        continue;
      }

      const clipped = clipWaterPolygon(corners);
      if (clipped.length < 3) continue;
      const first = clipped[0].index;
      for (let i = 1; i < clipped.length - 1; i++) {
        indices.push(first, clipped[i].index, clipped[i + 1].index);
      }
    }
  }
  if (indices.length === 0) return null;

  const fullPositions = new Float32Array(vertexGx.length * 3);
  for (let vi = 0; vi < vertexGx.length; vi++) {
    const gx = vertexGx[vi];
    const gz = vertexGz[vi];
    fullPositions[vi * 3] = riverField.startX + gx * riverField.stepX;
    fullPositions[vi * 3 + 1] = sampleFloatGridBilinear(renderSurfaceBase, nx, nz, gx, gz);
    fullPositions[vi * 3 + 2] = riverField.startZ + gz * riverField.stepZ;
  }

  const compact = compactWaterVertices({
    indices,
    vertexGx,
    vertexGz,
    foamBases,
    featherAlphas,
    positions: fullPositions,
    nx,
    nz,
  });

  const geometry = new THREE.BufferGeometry();
  const positionAttr = new THREE.BufferAttribute(compact.positions, 3);
  const foamAttr = new THREE.BufferAttribute(compact.foamBase, 1);
  const featherAttr = new THREE.BufferAttribute(compact.featherAlpha, 1);
  const simDeltaAttr = new THREE.BufferAttribute(compact.simDelta, 1);
  geometry.setAttribute('position', positionAttr);
  geometry.setAttribute('foamBase', foamAttr);
  geometry.setAttribute('featherAlpha', featherAttr);
  geometry.setAttribute('simDelta', simDeltaAttr);
  geometry.setIndex(compact.indices);
  geometry.computeVertexNormals();

  const vertexCount = compact.gx.length;
  const gridSamples = compact.gridSamples;

  const updateSimDelta = () => {
    sim.writeSurfaceHeightsInto(surfaceScratch);
    const simValues = simDeltaAttr.array as Float32Array;
    for (let vi = 0; vi < vertexCount; vi++) {
      const sample = gridSamples[vi];
      if (wetMask[sample.wetCell] === 0) {
        simValues[vi] = 0;
        continue;
      }
      const surface = sampleFromGrid(sample, surfaceScratch);
      const still = sampleFromGrid(sample, stillSurface);
      simValues[vi] = (surface - still) * WATER_SIM_RENDER_DELTA_SCALE;
    }
    simDeltaAttr.needsUpdate = true;
  };

  const mesh = new THREE.Mesh(geometry, getSharedRiverWaterMaterial(shoreMaps));
  mesh.name = 'River water surface';
  mesh.userData.water = true;
  mesh.raycast = () => {};
  mesh.receiveShadow = true;
  mesh.renderOrder = 1.25;
  group.add(mesh);

  updateSimDelta();

  let simAccum = 0;
  let cpuAccum = 0;
  let disposed = false;

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (mesh.parent === group) group.remove(mesh);
    geometry.dispose();
    disposeRiverWaterShoreMaps(shoreMaps);
    disposeSharedRiverWaterMaterial();
  };

  const tick = (dt: number, _timeSec?: number) => {
    if (disposed) return;

    cpuAccum += Math.min(0.1, Math.max(0, dt));
    if (cpuAccum < WATER_CPU_UPDATE_INTERVAL_SEC) return;
    const updateDt = cpuAccum;
    cpuAccum = 0;

    simAccum += Math.min(0.1, Math.max(0, updateDt));
    let steps = 0;
    let stepped = false;
    while (simAccum >= sim.dt && steps < MAX_SIM_CATCHUP_STEPS) {
      writeWaterConstrainedBoundaryFlows(sim, wetMask);
      sim.step();
      writeWaterConstrainedBoundaryFlows(sim, wetMask);
      simAccum -= sim.dt;
      steps++;
      stepped = true;
    }
    if (stepped) updateSimDelta();
  };

  return { tick, dispose };
}
