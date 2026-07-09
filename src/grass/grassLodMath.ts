/** Matches CameraController default orbit distance at 100% zoom. */
export const BASELINE_CAMERA_DISTANCE = 88;

/** Dirt is fully active at this zoom and beyond. */
export const DIRT_REVEAL_ZOOM_PERCENT = 400;

/** Dirt begins fading in above this zoom; below it the map stays meadow. */
export const DIRT_FADE_START_ZOOM_PERCENT = 300;

/** Pow easing on the zoom gate (< 1 = dirt ramps in more gradually between 300–400%). */
export const DIRT_BLEND_EASE = 0.72;

/** Orbit distances matching the 300% / 400% zoom band. */
export const TERRAIN_DIRT_CLOSE_DISTANCE =
  BASELINE_CAMERA_DISTANCE / (DIRT_REVEAL_ZOOM_PERCENT / 100);

export const TERRAIN_DIRT_FAR_DISTANCE =
  BASELINE_CAMERA_DISTANCE / (DIRT_FADE_START_ZOOM_PERCENT / 100);

/** Horizontal radius (world units) where close dirt is visible around the camera. */
export const DIRT_PROXIMITY_INNER = 22;

export const DIRT_PROXIMITY_OUTER = 64;

export const DIRT_PROXIMITY_INNER_SQ = DIRT_PROXIMITY_INNER * DIRT_PROXIMITY_INNER;

export const DIRT_PROXIMITY_OUTER_SQ = DIRT_PROXIMITY_OUTER * DIRT_PROXIMITY_OUTER;

/** Blade tufts use the same zoom band as close dirt terrain. */
export const GRASS_BLADE_REVEAL = {
  close: TERRAIN_DIRT_CLOSE_DISTANCE,
  far: TERRAIN_DIRT_FAR_DISTANCE,
} as const;

/** Horizontal radius where 3D grass tufts render — shorter than dirt so grass fades first. */
export const GRASS_BLADE_NEAR_RADIUS = 42;

/** Spatial chunk size for streamed grass batches (larger = fewer pan hitches). */
export const GRASS_BLADE_CHUNK_SIZE = 8;

/** Target tufts scattered per chunk (organic placement, not a rigid grid). */
export const GRASS_TUFTS_PER_CHUNK = 54;

/** Extra scatter attempts budget per chunk. */
export const GRASS_TUFT_SCATTER_ATTEMPTS = GRASS_TUFTS_PER_CHUNK + 28;

/** Blade stalks in each tuft mesh (shared geometry). */
export const GRASS_BLADES_PER_TUFT = 9;

/** World chunks kept loaded around the camera focus (covers the grass patch). */
export const GRASS_STREAM_CHUNK_RADIUS =
  Math.ceil(GRASS_BLADE_NEAR_RADIUS / GRASS_BLADE_CHUNK_SIZE) + 1;

/** Chunks written per frame into the back buffer — keeps pan hitch-free. */
export const GRASS_STREAM_CHUNKS_PER_FRAME = 10;

/** Soft falloff band at the outer edge of the grass patch (world units). */
export const GRASS_EDGE_FADE_BAND = 16;

/** 0 below 300% zoom → 1 at 400% zoom; controls whether close dirt is allowed at all. */
export function dirtZoomGate(cameraDistance: number): number {
  const t = smoothstep(TERRAIN_DIRT_CLOSE_DISTANCE, TERRAIN_DIRT_FAR_DISTANCE, cameraDistance);
  return Math.pow(1 - t, DIRT_BLEND_EASE);
}

export function grassBladeRevealOpacity(cameraDistance: number): number {
  return dirtZoomGate(cameraDistance);
}

export function isGrassBladeZoomActive(cameraDistance: number): boolean {
  return grassBladeRevealOpacity(cameraDistance) > 0.02;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
