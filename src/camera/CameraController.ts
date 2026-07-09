import * as THREE from 'three';
import type { TerrainBounds } from '../terrain/Terrain.ts';

const DEFAULT_PITCH = THREE.MathUtils.degToRad(7);
const MIN_PITCH = THREE.MathUtils.degToRad(5);
const MAX_PITCH = THREE.MathUtils.degToRad(70);
const MIN_DISTANCE = 16;
const MAX_DISTANCE = 300;
const DEFAULT_DISTANCE = 88;
const ZOOM_MULTIPLIER = 1.18;
const PAN_LERP_SPEED = 10;
const ROTATE_LERP_SPEED = 12;
const ZOOM_LERP_SPEED = 12;
const ROTATE_SENSITIVITY = 0.005;
const PITCH_SENSITIVITY = 0.004;
const RMB_PAN_MULTIPLIER = 0.105;
const KEY_PAN_SPEED = 34;
const KEY_ROTATE_SPEED = 2.8;

export type CameraControllerConfig = {
  camera: THREE.PerspectiveCamera;
  target: THREE.Vector3;
  domElement: HTMLElement;
  bounds: TerrainBounds;
  getHeightAt: (x: number, z: number) => number;
  getCursorOverride?: () => string | null;
};

export class CameraController {
  private readonly config: CameraControllerConfig;
  private currentDistance = DEFAULT_DISTANCE;
  private targetDistance = DEFAULT_DISTANCE;
  private currentYaw = -Math.PI / 2;
  private targetYaw = -Math.PI / 2;
  private currentPitch = DEFAULT_PITCH;
  private targetPitch = DEFAULT_PITCH;
  private desiredTarget = new THREE.Vector3();
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

  update(dt: number): void {
    const scale = this.getPanScale();
    const panSpeed = KEY_PAN_SPEED * scale * dt;
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
    this.currentPitch += (this.targetPitch - this.currentPitch) * rotLerp;
    this.currentDistance += (this.targetDistance - this.currentDistance) * zoomLerp;
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
      const dx = (event.clientX - this.lastMouseX) * RMB_PAN_MULTIPLIER * this.getPanScale();
      const dy = (event.clientY - this.lastMouseY) * RMB_PAN_MULTIPLIER * this.getPanScale();
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
      this.targetPitch = THREE.MathUtils.clamp(this.targetPitch + dy * PITCH_SENSITIVITY, MIN_PITCH, MAX_PITCH);
      this.targetDistance = this.clampDistance(this.targetDistance);
    }
  };

  private readonly onMouseUp = (event: MouseEvent): void => {
    if (event.button === 2) this.isPanning = false;
    if (event.button === 1) this.isRotating = false;
  };

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    if (event.deltaY !== 0) {
      const steps = Math.max(1, Math.floor(Math.abs(event.deltaY) / 80));
      const factor = event.deltaY > 0 ? ZOOM_MULTIPLIER : 1 / ZOOM_MULTIPLIER;
      for (let i = 0; i < steps; i++) this.targetDistance = this.clampDistance(this.targetDistance * factor);
    }
    if (event.deltaX !== 0) this.pan(event.deltaX * 0.03, 0);
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
    const ratio = this.currentDistance / 48;
    return THREE.MathUtils.clamp(ratio * ratio * 1.8, 0.55, 18);
  }

  private clampDistance(value: number): number {
    const minForTerrain = MIN_DISTANCE + Math.max(0, this.config.getHeightAt(this.config.target.x, this.config.target.z)) * 0.08;
    return THREE.MathUtils.clamp(value, minForTerrain, MAX_DISTANCE);
  }

  private clampTarget(): void {
    const { bounds } = this.config;
    this.desiredTarget.x = THREE.MathUtils.clamp(this.desiredTarget.x, bounds.minX, bounds.maxX);
    this.desiredTarget.z = THREE.MathUtils.clamp(this.desiredTarget.z, bounds.minZ, bounds.maxZ);
    this.desiredTarget.y = this.config.getHeightAt(this.desiredTarget.x, this.desiredTarget.z);
  }

  private updateCamera(): void {
    const dir = new THREE.Vector3(
      Math.cos(this.currentPitch) * Math.cos(this.currentYaw),
      Math.sin(this.currentPitch),
      Math.cos(this.currentPitch) * Math.sin(this.currentYaw)
    );
    this.config.camera.position.copy(this.config.target).addScaledVector(dir, this.currentDistance);
    this.config.camera.lookAt(this.config.target);
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


