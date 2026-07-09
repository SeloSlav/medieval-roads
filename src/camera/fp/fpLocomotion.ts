import * as THREE from 'three';
import {
  FP_LOCOMOTION_AIRBORNE_SUBSTEP_SCALE,
  FP_JUMP_ASCENT_SKIP_WALK_PROBE_VY,
  resolveFpWalkProbePhase,
  type FpWalkProbePhase,
} from './fpAirborneWalkPolicy.ts';
import { OUTDOOR_SPRINT_SPEED_MPS, OUTDOOR_WALK_SPEED_MPS } from './fpConstants.ts';

/** Match The Mammoth `apps/server` pose clamp lower bound. */
const FLOOR_Y = 0.35;
export const FP_LOCOMOTION_FEET_SKIN_M = 0.034;
const SKIN = FP_LOCOMOTION_FEET_SKIN_M;

const GRAVITY = 21.5;
const JUMP_SPEED = 5.7;
const WALK_SPEED = OUTDOOR_WALK_SPEED_MPS;
const SPRINT_SPEED = OUTDOOR_SPRINT_SPEED_MPS;
const CROUCH_SPEED = 2.8;
const GROUND_ACCEL = 19;
const AIR_ACCEL = 7.8;
const JUMP_RISE_CUT_FACTOR = 0.91;
const DRAG = 10;
const STOP_SPEED_EPS = 0.01;

const EYE_STAND = 1.55;
const EYE_CROUCH = 1.0;
const EYE_DAMP = 12;

export const FP_WALK_FOOT_RADIUS_XZ = 0.22;
export const FP_WALK_STEP_UP_MARGIN = 0.82;
export const FP_LOCOMOTION_SUBSTEPS_PER_SECOND = 200;
export const FP_WALK_PROBE_DY = 1.05;
export const FP_WALK_MAX_SUPPORT_DROP_M = 3.1;
const FP_WALK_DUAL_PROBE_MIN_XZ_TRAVEL_SQ = 0.0009;

const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _desired = new THREE.Vector3();
const _input2 = new THREE.Vector2();

export type WalkGroundSampler = (
  worldX: number,
  worldZ: number,
  probeTopY: number,
  phase: FpWalkProbePhase,
) => number;

export type FpLocomotionWalkOptions = {
  sampleWalkGroundTopY: WalkGroundSampler;
  probeDy?: number;
  maxSupportDropM?: number;
  sprintSpeedMps?: number;
  walkSpeedMps?: number;
  substepsForDt?: (dtSec: number, state: FpLocomotionState) => number;
};

export type FpLocomotionInput = {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  sprint: boolean;
  crouch: boolean;
  jumpHeld: boolean;
};

export type FpLocomotionState = {
  velocity: THREE.Vector3;
  grounded: boolean;
  headBobPhase: number;
  jumpQueued: boolean;
  eyeSmoothed: number;
};

export function createFpLocomotionState(): FpLocomotionState {
  return {
    velocity: new THREE.Vector3(),
    grounded: true,
    headBobPhase: 0,
    jumpQueued: false,
    eyeSmoothed: EYE_STAND,
  };
}

export function queueFpJump(state: FpLocomotionState): void {
  state.jumpQueued = true;
}

function defaultSubstepsForDt(dtSec: number): number {
  return Math.max(1, Math.min(50, Math.round(FP_LOCOMOTION_SUBSTEPS_PER_SECOND * dtSec)));
}

export function stepFpLocomotion(
  state: FpLocomotionState,
  pos: THREE.Vector3,
  yaw: number,
  input: FpLocomotionInput,
  dt: number,
  walk?: FpLocomotionWalkOptions,
): number {
  const h = Math.min(Math.max(dt, 0), 0.05);

  _input2.set(
    Number(input.right) - Number(input.left),
    Number(input.forward) - Number(input.backward),
  );
  if (_input2.lengthSq() > 1) _input2.normalize();

  _forward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
  _right.set(Math.cos(yaw), 0, -Math.sin(yaw));
  _desired.copy(_forward).multiplyScalar(_input2.y);
  _desired.addScaledVector(_right, _input2.x);

  const walkSpeed = walk?.walkSpeedMps ?? WALK_SPEED;
  const sprintSpeed = walk?.sprintSpeedMps ?? SPRINT_SPEED;
  const speed = input.crouch ? CROUCH_SPEED : input.sprint ? sprintSpeed : walkSpeed;
  const accel = state.grounded ? GROUND_ACCEL : AIR_ACCEL;
  const targetVx = _desired.x * speed;
  const targetVz = _desired.z * speed;

  state.velocity.x = THREE.MathUtils.damp(state.velocity.x, targetVx, accel, h);
  state.velocity.z = THREE.MathUtils.damp(state.velocity.z, targetVz, accel, h);

  const moving = _input2.lengthSq() > 0.0001;
  if (!moving && state.grounded) {
    state.velocity.x = THREE.MathUtils.damp(state.velocity.x, 0, DRAG, h);
    state.velocity.z = THREE.MathUtils.damp(state.velocity.z, 0, DRAG, h);
    if (Math.hypot(state.velocity.x, state.velocity.z) <= STOP_SPEED_EPS) {
      state.velocity.x = 0;
      state.velocity.z = 0;
    }
  }

  if (state.grounded && state.jumpQueued) {
    state.velocity.y = JUMP_SPEED;
    state.grounded = false;
  }
  state.jumpQueued = false;

  const probeDy = walk?.probeDy ?? FP_WALK_PROBE_DY;
  const maxSupportDrop = walk?.maxSupportDropM ?? FP_WALK_MAX_SUPPORT_DROP_M;
  const substeps = walk?.sampleWalkGroundTopY
    ? (walk.substepsForDt ?? defaultSubstepsForDt)(h, state)
    : 1;
  const sh = h / substeps;

  for (let i = 0; i < substeps; i++) {
    const x0 = pos.x;
    const z0 = pos.z;
    state.velocity.y -= GRAVITY * sh;
    if (state.velocity.y > 0.02 && !input.jumpHeld) {
      state.velocity.y *= JUMP_RISE_CUT_FACTOR;
    }
    pos.x += state.velocity.x * sh;
    pos.z += state.velocity.z * sh;
    pos.y += state.velocity.y * sh;
    if (walk?.sampleWalkGroundTopY) {
      const phase = resolveFpWalkProbePhase(state.grounded, state.velocity.y);
      if (phase === 'skip') {
        state.grounded = false;
      } else {
        const probeY = pos.y + probeDy;
        const dx = pos.x - x0;
        const dz = pos.z - z0;
        let walkTop: number;
        if (dx * dx + dz * dz < FP_WALK_DUAL_PROBE_MIN_XZ_TRAVEL_SQ) {
          walkTop = walk.sampleWalkGroundTopY(pos.x, pos.z, probeY, phase);
        } else {
          const w0 = walk.sampleWalkGroundTopY(x0, z0, probeY, phase);
          const w1 = walk.sampleWalkGroundTopY(pos.x, pos.z, probeY, phase);
          walkTop = w0;
          if (Number.isFinite(w1)) {
            walkTop = Number.isFinite(w0) ? Math.max(w0, w1) : w1;
          }
        }
        const snapEps = 0.006;
        const descending = phase === 'descent';
        const snapAbove = descending
          ? Math.max(snapEps, 0.2, -state.velocity.y * sh * 2.5)
          : snapEps;
        if (
          Number.isFinite(walkTop) &&
          walkTop > pos.y - maxSupportDrop &&
          pos.y <= walkTop + SKIN + snapAbove
        ) {
          pos.y = walkTop + SKIN;
          state.velocity.y = 0;
          state.grounded = true;
        } else if (!Number.isFinite(walkTop) || walkTop <= pos.y - maxSupportDrop) {
          state.grounded = false;
        }
      }
    } else if (pos.y <= FLOOR_Y + SKIN) {
      pos.y = FLOOR_Y + SKIN;
      state.velocity.y = 0;
      state.grounded = true;
    }
  }

  if (walk?.sampleWalkGroundTopY && pos.y < FLOOR_Y + SKIN - 1e-4) {
    pos.y = FLOOR_Y + SKIN;
    state.velocity.y = Math.max(0, state.velocity.y);
    state.grounded = true;
  }

  const horizontalSpeed = Math.hypot(state.velocity.x, state.velocity.z);
  const targetEye = input.crouch ? EYE_CROUCH : EYE_STAND;
  state.eyeSmoothed = THREE.MathUtils.damp(state.eyeSmoothed, targetEye, EYE_DAMP, h);

  let bob = 0;
  if (state.grounded && !input.crouch && moving && horizontalSpeed > 0.15) {
    const walkStrength = THREE.MathUtils.clamp(horizontalSpeed / sprintSpeed, 0, 1);
    state.headBobPhase += h * THREE.MathUtils.lerp(0, 6.5, walkStrength);
    bob = Math.sin(state.headBobPhase * 2) * 0.0011 * walkStrength;
  }

  return state.eyeSmoothed + bob;
}

export const fpLocomotionConstants = {
  eyeStand: EYE_STAND,
  eyeCrouch: EYE_CROUCH,
  floorY: FLOOR_Y,
  walkSpeedMps: WALK_SPEED,
  sprintSpeedMps: SPRINT_SPEED,
  crouchSpeedMps: CROUCH_SPEED,
  walkFootRadiusXZ: FP_WALK_FOOT_RADIUS_XZ,
  walkStepUpMargin: FP_WALK_STEP_UP_MARGIN,
  walkProbeDy: FP_WALK_PROBE_DY,
  walkMaxSupportDropM: FP_WALK_MAX_SUPPORT_DROP_M,
  locomotionSubstepsPerSecond: FP_LOCOMOTION_SUBSTEPS_PER_SECOND,
  jumpAscentSkipWalkProbeVyMps: FP_JUMP_ASCENT_SKIP_WALK_PROBE_VY,
  locomotionAirborneSubstepScale: FP_LOCOMOTION_AIRBORNE_SUBSTEP_SCALE,
  cameraFovDeg: 62,
} as const;
