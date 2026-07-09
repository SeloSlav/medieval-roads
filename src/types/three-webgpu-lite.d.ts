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
  }

  export class RenderPipeline {
    outputNode: unknown;
    constructor(renderer: WebGPURenderer, outputNode?: unknown);
    dispose(): void;
    render(): void;
  }
}
