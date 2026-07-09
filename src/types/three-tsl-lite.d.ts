declare module 'three/tsl' {
  import type * as THREE from 'three';

  export const cameraPosition: unknown;
  export const positionWorld: unknown;

  export function pass(
    scene: THREE.Object3D,
    camera: THREE.Camera,
  ): {
    dispose(): void;
    getTextureNode(name?: string): {
      add(value: unknown): unknown;
    };
  };

  export function uniform<T>(value: T): { value: T };
  export function uv(): unknown;
  export function wgslFn(code: string, includes?: unknown[]): (params: Record<string, unknown>) => unknown;
}
