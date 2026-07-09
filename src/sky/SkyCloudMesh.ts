import * as THREE from 'three';
import { SkyCloudMesh as WebGPUSkyCloudMesh } from 'sky-cloud-3d';
import { SkyCloudMesh as WebGLSkyCloudMesh } from 'sky-cloud-3d/webgl';
import type { RendererBackendKind } from '../scene/RendererBackend.ts';

type SkyCloudOptions = {
  cloudAbsorption?: number;
  cloudCoverage?: number;
  cloudHeight?: number;
  cloudThickness?: number;
  hazeStrength?: number;
  maxCloudDistance?: number;
  mieCoefficient?: number;
  mieDirectionalG?: number;
  radius?: number;
  rayleigh?: number;
  rendererBackend?: RendererBackendKind;
  sunDirection?: THREE.Vector3;
  turbidity?: number;
  windSpeedX?: number;
  windSpeedZ?: number;
  width?: number;
  height?: number;
  widthSegments?: number;
  heightSegments?: number;
};

type SkyCloudNativeMesh = THREE.Mesh & {
  isSkyCloudMesh?: boolean;
  ready?: Promise<unknown>;
  dispose?: () => void;
  updateCamera?: (camera: THREE.Camera) => void;
  updateResolution?: (width: number, height: number) => void;
  updateSun?: (direction: THREE.Vector3) => void;
  updateTime?: (time: number) => void;
};

const DEFAULTS = {
  cloudAbsorption: 0.34,
  cloudCoverage: 0.47,
  cloudHeight: 150,
  cloudThickness: 92,
  hazeStrength: 0.24,
  maxCloudDistance: 4200,
  mieCoefficient: 0.0028,
  mieDirectionalG: 0.48,
  radius: 1100,
  rayleigh: 0.42,
  turbidity: 1.85,
  windSpeedX: 0.22,
  windSpeedZ: 0.14,
  width: 1280,
  height: 720,
  widthSegments: 56,
  heightSegments: 28,
};

const WEBGL_PERLIN_TEXTURE_URL = new URL('../../vendor/sky-cloud-3d/perlin256.png', import.meta.url).href;

/**
 * Thin app wrapper around the actual sky-cloud-3d volumetric package.
 * WebGPU uses the package's TSL/NodeMaterial path; WebGL uses its shader fallback.
 */
export class SkyCloudMesh extends THREE.Group {
  readonly isSkyCloudMesh = true;
  readonly ready: Promise<SkyCloudMesh>;
  private readonly nativeSky: SkyCloudNativeMesh;

  constructor(options: SkyCloudOptions = {}) {
    super();
    const config = { ...DEFAULTS, ...options };
    const rendererBackend = config.rendererBackend ?? 'webgl';
    const NativeSky = rendererBackend === 'webgpu' ? WebGPUSkyCloudMesh : WebGLSkyCloudMesh;
    const nativeOptions = {
      ...config,
      perlinTextureUrl: WEBGL_PERLIN_TEXTURE_URL,
    };
    const nativeSky = new NativeSky(nativeOptions) as SkyCloudNativeMesh;
    nativeSky.name = rendererBackend === 'webgpu' ? 'sky-cloud-3d WebGPU volumetric sky' : 'sky-cloud-3d WebGL volumetric sky';
    nativeSky.renderOrder = -1000;
    nativeSky.frustumCulled = false;
    nativeSky.userData.isSkyCloudMesh = true;

    this.name = nativeSky.name;
    this.nativeSky = nativeSky;
    this.add(nativeSky);
    this.ready = Promise.resolve(nativeSky.ready).then(() => this);

    if (options.sunDirection) this.updateSun(options.sunDirection);
  }

  updateSun(direction: THREE.Vector3): void {
    this.nativeSky.updateSun?.(direction);
  }

  updateTime(time: number): void {
    this.nativeSky.updateTime?.(time);
  }

  updateResolution(width: number, height: number): void {
    this.nativeSky.updateResolution?.(width, height);
  }

  updateCamera(camera: THREE.Camera): void {
    if (this.nativeSky.updateCamera) {
      this.nativeSky.updateCamera(camera);
      return;
    }

    this.nativeSky.position.copy(camera.position);
  }

  dispose(): void {
    this.nativeSky.removeFromParent();
    disposeSky(this.nativeSky);
  }
}

function disposeSky(sky: SkyCloudNativeMesh): void {
  if (typeof sky.dispose === 'function') {
    sky.dispose();
    return;
  }

  sky.geometry?.dispose();
  const materials = Array.isArray(sky.material) ? sky.material : [sky.material];
  for (const material of materials) {
    material?.dispose();
  }
}
