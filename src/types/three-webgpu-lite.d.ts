declare module 'three/webgpu' {
  import type * as THREE from 'three';

  export type WebGPURendererParameters = {
    alpha?: boolean;
    antialias?: boolean;
    forceWebGL?: boolean;
    powerPreference?: 'low-power' | 'high-performance';
  };

  export class WebGPURenderer {
    readonly domElement: HTMLCanvasElement;
    readonly isWebGPURenderer: true;
    backend: {
      isWebGPUBackend?: boolean;
      isWebGLBackend?: boolean;
    };
    info: THREE.WebGLRenderer['info'];
    outputColorSpace: string;
    shadowMap: THREE.WebGLRenderer['shadowMap'] & {
      transmitted?: boolean;
    };
    toneMapping: THREE.ToneMapping;
    toneMappingExposure: number;

    constructor(parameters?: WebGPURendererParameters);
    dispose(): void;
    getMaxAnisotropy(): number;
    getPixelRatio(): number;
    init(): Promise<this>;
    render(scene: THREE.Object3D, camera: THREE.Camera): void;
    setClearColor(color: THREE.ColorRepresentation, alpha?: number): void;
    setPixelRatio(value?: number): void;
    setSize(width: number, height: number, updateStyle?: boolean): void;
  }

  export class NodeMaterial extends THREE.Material {
    fragmentNode: unknown;
    colorNode: unknown;
    normalNode: unknown;
    roughnessNode: unknown;
    aoNode: unknown;
    opacityNode: unknown;
    positionNode: unknown;
  }

  export class MeshStandardNodeMaterial extends NodeMaterial {
    color: THREE.Color;
    metalness: number;
    roughness: number;
    transparent: boolean;
    opacity: number;
    depthWrite: boolean;
    alphaMap: THREE.Texture | null;
  }

  export class RenderPipeline {
    outputNode: unknown;
    constructor(renderer: WebGPURenderer, outputNode?: unknown);
    dispose(): void;
    render(): void;
  }
}

declare module 'three/tsl' {
  type TslNode = unknown;
  export const float: (value?: number) => TslNode;
  export const mix: (a: TslNode, b: TslNode, t: TslNode) => TslNode;
  export const pow: (base: TslNode, exponent: TslNode) => TslNode;
  export const smoothstep: (edge0: TslNode, edge1: TslNode, value: TslNode) => TslNode;
  export const texture: (map: import('three').Texture, uv?: TslNode) => TslNode;
  export const uv: () => TslNode;
  export const vec3: (...values: Array<number | TslNode>) => TslNode;
  export const normalMap: (sample: TslNode) => TslNode;
  export const vertexColor: () => TslNode;
  export const attribute: (name: string, type: string) => TslNode;
  export const positionLocal: TslNode;
  export const time: TslNode;
  export const hash: (seed: TslNode) => TslNode;
  export const sin: (value: TslNode) => TslNode;
  export const min: (a: TslNode, b: TslNode) => TslNode;
  export const max: (a: TslNode, b: TslNode) => TslNode;
  export const cameraPosition: TslNode;
  export const positionWorld: TslNode;
  export const distance: (a: TslNode, b: TslNode) => TslNode;
  export const sub: (a: TslNode, b: TslNode) => TslNode;
}
