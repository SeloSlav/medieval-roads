import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { LivestockHerdState, LivestockSpecies, PastureState } from '../resources/types.ts';
import type { CrowdViewState } from '../settlement/crowdView.ts';
import { isWithinCrowdView, isWithinShadowRange } from '../settlement/crowdView.ts';
import { hashStringSeed, mulberry32 } from '../utils/random.ts';

type MotionMode = 'idle' | 'graze' | 'walk';

type AnimalSource = {
  scene: THREE.Group;
  bounds: THREE.Box3;
  sourceHeight: number;
  targetHeight: number;
  clips: {
    idle: THREE.AnimationClip;
    graze: THREE.AnimationClip;
    walk: THREE.AnimationClip;
  };
};

type AnimalVisual = {
  herdId: string;
  root: THREE.Group;
  model: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: Record<MotionMode, THREE.AnimationAction>;
  mode: MotionMode;
  modeTimer: number;
  x: number;
  z: number;
  targetX: number;
  targetZ: number;
  speed: number;
  pasture: PastureState;
  random: () => number;
};

type ReplayableLivestockInput = {
  pastures: PastureState[];
  herds: Map<string, LivestockHerdState>;
};

const MODEL_URLS = {
  cow: '/assets/models/livestock/quaternius-cow.glb',
  bull: '/assets/models/livestock/quaternius-bull.glb',
  sheep: '/assets/models/livestock/quaternius-sheep.glb',
  swine: '/assets/models/livestock/quaternius-pig.glb',
} as const;

const TARGET_HEIGHTS = {
  cow: 1.55,
  bull: 1.72,
  sheep: 0.92,
  swine: 0.78,
} as const;

const VISUAL_HEAD_CAP = 14;
const MIN_EDGE_MARGIN = 0.12;
const TAU = Math.PI * 2;

export type CattleVisualKind = 'cow' | 'bull';

/** Keeps cattle herds cow-heavy while adding one breeding bull once established. */
export function createCattleVisualDistribution(headCount: number): CattleVisualKind[] {
  const count = Math.max(0, Math.min(VISUAL_HEAD_CAP, Math.floor(headCount)));
  return Array.from({ length: count }, (_, index) => count >= 4 && index === 0 ? 'bull' : 'cow');
}

/** Close-world, rigged animals for authoritative livestock herds. */
export class LivestockVisuals {
  private readonly root = new THREE.Group();
  private readonly animals: AnimalVisual[] = [];
  private readonly getHeightAt: (x: number, z: number) => number;
  private sources: Record<keyof typeof MODEL_URLS, AnimalSource> | null = null;
  private latestInput: ReplayableLivestockInput | null = null;
  private lastSignature = '';
  private disposed = false;

  constructor(
    parent: THREE.Group,
    getHeightAt: (x: number, z: number) => number,
  ) {
    this.getHeightAt = getHeightAt;
    this.root.name = 'Animated livestock herds';
    parent.add(this.root);
    void this.loadSources();
  }

  sync(
    pastures: Iterable<PastureState>,
    herds: Map<string, LivestockHerdState>,
  ): void {
    this.latestInput = { pastures: [...pastures], herds: new Map(herds) };
    this.rebuildIfNeeded();
  }

  tick(dtSeconds: number, view?: CrowdViewState): void {
    const dt = Math.min(0.08, Math.max(0, dtSeconds));
    for (const animal of this.animals) {
      const visible = isWithinCrowdView(animal.x, animal.z, view);
      animal.root.visible = visible;
      if (!visible) continue;

      animal.modeTimer -= dt;
      if (animal.modeTimer <= 0) this.chooseNextMode(animal);

      if (animal.mode === 'walk') {
        const dx = animal.targetX - animal.x;
        const dz = animal.targetZ - animal.z;
        const distance = Math.hypot(dx, dz);
        if (distance < 0.18) {
          this.transition(animal, animal.random() < 0.58 ? 'graze' : 'idle');
          animal.modeTimer = 2.8 + animal.random() * 6;
        } else {
          const step = Math.min(distance, animal.speed * dt);
          animal.x += (dx / distance) * step;
          animal.z += (dz / distance) * step;
          animal.root.rotation.y = Math.atan2(dx, dz);
        }
      }

      animal.root.position.set(
        animal.x,
        this.getHeightAt(animal.x, animal.z),
        animal.z,
      );
      const castShadow = isWithinShadowRange(animal.x, animal.z, view);
      animal.model.traverse((object) => {
        const mesh = object as THREE.SkinnedMesh;
        if (mesh.isSkinnedMesh) mesh.castShadow = castShadow;
      });
      animal.mixer.update(dt);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.latestInput = null;
    this.clearAnimals();
    if (this.sources) {
      const scenes = new Set(Object.values(this.sources).map((source) => source.scene));
      for (const scene of scenes) disposeModelResources(scene);
    }
    this.sources = null;
    this.root.removeFromParent();
  }

  private async loadSources(): Promise<void> {
    try {
      const [cow, bull, sheep, swine] = await Promise.all([
        loadAnimalSource(MODEL_URLS.cow, TARGET_HEIGHTS.cow),
        loadAnimalSource(MODEL_URLS.bull, TARGET_HEIGHTS.bull),
        loadAnimalSource(MODEL_URLS.sheep, TARGET_HEIGHTS.sheep),
        loadAnimalSource(MODEL_URLS.swine, TARGET_HEIGHTS.swine),
      ]);
      if (this.disposed) {
        for (const source of [cow, bull, sheep, swine]) disposeModelResources(source.scene);
        return;
      }
      this.sources = { cow, bull, sheep, swine };
      this.rebuildIfNeeded(true);
    } catch (error) {
      console.warn('[Livestock] Animated CC0 farm animals failed to load.', error);
    }
  }

  private rebuildIfNeeded(force = false): void {
    if (!this.sources || !this.latestInput) return;
    const signature = buildSignature(this.latestInput);
    if (!force && signature === this.lastSignature) return;
    this.lastSignature = signature;
    this.clearAnimals();

    const pasturesByHerd = new Map<string, PastureState[]>();
    for (const pasture of this.latestInput.pastures) {
      const list = pasturesByHerd.get(pasture.farmsteadId) ?? [];
      list.push(pasture);
      pasturesByHerd.set(pasture.farmsteadId, list);
    }

    for (const herd of this.latestInput.herds.values()) {
      const pastures = pasturesByHerd.get(herd.buildingId);
      if (!pastures?.length || herd.headCount <= 0) continue;
      const visualCount = Math.min(VISUAL_HEAD_CAP, herd.headCount);
      const cattleDistribution = herd.species === 'cattle'
        ? createCattleVisualDistribution(visualCount)
        : null;
      for (let index = 0; index < visualCount; index++) {
        const pasture = pastures[index % pastures.length]!;
        const modelKind = cattleDistribution?.[index] ?? resolveModelKind(herd.species);
        this.addAnimal(herd, pasture, index, modelKind);
      }
    }
  }

  private addAnimal(
    herd: LivestockHerdState,
    pasture: PastureState,
    index: number,
    modelKind: keyof typeof MODEL_URLS,
  ): void {
    if (!this.sources) return;
    const source = this.sources[modelKind];
    const random = mulberry32(hashStringSeed(`${herd.buildingId}:${modelKind}:${index}`));
    const model = cloneSkinned(source.scene) as THREE.Group;
    const scale = (source.targetHeight / source.sourceHeight) * THREE.MathUtils.lerp(0.9, 1.08, random());
    model.scale.setScalar(scale);
    model.position.y = -source.bounds.min.y * scale + 0.018;
    configureModelMeshes(model);

    const root = new THREE.Group();
    root.name = `${modelKind === 'swine' ? 'Pig' : modelKind[0]!.toUpperCase() + modelKind.slice(1)} in herd ${herd.buildingId}`;
    root.userData.livestockSpecies = herd.species;
    root.userData.herdBuildingId = herd.buildingId;
    root.add(model);
    this.root.add(root);

    const mixer = new THREE.AnimationMixer(model);
    const actions: Record<MotionMode, THREE.AnimationAction> = {
      idle: mixer.clipAction(source.clips.idle, model),
      graze: mixer.clipAction(source.clips.graze, model),
      walk: mixer.clipAction(source.clips.walk, model),
    };
    for (const action of Object.values(actions)) {
      action.setLoop(THREE.LoopRepeat, Number.POSITIVE_INFINITY);
      action.enabled = true;
    }
    actions.walk.setEffectiveTimeScale(modelKind === 'sheep' || modelKind === 'swine' ? 1.12 : 0.96);

    const point = samplePasturePoint(pasture, random);
    const initialMode: MotionMode = index % 4 === 0 ? 'walk' : index % 3 === 0 ? 'idle' : 'graze';
    const target = samplePasturePoint(pasture, random);
    const visual: AnimalVisual = {
      herdId: herd.buildingId,
      root,
      model,
      mixer,
      actions,
      mode: initialMode,
      modeTimer: 1.5 + random() * 5,
      x: point.x,
      z: point.z,
      targetX: target.x,
      targetZ: target.z,
      speed: herd.species === 'cattle' ? 0.72 : herd.species === 'sheep' ? 0.92 : 0.84,
      pasture,
      random,
    };
    actions[initialMode].play();
    actions[initialMode].time = random() * Math.max(0.1, actions[initialMode].getClip().duration);
    root.position.set(point.x, this.getHeightAt(point.x, point.z), point.z);
    root.rotation.y = random() * TAU;
    this.animals.push(visual);
  }

  private chooseNextMode(animal: AnimalVisual): void {
    if (animal.mode === 'walk' || animal.random() < 0.62) {
      const next: MotionMode = animal.random() < 0.66 ? 'graze' : 'idle';
      this.transition(animal, next);
      animal.modeTimer = 2.5 + animal.random() * 7;
      return;
    }
    const target = samplePasturePoint(animal.pasture, animal.random);
    animal.targetX = target.x;
    animal.targetZ = target.z;
    this.transition(animal, 'walk');
    animal.modeTimer = 5 + animal.random() * 8;
  }

  private transition(animal: AnimalVisual, nextMode: MotionMode): void {
    if (animal.mode === nextMode) return;
    animal.actions[animal.mode].fadeOut(0.24);
    animal.actions[nextMode].reset().fadeIn(0.24).play();
    animal.mode = nextMode;
  }

  private clearAnimals(): void {
    for (const animal of this.animals) {
      animal.mixer.stopAllAction();
      animal.mixer.uncacheRoot(animal.model);
      animal.root.removeFromParent();
    }
    this.animals.length = 0;
    this.root.clear();
  }
}

function buildSignature(input: ReplayableLivestockInput): string {
  const herds = [...input.herds.values()]
    .sort((a, b) => a.buildingId.localeCompare(b.buildingId))
    .map((herd) => `${herd.buildingId}:${herd.species}:${herd.headCount}`)
    .join('|');
  const pastures = [...input.pastures]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((pasture) => `${pasture.id}:${pasture.farmsteadId}:${pasture.corners.map((corner) => `${corner.x.toFixed(1)},${corner.z.toFixed(1)}`).join(';')}`)
    .join('|');
  return `${herds}#${pastures}`;
}

function resolveModelKind(
  species: LivestockSpecies,
): keyof typeof MODEL_URLS {
  if (species === 'sheep') return 'sheep';
  if (species === 'swine') return 'swine';
  return 'cow';
}

function samplePasturePoint(pasture: PastureState, random: () => number): { x: number; z: number } {
  const [a, b, c, d] = pasture.corners;
  const u = THREE.MathUtils.lerp(MIN_EDGE_MARGIN, 1 - MIN_EDGE_MARGIN, random());
  const v = THREE.MathUtils.lerp(MIN_EDGE_MARGIN, 1 - MIN_EDGE_MARGIN, random());
  const nearX = THREE.MathUtils.lerp(a.x, b.x, u);
  const nearZ = THREE.MathUtils.lerp(a.z, b.z, u);
  const farX = THREE.MathUtils.lerp(d.x, c.x, u);
  const farZ = THREE.MathUtils.lerp(d.z, c.z, u);
  return {
    x: THREE.MathUtils.lerp(nearX, farX, v),
    z: THREE.MathUtils.lerp(nearZ, farZ, v),
  };
}

async function loadAnimalSource(url: string, targetHeight: number): Promise<AnimalSource> {
  const gltf = await new GLTFLoader().loadAsync(url);
  const bounds = new THREE.Box3().setFromObject(gltf.scene);
  const sourceHeight = bounds.max.y - bounds.min.y;
  if (!Number.isFinite(sourceHeight) || sourceHeight <= 0.001) {
    throw new Error(`Invalid livestock model bounds for ${url}`);
  }
  return {
    scene: gltf.scene,
    bounds,
    sourceHeight,
    targetHeight,
    clips: resolveAnimationClips(gltf.animations, url),
  };
}

function resolveAnimationClips(
  animations: ReadonlyArray<THREE.AnimationClip>,
  url: string,
): AnimalSource['clips'] {
  const findClip = (...names: string[]): THREE.AnimationClip | undefined => animations.find((clip) => {
    const normalized = clip.name.toLowerCase();
    return names.some((name) => normalized === name || normalized.endsWith(`|${name}`));
  });
  const idle = findClip('idle', 'idle_1');
  const graze = findClip('eating', 'idle_eating', 'idle_headlow') ?? idle;
  const walk = findClip('walk');
  if (!idle || !graze || !walk) throw new Error(`Missing idle/graze/walk clips in ${url}`);
  return { idle, graze, walk };
}

function configureModelMeshes(model: THREE.Object3D): void {
  model.traverse((object) => {
    const mesh = object as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
  });
}

function disposeModelResources(source: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  source.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    const materialsForMesh = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
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
