import type { BuildingKind } from '../resources/types.ts';
import type { TerrainBounds } from '../terrain/Terrain.ts';
import { buildingPlacementYaw } from './buildingPlacement.ts';

export type BuildingTerrainSource = {
  kind: BuildingKind;
  x: number;
  z: number;
};

export type ResidenceTerrainSource = {
  x: number;
  z: number;
  yaw: number;
};

type BuildingPadParams = {
  radiusX: number;
  radiusZ: number;
  innerFade: number;
  outerFade: number;
};

type TerrainPadSite = BuildingPadParams & {
  x: number;
  z: number;
  rotation: number;
  platformHeight: number;
  shape: 'ellipse' | 'box';
  maxRaise?: number;
};

const PAD_PARAMS: Record<BuildingKind, BuildingPadParams> = {
  lumber_mill: { radiusX: 10.2, radiusZ: 4.8, innerFade: 0.86, outerFade: 1.38 },
  reforester: { radiusX: 4.4, radiusZ: 4.1, innerFade: 0.88, outerFade: 1.32 },
  woodcutters_lodge: { radiusX: 4.6, radiusZ: 4.3, innerFade: 0.88, outerFade: 1.34 },
  stone_quarry: { radiusX: 10.5, radiusZ: 10.5, innerFade: 0.82, outerFade: 1.42 },
  well: { radiusX: 2.2, radiusZ: 2.2, innerFade: 0.9, outerFade: 1.2 },
  hunters_hall: { radiusX: 5.2, radiusZ: 4.8, innerFade: 0.88, outerFade: 1.34 },
  foragers_shed: { radiusX: 4.2, radiusZ: 3.8, innerFade: 0.88, outerFade: 1.3 },
  chapel: { radiusX: 3.4, radiusZ: 4.2, innerFade: 0.9, outerFade: 1.28 },
  marketplace: { radiusX: 4.2, radiusZ: 3.4, innerFade: 0.9, outerFade: 1.3 },
  town_hall: { radiusX: 7.2, radiusZ: 5.8, innerFade: 0.88, outerFade: 1.32 },
  village_storehouse: { radiusX: 6.3, radiusZ: 5.2, innerFade: 0.88, outerFade: 1.3 },
  threshing_barn: { radiusX: 6.5, radiusZ: 5.0, innerFade: 0.88, outerFade: 1.3 },
  monastery: { radiusX: 9.5, radiusZ: 6.8, innerFade: 0.86, outerFade: 1.35 },
  brewery: { radiusX: 5.6, radiusZ: 4.7, innerFade: 0.88, outerFade: 1.3 },
  smokehouse: { radiusX: 4.4, radiusZ: 4.0, innerFade: 0.88, outerFade: 1.28 },
  granary: { radiusX: 5.8, radiusZ: 4.7, innerFade: 0.88, outerFade: 1.3 },
  apiary: { radiusX: 5.3, radiusZ: 4.6, innerFade: 0.88, outerFade: 1.28 },
  watermill: { radiusX: 6.7, radiusZ: 4.9, innerFade: 0.86, outerFade: 1.35 },
  carpenter: { radiusX: 6.4, radiusZ: 4.8, innerFade: 0.88, outerFade: 1.32 },
  ferry_landing: { radiusX: 6.8, radiusZ: 8.5, innerFade: 0.84, outerFade: 1.25 },
  vineyard: { radiusX: 8.0, radiusZ: 6.8, innerFade: 0.88, outerFade: 1.24 },
  pastoral_farmstead: { radiusX: 7.2, radiusZ: 5.4, innerFade: 0.88, outerFade: 1.3 },
  swineherd: { radiusX: 6.2, radiusZ: 5.2, innerFade: 0.88, outerFade: 1.28 },
};

const FOOTPRINT_SAMPLE_FRACTIONS = [0, 0.55, 0.82, 1] as const;
/** Matches placement preview silhouette scale in BuildingPlacementPreview. */
const FOOTPRINT_PREVIEW_SCALE = 0.92;
const RESIDENCE_PAD_PARAMS: BuildingPadParams = {
  radiusX: 4.3,
  radiusZ: 4.7,
  innerFade: 0.9,
  outerFade: 1.35,
};
const RESIDENCE_PAD_SAMPLE_FRACTIONS = [-1, -0.5, 0, 0.5, 1] as const;

export class BuildingTerrainLayout {
  readonly sites: TerrainPadSite[];

  private constructor(sites: TerrainPadSite[]) {
    this.sites = sites;
  }

  static fromBuildings(
    buildings: Iterable<BuildingTerrainSource>,
    sampleNaturalHeight: (x: number, z: number) => number,
  ): BuildingTerrainLayout {
    const sites: TerrainPadSite[] = [];
    for (const building of buildings) {
      sites.push(createBuildingPadSite(building, sampleNaturalHeight));
    }
    return new BuildingTerrainLayout(sites);
  }

  static fromSettlement(
    buildings: Iterable<BuildingTerrainSource>,
    residences: Iterable<ResidenceTerrainSource>,
    sampleNaturalHeight: (x: number, z: number) => number,
  ): BuildingTerrainLayout {
    const sites: TerrainPadSite[] = [];
    for (const building of buildings) {
      sites.push(createBuildingPadSite(building, sampleNaturalHeight));
    }
    for (const residence of residences) {
      sites.push(createResidencePadSite(residence, sampleNaturalHeight));
    }
    return new BuildingTerrainLayout(sites);
  }

  getPlatformRaise(x: number, z: number, naturalHeight: number): number {
    let targetHeight = naturalHeight;
    for (const site of this.sites) {
      const raise = sampleSiteRaise(x, z, site, naturalHeight);
      targetHeight = Math.max(targetHeight, naturalHeight + raise);
    }
    return targetHeight - naturalHeight;
  }

  getAffectedBounds(): TerrainBounds[] {
    return this.sites.map((site) => siteBounds(site));
  }

  isBlockedForGrass(x: number, z: number): boolean {
    for (const site of this.sites) {
      if (sampleSiteBlend(x, z, site, 0, site.outerFade * 1.04) >= 0.24) return true;
    }
    return false;
  }
}

export function getBuildingPadParams(kind: BuildingKind): BuildingPadParams {
  return PAD_PARAMS[kind];
}

/** Tests a point or circular obstacle against the visible construction pad. */
export function pointWithinBuildingSiteClearance(
  x: number,
  z: number,
  building: BuildingTerrainSource,
  clearanceRadius = 0,
): boolean {
  const params = PAD_PARAMS[building.kind];
  const rotation = buildingPlacementYaw(building.kind, building.x, building.z);
  const dx = x - building.x;
  const dz = z - building.z;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const localX = dx * cos + dz * sin;
  const localZ = -dx * sin + dz * cos;
  const normDist = Math.hypot(localX / params.radiusX, localZ / params.radiusZ);
  const clearOuter = params.outerFade * 1.04 + clearanceRadius / Math.min(params.radiusX, params.radiusZ);
  return normDist <= clearOuter;
}

export function sampleBuildingFootprintHeights(
  kind: BuildingKind,
  x: number,
  z: number,
  sampleNaturalHeight: (x: number, z: number) => number,
): number[] {
  return sampleBuildingFootprintPoints(kind, x, z).map((point) => sampleNaturalHeight(point.x, point.z));
}

export function sampleBuildingFootprintPoints(
  kind: BuildingKind,
  x: number,
  z: number,
): Array<{ x: number; z: number }> {
  const params = PAD_PARAMS[kind];
  const rotation = buildingPlacementYaw(kind, x, z);
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const points: Array<{ x: number; z: number }> = [];

  for (const fraction of FOOTPRINT_SAMPLE_FRACTIONS) {
    const sampleFraction = fraction === 1 ? FOOTPRINT_PREVIEW_SCALE : fraction;
    for (const sx of [-1, 0, 1] as const) {
      for (const sz of [-1, 0, 1] as const) {
        if (fraction === 0 && (sx !== 0 || sz !== 0)) continue;
        const localX = sx * params.radiusX * params.innerFade * sampleFraction;
        const localZ = sz * params.radiusZ * params.innerFade * sampleFraction;
        points.push({
          x: x + localX * cos - localZ * sin,
          z: z + localX * sin + localZ * cos,
        });
      }
    }
  }

  return points;
}

function createBuildingPadSite(
  building: BuildingTerrainSource,
  sampleNaturalHeight: (x: number, z: number) => number,
): TerrainPadSite {
  const params = PAD_PARAMS[building.kind];
  const rotation = buildingPlacementYaw(building.kind, building.x, building.z);
  const footprintHeights = sampleBuildingFootprintHeights(building.kind, building.x, building.z, sampleNaturalHeight);
  const platformHeight = Math.max(...footprintHeights);

  return {
    x: building.x,
    z: building.z,
    ...params,
    rotation,
    platformHeight,
    shape: 'ellipse',
  };
}

function createResidencePadSite(
  residence: ResidenceTerrainSource,
  sampleNaturalHeight: (x: number, z: number) => number,
): TerrainPadSite {
  const { radiusX, radiusZ, innerFade } = RESIDENCE_PAD_PARAMS;
  const cos = Math.cos(residence.yaw);
  const sin = Math.sin(residence.yaw);
  let platformHeight = -Infinity;

  for (const xFraction of RESIDENCE_PAD_SAMPLE_FRACTIONS) {
    for (const zFraction of RESIDENCE_PAD_SAMPLE_FRACTIONS) {
      const localX = xFraction * radiusX * innerFade;
      const localZ = zFraction * radiusZ * innerFade;
      const x = residence.x + localX * cos - localZ * sin;
      const z = residence.z + localX * sin + localZ * cos;
      platformHeight = Math.max(platformHeight, sampleNaturalHeight(x, z));
    }
  }

  return {
    x: residence.x,
    z: residence.z,
    ...RESIDENCE_PAD_PARAMS,
    rotation: residence.yaw,
    platformHeight,
    shape: 'box',
    maxRaise: 2.4,
  };
}

function sampleSiteRaise(x: number, z: number, site: TerrainPadSite, naturalHeight: number): number {
  const blend = sampleSiteBlend(x, z, site, site.innerFade, site.outerFade);
  if (blend <= 0) return 0;

  const needed = Math.min(
    site.maxRaise ?? Number.POSITIVE_INFINITY,
    site.platformHeight - naturalHeight,
  );
  if (needed <= 0) return 0;

  return blend * needed;
}

function sampleSiteBlend(
  x: number,
  z: number,
  site: TerrainPadSite,
  innerFade: number,
  outerFade: number,
): number {
  const dx = x - site.x;
  const dz = z - site.z;
  const cos = Math.cos(site.rotation);
  const sin = Math.sin(site.rotation);
  const localX = dx * cos + dz * sin;
  const localZ = -dx * sin + dz * cos;
  const normX = Math.abs(localX / site.radiusX);
  const normZ = Math.abs(localZ / site.radiusZ);
  const normDist = site.shape === 'box'
    ? Math.max(normX, normZ)
    : Math.hypot(normX, normZ);
  return 1 - smoothstep(innerFade, outerFade, normDist);
}

function siteBounds(site: TerrainPadSite): TerrainBounds {
  const extentX = site.radiusX * site.outerFade;
  const extentZ = site.radiusZ * site.outerFade;
  const cornerRadius = Math.hypot(extentX, extentZ);
  return {
    minX: site.x - cornerRadius,
    maxX: site.x + cornerRadius,
    minZ: site.z - cornerRadius,
    maxZ: site.z + cornerRadius,
  };
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = saturate((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function saturate(value: number): number {
  return Math.max(0, Math.min(1, value));
}
