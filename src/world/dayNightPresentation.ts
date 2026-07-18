import * as THREE from 'three';
import {
  CALENDAR_HOURS_PER_DAY,
  CALENDAR_WORK_END_HOUR,
  CALENDAR_WORK_START_HOUR,
} from '../generated/gameBalance.ts';
import type { GameClock } from './gameCalendar.ts';
import { simElapsedSeconds } from './gameCalendar.ts';

export type DayNightGrade = {
  saturation: number;
  contrast: number;
  warmth: number;
  nightBlue: number;
  vignette: number;
};

export type DayNightLightingState = {
  sunDirection: THREE.Vector3;
  sunColor: number;
  sunIntensity: number;
  hemiSkyColor: number;
  hemiGroundColor: number;
  hemiIntensity: number;
  ambientColor: number;
  ambientIntensity: number;
  buildingIndirectIntensity: number;
  fillColor: number;
  fillIntensity: number;
  fogColor: number;
  fogDensity: number;
  grade: DayNightGrade;
  skyAnimationTime: number;
  isNight: boolean;
  smokeAllowed: boolean;
  eveningWindowGlow: number;
};

const SUN_DIRECTION = new THREE.Vector3();

export function fractionalHour(clock: GameClock): number {
  return clock.hour + clock.minute / 60;
}

export function computeDayNightState(
  clock: GameClock,
  laborPaused: boolean,
): DayNightLightingState {
  const hour = fractionalHour(clock);
  const smokeAllowed = !laborPaused;

  const dawn = blendPhases(hour, [
    { at: 4.5, value: 0 },
    { at: CALENDAR_WORK_START_HOUR, value: 1 },
    { at: 8, value: 0 },
  ]);
  const dusk = blendPhases(hour, [
    { at: CALENDAR_WORK_END_HOUR - 2, value: 0 },
    { at: CALENDAR_WORK_END_HOUR, value: 1 },
    { at: CALENDAR_WORK_END_HOUR + 1.5, value: 0 },
  ]);
  const night = blendPhases(hour, [
    { at: 0, value: 1 },
    { at: CALENDAR_WORK_START_HOUR - 1, value: 1 },
    { at: CALENDAR_WORK_START_HOUR + 0.5, value: 0 },
    { at: CALENDAR_WORK_END_HOUR, value: 0 },
    { at: CALENDAR_WORK_END_HOUR + 2, value: 1 },
    { at: CALENDAR_HOURS_PER_DAY, value: 1 },
  ]);

  const dayAmount = clamp01(1 - night * 0.92);
  const goldenHour = clamp01(Math.max(dawn, dusk) * (1 - night * 0.65));
  const isNight = night > 0.55;

  const daySpan = CALENDAR_WORK_END_HOUR - CALENDAR_WORK_START_HOUR;
  const dayProgress = clamp01((hour - CALENDAR_WORK_START_HOUR) / daySpan);
  const noonCurve = Math.sin(dayProgress * Math.PI);
  const elevationDeg = isNight
    ? -18 + 8 * (1 - night)
    : 6 + noonCurve * 48;
  const azimuthDeg = isNight
    ? 300 + (hour / CALENDAR_HOURS_PER_DAY) * 120
    : 118 + dayProgress * 168;

  const elevationRad = THREE.MathUtils.degToRad(elevationDeg);
  const azimuthRad = THREE.MathUtils.degToRad(azimuthDeg);
  SUN_DIRECTION.setFromSphericalCoords(
    1,
    THREE.MathUtils.degToRad(90) - elevationRad,
    azimuthRad,
  );

  const sunColor = lerpColor(0x9eb6ff, 0xffefd2, dayAmount);
  const sunWarm = lerpColor(sunColor, 0xffb070, goldenHour * 0.75);
  const sunIntensity = lerp(0.35, 4.9, dayAmount) + goldenHour * 0.8;
  const hemiSkyColor = lerpColor(0x1a2744, 0xdff0ff, dayAmount);
  const hemiGroundColor = lerpColor(0x1f2a22, 0x56644a, dayAmount);
  const hemiIntensity = lerp(0.55, 1.9, dayAmount);
  const ambientColor = lerpColor(0x4a628f, 0xb8d1ff, dayAmount);
  const ambientIntensity = lerp(0.12, 0.2, dayAmount) + night * 0.08;
  const buildingIndirectIntensity = lerp(0.018, 0.11, dayAmount);
  const fillColor = lerpColor(0x5f7fb8, 0x9fc8ff, dayAmount);
  const fillIntensity = lerp(0.18, 0.45, dayAmount);
  const fogColor = lerpColor(0x1b2740, 0xc8def1, dayAmount);
  const fogDensity = lerp(0.00145, 0.00082, dayAmount);
  const eveningWindowGlow = computeEveningWindowGlow(hour, night);

  return {
    sunDirection: SUN_DIRECTION.clone(),
    sunColor: sunWarm,
    sunIntensity,
    hemiSkyColor,
    hemiGroundColor,
    hemiIntensity,
    ambientColor,
    ambientIntensity,
    buildingIndirectIntensity,
    fillColor,
    fillIntensity,
    fogColor,
    fogDensity,
    grade: {
      saturation: lerp(0.72, 1.02, dayAmount) + goldenHour * 0.08,
      contrast: lerp(0.96, 1.05, dayAmount),
      warmth: goldenHour * 0.42 + dawn * 0.18,
      nightBlue: night * 0.55,
      vignette: lerp(0.18, 0.1, dayAmount) + night * 0.08,
    },
    skyAnimationTime: simElapsedSeconds(clock.simTick),
    isNight,
    smokeAllowed,
    eveningWindowGlow,
  };
}

/** Warm window light after work winds down; fades out before deep night. */
function computeEveningWindowGlow(hour: number, night: number): number {
  const evening = blendPhases(hour, [
    { at: 17, value: 0 },
    { at: 18, value: 0.55 },
    { at: 19, value: 1 },
    { at: 20, value: 0.9 },
    { at: 21, value: 0.45 },
    { at: 22, value: 0 },
  ]);
  return clamp01(evening * (1 - night * 0.95));
}

function blendPhases(hour: number, phases: { at: number; value: number }[]): number {
  if (phases.length === 0) return 0;
  if (hour <= phases[0].at) return phases[0].value;
  for (let i = 1; i < phases.length; i += 1) {
    const prev = phases[i - 1];
    const next = phases[i];
    if (hour <= next.at) {
      const span = next.at - prev.at;
      if (span <= 1e-6) return next.value;
      const t = clamp01((hour - prev.at) / span);
      const smooth = t * t * (3 - 2 * t);
      return prev.value + (next.value - prev.value) * smooth;
    }
  }
  return phases[phases.length - 1].value;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp01(t);
}

function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const br = (b >> 16) & 255;
  const bg = (b >> 8) & 255;
  const bb = b & 255;
  const mix = clamp01(t);
  const r = Math.round(lerp(ar, br, mix));
  const g = Math.round(lerp(ag, bg, mix));
  const bl = Math.round(lerp(ab, bb, mix));
  return (r << 16) | (g << 8) | bl;
}
