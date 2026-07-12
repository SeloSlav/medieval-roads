declare module '@seedthree/core/tree.js' {
  import type * as THREE from 'three';

  export function buildTree(
    species: unknown,
    seed: string | number,
    assets?: Record<string, unknown>,
    lodOpts?: Record<string, unknown>,
    reuse?: THREE.LOD | null,
  ): { group: THREE.LOD; stems: unknown[]; tips: unknown[] };

  export function makeBarkMaterial(assets?: Record<string, unknown>): THREE.Material;
  export function forestBarkMaterial(srcMat: THREE.Material): THREE.Material;
}

declare module '@seedthree/core/leaf-cards.js' {
  import type * as THREE from 'three';

  export function makeFoliageMaterial(
    assets: Record<string, unknown>,
    foliage: Record<string, unknown>,
  ): {
    material: THREE.Material;
    centerUniform: { value: THREE.Vector3 };
    tintNode: unknown;
    tintAmount: unknown;
  };
}

declare module '@seedthree/core/branch-cards.js' {
  import type * as THREE from 'three';

  export type BranchCardsSet = {
    variants: Array<{
      geometry: THREE.BufferGeometry;
      material: THREE.Material;
      textures: Record<string, THREE.Texture>;
      chordLen: number;
    }>;
    centerUniform: { value: THREE.Vector3 };
    foliageOnly?: boolean;
  };

  export function forestCardMaterial(srcMat: THREE.Material): THREE.Material;

  export function bakeBranchCards(
    renderer: unknown,
    species: unknown,
    assets: unknown,
    opts?: Record<string, unknown>,
  ): Promise<BranchCardsSet | null>;

  export function disposeBranchCards(cards: {
    byLevel?: Map<string, BranchCardsSet>;
    variants?: BranchCardsSet['variants'];
  }): void;
}

declare module '@seedthree/core/rng.js' {
  export class Rng {
    constructor(seed: string | number);
    next(): number;
    range(min: number, max: number): number;
  }
}

declare module '@seedthree/core/wind.js' {
  import type * as THREE from 'three';

  export const windStrength: { value: number };
  export const windSpeed: { value: number };
  export const WIND_DIR: THREE.Vector3;
  export function grassWindPosition(bladeHeight?: number): unknown;
  export function instancedGrassWindPosition(bladeHeight?: number): unknown;
}

declare module '@seedthree/species/index.js' {
  export const SPECIES: Record<string, Record<string, unknown>>;
  export const DEFAULT_SPECIES: string;
}
