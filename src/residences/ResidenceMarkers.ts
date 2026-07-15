import * as THREE from 'three';
import { addTriangularGableWall } from '../buildings/meshPrimitives.ts';
import { addLogPile } from '../buildings/logPile.ts';
import { createResidenceShadowProxy } from '../buildings/buildingShadowProxy.ts';
import {
  addMesh,
  residenceFacadeMaterial,
  residenceRoofMaterial,
  sharedBuildingDetailMaterial,
  sharedBuildingMaterial,
  stoneMaterial,
  timberMaterial,
} from '../buildings/buildingMaterials.ts';
import { areBuildingShadowsEnabled } from '../scene/shadowPreference.ts';
import { ChimneySmokeEmitter } from './ResidenceChimneySmoke.ts';
import {
  pickResidenceAppearance,
  type ResidenceArchetype,
  type ResidenceTrimColor,
} from './residenceAppearance.ts';
import { getNeedStock } from './residenceNeedState.ts';
import type { ResidenceState } from '../resources/types.ts';
import { RESIDENCE_FIREWOOD_CAPACITY } from '../generated/gameBalance.ts';
import { hashStringSeed } from '../utils/random.ts';

const WINDOW_GLOW_EMISSIVE = 0xffc060;
const WINDOW_GLOW_COLOR = 0x4a3820;
const WINDOW_DARK_EMISSIVE = 0x1a2530;
const WINDOW_DARK_COLOR = 0x2a3540;

function createWindowMaterial(): THREE.MeshStandardMaterial {
  const material = sharedBuildingMaterial('glass').clone();
  material.name = 'Residence window (dynamic glow)';
  material.userData.sharedBuildingMaterial = false;
  material.emissive.setHex(WINDOW_DARK_EMISSIVE);
  material.emissiveIntensity = 0.15;
  return material;
}

export function applyResidenceWindowGlow(
  material: THREE.MeshStandardMaterial,
  eveningGlow: number,
  occupied: boolean,
): void {
  const amount = occupied ? eveningGlow : eveningGlow * 0.06;
  material.color.setHex(lerpColor(WINDOW_DARK_COLOR, WINDOW_GLOW_COLOR, amount));
  material.emissive.setHex(lerpColor(WINDOW_DARK_EMISSIVE, WINDOW_GLOW_EMISSIVE, amount));
  material.emissiveIntensity = 0.12 + amount * 1.15;
}

function lerpColor(a: number, b: number, t: number): number {
  const mix = Math.min(1, Math.max(0, t));
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const br = (b >> 16) & 255;
  const bg = (b >> 8) & 255;
  const bb = b & 255;
  const r = Math.round(ar + (br - ar) * mix);
  const g = Math.round(ag + (bg - ag) * mix);
  const bl = Math.round(ab + (bb - ab) * mix);
  return (r << 16) | (g << 8) | bl;
}

type HouseDimensions = {
  width: number;
  depth: number;
  foundationHeight: number;
  groundHeight: number;
  upperHeight: number;
  ridgeHeight: number;
};

function dimensionsForArchetype(archetype: ResidenceArchetype): HouseDimensions {
  switch (archetype) {
    case 'stone_portal':
      return { width: 6.3, depth: 7.05, foundationHeight: 0.48, groundHeight: 2.42, upperHeight: 2.34, ridgeHeight: 2.5 };
    case 'timber_balcony':
      return { width: 6.0, depth: 6.45, foundationHeight: 0.5, groundHeight: 2.38, upperHeight: 2.32, ridgeHeight: 2.42 };
    case 'working_lean_to':
      return { width: 5.65, depth: 6.7, foundationHeight: 0.46, groundHeight: 2.36, upperHeight: 2.28, ridgeHeight: 2.38 };
  }
}

function dimensionsForTier(archetype: ResidenceArchetype, tier: 1 | 2 | 3): HouseDimensions {
  const base = dimensionsForArchetype(archetype);
  if (tier === 1) return { width: base.width * 0.82, depth: base.depth * 0.82, foundationHeight: 0.38, groundHeight: 2.18, upperHeight: 0.62, ridgeHeight: 1.85 };
  if (tier === 3) return { width: base.width * 1.22, depth: base.depth * 1.14, foundationHeight: 0.62, groundHeight: 2.58, upperHeight: 2.55, ridgeHeight: 2.78 };
  return base;
}

function residenceTrimMaterial(trim: ResidenceTrimColor): THREE.MeshStandardMaterial {
  if (trim === 'red') return sharedBuildingDetailMaterial('paintRed');
  if (trim === 'blue') return sharedBuildingDetailMaterial('paintBlue');
  if (trim === 'green') return sharedBuildingMaterial('moss');
  return sharedBuildingMaterial('timberDark');
}

function addFrontWindow(
  group: THREE.Group,
  windowMaterial: THREE.MeshStandardMaterial,
  shutterMaterial: THREE.MeshStandardMaterial,
  x: number,
  y: number,
  z: number,
  width = 0.82,
  height = 1.12,
  shutters = true,
): void {
  addMesh(
    group,
    new THREE.BoxGeometry(width + 0.22, height + 0.22, 0.08),
    stoneMaterial('light'),
    new THREE.Vector3(x, y, z),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(width, height, 0.075),
    windowMaterial,
    new THREE.Vector3(x, y, z + 0.065),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(width + 0.28, 0.1, 0.2),
    stoneMaterial('mortar'),
    new THREE.Vector3(x, y - height * 0.5 - 0.1, z + 0.09),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(0.055, height * 0.88, 0.055),
    timberMaterial('dark'),
    new THREE.Vector3(x, y, z + 0.125),
  );
  if (!shutters) return;

  for (const side of [-1, 1] as const) {
    addMesh(
      group,
      new THREE.BoxGeometry(width * 0.32, height * 0.92, 0.07),
      shutterMaterial,
      new THREE.Vector3(x + side * (width * 0.7), y, z + 0.08),
    );
  }
}

function addSideWindow(
  group: THREE.Group,
  windowMaterial: THREE.MeshStandardMaterial,
  side: -1 | 1,
  x: number,
  y: number,
  z: number,
  width = 0.78,
  height = 1.08,
): void {
  addMesh(
    group,
    new THREE.BoxGeometry(0.08, height + 0.22, width + 0.22),
    stoneMaterial('light'),
    new THREE.Vector3(x, y, z),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(0.075, height, width),
    windowMaterial,
    new THREE.Vector3(x + side * 0.065, y, z),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(0.18, 0.1, width + 0.28),
    stoneMaterial('mortar'),
    new THREE.Vector3(x + side * 0.09, y - height * 0.5 - 0.1, z),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(0.055, height * 0.88, 0.055),
    timberMaterial('dark'),
    new THREE.Vector3(x + side * 0.125, y, z),
  );
}

function addPlankDoor(
  group: THREE.Group,
  x: number,
  baseY: number,
  z: number,
  width = 1.02,
  height = 1.92,
): void {
  addMesh(
    group,
    new THREE.BoxGeometry(width + 0.38, height + 0.24, 0.1),
    stoneMaterial('light'),
    new THREE.Vector3(x, baseY + height * 0.5, z),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(width, height, 0.12),
    timberMaterial('dark'),
    new THREE.Vector3(x, baseY + height * 0.5, z + 0.075),
  );
  for (let plank = -1; plank <= 1; plank++) {
    addMesh(
      group,
      new THREE.BoxGeometry(0.26, height * 0.88, 0.055),
      plank === 0 ? timberMaterial('mid') : timberMaterial('weathered'),
      new THREE.Vector3(x + plank * 0.29, baseY + height * 0.5, z + 0.155),
    );
  }
  for (const y of [baseY + 0.45, baseY + 1.36]) {
    addMesh(
      group,
      new THREE.BoxGeometry(width * 0.82, 0.075, 0.055),
      timberMaterial('dark'),
      new THREE.Vector3(x, y, z + 0.205),
    );
  }
}

function addStoneStoreyCourses(
  group: THREE.Group,
  width: number,
  depth: number,
  foundationHeight: number,
  groundHeight: number,
): void {
  for (let course = 1; course <= 3; course++) {
    addMesh(
      group,
      new THREE.BoxGeometry(width + 0.04, 0.035, depth + 0.04),
      stoneMaterial('mortar'),
      new THREE.Vector3(0, foundationHeight + groundHeight * (course / 4), 0),
    );
  }
}

function addRoofCourses(
  group: THREE.Group,
  material: THREE.Material,
  halfWidth: number,
  depth: number,
  wallTop: number,
  ridgeHeight: number,
  roofPitch: number,
): void {
  for (const side of [-1, 1] as const) {
    for (let row = 0; row < 4; row++) {
      const t = (row + 0.45) / 4.8;
      addMesh(
        group,
        new THREE.BoxGeometry(0.07, 0.06, depth + 0.46),
        material,
        new THREE.Vector3(side * halfWidth * (1 - t), wallTop + ridgeHeight * t + 0.02, 0),
        new THREE.Euler(0, 0, side * -roofPitch),
      );
    }
  }
}

function addStonePortalPorch(
  group: THREE.Group,
  entryX: number,
  frontZ: number,
  foundationHeight: number,
): void {
  for (const side of [-1, 1] as const) {
    addMesh(
      group,
      new THREE.BoxGeometry(0.16, 1.72, 0.16),
      timberMaterial('dark'),
      new THREE.Vector3(entryX + side * 0.68, foundationHeight + 0.86, frontZ + 0.7),
    );
  }
  addMesh(
    group,
    new THREE.BoxGeometry(1.7, 0.12, 1.08),
    residenceRoofMaterial('red'),
    new THREE.Vector3(entryX, foundationHeight + 1.77, frontZ + 0.36),
    new THREE.Euler(-0.16, 0, 0),
  );
}

function addTimberBalcony(
  group: THREE.Group,
  entrySide: -1 | 1,
  frontZ: number,
  floorY: number,
): void {
  const width = 4.4;
  const depth = 0.62;
  const deckZ = frontZ + depth * 0.52;
  addMesh(
    group,
    new THREE.BoxGeometry(width, 0.16, depth),
    timberMaterial('mid'),
    new THREE.Vector3(0, floorY, deckZ),
  );
  for (const x of [-2.0, -1.0, 0, 1.0, 2.0]) {
    addMesh(
      group,
      new THREE.BoxGeometry(0.11, 0.82, 0.11),
      timberMaterial('dark'),
      new THREE.Vector3(x, floorY + 0.46, deckZ + depth * 0.42),
    );
  }
  addMesh(
    group,
    new THREE.BoxGeometry(width + 0.08, 0.1, 0.1),
    timberMaterial('weathered'),
    new THREE.Vector3(0, floorY + 0.84, deckZ + depth * 0.42),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(0.12, 1.95, 0.12),
    timberMaterial('dark'),
    new THREE.Vector3(-entrySide * 2.0, floorY - 0.75, deckZ),
  );
}

function addWorkingLeanTo(
  group: THREE.Group,
  side: -1 | 1,
  halfWidth: number,
  foundationHeight: number,
): void {
  const annexWidth = 0.74;
  const annexHeight = 1.78;
  const x = side * (halfWidth + annexWidth * 0.48);
  addMesh(
    group,
    new THREE.BoxGeometry(annexWidth, annexHeight, 3.4),
    timberMaterial('weathered'),
    new THREE.Vector3(x, foundationHeight + annexHeight * 0.5, -0.28),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(annexWidth + 0.22, 0.12, 3.68),
    residenceRoofMaterial('brown'),
    new THREE.Vector3(x, foundationHeight + annexHeight + 0.12, -0.28),
    new THREE.Euler(0, 0, side * 0.18),
  );
}

export function createResidenceMesh(seed = 0, tier: 1 | 2 | 3 = 1): THREE.Group {
  const appearance = pickResidenceAppearance(seed);
  const { facade, roof, archetype, entrySide, trim } = appearance;
  const dimensions = dimensionsForTier(archetype, tier);
  const wallMaterial = residenceFacadeMaterial(facade);
  const roofSurfaceMaterial = residenceRoofMaterial(roof);
  const shutterMaterial = residenceTrimMaterial(trim);
  const windowMaterial = createWindowMaterial();

  const group = new THREE.Group();
  group.name = 'Residence';
  group.userData.windowMaterial = windowMaterial;
  group.userData.residenceArchetype = archetype;
  group.userData.residenceTier = tier;

  const { width, depth, foundationHeight, groundHeight, upperHeight, ridgeHeight } = dimensions;
  const halfW = width * 0.5;
  const halfD = depth * 0.5;
  const groundTop = foundationHeight + groundHeight;
  const wallTop = groundTop + upperHeight;
  const roofPitch = Math.atan2(ridgeHeight, halfW);
  const slopeLen = halfW / Math.cos(roofPitch) + 0.3;
  const frontZ = halfD - 0.075;

  addMesh(
    group,
    new THREE.BoxGeometry(width + 0.38, foundationHeight, depth + 0.38),
    stoneMaterial('light'),
    new THREE.Vector3(0, foundationHeight * 0.5, 0),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(width, groundHeight, depth),
    stoneMaterial('mid'),
    new THREE.Vector3(0, foundationHeight + groundHeight * 0.5, 0),
  );
  addStoneStoreyCourses(group, width, depth, foundationHeight, groundHeight);

  addMesh(
    group,
    new THREE.BoxGeometry(width - 0.12, upperHeight, depth - 0.12),
    wallMaterial,
    new THREE.Vector3(0, groundTop + upperHeight * 0.5, 0),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(width + 0.12, 0.18, depth + 0.12),
    timberMaterial('dark'),
    new THREE.Vector3(0, groundTop + 0.04, 0),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(width + 0.08, 0.14, depth + 0.08),
    stoneMaterial('mortar'),
    new THREE.Vector3(0, wallTop - 0.07, 0),
  );

  const doorX = entrySide * (archetype === 'working_lean_to' ? 1.18 : 1.38);
  addPlankDoor(group, doorX, foundationHeight + 0.08, frontZ + 0.03);
  addFrontWindow(
    group,
    windowMaterial,
    shutterMaterial,
    -entrySide * 1.38,
    foundationHeight + groundHeight * 0.55,
    frontZ + 0.02,
    0.78,
    1.02,
    false,
  );

  if (tier > 1 && archetype === 'timber_balcony') {
    addFrontWindow(group, windowMaterial, shutterMaterial, -entrySide * 1.35, groundTop + upperHeight * 0.55, frontZ + 0.02);
    addPlankDoor(group, entrySide * 0.82, groundTop + 0.08, frontZ + 0.03, 0.86, 1.84);
    addTimberBalcony(group, entrySide, frontZ, groundTop + 0.08);
  } else if (tier > 1) {
    addFrontWindow(group, windowMaterial, shutterMaterial, -1.38, groundTop + upperHeight * 0.54, frontZ + 0.02);
    addFrontWindow(group, windowMaterial, shutterMaterial, 1.38, groundTop + upperHeight * 0.54, frontZ + 0.02);
  }

  for (const side of [-1, 1] as const) {
    const x = side * (halfW - 0.035);
    addSideWindow(group, windowMaterial, side, x, foundationHeight + groundHeight * 0.56, -0.35, 0.74, 0.98);
    if (tier > 1) addSideWindow(group, windowMaterial, side, x, groundTop + upperHeight * 0.54, 0.42, 0.78, 1.05);
  }

  for (let step = 0; step < 2; step++) {
    addMesh(
      group,
      new THREE.BoxGeometry(1.5 - step * 0.18, 0.16, 0.5),
      stoneMaterial(step === 0 ? 'mid' : 'light'),
      new THREE.Vector3(doorX, 0.08 + step * 0.12, halfD + 0.34 - step * 0.14),
    );
  }

  for (const side of [-1, 1] as const) {
    addMesh(
      group,
      new THREE.BoxGeometry(slopeLen, 0.14, depth + 0.48),
      roofSurfaceMaterial,
      new THREE.Vector3(side * halfW * 0.46, wallTop + ridgeHeight * 0.48, 0),
      new THREE.Euler(0, 0, side * -roofPitch),
    );
  }
  addRoofCourses(group, roofSurfaceMaterial, halfW, depth, wallTop, ridgeHeight, roofPitch);
  addMesh(
    group,
    new THREE.BoxGeometry(0.24, 0.18, depth + 0.62),
    roofSurfaceMaterial,
    new THREE.Vector3(0, wallTop + ridgeHeight + 0.035, 0),
  );

  for (const zSign of [-1, 1] as const) {
    addTriangularGableWall(
      group,
      'z',
      zSign * (halfD - 0.065),
      halfW,
      wallTop,
      ridgeHeight,
      0.16,
      wallMaterial,
    );
    for (const side of [-1, 1] as const) {
      addMesh(
        group,
        new THREE.BoxGeometry(slopeLen, 0.14, 0.15),
        timberMaterial('dark'),
        new THREE.Vector3(side * halfW * 0.46, wallTop + ridgeHeight * 0.48, zSign * (halfD + 0.16)),
        new THREE.Euler(0, 0, side * -roofPitch),
      );
    }
  }

  if (tier > 1 && archetype === 'stone_portal') {
    addStonePortalPorch(group, doorX, frontZ, foundationHeight);
  } else if (archetype === 'working_lean_to') {
    addWorkingLeanTo(group, entrySide === -1 ? 1 : -1, halfW, foundationHeight);
  }

  if (tier === 3 && archetype !== 'working_lean_to') {
    addWorkingLeanTo(group, entrySide === -1 ? 1 : -1, halfW, foundationHeight);
  }

  const chimneySide: -1 | 1 = entrySide === -1 ? 1 : -1;
  const chimneyX = chimneySide * (halfW - 0.92);
  const chimneyZ = -halfD + 1.22;
  const chimneyHeight = 2.02;
  const chimneyY = wallTop + 0.62 + chimneyHeight * 0.5;
  addMesh(
    group,
    new THREE.BoxGeometry(0.72, chimneyHeight, 0.72),
    stoneMaterial('mid'),
    new THREE.Vector3(chimneyX, chimneyY, chimneyZ),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(0.82, 0.18, 0.82),
    stoneMaterial('light'),
    new THREE.Vector3(chimneyX, chimneyY + chimneyHeight * 0.5 + 0.08, chimneyZ),
  );

  const chimneyEmitter = new THREE.Object3D();
  chimneyEmitter.name = 'ChimneyEmitter';
  chimneyEmitter.position.set(chimneyX, chimneyY + chimneyHeight * 0.5 + 0.22, chimneyZ);
  group.add(chimneyEmitter);

  const firewoodPile = new THREE.Group();
  firewoodPile.name = 'FirewoodPile';
  firewoodPile.visible = false;
  group.add(firewoodPile);
  addLogPile(firewoodPile, entrySide * (halfW - 0.72), -halfD - 0.72, 0, 4, 2.15, 0.19);

  return group;
}

const PREVIEW_OPACITY = 0.72;

export function createResidencePreviewMesh(seed = 0): THREE.Group {
  const mesh = createResidenceMesh(seed, 1);
  mesh.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const source = child.material;
    if (Array.isArray(source)) return;
    const material = source.clone();
    if (material instanceof THREE.MeshStandardMaterial) {
      material.transparent = true;
      material.opacity = PREVIEW_OPACITY;
      material.depthWrite = false;
    }
    child.material = material;
    child.renderOrder = 15;
  });
  mesh.frustumCulled = false;
  return mesh;
}

export class ResidenceMarkers {
  private readonly root: THREE.Group;
  private readonly meshes = new Map<string, THREE.Group>();
  private readonly smokeEmitters = new Map<string, ChimneySmokeEmitter>();
  private readonly smokeActive = new Map<string, boolean>();
  private readonly residenceOccupied = new Map<string, boolean>();
  private chimneySmokeAllowed = true;
  private eveningWindowGlow = 0;

  constructor(parent: THREE.Group) {
    this.root = new THREE.Group();
    this.root.name = 'Residences';
    parent.add(this.root);
  }

  setChimneySmokeAllowed(allowed: boolean): void {
    this.chimneySmokeAllowed = allowed;
    for (const [id, emitter] of this.smokeEmitters) {
      emitter.setActive(this.smokeActive.get(id) ?? false);
    }
  }

  setEveningWindowGlow(glow: number): void {
    this.eveningWindowGlow = glow;
    this.applyWindowGlow();
  }

  private applyWindowGlow(): void {
    for (const [id, marker] of this.meshes) {
      const material = marker.userData.windowMaterial as THREE.MeshStandardMaterial | undefined;
      if (!material) continue;
      applyResidenceWindowGlow(
        material,
        this.eveningWindowGlow,
        this.residenceOccupied.get(id) ?? false,
      );
    }
  }

  tick(dt: number): void {
    for (const [id, emitter] of this.smokeEmitters) {
      emitter.setActive(this.smokeActive.get(id) ?? false);
      emitter.tick(dt);
    }
  }

  syncResidences(
    residences: Iterable<ResidenceState>,
    getHeightAt: (x: number, z: number) => number,
  ): void {
    const nextIds = new Set<string>();
    for (const residence of residences) {
      nextIds.add(residence.id);
      let marker = this.meshes.get(residence.id);
      if (marker && marker.userData.residenceTier !== residence.tier) {
        this.root.remove(marker);
        disposeGroup(marker);
        this.meshes.delete(residence.id);
        this.smokeEmitters.get(residence.id)?.dispose();
        this.smokeEmitters.delete(residence.id);
        marker = undefined;
      }
      if (!marker) {
        const appearanceSeed = hashStringSeed(residence.id);
        marker = createResidenceMesh(appearanceSeed, residence.tier);
        const shadowProxy = createResidenceShadowProxy(residence.tier);
        shadowProxy.castShadow = areBuildingShadowsEnabled();
        marker.add(shadowProxy);
        this.root.add(marker);
        this.meshes.set(residence.id, marker);

        const chimneyEmitter = marker.getObjectByName('ChimneyEmitter');
        if (chimneyEmitter) {
          this.smokeEmitters.set(residence.id, new ChimneySmokeEmitter(chimneyEmitter, appearanceSeed));
        }
      }
      const y = getHeightAt(residence.x, residence.z);
      marker.position.set(residence.x, y, residence.z);
      marker.rotation.y = residence.yaw;
      this.smokeActive.set(
        residence.id,
        this.chimneySmokeAllowed
          && !residence.abandoned
          && residence.population > 0
          && getNeedStock(residence.needs, 'firewood') > 0,
      );
      this.residenceOccupied.set(
        residence.id,
        !residence.abandoned && residence.population > 0,
      );
      this.applyWindowGlowForResidence(marker, residence.id);
      syncFirewoodPile(marker, getNeedStock(residence.needs, 'firewood'));
      if (!marker.getObjectByName('Building shadow proxy')) {
        const shadowProxy = createResidenceShadowProxy(residence.tier);
        shadowProxy.castShadow = areBuildingShadowsEnabled();
        marker.add(shadowProxy);
      }
    }

    for (const [id, marker] of this.meshes) {
      if (nextIds.has(id)) continue;
      this.root.remove(marker);
      disposeGroup(marker);
      this.meshes.delete(id);
      this.smokeEmitters.get(id)?.dispose();
      this.smokeEmitters.delete(id);
      this.smokeActive.delete(id);
      this.residenceOccupied.delete(id);
    }
  }

  private applyWindowGlowForResidence(marker: THREE.Group, residenceId: string): void {
    const material = marker.userData.windowMaterial as THREE.MeshStandardMaterial | undefined;
    if (!material) return;
    applyResidenceWindowGlow(
      material,
      this.eveningWindowGlow,
      this.residenceOccupied.get(residenceId) ?? false,
    );
  }

  dispose(): void {
    for (const emitter of this.smokeEmitters.values()) {
      emitter.dispose();
    }
    this.smokeEmitters.clear();
    this.smokeActive.clear();
    this.residenceOccupied.clear();
    for (const marker of this.meshes.values()) {
      disposeGroup(marker);
    }
    this.meshes.clear();
    this.root.removeFromParent();
  }
}

function syncFirewoodPile(marker: THREE.Group, firewoodStock: number): void {
  const pile = marker.getObjectByName('FirewoodPile');
  if (!(pile instanceof THREE.Group)) return;

  if (firewoodStock <= 0.05) {
    pile.visible = false;
    return;
  }

  pile.visible = true;
  const fill = Math.min(1, firewoodStock / RESIDENCE_FIREWOOD_CAPACITY);
  const scale = 0.42 + fill * 0.58;
  pile.scale.setScalar(scale);
}

function disposeGroup(group: THREE.Group): void {
  const windowMaterial = group.userData.windowMaterial as THREE.Material | undefined;
  if (windowMaterial) windowMaterial.dispose();
  group.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
    }
  });
}
