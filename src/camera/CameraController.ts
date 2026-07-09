import * as THREE from 'three';
import type { TerrainBounds } from '../terrain/Terrain.ts';
import {
  DEFAULT_ZOOM01,
  MIN_CAMERA_TERRAIN_CLEARANCE,
  evalCameraRigPose,
  zoom01ToPercent,
} from './CameraCurves.ts';

const PAN_LERP_SPEED = 10;
const ROTATE_LERP_SPEED = 12;
const ZOOM_LERP_SPEED = 12;
const ROTATE_SENSITIVITY = 0.005;
const PITCH_OFFSET_SENSITIVITY = 0.003;
const MAX_PITCH_OFFSET = THREE.MathUtils.degToRad(12);
const RMB_PAN_MULTIPLIER = 0.105;
const KEY_PAN_SPEED = 34;
const KEY_ROTATE_SPEED = 2.8;
const WHEEL_ZOOM_STEP = 0.045;
const CURSOR_ANCHOR_STRENGTH = 2.8;
const HORIZONTAL_WHEEL_PAN = 0.03;

export type CameraControllerConfig = {
  camera: THREE.PerspectiveCamera;
  target: THREE.Vector3;
  domElement: HTMLElement;
  bounds: TerrainBounds;
  getHeightAt: (x: number, z: number) => number;
  pickAtScreen?: (clientX: number, clientY: number) => THREE.Vector3 | null;
  getCursorOverride?: () => string | null;
  shouldIgnoreInput?: (event: MouseEvent | WheelEvent) => boolean;
};

/**
 * Manor Lords-style camera rig: orbits a terrain target at far/mid zoom, then
 * blends into a low ground-eye perspective when zoomed close.
 */
export class CameraController {
  private readonly config: CameraControllerConfig;
  private readonly desiredTarget = new THREE.Vector3();
  private readonly orbitPosition = new THREE.Vector3();
  private readonly closePosition = new THREE.Vector3();
  private readonly lookAtPoint = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly orbitDirection = new THREE.Vector3();

  private currentZoom01 = DEFAULT_ZOOM01;
  private targetZoom01 = DEFAULT_ZOOM01;
  private currentYaw = -Math.PI / 2;
  private targetYaw = -Math.PI / 2;
  private pitchOffset = 0;
  private targetPitchOffset = 0;
  private readonly keys = new Set<string>();
  private isPanning = false;
  private isRotating = false;
  private lastMouseX = 0;
  private lastMouseY = 0;

  constructor(config: CameraControllerConfig) {
    this.config = config;
    this.config.target.set(0, config.getHeightAt(0, 0), 0);
    this.desiredTarget.copy(this.config.target);
    this.updateCamera();
    config.domElement.addEventListener('mousedown', this.onMouseDown, { capture: true });
    config.domElement.addEventListener('wheel', this.onWheel, { passive: false, capture: true });
    config.domElement.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  getZoomPercent(): number {
    return zoom01ToPercent(this.currentZoom01);
  }

  update(dt: number): void {
    const pose = evalCameraRigPose(this.currentZoom01);
    const panSpeed = KEY_PAN_SPEED * pose.panSpeed * dt;
    if (this.keys.has('w') || this.keys.has('arrowup')) this.pan(0, panSpeed);
    if (this.keys.has('s') || this.keys.has('arrowdown')) this.pan(0, -panSpeed);
    if (this.keys.has('a') || this.keys.has('arrowleft')) this.pan(panSpeed, 0);
    if (this.keys.has('d') || this.keys.has('arrowright')) this.pan(-panSpeed, 0);
    if (this.keys.has('q')) this.targetYaw = this.normalizeAngle(this.targetYaw - KEY_ROTATE_SPEED * dt);
    if (this.keys.has('e')) this.targetYaw = this.normalizeAngle(this.targetYaw + KEY_ROTATE_SPEED * dt);

    const panLerp = 1 - Math.exp(-PAN_LERP_SPEED * dt);
    const rotLerp = 1 - Math.exp(-ROTATE_LERP_SPEED * dt);
    const zoomLerp = 1 - Math.exp(-ZOOM_LERP_SPEED * dt);

    this.config.target.lerp(this.desiredTarget, panLerp);
    this.config.target.y = this.config.getHeightAt(this.config.target.x, this.config.target.z);

    this.currentYaw = this.normalizeAngle(this.currentYaw + this.normalizeAngle(this.targetYaw - this.currentYaw) * rotLerp);
    this.pitchOffset += (this.targetPitchOffset - this.pitchOffset) * rotLerp;
    this.currentZoom01 += (this.targetZoom01 - this.currentZoom01) * zoomLerp;

    this.updateCamera();
    this.applyCursor();
  }

  dispose(): void {
    const el = this.config.domElement;
    el.removeEventListener('mousedown', this.onMouseDown, true);
    el.removeEventListener('wheel', this.onWheel, true);
    el.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    el.style.cursor = '';
    document.body.style.cursor = '';
  }

  private readonly onMouseDown = (event: MouseEvent): void => {
    if (!this.config.domElement.contains(event.target as Node)) return;
    if (this.config.shouldIgnoreInput?.(event)) return;
    if (event.button === 2) {
      this.isPanning = true;
      this.lastMouseX = event.clientX;
      this.lastMouseY = event.clientY;
      event.preventDefault();
    } else if (event.button === 1) {
      this.isRotating = true;
      this.lastMouseX = event.clientX;
      this.lastMouseY = event.clientY;
      event.preventDefault();
    }
  };

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (this.isPanning) {
      if ((event.buttons & 2) === 0) {
        this.isPanning = false;
        return;
      }
      const scale = this.getPanScale();
      const dx = (event.clientX - this.lastMouseX) * RMB_PAN_MULTIPLIER * scale;
      const dy = (event.clientY - this.lastMouseY) * RMB_PAN_MULTIPLIER * scale;
      this.lastMouseX = event.clientX;
      this.lastMouseY = event.clientY;
      this.pan(dx, dy);
    } else if (this.isRotating) {
      if ((event.buttons & 4) === 0) {
        this.isRotating = false;
        return;
      }
      const dx = event.clientX - this.lastMouseX;
      const dy = event.clientY - this.lastMouseY;
      this.lastMouseX = event.clientX;
      this.lastMouseY = event.clientY;
      this.targetYaw = this.normalizeAngle(this.targetYaw - dx * ROTATE_SENSITIVITY);
      const closeBlend = evalCameraRigPose(this.currentZoom01).closeBlend;
      const pitchScale = 1 - closeBlend;
      this.targetPitchOffset = THREE.MathUtils.clamp(
        this.targetPitchOffset + dy * PITCH_OFFSET_SENSITIVITY * pitchScale,
        -MAX_PITCH_OFFSET,
        MAX_PITCH_OFFSET,
      );
    }
  };

  private readonly onMouseUp = (event: MouseEvent): void => {
    if (event.button === 2) this.isPanning = false;
    if (event.button === 1) this.isRotating = false;
  };

  private readonly onWheel = (event: WheelEvent): void => {
    if (this.config.shouldIgnoreInput?.(event)) return;
    event.preventDefault();
    if (event.deltaY !== 0) {
      const steps = Math.max(1, Math.floor(Math.abs(event.deltaY) / 80));
      const direction = event.deltaY < 0 ? 1 : -1;
      for (let i = 0; i < steps; i++) this.applyZoomStep(direction, event.clientX, event.clientY);
    }
    if (event.deltaX !== 0) this.pan(event.deltaX * HORIZONTAL_WHEEL_PAN, 0);
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement | null;
    const tag = target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
    const key = event.key.toLowerCase();
    if (key.startsWith('arrow')) event.preventDefault();
    this.keys.add(key);
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.key.toLowerCase());
  };

  private readonly onContextMenu = (event: Event): void => event.preventDefault();

  private applyZoomStep(direction: 1 | -1, clientX: number, clientY: number): void {
    const beforeZoom = this.targetZoom01;
    this.targetZoom01 = THREE.MathUtils.clamp(this.targetZoom01 + direction * WHEEL_ZOOM_STEP, 0, 1);
    const zoomDelta = this.targetZoom01 - beforeZoom;
    if (zoomDelta === 0) return;

    const pick = this.config.pickAtScreen?.(clientX, clientY);
    if (pick) {
      const anchorT = Math.abs(zoomDelta) * CURSOR_ANCHOR_STRENGTH;
      this.desiredTarget.x += (pick.x - this.desiredTarget.x) * anchorT;
      this.desiredTarget.z += (pick.z - this.desiredTarget.z) * anchorT;
      this.clampTarget();
    }
  }

  private pan(dx: number, dy: number): void {
    const rightX = -Math.sin(this.currentYaw);
    const rightZ = Math.cos(this.currentYaw);
    const forwardX = -Math.cos(this.currentYaw);
    const forwardZ = -Math.sin(this.currentYaw);
    this.desiredTarget.x += rightX * dx + forwardX * dy;
    this.desiredTarget.z += rightZ * dx + forwardZ * dy;
    this.clampTarget();
  }

  private getPanScale(): number {
    return evalCameraRigPose(this.currentZoom01).panSpeed;
  }

  private clampTarget(): void {
    const { bounds } = this.config;
    this.desiredTarget.x = THREE.MathUtils.clamp(this.desiredTarget.x, bounds.minX, bounds.maxX);
    this.desiredTarget.z = THREE.MathUtils.clamp(this.desiredTarget.z, bounds.minZ, bounds.maxZ);
    this.desiredTarget.y = this.config.getHeightAt(this.desiredTarget.x, this.desiredTarget.z);
  }

  private getForwardXZ(): THREE.Vector3 {
    this.forward.set(-Math.cos(this.currentYaw), 0, -Math.sin(this.currentYaw));
    return this.forward;
  }

  private updateCamera(): void {
    const pose = evalCameraRigPose(this.currentZoom01);
    const target = this.config.target;
    const forward = this.getForwardXZ();
    const pitch = pose.orbitPitch + this.pitchOffset * (1 - pose.closeBlend);

    this.orbitDirection.set(
      Math.cos(pitch) * Math.cos(this.currentYaw),
      Math.sin(pitch),
      Math.cos(pitch) * Math.sin(this.currentYaw),
    );
    this.orbitPosition.copy(target).addScaledVector(this.orbitDirection, pose.orbitDistance);

    const camX = target.x - forward.x * pose.backDistance;
    const camZ = target.z - forward.z * pose.backDistance;
    const terrainUnderCamera = this.config.getHeightAt(camX, camZ);
    this.closePosition.set(camX, terrainUnderCamera + pose.heightAboveTerrain, camZ);

    const camera = this.config.camera;
    camera.position.lerpVectors(this.orbitPosition, this.closePosition, pose.closeBlend);
    this.enforceTerrainClearance(camera.position);

    const lookX = target.x + forward.x * pose.lookAhead;
    const lookZ = target.z + forward.z * pose.lookAhead;
    const lookTerrainY = this.config.getHeightAt(lookX, lookZ);
    this.lookAtPoint.set(lookX, lookTerrainY + pose.lookHeightOffset, lookZ);
    const orbitLookAt = target;
    this.lookAtPoint.lerp(orbitLookAt, 1 - pose.closeBlend);
    camera.lookAt(this.lookAtPoint);

    if (Math.abs(camera.fov - pose.fov) > 0.01) {
      camera.fov = pose.fov;
      camera.updateProjectionMatrix();
    }
  }

  private enforceTerrainClearance(position: THREE.Vector3): void {
    const terrainY = this.config.getHeightAt(position.x, position.z);
    const minY = terrainY + MIN_CAMERA_TERRAIN_CLEARANCE;
    if (position.y < minY) position.y = minY;
  }

  private applyCursor(): void {
    const override = this.config.getCursorOverride?.();
    let cursor = override ?? 'default';
    if (!override && this.isPanning) cursor = 'move';
    if (!override && this.isRotating) cursor = 'grabbing';
    this.config.domElement.style.cursor = cursor;
    document.body.style.cursor = cursor;
  }

  private normalizeAngle(angle: number): number {
    return Math.atan2(Math.sin(angle), Math.cos(angle));
  }
}
