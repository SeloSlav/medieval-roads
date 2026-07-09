import * as THREE from 'three';
import { createForestProps } from '../props/ForestProps.ts';
import type { RoadEdge } from '../roads/RoadEdge.ts';
import { RoadJunctionBuilder } from '../roads/RoadJunctionBuilder.ts';
import { RoadMaterialFactory } from '../roads/RoadMaterialFactory.ts';
import { RoadMeshBuilder } from '../roads/RoadMeshBuilder.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import { SkyCloudMesh } from '../sky/SkyCloudMesh.ts';
import { Terrain } from '../terrain/Terrain.ts';
import { TerrainProjector } from '../terrain/TerrainProjector.ts';
import { disposeObject3D } from '../utils/dispose.ts';
import { createPostProcessor, type ScenePostProcessor } from './PostProcessing.ts';
import { createPreferredRenderer, type RendererBackend, type RendererBackendKind, type SupportedRenderer } from './RendererBackend.ts';

export class SceneManager {
  private readonly container: HTMLElement;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: SupportedRenderer;
  readonly rendererBackend: RendererBackendKind;
  readonly postProcessor: ScenePostProcessor;
  readonly cameraTarget = new THREE.Vector3();
  readonly terrain: Terrain;
  readonly terrainProjector: TerrainProjector;
  readonly materials: RoadMaterialFactory;
  readonly roadMeshBuilder: RoadMeshBuilder;
  readonly previewGroup = new THREE.Group();
  readonly selectionGroup = new THREE.Group();
  private readonly sky: SkyCloudMesh;
  private readonly sunDirection = new THREE.Vector3();
  private readonly forestGroup: THREE.Group;
  private readonly roadGroup = new THREE.Group();
  private readonly junctionGroup = new THREE.Group();
  private readonly edgeVisuals = new Map<string, { revision: number; group: THREE.Group }>();

  private constructor(container: HTMLElement, backend: RendererBackend, materials: RoadMaterialFactory) {
    this.container = container;
    this.renderer = backend.renderer;
    this.rendererBackend = backend.kind;
    this.materials = materials;
    this.scene = new THREE.Scene();
    this.scene.background = null;
    this.scene.fog = new THREE.FogExp2(0xc8def1, 0.00082);
    this.camera = new THREE.PerspectiveCamera(54, 1, 0.1, 2600);
    this.sunDirection.setFromSphericalCoords(1, THREE.MathUtils.degToRad(43), THREE.MathUtils.degToRad(225));
    this.terrain = new Terrain(materials.terrain);
    this.terrainProjector = new TerrainProjector(this.terrain, this.camera, this.renderer.domElement);
    this.roadMeshBuilder = new RoadMeshBuilder(this.terrain, materials);
    this.sky = new SkyCloudMesh({
      sunDirection: this.sunDirection,
      cloudCoverage: 0.3,
      cloudHeight: 185,
      cloudThickness: 54,
      cloudAbsorption: 0.42,
      hazeStrength: 0.07,
      maxCloudDistance: 6200,
      radius: 1900,
      rayleigh: 0.62,
      turbidity: 1.2,
      windSpeedX: 0.12,
      windSpeedZ: 0.07,
      widthSegments: 56,
      heightSegments: 28,
      rendererBackend: backend.kind,
    });
    this.forestGroup = createForestProps(this.terrain, backend.maxAnisotropy);

    this.roadGroup.name = 'Road network visuals';
    this.junctionGroup.name = 'Road junction visuals';
    this.previewGroup.name = 'Road preview root';
    this.selectionGroup.name = 'Road selection root';

    this.scene.add(this.sky, this.terrain.mesh, this.forestGroup, this.roadGroup, this.junctionGroup, this.previewGroup, this.selectionGroup);
    this.addLighting();
    this.postProcessor = createPostProcessor(backend, this.scene, this.camera);
  }

  static async create(container: HTMLElement): Promise<SceneManager> {
    const backend = await createPreferredRenderer();
    container.appendChild(backend.renderer.domElement);
    const materials = await RoadMaterialFactory.create(backend.maxAnisotropy);
    return new SceneManager(container, backend, materials);
  }

  resize(): void {
    const rect = this.container.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    const pixelRatio = Math.min(window.devicePixelRatio, 1);
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
    this.postProcessor.setPixelRatio(pixelRatio);
    this.postProcessor.setSize(width, height);
    this.sky.updateResolution(width * pixelRatio, height * pixelRatio);
  }

  render(dt: number): void {
    const elapsed = performance.now() * 0.001;
    this.sky.updateCamera(this.camera);
    this.sky.updateSun(this.sunDirection);
    this.sky.updateTime(elapsed);
    this.postProcessor.render(dt);
  }

  getPerformanceStats(): { backend: RendererBackendKind; calls: number; triangles: number; pixelRatio: number } {
    return {
      backend: this.rendererBackend,
      calls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      pixelRatio: this.renderer.getPixelRatio(),
    };
  }

  syncRoadNetwork(network: RoadNetwork): void {
    for (const [edgeId, visual] of this.edgeVisuals) {
      if (!network.edges.has(edgeId)) {
        this.roadGroup.remove(visual.group);
        disposeObject3D(visual.group);
        this.edgeVisuals.delete(edgeId);
      }
    }

    for (const edge of network.edges.values()) {
      this.upsertEdge(edge);
    }

    this.rebuildJunctions(network);
  }

  getRoadPickMeshes(): THREE.Object3D[] {
    const meshes: THREE.Object3D[] = [];
    for (const visual of this.edgeVisuals.values()) {
      visual.group.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) meshes.push(child);
      });
    }
    return meshes;
  }

  dispose(): void {
    for (const visual of this.edgeVisuals.values()) disposeObject3D(visual.group);
    this.edgeVisuals.clear();
    disposeObject3D(this.forestGroup);
    (this.forestGroup.userData.disposeResources as (() => void) | undefined)?.();
    this.sky.dispose();
    this.postProcessor.dispose();
    disposeObject3D(this.junctionGroup);
    disposeObject3D(this.previewGroup);
    disposeObject3D(this.selectionGroup);
    this.terrain.dispose();
    this.materials.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private upsertEdge(edge: RoadEdge): void {
    const existing = this.edgeVisuals.get(edge.id);
    if (existing && existing.revision === edge.revision) return;
    if (existing) {
      this.roadGroup.remove(existing.group);
      disposeObject3D(existing.group);
      this.edgeVisuals.delete(edge.id);
    }
    const group = this.roadMeshBuilder.buildEdge(edge);
    this.roadGroup.add(group);
    this.edgeVisuals.set(edge.id, { revision: edge.revision, group });
  }

  private rebuildJunctions(network: RoadNetwork): void {
    disposeObject3D(this.junctionGroup);
    this.junctionGroup.clear();
    const builder = new RoadJunctionBuilder(this.terrain, this.materials);
    const next = builder.build(network);
    for (const child of [...next.children]) this.junctionGroup.add(child);
  }

  private addLighting(): void {
    const hemi = new THREE.HemisphereLight(0xdff0ff, 0x56644a, 1.9);
    this.scene.add(hemi);

    const ambient = new THREE.AmbientLight(0xb8d1ff, 0.2);
    this.scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xffefd2, 4.9);
    sun.name = 'Sun';
    sun.position.copy(this.sunDirection).multiplyScalar(180);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 15;
    sun.shadow.camera.far = 260;
    sun.shadow.camera.left = -120;
    sun.shadow.camera.right = 120;
    sun.shadow.camera.top = 120;
    sun.shadow.camera.bottom = -120;
    sun.shadow.bias = -0.00008;
    sun.shadow.normalBias = 0.025;
    this.scene.add(sun);

    const blueFill = new THREE.DirectionalLight(0x9fc8ff, 0.45);
    blueFill.name = 'Sky fill';
    blueFill.position.copy(this.sunDirection).multiplyScalar(-90).add(new THREE.Vector3(0, 65, 0));
    this.scene.add(blueFill);
  }

}
