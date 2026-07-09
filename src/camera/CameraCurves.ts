import * as THREE from 'three';

/**
 * Normalized zoom in [0, 1]: 0 = far strategy view, 1 = close ground-eye view.
 * Tune these constants to adjust camera feel without touching controller logic.
 */

/** Zoom level that maps to 100% in the zoom HUD. */
export const DEFAULT_ZOOM01 = 0.35;

/** Close-ground rig blend begins here; below feels like a normal strategy camera. */
export const CLOSE_ZOOM_BLEND_START = 0.65;

// ── Far (zoom01 = 0) ──────────────────────────────────────────────────────────
export const FAR_ORBIT_DISTANCE = 110;
export const FAR_ORBIT_PITCH = THREE.MathUtils.degToRad(62);
export const FAR_PAN_SPEED = 1.0;
export const FAR_FOV = 54;

// ── Mid (zoom01 ≈ 0.5) ────────────────────────────────────────────────────────
export const MID_ORBIT_DISTANCE = 52;
export const MID_ORBIT_PITCH = THREE.MathUtils.degToRad(42);
export const MID_PAN_SPEED = 0.45;

// ── Close (zoom01 = 1) ────────────────────────────────────────────────────────
export const CLOSE_BACK_DISTANCE = 13;
export const CLOSE_HEIGHT_ABOVE_TERRAIN = 4;
export const CLOSE_LOOK_AHEAD = 12;
export const CLOSE_LOOK_HEIGHT_OFFSET = 0.35;
export const CLOSE_PAN_SPEED = 0.12;
export const CLOSE_FOV = 48;

/** Minimum clearance between camera and sampled terrain height. */
export const MIN_CAMERA_TERRAIN_CLEARANCE = 1.8;

/** UI zoom percent baseline and ceiling. */
export const BASELINE_ZOOM_PERCENT = 100;
export const MAX_ZOOM_PERCENT = 1000;

/** Smoothstep in [0, 1] with zero derivatives at both ends. */
export function smoothstep01(t: number): number {
  const x = THREE.MathUtils.clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

/** Blend weight for the low ground-eye rig; stays 0 until CLOSE_ZOOM_BLEND_START. */
export function evalCloseBlend(zoom01: number): number {
  return smoothstep01(
    (THREE.MathUtils.clamp(zoom01, 0, 1) - CLOSE_ZOOM_BLEND_START) / (1 - CLOSE_ZOOM_BLEND_START),
  );
}

/** Piecewise lerp across far → mid → close keyframes. */
export function lerpZoomKeyframes(zoom01: number, far: number, mid: number, close: number): number {
  const t = THREE.MathUtils.clamp(zoom01, 0, 1);
  if (t <= 0.5) return THREE.MathUtils.lerp(far, mid, t / 0.5);
  return THREE.MathUtils.lerp(mid, close, (t - 0.5) / 0.5);
}

export type CameraRigPose = {
  orbitDistance: number;
  orbitPitch: number;
  backDistance: number;
  heightAboveTerrain: number;
  lookAhead: number;
  lookHeightOffset: number;
  panSpeed: number;
  fov: number;
  closeBlend: number;
};

/** Derive all rig parameters from a single normalized zoom value. */
export function evalCameraRigPose(zoom01: number): CameraRigPose {
  const closeBlend = evalCloseBlend(zoom01);
  return {
    orbitDistance: lerpZoomKeyframes(zoom01, FAR_ORBIT_DISTANCE, MID_ORBIT_DISTANCE, CLOSE_BACK_DISTANCE * 1.4),
    orbitPitch: lerpZoomKeyframes(zoom01, FAR_ORBIT_PITCH, MID_ORBIT_PITCH, THREE.MathUtils.degToRad(10)),
    backDistance: lerpZoomKeyframes(zoom01, FAR_ORBIT_DISTANCE, MID_ORBIT_DISTANCE, CLOSE_BACK_DISTANCE),
    heightAboveTerrain: lerpZoomKeyframes(zoom01, 0, 0, CLOSE_HEIGHT_ABOVE_TERRAIN),
    lookAhead: lerpZoomKeyframes(zoom01, 0, 2, CLOSE_LOOK_AHEAD),
    lookHeightOffset: lerpZoomKeyframes(zoom01, 0, 0.1, CLOSE_LOOK_HEIGHT_OFFSET),
    panSpeed: lerpZoomKeyframes(zoom01, FAR_PAN_SPEED, MID_PAN_SPEED, CLOSE_PAN_SPEED),
    fov: lerpZoomKeyframes(zoom01, FAR_FOV, FAR_FOV, CLOSE_FOV),
    closeBlend,
  };
}

/** Map zoom01 to HUD zoom percent using equivalent orbit distance. */
export function zoom01ToPercent(zoom01: number): number {
  const pose = evalCameraRigPose(zoom01);
  const defaultPose = evalCameraRigPose(DEFAULT_ZOOM01);
  const refDistance = defaultPose.orbitDistance;
  const distance = THREE.MathUtils.lerp(pose.orbitDistance, pose.backDistance, pose.closeBlend);
  return THREE.MathUtils.clamp((refDistance / distance) * BASELINE_ZOOM_PERCENT, 1, MAX_ZOOM_PERCENT);
}
