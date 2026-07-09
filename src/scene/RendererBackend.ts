import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';

type WebGPUPowerPreference = 'low-power' | 'high-performance';

type NavigatorWithWebGPU = Navigator & {
  gpu?: {
    requestAdapter(options?: { powerPreference?: WebGPUPowerPreference }): Promise<unknown>;
  };
};

type RendererWithBackend = WebGPURenderer & {
  backend: {
    isWebGPUBackend?: boolean;
    isWebGLBackend?: boolean;
  };
};

type ShadowMapWithManualRefresh = THREE.WebGLRenderer['shadowMap'] & {
  autoUpdate?: boolean;
  needsUpdate?: boolean;
};

export type RendererBackendKind = 'webgpu' | 'webgl';
export type SupportedRenderer = THREE.WebGLRenderer | WebGPURenderer;

export type RendererBackend = {
  kind: RendererBackendKind;
  maxAnisotropy: number;
  renderer: SupportedRenderer;
};

const RENDERER_OPTIONS = {
  antialias: true,
  powerPreference: 'high-performance' as const,
};
const WEBGPU_STARTUP_TIMEOUT_MS = 2500;

export async function createPreferredRenderer(): Promise<RendererBackend> {
  if (await canUseWebGPU()) {
    const renderer = new WebGPURenderer({ ...RENDERER_OPTIONS, alpha: true });
    configureRenderer(renderer);

    try {
      await withTimeout(renderer.init(), WEBGPU_STARTUP_TIMEOUT_MS, 'WebGPU renderer initialization');

      if (isNativeWebGPU(renderer)) {
        return {
          kind: 'webgpu',
          maxAnisotropy: renderer.getMaxAnisotropy(),
          renderer,
        };
      }

      console.warn('WebGPU initialization selected Three.js WebGL fallback; using the classic WebGL renderer instead.');
    } catch (error) {
      console.warn('WebGPU renderer initialization failed; falling back to WebGL.', error);
    }

    renderer.dispose();
  }

  const renderer = new THREE.WebGLRenderer(RENDERER_OPTIONS);
  configureRenderer(renderer);

  return {
    kind: 'webgl',
    maxAnisotropy: renderer.capabilities.getMaxAnisotropy(),
    renderer,
  };
}

function configureRenderer(renderer: SupportedRenderer): void {
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setClearColor(0x86bdf1, 1);

  const shadowMap = renderer.shadowMap as ShadowMapWithManualRefresh;
  if ('autoUpdate' in shadowMap) shadowMap.autoUpdate = false;
  if ('needsUpdate' in shadowMap) shadowMap.needsUpdate = true;
}

async function canUseWebGPU(): Promise<boolean> {
  if (typeof navigator === 'undefined') return false;

  const gpu = (navigator as NavigatorWithWebGPU).gpu;
  if (!gpu) return false;

  try {
    return Boolean(
      await withTimeout(
        gpu.requestAdapter({ powerPreference: RENDERER_OPTIONS.powerPreference }),
        WEBGPU_STARTUP_TIMEOUT_MS,
        'WebGPU adapter request',
      ),
    );
  } catch (error) {
    console.warn('WebGPU adapter request failed; falling back to WebGL.', error);
    return false;
  }
}

function isNativeWebGPU(renderer: WebGPURenderer): boolean {
  return (renderer as RendererWithBackend).backend.isWebGPUBackend === true;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms.`)), timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timeout);
        reject(error);
      },
    );
  });
}
