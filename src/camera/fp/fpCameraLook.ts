import {
  FREE_LOOK_RECENTER_RATE_PER_S,
  FREE_LOOK_RECENTER_SNAP_EPS,
  FREE_LOOK_YAW_MAX,
  LOOK_INERTIA_COAST_GAIN,
  LOOK_INERTIA_DAMP_PER_S,
  MOUSE_SENS,
  PITCH_LIMIT,
} from './fpConstants.ts';

export type FpLookInertiaState = {
  velYaw: number;
  velPitch: number;
};

export type FpLookAngleState = {
  bodyYaw: number;
  pitch: number;
  headLookYaw: number;
};

export function createFpLookInertiaState(): FpLookInertiaState {
  return { velYaw: 0, velPitch: 0 };
}

export function resetFpLookInertia(state: FpLookInertiaState): void {
  state.velYaw = 0;
  state.velPitch = 0;
}

export type StepFpLookInertiaOpts = {
  freeLook: boolean;
  mouseSens?: number;
  pitchLimit?: number;
  freeLookYawMax?: number;
  inertiaDampPerS?: number;
  coastGain?: number;
};

function applyLookVelocityToAngles(
  inertia: FpLookInertiaState,
  angles: FpLookAngleState,
  opts: StepFpLookInertiaOpts,
): void {
  const pitchLimit = opts.pitchLimit ?? PITCH_LIMIT;
  const freeLookYawMax = opts.freeLookYawMax ?? FREE_LOOK_YAW_MAX;

  if (opts.freeLook) {
    const nextHeadLookYaw = angles.headLookYaw + inertia.velYaw;
    if (nextHeadLookYaw <= -freeLookYawMax || nextHeadLookYaw >= freeLookYawMax) {
      angles.headLookYaw = Math.max(-freeLookYawMax, Math.min(freeLookYawMax, nextHeadLookYaw));
      inertia.velYaw = 0;
    } else {
      angles.headLookYaw = nextHeadLookYaw;
    }
  } else {
    angles.bodyYaw += inertia.velYaw;
  }

  const nextPitch = angles.pitch + inertia.velPitch;
  if (nextPitch <= -pitchLimit || nextPitch >= pitchLimit) {
    angles.pitch = Math.max(-pitchLimit, Math.min(pitchLimit, nextPitch));
    inertia.velPitch = 0;
  } else {
    angles.pitch = nextPitch;
  }
}

export function stepFpLookInertia(
  inertia: FpLookInertiaState,
  angles: FpLookAngleState,
  deltaX: number,
  deltaY: number,
  dt: number,
  opts: StepFpLookInertiaOpts,
): void {
  const hasPointerDelta = deltaX !== 0 || deltaY !== 0;
  if (dt <= 0 && !hasPointerDelta) return;

  const mouseSens = opts.mouseSens ?? MOUSE_SENS;
  const pitchLimit = opts.pitchLimit ?? PITCH_LIMIT;
  const freeLookYawMax = opts.freeLookYawMax ?? FREE_LOOK_YAW_MAX;
  const inertiaDampPerS = opts.inertiaDampPerS ?? LOOK_INERTIA_DAMP_PER_S;
  const coastGain = opts.coastGain ?? LOOK_INERTIA_COAST_GAIN;
  const decay = dt > 0 ? Math.exp(-inertiaDampPerS * dt) : 1;

  if (hasPointerDelta) {
    if (opts.freeLook) {
      angles.headLookYaw -= deltaX * mouseSens;
      angles.headLookYaw = Math.max(-freeLookYawMax, Math.min(freeLookYawMax, angles.headLookYaw));
    } else {
      angles.bodyYaw -= deltaX * mouseSens;
    }
    angles.pitch -= deltaY * mouseSens;
    angles.pitch = Math.max(-pitchLimit, Math.min(pitchLimit, angles.pitch));

    inertia.velYaw -= deltaX * mouseSens * coastGain;
    inertia.velPitch -= deltaY * mouseSens * coastGain;
  } else if (dt > 0 && (Math.abs(inertia.velYaw) > 1e-8 || Math.abs(inertia.velPitch) > 1e-8)) {
    applyLookVelocityToAngles(inertia, angles, opts);
  }

  if (dt > 0) {
    inertia.velYaw *= decay;
    inertia.velPitch *= decay;
    if (Math.abs(inertia.velYaw) < 1e-7) inertia.velYaw = 0;
    if (Math.abs(inertia.velPitch) < 1e-7) inertia.velPitch = 0;
  }
}

export type StepFpFreeLookRecenterOpts = {
  recenterRatePerS?: number;
  snapEpsilon?: number;
};

export function stepFpFreeLookRecenter(
  angles: Pick<FpLookAngleState, 'headLookYaw'>,
  dt: number,
  opts?: StepFpFreeLookRecenterOpts,
): boolean {
  if (dt <= 0 || angles.headLookYaw === 0) return false;

  const recenterRatePerS = opts?.recenterRatePerS ?? FREE_LOOK_RECENTER_RATE_PER_S;
  const snapEpsilon = opts?.snapEpsilon ?? FREE_LOOK_RECENTER_SNAP_EPS;
  angles.headLookYaw *= Math.exp(-recenterRatePerS * dt);

  if (Math.abs(angles.headLookYaw) < snapEpsilon) {
    angles.headLookYaw = 0;
    return false;
  }
  return true;
}

export function normalizeBodyYaw(yaw: number): number {
  return Math.atan2(Math.sin(yaw), Math.cos(yaw));
}
