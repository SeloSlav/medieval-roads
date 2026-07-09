declare module 'sky-cloud-3d' {
  import type { Camera, Mesh, Vector3 } from 'three';

  export class SkyCloudMesh extends Mesh {
    isSkyCloudMesh: boolean;
    ready: Promise<SkyCloudMesh>;
    constructor(options?: Record<string, unknown>);
    updateCamera(camera: Camera): void;
    updateResolution(width: number, height: number): void;
    updateSun(direction: Vector3): void;
    updateTime(time: number): void;
    dispose(): void;
  }
}

declare module 'sky-cloud-3d/webgl' {
  import type { Mesh, Vector3 } from 'three';

  export class SkyCloudMesh extends Mesh {
    isSkyCloudMesh: boolean;
    ready?: Promise<SkyCloudMesh>;
    constructor(options?: Record<string, unknown>);
    updateResolution?(width: number, height: number): void;
    updateSun(direction: Vector3): void;
    updateTime(time: number): void;
    dispose?(): void;
  }
}
