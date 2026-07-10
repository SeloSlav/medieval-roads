import * as THREE from 'three';
import type { TerrainBounds } from '../terrain/Terrain.ts';
import { DEFAULT_FOV } from './CameraCurves.ts';
import { FP_LOCOMOTION_AIRBORNE_SUBSTEP_SCALE } from './fp/fpAirborneWalkPolicy.ts';
import {
  createFpLookInertiaState,
  normalizeBodyYaw,
  resetFpLookInertia,
  stepFpFreeLookRecenter,
  stepFpLookInertia,
  type FpLookAngleState,
} from './fp/fpCameraLook.ts';
import { CAM_BOB_DIP_Y } from './fp/fpConstants.ts';
import {
  publishCompassHeadingFromYawRad,
  resetCompassHeading,
} from '../ui/compassHeading.ts';
import {
  createFpLocomotionState,
  FP_LOCOMOTION_FEET_SKIN_M,
  FP_WALK_FOOT_RADIUS_XZ,
  fpLocomotionConstants,
  queueFpJump,
  stepFpLocomotion,
  type FpLocomotionInput,
  type FpLocomotionState,
  type FpLocomotionWalkOptions,
  type WalkGroundSampler,
} from './fp/fpLocomotion.ts';

export type FirstPersonControllerConfig = {
  camera: THREE.PerspectiveCamera;
  domElement: HTMLElement;
  bounds: TerrainBounds;
  getHeightAt: (x: number, z: number) => number;
  getRoadDeckY?: (x: number, z: number) => number | null;
  getOrbitSpawn?: () => FirstPersonSpawn;
  onModeChange?: (active: boolean) => void;
  isMenuOpen?: () => boolean;
};

export type FirstPersonSpawn = {
  x: number;
  z: number;
  yaw: number;
  pitch?: number;
};

export class FirstPersonController {
  private readonly config: FirstPersonControllerConfig;
  private readonly pos = new THREE.Vector3();
  private readonly keys = new Set<string>();
  private readonly look: FpLookAngleState = { bodyYaw: 0, pitch: 0, headLookYaw: 0 };
  private readonly lookInertia = createFpLookInertiaState();
  private readonly loco: FpLocomotionState = createFpLocomotionState();
  private readonly input: FpLocomotionInput = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    sprint: false,
    crouch: false,
    jumpHeld: false,
  };
  private readonly walkOpts: FpLocomotionWalkOptions;
  private active = false;
  private savedFov = DEFAULT_FOV;
  private reticule: HTMLElement | null = null;
  private toggleRequested = false;
  private crouchToggle = false;
  private camBobY = 0;
  private camBobRoll = 0;
  private lastEyeLine: number = fpLocomotionConstants.eyeStand;

  constructor(config: FirstPersonControllerConfig) {
    this.config = config;
    this.walkOpts = {
      sampleWalkGroundTopY: this.sampleTerrainGround,
      substepsForDt: (dtSec, state) => {
        const base = Math.max(
          1,
          Math.min(50, Math.round(fpLocomotionConstants.locomotionSubstepsPerSecond * dtSec)),
        );
        if (state.grounded) return base;
        return Math.max(1, Math.round(base * FP_LOCOMOTION_AIRBORNE_SUBSTEP_SCALE));
      },
    };

    window.addEventListener('keydown', this.onKeyDown, { capture: true });
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onWindowBlur);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    config.domElement.addEventListener('click', this.onCanvasClick);
    config.domElement.addEventListener('contextmenu', this.onContextMenu);
  }

  isActive(): boolean {
    return this.active;
  }

  toggle(spawn?: FirstPersonSpawn): void {
    if (this.active) this.deactivate();
    else this.activate(spawn ?? this.config.getOrbitSpawn?.());
  }

  activate(spawn?: FirstPersonSpawn): void {
    if (this.active) return;
    this.active = true;
    this.savedFov = this.config.camera.fov;

    const x = spawn?.x ?? 0;
    const z = spawn?.z ?? 0;
    const terrainY = this.config.getHeightAt(x, z);
    this.pos.set(x, terrainY + FP_LOCOMOTION_FEET_SKIN_M, z);
    this.look.bodyYaw = spawn?.yaw ?? 0;
    this.look.pitch = spawn?.pitch ?? 0;
    this.look.headLookYaw = 0;
    resetFpLookInertia(this.lookInertia);
    this.loco.velocity.set(0, 0, 0);
    this.loco.grounded = true;
    this.loco.jumpQueued = false;
    this.loco.headBobPhase = 0;
    this.loco.eyeSmoothed = fpLocomotionConstants.eyeStand;
    this.keys.clear();
    this.crouchToggle = false;
    this.camBobY = 0;
    this.camBobRoll = 0;
    this.lastEyeLine = fpLocomotionConstants.eyeStand;

    this.config.camera.fov = fpLocomotionConstants.cameraFovDeg;
    this.config.camera.updateProjectionMatrix();
    this.config.onModeChange?.(true);
    this.requestPointerLock();
    this.applyCameraTransform(this.lastEyeLine);
    this.syncReticuleVisibility();
  }

  deactivate(): void {
    if (!this.active) return;
    this.active = false;
    this.keys.clear();
    this.crouchToggle = false;
    this.exitPointerLock();
    this.showCrosshair(false);
    resetCompassHeading();

    this.config.camera.fov = this.savedFov;
    this.config.camera.updateProjectionMatrix();
    this.config.camera.rotation.set(0, 0, 0);
    this.config.camera.position.set(0, 0, 0);
    this.config.onModeChange?.(false);
  }

  getPosition(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(this.pos.x, this.pos.y, this.pos.z);
  }

  getBodyYaw(): number {
    return this.look.bodyYaw;
  }

  update(dt: number): void {
    if (!this.active) return;
    if (this.config.isMenuOpen?.()) return;

    this.syncInputFromKeys();
    const freeLook = this.resolveFreeLook();
    if (document.pointerLockElement === this.config.domElement) {
      stepFpLookInertia(this.lookInertia, this.look, 0, 0, dt, { freeLook });
      if (!freeLook && this.look.headLookYaw !== 0) {
        stepFpFreeLookRecenter(this.look, dt);
      }
    }

    const eyeLine = stepFpLocomotion(
      this.loco,
      this.pos,
      this.look.bodyYaw,
      this.input,
      dt,
      this.walkOpts,
    );
    this.lastEyeLine = eyeLine;
    this.clampPositionXZ();

    const horizontalSpeed = Math.hypot(this.loco.velocity.x, this.loco.velocity.z);
    const moving = this.input.forward || this.input.backward || this.input.left || this.input.right;
    if (
      this.loco.grounded &&
      !this.input.crouch &&
      !freeLook &&
      moving &&
      horizontalSpeed > 0.12
    ) {
      const walkStrength = THREE.MathUtils.clamp(
        horizontalSpeed / fpLocomotionConstants.sprintSpeedMps,
        0,
        1,
      );
      const dip = Math.sin(this.loco.headBobPhase * 2) * CAM_BOB_DIP_Y * walkStrength;
      this.camBobY = dip;
      this.camBobRoll = 0;
    } else {
      this.camBobY = THREE.MathUtils.damp(this.camBobY, 0, 10, dt);
      this.camBobRoll = THREE.MathUtils.damp(this.camBobRoll, 0, 10, dt);
    }

    this.applyCameraTransform(eyeLine);
    this.syncReticuleVisibility();
  }

  dispose(): void {
    this.deactivate();
    window.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onWindowBlur);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    this.config.domElement.removeEventListener('click', this.onCanvasClick);
    this.config.domElement.removeEventListener('contextmenu', this.onContextMenu);
    this.reticule?.remove();
    this.reticule = null;
  }

  private applyCameraTransform(eyeLine: number): void {
    const camera = this.config.camera;
    const yaw = this.look.bodyYaw + this.look.headLookYaw;
    camera.position.set(this.pos.x, this.pos.y + eyeLine + this.camBobY, this.pos.z);
    camera.rotation.order = 'YXZ';
    camera.rotation.y = yaw;
    camera.rotation.x = this.look.pitch;
    camera.rotation.z = this.camBobRoll;
    publishCompassHeadingFromYawRad(yaw);
  }

  private applyLookFromPointer(deltaX: number, deltaY: number): void {
    const freeLook = this.resolveFreeLook();
    stepFpLookInertia(this.lookInertia, this.look, deltaX, deltaY, 0, { freeLook });
    this.applyCameraTransform(this.lastEyeLine);
  }

  private readonly sampleTerrainGround: WalkGroundSampler = (worldX, worldZ) => {
    const terrainY = sampleTerrainWalkTop(this.config.getHeightAt, worldX, worldZ);
    const roadY = this.config.getRoadDeckY?.(worldX, worldZ);
    return roadY != null ? Math.max(terrainY, roadY) : terrainY;
  };

  private clampPositionXZ(): void {
    const { bounds } = this.config;
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, bounds.minX, bounds.maxX);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, bounds.minZ, bounds.maxZ);
  }

  private resolveFreeLook(): boolean {
    return this.keys.has('AltLeft') || this.keys.has('AltRight');
  }

  private syncInputFromKeys(): void {
    this.input.forward = this.keys.has('KeyW') || this.keys.has('ArrowUp');
    this.input.backward = this.keys.has('KeyS') || this.keys.has('ArrowDown');
    this.input.left = this.keys.has('KeyA') || this.keys.has('ArrowLeft');
    this.input.right = this.keys.has('KeyD') || this.keys.has('ArrowRight');
    this.input.sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    this.input.crouch = this.crouchToggle;
    this.input.jumpHeld = this.keys.has('Space');
  }

  private commitFreeLookIntoBodyYaw(): void {
    if (this.look.headLookYaw !== 0) {
      this.look.bodyYaw += this.look.headLookYaw;
      this.look.headLookYaw = 0;
      this.look.bodyYaw = normalizeBodyYaw(this.look.bodyYaw);
    }
  }

  private resetTransientInputState(): void {
    this.commitFreeLookIntoBodyYaw();
    resetFpLookInertia(this.lookInertia);
    this.keys.clear();
  }

  private requestPointerLock(): void {
    void this.config.domElement.requestPointerLock();
  }

  private exitPointerLock(): void {
    if (document.pointerLockElement === this.config.domElement) {
      document.exitPointerLock();
    }
  }

  private showCrosshair(visible: boolean): void {
    if (!this.reticule) {
      this.reticule = document.createElement('div');
      this.reticule.className = 'fps-reticule';
      this.reticule.setAttribute('aria-hidden', 'true');
      this.reticule.innerHTML = `
        <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
          <line x1="11" y1="2" x2="11" y2="3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          <line x1="11" y1="19" x2="11" y2="20" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          <line x1="2" y1="11" x2="3" y2="11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          <line x1="19" y1="11" x2="20" y2="11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          <circle cx="11" cy="11" r="1.2" fill="currentColor" opacity="0.35" />
        </svg>
      `;
      this.config.domElement.parentElement?.appendChild(this.reticule);
    }
    this.reticule.hidden = !visible;
  }

  private syncReticuleVisibility(): void {
    if (!this.active) {
      this.showCrosshair(false);
      return;
    }
    const locked = document.pointerLockElement === this.config.domElement;
    this.showCrosshair(locked);
  }

  private isToggleKey(event: KeyboardEvent): boolean {
    return event.code === 'Backquote' || event.key === '`' || event.key === '~';
  }

  private isTextInputFocused(): boolean {
    const target = document.activeElement as HTMLElement | null;
    const tag = target?.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || Boolean(target?.isContentEditable);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (this.isTextInputFocused()) return;

    if (this.isToggleKey(event)) {
      event.preventDefault();
      event.stopPropagation();
      this.toggleRequested = true;
      this.toggle();
      return;
    }

    if (!this.active) return;
    if (this.config.isMenuOpen?.()) return;

    if (event.code === 'AltLeft' || event.code === 'AltRight') {
      event.preventDefault();
    }

    this.keys.add(event.code);

    if (event.code === 'Escape') {
      if (this.config.isMenuOpen?.()) return;
      event.preventDefault();
      this.deactivate();
      return;
    }

    if (event.code === 'Space' && !event.repeat) {
      event.preventDefault();
      queueFpJump(this.loco);
    }

    if (event.code === 'KeyC' && !event.repeat) {
      event.preventDefault();
      this.crouchToggle = !this.crouchToggle;
    }
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
    if (event.code === 'AltLeft' || event.code === 'AltRight') {
      resetFpLookInertia(this.lookInertia);
    }
  };

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (!this.active || this.config.isMenuOpen?.()) return;
    if (document.pointerLockElement !== this.config.domElement) return;
    if (event.movementX === 0 && event.movementY === 0) return;
    this.applyLookFromPointer(event.movementX, event.movementY);
  };

  private readonly onPointerLockChange = (): void => {
    this.syncReticuleVisibility();
    if (!this.active) return;
    if (document.pointerLockElement === this.config.domElement) return;
    if (this.toggleRequested) {
      this.toggleRequested = false;
      return;
    }
    this.deactivate();
  };

  private readonly onCanvasClick = (): void => {
    if (!this.active) return;
    if (document.pointerLockElement !== this.config.domElement) {
      this.requestPointerLock();
    }
  };

  private readonly onContextMenu = (event: Event): void => {
    if (!this.active) return;
    event.preventDefault();
  };

  private readonly onWindowBlur = (): void => {
    if (!this.active) return;
    this.resetTransientInputState();
  };

  private readonly onVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden' && this.active) {
      this.resetTransientInputState();
    }
  };
}

/** Max terrain under the foot disk — keeps the body on slopes like Mammoth walk AABBs. */
function sampleTerrainWalkTop(
  getHeightAt: (x: number, z: number) => number,
  x: number,
  z: number,
): number {
  const r = FP_WALK_FOOT_RADIUS_XZ;
  let top = getHeightAt(x, z);
  top = Math.max(top, getHeightAt(x + r, z));
  top = Math.max(top, getHeightAt(x - r, z));
  top = Math.max(top, getHeightAt(x, z + r));
  top = Math.max(top, getHeightAt(x, z - r));
  return top;
}
