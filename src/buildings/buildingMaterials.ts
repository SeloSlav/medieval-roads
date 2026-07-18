import * as THREE from 'three';
import { loadBitmapTexture } from '../utils/textureLoad.ts';
import { prepareBuildingGeometryUvs } from './buildingMetricUvs.ts';

export const GORSKI_PALETTE = {
  stoneWhite: 0xe6dfd0,
  stoneWhiteShadow: 0xcbc3b4,
  stoneMortar: 0xb8b0a2,
  timberDark: 0x4f3828,
  timberMid: 0x6b4e38,
  timberLight: 0x8a684c,
  timberWeathered: 0x7a5e46,
  tileRed: 0xa83f32,
  tileRedDark: 0x8a3228,
  tileRedHighlight: 0xc04a3a,
  shingleWood: 0x5c4636,
  shingleAged: 0x4a382c,
  moss: 0x4d6b3c,
  grassRoof: 0x5f7a44,
  mossDark: 0x3d5530,
  interiorDark: 0x1a1410,
} as const;

export const RESIDENCE_FACADE_PALETTE = {
  white: 0xe8e2d8,
  yellow: 0xccb860,
  grey: 0x8a8580,
  lightOrange: 0xcc9858,
  orange: 0xbf7038,
} as const;

export const RESIDENCE_ROOF_PALETTE = {
  red: GORSKI_PALETTE.tileRed,
  brown: GORSKI_PALETTE.shingleWood,
  grey: 0x6a6662,
  slate: 0x454a50,
} as const;

export const RESIDENCE_ROOF_SPECS = {
  red: { roughness: 0.82, metalness: 0.02 },
  brown: { roughness: 0.92, metalness: 0 },
  grey: { roughness: 0.92, metalness: 0 },
  slate: { roughness: 0.88, metalness: 0.04 },
} as const;

export type ResidenceFacadeColor = keyof typeof RESIDENCE_FACADE_PALETTE;
export type ResidenceRoofColor = keyof typeof RESIDENCE_ROOF_PALETTE;

/** Weathered grey quarry stone — distinct from bright Gorski limestone on mills/huts. */
export const QUARRY_ROCK_PALETTE = {
  dark: 0x52565c,
  mid: 0x6b7078,
  light: 0x828890,
  cut: 0x5e636a,
  dust: 0x6a6660,
  spoil: 0x5c5854,
} as const;

type TextureFamily = 'plaster' | 'masonry' | 'clayTiles' | 'woodPlanks';

/**
 * The complete shared construction palette. Keeping this list deliberately
 * small lets every building reuse the same renderer programs, material state,
 * and texture objects while tinting a few culturally consistent variants.
 */
export type BuildingMaterialKey =
  | 'plasterWhite'
  | 'plasterYellow'
  | 'plasterGrey'
  | 'plasterOrange'
  | 'masonryLight'
  | 'masonryMid'
  | 'masonryDark'
  | 'timberDark'
  | 'timberMid'
  | 'timberLight'
  | 'timberWeathered'
  | 'clayRed'
  | 'clayDark'
  | 'shingle'
  | 'slate'
  | 'metalIron'
  | 'glass'
  | 'moss'
  | 'grassRoof'
  | 'interiorDark';

type MaterialDefinition = {
  color: number;
  roughness: number;
  metalness: number;
  textureFamily?: TextureFamily;
  normalScale?: number;
};

const MATERIAL_DEFINITIONS: Record<BuildingMaterialKey, MaterialDefinition> = {
  plasterWhite: { color: 0xffffff, roughness: 0.92, metalness: 0, textureFamily: 'plaster', normalScale: 0.42 },
  plasterYellow: { color: 0xeadc9f, roughness: 0.93, metalness: 0, textureFamily: 'plaster', normalScale: 0.42 },
  plasterGrey: { color: 0xb8b4af, roughness: 0.94, metalness: 0, textureFamily: 'plaster', normalScale: 0.46 },
  plasterOrange: { color: 0xe6b17e, roughness: 0.93, metalness: 0, textureFamily: 'plaster', normalScale: 0.44 },
  masonryLight: { color: 0xf0e9dc, roughness: 0.96, metalness: 0, textureFamily: 'masonry', normalScale: 0.72 },
  masonryMid: { color: 0xc5beb2, roughness: 0.97, metalness: 0, textureFamily: 'masonry', normalScale: 0.78 },
  masonryDark: { color: 0x858688, roughness: 0.98, metalness: 0, textureFamily: 'masonry', normalScale: 0.82 },
  timberDark: { color: 0x86664f, roughness: 0.91, metalness: 0, textureFamily: 'woodPlanks', normalScale: 0.62 },
  timberMid: { color: 0xaa866b, roughness: 0.9, metalness: 0, textureFamily: 'woodPlanks', normalScale: 0.58 },
  timberLight: { color: 0xc2a184, roughness: 0.9, metalness: 0, textureFamily: 'woodPlanks', normalScale: 0.55 },
  timberWeathered: { color: 0xae9a87, roughness: 0.94, metalness: 0, textureFamily: 'woodPlanks', normalScale: 0.68 },
  clayRed: { color: 0xffffff, roughness: 0.84, metalness: 0.01, textureFamily: 'clayTiles', normalScale: 0.74 },
  clayDark: { color: 0xc58f84, roughness: 0.88, metalness: 0.01, textureFamily: 'clayTiles', normalScale: 0.78 },
  shingle: { color: 0x806856, roughness: 0.95, metalness: 0, textureFamily: 'woodPlanks', normalScale: 0.72 },
  slate: { color: 0x737980, roughness: 0.91, metalness: 0.02, textureFamily: 'masonry', normalScale: 0.48 },
  metalIron: { color: 0x4a4846, roughness: 0.55, metalness: 0.72 },
  glass: { color: 0x3d4747, roughness: 0.4, metalness: 0.03 },
  moss: { color: GORSKI_PALETTE.moss, roughness: 0.98, metalness: 0 },
  grassRoof: { color: GORSKI_PALETTE.grassRoof, roughness: 0.99, metalness: 0 },
  interiorDark: { color: GORSKI_PALETTE.interiorDark, roughness: 1, metalness: 0 },
};

const TEXTURE_METERS: Record<TextureFamily, number> = {
  plaster: 2.5,
  masonry: 2.4,
  clayTiles: 4,
  woodPlanks: 2,
};

type BuildingTextureSet = {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
};

const BUILDING_TEXTURE_URLS: Record<TextureFamily, { map: string; normalMap: string; roughnessMap: string }> = {
  plaster: {
    map: '/textures/buildings/plaster_diff.jpg',
    normalMap: '/textures/buildings/plaster_nor_gl.png',
    roughnessMap: '/textures/buildings/plaster_rough.jpg',
  },
  masonry: {
    map: '/textures/buildings/masonry_diff.jpg',
    normalMap: '/textures/buildings/masonry_nor_gl.png',
    roughnessMap: '/textures/buildings/masonry_rough.jpg',
  },
  clayTiles: {
    map: '/textures/buildings/clay_tiles_diff.jpg',
    normalMap: '/textures/buildings/clay_tiles_nor_gl.png',
    roughnessMap: '/textures/buildings/clay_tiles_rough.jpg',
  },
  woodPlanks: {
    map: '/textures/buildings/wood_planks_diff.jpg',
    normalMap: '/textures/buildings/wood_planks_nor_gl.png',
    roughnessMap: '/textures/buildings/wood_planks_rough.jpg',
  },
};

const materialCache = new Map<BuildingMaterialKey, THREE.MeshStandardMaterial>();
const DEFAULT_BUILDING_INDIRECT_INTENSITY = 0.11;
let buildingIndirectIntensity = DEFAULT_BUILDING_INDIRECT_INTENSITY;
export type BuildingDetailMaterialKey =
  | 'brass'
  | 'paintRed'
  | 'paintBlue'
  | 'paintOchre'
  | 'water'
  | 'smoke'
  | 'earth'
  | 'foliage'
  | 'crop';

type DetailMaterialDefinition = Omit<THREE.MeshStandardMaterialParameters, 'normalScale'> & {
  textureFamily?: TextureFamily;
  buildingNormalScale?: number;
};

const DETAIL_MATERIAL_DEFINITIONS: Record<BuildingDetailMaterialKey, DetailMaterialDefinition> = {
  brass: { color: 0x9b7134, roughness: 0.48, metalness: 0.72 },
  paintRed: { color: 0xb75a4d, roughness: 0.89, metalness: 0, textureFamily: 'woodPlanks', buildingNormalScale: 0.22 },
  paintBlue: { color: 0x668996, roughness: 0.9, metalness: 0, textureFamily: 'woodPlanks', buildingNormalScale: 0.22 },
  paintOchre: { color: 0xd4ae62, roughness: 0.91, metalness: 0, textureFamily: 'woodPlanks', buildingNormalScale: 0.22 },
  water: { color: 0x315868, roughness: 0.32, metalness: 0.04 },
  smoke: { color: 0x77736d, roughness: 1, metalness: 0, transparent: true, opacity: 0.28, depthWrite: false },
  earth: { color: 0x6d5235, roughness: 1, metalness: 0 },
  foliage: { color: 0x526f3b, roughness: 1, metalness: 0 },
  crop: { color: 0xb69a48, roughness: 1, metalness: 0 },
};

const detailMaterialCache = new Map<BuildingDetailMaterialKey, THREE.MeshStandardMaterial>();
let textureSets: Record<TextureFamily, BuildingTextureSet> | null = null;
let textureLoadPromise: Promise<void> | null = null;

export function sharedBuildingMaterial(key: BuildingMaterialKey): THREE.MeshStandardMaterial {
  const cached = materialCache.get(key);
  if (cached) return cached;

  const definition = MATERIAL_DEFINITIONS[key];
  const material = new THREE.MeshStandardMaterial({
    color: definition.color,
    roughness: definition.roughness,
    metalness: definition.metalness,
  });
  configureBuildingIndirectLight(material);
  material.name = `Shared building material: ${key}`;
  material.userData.sharedBuildingMaterial = true;
  if (definition.textureFamily) {
    material.userData.metricUvMeters = TEXTURE_METERS[definition.textureFamily];
  }
  materialCache.set(key, material);
  applyTextureSet(material, definition);
  return material;
}

/**
 * Keeps outdoor building faces readable when they fall outside the direct sun.
 * The albedo-matched emissive term approximates broad sky/ground bounce without
 * raising exposure for the already bright terrain and foliage.
 */
export function setBuildingIndirectLightIntensity(intensity: number): void {
  buildingIndirectIntensity = Math.max(0, intensity);
  for (const material of materialCache.values()) {
    material.emissiveIntensity = buildingIndirectIntensity;
  }
}

/** Shared non-structural materials used by building props and painted trim. */
export function sharedBuildingDetailMaterial(key: BuildingDetailMaterialKey): THREE.MeshStandardMaterial {
  const cached = detailMaterialCache.get(key);
  if (cached) return cached;
  const definition = DETAIL_MATERIAL_DEFINITIONS[key];
  const { textureFamily, buildingNormalScale, ...parameters } = definition;
  const material = new THREE.MeshStandardMaterial(parameters);
  material.name = `Shared building detail material: ${key}`;
  material.userData.sharedBuildingMaterial = true;
  if (textureFamily) material.userData.metricUvMeters = TEXTURE_METERS[textureFamily];
  detailMaterialCache.set(key, material);
  applyDetailTextureSet(material, definition);
  return material;
}

/** Loads the four 1K CC0 texture sets once and attaches them to all shared materials. */
export function initializeBuildingMaterialLibrary(maxAnisotropy = 8): Promise<void> {
  if (textureSets) return Promise.resolve();
  if (textureLoadPromise) return textureLoadPromise;

  const anisotropy = Math.max(1, Math.min(8, maxAnisotropy));
  textureLoadPromise = Promise.all(
    (Object.keys(BUILDING_TEXTURE_URLS) as TextureFamily[]).map(async (family) => {
      const urls = BUILDING_TEXTURE_URLS[family];
      const [map, normalMap, roughnessMap] = await Promise.all([
        loadBitmapTexture(urls.map, anisotropy, { srgb: true, anisotropyLimit: 8 }),
        loadBitmapTexture(urls.normalMap, anisotropy, { anisotropyLimit: 8 }),
        loadBitmapTexture(urls.roughnessMap, anisotropy, { anisotropyLimit: 8 }),
      ]);
      map.name = `Building ${family} diffuse`;
      normalMap.name = `Building ${family} normal`;
      roughnessMap.name = `Building ${family} roughness`;
      return [family, { map, normalMap, roughnessMap }] as const;
    }),
  ).then((entries) => {
    textureSets = Object.fromEntries(entries) as Record<TextureFamily, BuildingTextureSet>;
    for (const [key, material] of materialCache) {
      applyTextureSet(material, MATERIAL_DEFINITIONS[key]);
    }
    for (const [key, material] of detailMaterialCache) {
      applyDetailTextureSet(material, DETAIL_MATERIAL_DEFINITIONS[key]);
    }
  }).catch((error) => {
    textureLoadPromise = null;
    throw error;
  });
  return textureLoadPromise;
}

export function disposeBuildingMaterialLibrary(): void {
  for (const material of materialCache.values()) material.dispose();
  for (const material of detailMaterialCache.values()) material.dispose();
  if (textureSets) {
    const textures = new Set<THREE.Texture>();
    for (const set of Object.values(textureSets)) {
      textures.add(set.map);
      textures.add(set.normalMap);
      textures.add(set.roughnessMap);
    }
    for (const texture of textures) texture.dispose();
  }
  textureSets = null;
  textureLoadPromise = null;
}

export function getBuildingMaterialLibraryStats(): { constructionMaterials: number; detailMaterials: number; textures: number; loaded: boolean } {
  return {
    constructionMaterials: materialCache.size,
    detailMaterials: detailMaterialCache.size,
    textures: textureSets ? new Set(Object.values(textureSets).flatMap((set) => [set.map, set.normalMap, set.roughnessMap])).size : 0,
    loaded: textureSets !== null,
  };
}

function applyTextureSet(material: THREE.MeshStandardMaterial, definition: MaterialDefinition): void {
  if (!definition.textureFamily || !textureSets) return;
  const set = textureSets[definition.textureFamily];
  material.map = set.map;
  material.emissiveMap = set.map;
  material.normalMap = set.normalMap;
  material.roughnessMap = set.roughnessMap;
  material.normalScale.setScalar(definition.normalScale ?? 1);
  material.needsUpdate = true;
}

function configureBuildingIndirectLight(material: THREE.MeshStandardMaterial): void {
  material.emissive.copy(material.color);
  material.emissiveIntensity = buildingIndirectIntensity;
  material.userData.buildingIndirectLight = true;
}

function applyDetailTextureSet(
  material: THREE.MeshStandardMaterial,
  definition: DetailMaterialDefinition,
): void {
  if (!definition.textureFamily || !textureSets) return;
  const set = textureSets[definition.textureFamily];
  material.map = set.map;
  material.normalMap = set.normalMap;
  material.roughnessMap = set.roughnessMap;
  material.normalScale.setScalar(definition.buildingNormalScale ?? 1);
  material.needsUpdate = true;
}

export function quarryRockMaterial(
  shade: keyof typeof QUARRY_ROCK_PALETTE = 'mid',
): THREE.MeshStandardMaterial {
  if (shade === 'light' || shade === 'cut' || shade === 'dust') return sharedBuildingMaterial('masonryLight');
  if (shade === 'dark' || shade === 'spoil') return sharedBuildingMaterial('masonryDark');
  return sharedBuildingMaterial('masonryMid');
}

export function stoneMaterial(shade: 'light' | 'mid' | 'mortar' = 'mid'): THREE.MeshStandardMaterial {
  if (shade === 'light') return sharedBuildingMaterial('masonryLight');
  if (shade === 'mortar') return sharedBuildingMaterial('masonryDark');
  return sharedBuildingMaterial('masonryMid');
}

export function timberMaterial(shade: 'dark' | 'mid' | 'light' | 'weathered' = 'mid'): THREE.MeshStandardMaterial {
  if (shade === 'dark') return sharedBuildingMaterial('timberDark');
  if (shade === 'light') return sharedBuildingMaterial('timberLight');
  if (shade === 'weathered') return sharedBuildingMaterial('timberWeathered');
  return sharedBuildingMaterial('timberMid');
}

export function tileMaterial(variant: 0 | 1 | 2 = 0): THREE.MeshStandardMaterial {
  return sharedBuildingMaterial(variant === 1 ? 'clayDark' : 'clayRed');
}

export function shingleMaterial(): THREE.MeshStandardMaterial {
  return sharedBuildingMaterial('shingle');
}

export function residenceFacadeMaterial(facade: ResidenceFacadeColor): THREE.MeshStandardMaterial {
  if (facade === 'yellow') return sharedBuildingMaterial('plasterYellow');
  if (facade === 'grey') return sharedBuildingMaterial('plasterGrey');
  if (facade === 'lightOrange' || facade === 'orange') return sharedBuildingMaterial('plasterOrange');
  return sharedBuildingMaterial('plasterWhite');
}

export function residenceRoofMaterial(roof: ResidenceRoofColor): THREE.MeshStandardMaterial {
  if (roof === 'red') return sharedBuildingMaterial('clayRed');
  if (roof === 'brown') return sharedBuildingMaterial('shingle');
  return sharedBuildingMaterial('slate');
}

export function mossMaterial(kind: 'moss' | 'grass' = 'moss'): THREE.MeshStandardMaterial {
  return sharedBuildingMaterial(kind === 'grass' ? 'grassRoof' : 'moss');
}

export function metalMaterial(shade: 'iron' | 'steel' = 'iron'): THREE.MeshStandardMaterial {
  void shade;
  return sharedBuildingMaterial('metalIron');
}

export function addMesh(
  group: THREE.Group,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: THREE.Vector3,
  rotation = new THREE.Euler(),
  scale = new THREE.Vector3(1, 1, 1),
): THREE.Mesh {
  const mesh = new THREE.Mesh(prepareBuildingGeometryUvs(geometry, material), material);
  mesh.position.copy(position);
  mesh.rotation.copy(rotation);
  mesh.scale.copy(scale);
  // Detailed meshes stay off the shadow pass; one invisible proxy per building casts instead.
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}
