import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { bloom } from 'three/examples/jsm/tsl/display/BloomNode.js';
import { RenderPipeline, type WebGPURenderer } from 'three/webgpu';
import { pass, uv, wgslFn } from 'three/tsl';
import type { RendererBackend } from './RendererBackend.ts';

type Disposable = {
  dispose(): void;
};

type PassNodeLike = Disposable & {
  getTextureNode(name?: string): {
    add(value: unknown): unknown;
  };
};

const DAYLIGHT_GRADE_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    saturation: { value: 1.0 },
    contrast: { value: 1.03 },
    vignette: { value: 0.1 },
  },
  vertexShader: `
    varying vec2 vUv;

    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float saturation;
    uniform float contrast;
    uniform float vignette;
    varying vec2 vUv;

    vec3 adjustSaturation(vec3 color, float amount) {
      float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
      return mix(vec3(luma), color, amount);
    }

    void main() {
      vec3 color = texture2D(tDiffuse, vUv).rgb;
      color = (color - 0.5) * contrast + 0.5;
      color = adjustSaturation(color, saturation);
      color = mix(color, color * vec3(1.03, 1.01, 0.97), 0.18);
      float distanceFromCenter = distance(vUv, vec2(0.5));
      float edge = smoothstep(0.18, 0.78, distanceFromCenter);
      color *= mix(1.0, 1.0 - vignette, edge);
      gl_FragColor = vec4(max(color, vec3(0.0)), 1.0);
    }
  `,
};

const DAYLIGHT_GRADE_WGSL = wgslFn(`
  fn daylightGrade(inputColor: vec4<f32>, frameUv: vec2<f32>) -> vec4<f32> {
    let luma = dot(inputColor.rgb, vec3<f32>(0.2126, 0.7152, 0.0722));
    let saturated = mix(vec3<f32>(luma), inputColor.rgb, 1.0);
    let contrasted = (saturated - vec3<f32>(0.5)) * 1.03 + vec3<f32>(0.5);
    let warmed = mix(contrasted, contrasted * vec3<f32>(1.03, 1.01, 0.97), 0.18);
    let distanceFromCenter = distance(frameUv, vec2<f32>(0.5));
    let edge = smoothstep(0.18, 0.78, distanceFromCenter);
    let graded = warmed * mix(1.0, 0.9, edge);
    return vec4<f32>(max(graded, vec3<f32>(0.0)), inputColor.a);
  }
`);

export type ScenePostProcessor = {
  dispose(): void;
  render(dt: number): void;
  setPixelRatio(pixelRatio: number): void;
  setSize(width: number, height: number): void;
};

export function createPostProcessor(
  backend: RendererBackend,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
): ScenePostProcessor {
  if (backend.kind === 'webgpu') {
    return new WebGPUPostProcessor(backend.renderer as WebGPURenderer, scene, camera);
  }

  return new WebGLPostProcessor(backend.renderer as THREE.WebGLRenderer, scene, camera);
}

class WebGLPostProcessor implements ScenePostProcessor {
  private readonly composer: EffectComposer;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.12, 0.38, 0.82));
    this.composer.addPass(new ShaderPass(DAYLIGHT_GRADE_SHADER));
    this.composer.addPass(new OutputPass());
  }

  dispose(): void {
    this.composer.dispose();
  }

  render(dt: number): void {
    this.composer.render(dt);
  }

  setPixelRatio(pixelRatio: number): void {
    this.composer.setPixelRatio(pixelRatio);
  }

  setSize(width: number, height: number): void {
    this.composer.setSize(width, height);
  }
}

class WebGPUPostProcessor implements ScenePostProcessor {
  private readonly bloomPass: Disposable;
  private readonly pipeline: RenderPipeline;
  private readonly scenePass: PassNodeLike;

  constructor(renderer: WebGPURenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.pipeline = new RenderPipeline(renderer);
    this.scenePass = pass(scene, camera) as PassNodeLike;

    const sceneColor = this.scenePass.getTextureNode('output');
    this.bloomPass = bloom(sceneColor, 0.12, 0.38, 0.82);
    this.pipeline.outputNode = DAYLIGHT_GRADE_WGSL({
      frameUv: uv(),
      inputColor: sceneColor.add(this.bloomPass),
    });
  }

  dispose(): void {
    this.pipeline.dispose();
    this.scenePass.dispose();
    this.bloomPass.dispose();
  }

  render(): void {
    this.pipeline.render();
  }

  setPixelRatio(): void {
    // WebGPU pass nodes size themselves from the renderer drawing buffer each frame.
  }

  setSize(): void {
    // WebGPU pass nodes size themselves from the renderer drawing buffer each frame.
  }
}
