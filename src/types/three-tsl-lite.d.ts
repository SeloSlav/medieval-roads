declare module 'three/tsl' {
  import type * as THREE from 'three';

  export const abs: (value: unknown) => unknown;
  export const cameraPosition: unknown;
  export const dot: (a: unknown, b: unknown) => unknown;
  export const normalView: unknown;
  export const normalize: (value: unknown) => unknown;
  export const positionWorld: unknown;
  export const screenUV: unknown;
  export const sub: (a: unknown, b: unknown) => unknown;
  export const viewportSafeUV: (uv?: unknown) => unknown;
  export const viewportSharedTexture: (uv?: unknown) => unknown;

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
  export function sub(a: unknown, b: unknown): unknown;
  export function texture(texture: THREE.Texture, uvNode?: unknown): unknown;
  export function attribute(name: string, type: string): unknown;
  export function vertexColor(index?: number): unknown;
  export function normalMap(node: unknown, scaleNode?: unknown): unknown;
  export function float(value: number): unknown;
  export function max(a: unknown, b: unknown): unknown;
  export function mix(a: unknown, b: unknown, t: unknown): unknown;
  export function vec2(x: unknown, y?: unknown): unknown;
  export function vec3(x: unknown, y?: unknown, z?: unknown): unknown;
  export const fwidth: (value: unknown) => unknown;
}
