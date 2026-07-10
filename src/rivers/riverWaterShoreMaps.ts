import * as THREE from 'three';
import type { RiverField } from './RiverField.ts';

export const WATER_CLIP_FEATHER = -0.62;
export const WATER_ALPHA_FEATHER_IN = 1.45;

export type RiverWaterShoreMaps = {
  shoreTexture: THREE.DataTexture;
  originX: number;
  originZ: number;
  invSpanX: number;
  invSpanZ: number;
};

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / Math.max(1e-6, edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function computeWaterFeatherAlpha(signed: number): number {
  return smoothstep(
    WATER_CLIP_FEATHER - 0.18,
    WATER_ALPHA_FEATHER_IN + 0.42,
    signed,
  );
}

export function computeWaterFoamBase(foamSigned: number): number {
  return foamSigned >= 0
    ? 1 - smoothstep(0.12, 4.8, foamSigned)
    : 1 - smoothstep(-0.28, 0.14, foamSigned);
}

export function createRiverWaterShoreMaps(riverField: RiverField): RiverWaterShoreMaps {
  const { resolution, startX, startZ, spanX, spanZ, organicSignedDistance } = riverField;
  const data = new Uint8Array(resolution * resolution * 2);

  for (let iz = 0; iz < resolution; iz++) {
    for (let ix = 0; ix < resolution; ix++) {
      const i = iz * resolution + ix;
      const foamSigned = organicSignedDistance[i] ?? 0;
      const feather = computeWaterFeatherAlpha(foamSigned);
      const foamBase = Math.min(1, computeWaterFoamBase(foamSigned));
      const offset = i * 2;
      data[offset] = Math.round(feather * 255);
      data[offset + 1] = Math.round(foamBase * 255);
    }
  }

  const shoreTexture = new THREE.DataTexture(
    data,
    resolution,
    resolution,
    THREE.RGFormat,
    THREE.UnsignedByteType,
  );
  shoreTexture.colorSpace = THREE.NoColorSpace;
  shoreTexture.wrapS = THREE.ClampToEdgeWrapping;
  shoreTexture.wrapT = THREE.ClampToEdgeWrapping;
  shoreTexture.minFilter = THREE.LinearFilter;
  shoreTexture.magFilter = THREE.LinearFilter;
  shoreTexture.generateMipmaps = false;
  shoreTexture.needsUpdate = true;

  return {
    shoreTexture,
    originX: startX,
    originZ: startZ,
    invSpanX: 1 / spanX,
    invSpanZ: 1 / spanZ,
  };
}

export function disposeRiverWaterShoreMaps(maps: RiverWaterShoreMaps): void {
  maps.shoreTexture.dispose();
}
