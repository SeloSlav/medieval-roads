import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import {
  isWithinCrowdView,
  isWithinShadowRange,
  type CrowdViewState,
} from './crowdView.ts';

const MAX_INSTANCES = 1024;
const MAX_ANIMATED_VILLAGERS = 72;
const MODEL_YAW_OFFSET = 0;
const BODY_GEOMETRY = new THREE.CapsuleGeometry(0.22, 0.72, 4, 8);
const LEGS_GEOMETRY = new THREE.CapsuleGeometry(0.16, 0.34, 4, 8);
const HEAD_GEOMETRY = new THREE.SphereGeometry(0.19, 10, 10);

const MODEL_URLS = {
  man: '/assets/models/villagers/quaternius-villager-man.glb',
  woman: '/assets/models/villagers/quaternius-villager-woman.glb',
} as const;

const TARGET_HEIGHTS = {
  man: 1.72,
  woman: 1.64,
} as const;

export type VillagerModelVariant = keyof typeof MODEL_URLS;
export type VillagerRenderMode = 'idle' | 'walk';

type FallbackPartLayer = {
  mesh: THREE.InstancedMesh;
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
};

type VillagerSource = {
  scene: THREE.Group;
  bounds: THREE.Box3;
  sourceHeight: number;
  targetHeight: number;
  clips: Record<VillagerRenderMode, THREE.AnimationClip>;
};

type ProxyLayer = {
  variant: VillagerModelVariant;
  mesh: THREE.InstancedMesh;
  material: THREE.MeshStandardMaterial;
  materialName: string;
  modelMatrix: THREE.Matrix4;
};

type AnimatedVillager = {
  id: string;
  variant: VillagerModelVariant;
  root: THREE.Group;
  model: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: Record<VillagerRenderMode, THREE.AnimationAction>;
  mode: VillagerRenderMode;
  ownedMaterials: THREE.Material[];
};

export type CrowdRenderAgent = {
  id: string;
  slot: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  appearanceSeed: number;
  variant: VillagerModelVariant;
  mode: VillagerRenderMode;
  tunicColor: number;
  skinColor: number;
  hairColor: number;
  active: boolean;
};

export type SettlementCrowdRendererOptions = {
  parent: THREE.Group;
};

/**
 * Renders close villagers with their authored skeletal animations and all other
 * visible villagers as instanced, bind-pose copies of the same low-poly models.
 */
export class SettlementCrowdRenderer {
  private readonly group = new THREE.Group();
  private readonly animatedGroup = new THREE.Group();
  private readonly proxyGroup = new THREE.Group();
  private readonly matrix = new THREE.Matrix4();
  private readonly agentMatrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();
  private readonly euler = new THREE.Euler();
  private readonly color = new THREE.Color();
  private readonly scale = new THREE.Vector3(1, 1, 1);
  private readonly fallbackBody: FallbackPartLayer;
  private readonly fallbackLegs: FallbackPartLayer;
  private readonly fallbackHead: FallbackPartLayer;
  private readonly animated = new Map<string, AnimatedVillager>();
  private sources: Record<VillagerModelVariant, VillagerSource> | null = null;
  private proxyLayers: ProxyLayer[] = [];
  private latestAgents: CrowdRenderAgent[] = [];
  private lastView: CrowdViewState | undefined;
  private elapsed = 0;
  private disposed = false;

  constructor(options: SettlementCrowdRendererOptions) {
    this.group.name = 'Villagers';
    this.animatedGroup.name = 'Animated Quaternius villagers';
    this.proxyGroup.name = 'Instanced Quaternius villager LOD';
    this.group.add(this.proxyGroup, this.animatedGroup);
    options.parent.add(this.group);

    this.fallbackBody = this.createFallbackLayer('Villager loading body', BODY_GEOMETRY);
    this.fallbackLegs = this.createFallbackLayer('Villager loading legs', LEGS_GEOMETRY);
    this.fallbackHead = this.createFallbackLayer('Villager loading head', HEAD_GEOMETRY);
    void this.loadSources();
  }

  syncAgents(
    agents: readonly CrowdRenderAgent[],
    view?: CrowdViewState,
    dtSeconds = 0,
  ): void {
    this.latestAgents = [...agents];
    this.lastView = view;
    const dt = Math.min(0.08, Math.max(0, dtSeconds));
    this.elapsed += dt;

    const visibleAgents = this.latestAgents.filter((agent) =>
      agent.active && isWithinCrowdView(agent.x, agent.z, view)
    );

    if (!this.sources) {
      this.updateFallback(visibleAgents);
      return;
    }

    this.clearFallback();
    const animatedIds = this.pickAnimatedIds(visibleAgents, view);
    this.syncAnimatedVillagers(visibleAgents, animatedIds, dt);
    this.updateProxyLayers(visibleAgents, animatedIds);
  }

  dispose(): void {
    this.disposed = true;
    for (const id of [...this.animated.keys()]) this.removeAnimatedVillager(id);

    for (const layer of this.proxyLayers) {
      layer.material.dispose();
      layer.mesh.removeFromParent();
    }
    this.proxyLayers = [];

    for (const layer of [this.fallbackBody, this.fallbackLegs, this.fallbackHead]) {
      layer.geometry.dispose();
      layer.material.dispose();
      layer.mesh.removeFromParent();
    }

    if (this.sources) {
      for (const source of Object.values(this.sources)) disposeModelResources(source.scene);
    }
    this.sources = null;
    this.group.removeFromParent();
  }

  private async loadSources(): Promise<void> {
    try {
      const [man, woman] = await Promise.all([
        loadVillagerSource(MODEL_URLS.man, TARGET_HEIGHTS.man),
        loadVillagerSource(MODEL_URLS.woman, TARGET_HEIGHTS.woman),
      ]);
      if (this.disposed) {
        disposeModelResources(man.scene);
        disposeModelResources(woman.scene);
        return;
      }
      this.sources = { man, woman };
      this.proxyLayers = [
        ...this.createProxyLayers('man', man),
        ...this.createProxyLayers('woman', woman),
      ];
      this.syncAgents(this.latestAgents, this.lastView);
    } catch (error) {
      console.warn('[Villagers] Animated CC0 Quaternius villagers failed to load.', error);
    }
  }

  private createFallbackLayer(
    name: string,
    geometry: THREE.BufferGeometry,
  ): FallbackPartLayer {
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.9,
      metalness: 0,
    });
    const mesh = new THREE.InstancedMesh(geometry, material, MAX_INSTANCES);
    mesh.name = name;
    mesh.count = 0;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    this.group.add(mesh);
    return { mesh, geometry, material };
  }

  private updateFallback(agents: readonly CrowdRenderAgent[]): void {
    let count = 0;
    for (const agent of agents) {
      if (count >= MAX_INSTANCES) break;
      this.writeFallbackInstance(
        this.fallbackBody.mesh,
        count,
        agent,
        0.62,
        agent.tunicColor,
      );
      this.writeFallbackInstance(
        this.fallbackLegs.mesh,
        count,
        agent,
        0.22,
        darkenHex(agent.tunicColor, 0.55),
      );
      this.writeFallbackInstance(
        this.fallbackHead.mesh,
        count,
        agent,
        1.18,
        agent.skinColor,
      );
      count++;
    }
    for (const layer of [this.fallbackBody, this.fallbackLegs, this.fallbackHead]) {
      layer.mesh.count = count;
      layer.mesh.instanceMatrix.needsUpdate = true;
      if (layer.mesh.instanceColor) layer.mesh.instanceColor.needsUpdate = true;
    }
  }

  private clearFallback(): void {
    this.fallbackBody.mesh.count = 0;
    this.fallbackLegs.mesh.count = 0;
    this.fallbackHead.mesh.count = 0;
  }

  private writeFallbackInstance(
    mesh: THREE.InstancedMesh,
    index: number,
    agent: CrowdRenderAgent,
    yOffset: number,
    hexColor: number,
  ): void {
    this.position.set(agent.x, agent.y + yOffset, agent.z);
    this.euler.set(0, agent.yaw, 0);
    this.quaternion.setFromEuler(this.euler);
    this.matrix.compose(this.position, this.quaternion, this.scale);
    mesh.setMatrixAt(index, this.matrix);
    this.color.setHex(hexColor);
    mesh.setColorAt(index, this.color);
  }

  private pickAnimatedIds(
    agents: readonly CrowdRenderAgent[],
    view?: CrowdViewState,
  ): Set<string> {
    const candidates = agents.filter((agent) =>
      isWithinShadowRange(agent.x, agent.z, view)
    );
    if (view) {
      candidates.sort((a, b) => {
        const aDx = a.x - view.centerX;
        const aDz = a.z - view.centerZ;
        const bDx = b.x - view.centerX;
        const bDz = b.z - view.centerZ;
        return aDx * aDx + aDz * aDz - (bDx * bDx + bDz * bDz);
      });
    }
    return new Set(
      candidates.slice(0, MAX_ANIMATED_VILLAGERS).map((agent) => agent.id),
    );
  }

  private syncAnimatedVillagers(
    agents: readonly CrowdRenderAgent[],
    animatedIds: ReadonlySet<string>,
    dt: number,
  ): void {
    const byId = new Map(agents.map((agent) => [agent.id, agent]));
    for (const id of [...this.animated.keys()]) {
      if (!animatedIds.has(id) || !byId.has(id)) this.removeAnimatedVillager(id);
    }

    for (const agent of agents) {
      if (!animatedIds.has(agent.id)) continue;
      let visual = this.animated.get(agent.id);
      if (!visual || visual.variant !== agent.variant) {
        if (visual) this.removeAnimatedVillager(agent.id);
        visual = this.createAnimatedVillager(agent);
        this.animated.set(agent.id, visual);
      }

      visual.root.position.set(agent.x, agent.y, agent.z);
      visual.root.rotation.y = agent.yaw + MODEL_YAW_OFFSET;
      if (visual.mode !== agent.mode) this.transition(visual, agent.mode);
      if (dt > 0) visual.mixer.update(dt);
    }
  }

  private createAnimatedVillager(agent: CrowdRenderAgent): AnimatedVillager {
    const source = this.sources![agent.variant];
    const model = cloneSkinned(source.scene) as THREE.Group;
    const heightJitter = 0.96 + ((agent.appearanceSeed >>> 8) & 0xff) / 0xff * 0.08;
    const scale = source.targetHeight / source.sourceHeight * heightJitter;
    model.scale.setScalar(scale);
    model.position.y = -source.bounds.min.y * scale + 0.012;

    const ownedMaterials: THREE.Material[] = [];
    model.traverse((object) => {
      const mesh = object as THREE.SkinnedMesh;
      if (!mesh.isSkinnedMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const clones = materials.map((material) => {
        const clone = material.clone();
        const standard = clone as THREE.MeshStandardMaterial;
        if (standard.color) {
          standard.color.setHex(resolvePartColor(material.name, agent));
          standard.roughness = 0.9;
          standard.metalness = 0;
        }
        ownedMaterials.push(clone);
        return clone;
      });
      mesh.material = Array.isArray(mesh.material) ? clones : clones[0]!;
    });

    const root = new THREE.Group();
    root.name = `${agent.variant === 'woman' ? 'Woman' : 'Man'} villager ${agent.id}`;
    root.userData.villagerId = agent.id;
    root.userData.villagerGender = agent.variant;
    root.add(model);
    this.animatedGroup.add(root);

    const mixer = new THREE.AnimationMixer(model);
    const actions: Record<VillagerRenderMode, THREE.AnimationAction> = {
      idle: mixer.clipAction(source.clips.idle, model),
      walk: mixer.clipAction(source.clips.walk, model),
    };
    for (const action of Object.values(actions)) {
      action.enabled = true;
      action.setLoop(THREE.LoopRepeat, Number.POSITIVE_INFINITY);
    }
    actions.walk.setEffectiveTimeScale(1.06);
    actions[agent.mode].play();
    actions[agent.mode].time =
      (agent.appearanceSeed % 997) / 997 * actions[agent.mode].getClip().duration;

    return {
      id: agent.id,
      variant: agent.variant,
      root,
      model,
      mixer,
      actions,
      mode: agent.mode,
      ownedMaterials,
    };
  }

  private transition(
    visual: AnimatedVillager,
    nextMode: VillagerRenderMode,
  ): void {
    if (visual.mode === nextMode) return;
    visual.actions[visual.mode].fadeOut(0.18);
    visual.actions[nextMode].reset().fadeIn(0.18).play();
    visual.mode = nextMode;
  }

  private removeAnimatedVillager(id: string): void {
    const visual = this.animated.get(id);
    if (!visual) return;
    visual.mixer.stopAllAction();
    visual.mixer.uncacheRoot(visual.model);
    for (const material of visual.ownedMaterials) material.dispose();
    visual.root.removeFromParent();
    this.animated.delete(id);
  }

  private createProxyLayers(
    variant: VillagerModelVariant,
    source: VillagerSource,
  ): ProxyLayer[] {
    const layers: ProxyLayer[] = [];
    const modelScale = source.targetHeight / source.sourceHeight;
    source.scene.updateMatrixWorld(true);

    source.scene.traverse((object) => {
      const sourceMesh = object as THREE.SkinnedMesh;
      if (!sourceMesh.isSkinnedMesh) return;
      const sourceMaterial = Array.isArray(sourceMesh.material)
        ? sourceMesh.material[0]
        : sourceMesh.material;
      const material = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.9,
        metalness: 0,
      });
      const mesh = new THREE.InstancedMesh(
        sourceMesh.geometry,
        material,
        MAX_INSTANCES,
      );
      mesh.name = `${variant} villager LOD: ${sourceMaterial?.name ?? sourceMesh.name}`;
      mesh.count = 0;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.proxyGroup.add(mesh);

      const modelMatrix = new THREE.Matrix4()
        .makeTranslation(0, -source.bounds.min.y * modelScale + 0.012, 0)
        .multiply(new THREE.Matrix4().makeScale(modelScale, modelScale, modelScale))
        .multiply(sourceMesh.matrixWorld);
      layers.push({
        variant,
        mesh,
        material,
        materialName: sourceMaterial?.name ?? sourceMesh.name,
        modelMatrix,
      });
    });

    return layers;
  }

  private updateProxyLayers(
    agents: readonly CrowdRenderAgent[],
    animatedIds: ReadonlySet<string>,
  ): void {
    const proxyAgents = agents.filter((agent) => !animatedIds.has(agent.id));
    for (const layer of this.proxyLayers) {
      let count = 0;
      for (const agent of proxyAgents) {
        if (agent.variant !== layer.variant || count >= MAX_INSTANCES) continue;
        const phase = this.elapsed * 7.5 + (agent.appearanceSeed % 1024) * 0.07;
        const bob = agent.mode === 'walk' ? Math.sin(phase) * 0.018 : 0;
        this.position.set(agent.x, agent.y + bob, agent.z);
        this.euler.set(0, agent.yaw + MODEL_YAW_OFFSET, 0);
        this.quaternion.setFromEuler(this.euler);
        this.agentMatrix.compose(this.position, this.quaternion, this.scale);
        this.matrix.multiplyMatrices(this.agentMatrix, layer.modelMatrix);
        layer.mesh.setMatrixAt(count, this.matrix);
        this.color.setHex(resolvePartColor(layer.materialName, agent));
        layer.mesh.setColorAt(count, this.color);
        count++;
      }
      layer.mesh.count = count;
      layer.mesh.instanceMatrix.needsUpdate = true;
      if (layer.mesh.instanceColor) layer.mesh.instanceColor.needsUpdate = true;
    }
  }
}

async function loadVillagerSource(
  url: string,
  targetHeight: number,
): Promise<VillagerSource> {
  const gltf = await new GLTFLoader().loadAsync(url);
  const bounds = new THREE.Box3().setFromObject(gltf.scene);
  const sourceHeight = bounds.max.y - bounds.min.y;
  if (!Number.isFinite(sourceHeight) || sourceHeight <= 0.001) {
    throw new Error(`Invalid villager model bounds for ${url}`);
  }
  const idle = findAnimationClip(gltf.animations, 'idle');
  const walk = findAnimationClip(gltf.animations, 'walk');
  if (!idle || !walk) throw new Error(`Missing idle/walk clips in ${url}`);
  return {
    scene: gltf.scene,
    bounds,
    sourceHeight,
    targetHeight,
    clips: { idle, walk },
  };
}

function findAnimationClip(
  animations: readonly THREE.AnimationClip[],
  name: string,
): THREE.AnimationClip | undefined {
  return animations.find((clip) => {
    const normalized = clip.name.toLowerCase();
    return normalized === name ||
      normalized.endsWith(`|${name}`) ||
      normalized.endsWith(`_${name}`);
  });
}

function resolvePartColor(
  materialName: string,
  agent: CrowdRenderAgent,
): number {
  const normalized = materialName.toLowerCase();
  if (normalized.includes('skin')) return agent.skinColor;
  if (normalized.includes('hair')) {
    return normalized.endsWith('2')
      ? darkenHex(agent.hairColor, 0.82)
      : agent.hairColor;
  }
  if (normalized.includes('dress') || normalized === 'shirt') {
    return agent.tunicColor;
  }
  if (normalized.includes('shirt')) return darkenHex(agent.tunicColor, 0.78);
  if (normalized.includes('pants')) return darkenHex(agent.tunicColor, 0.56);
  if (normalized.includes('socks')) return 0x776d61;
  if (normalized.includes('shoes')) return 0x3d2b22;
  if (normalized.includes('eyes')) return 0x241e1a;
  return 0xffffff;
}

function darkenHex(hex: number, factor: number): number {
  const r = Math.round(((hex >> 16) & 0xff) * factor);
  const g = Math.round(((hex >> 8) & 0xff) * factor);
  const b = Math.round((hex & 0xff) * factor);
  return (r << 16) | (g << 8) | b;
}

function disposeModelResources(source: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  source.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    const materialsForMesh = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];
    for (const material of materialsForMesh) {
      if (!material) continue;
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) textures.add(value);
      }
    }
  });
  for (const texture of textures) texture.dispose();
  for (const material of materials) material.dispose();
  for (const geometry of geometries) geometry.dispose();
}
