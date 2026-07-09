import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
  attribute,
  cameraPosition,
  distance,
  float,
  max,
  mix,
  normalMap,
  pow,
  smoothstep,
  sub,
  texture,
  uv,
  vec3,
  vertexColor,
  positionWorld,
} from 'three/tsl';
import { GRASS_LOD } from '../grass/GrassLodConfig.ts';
import type { TextureSet } from '../roads/RoadTextureLoader.ts';
import type { TerrainBlendTextureSet } from '../roads/RoadTextureLoader.ts';

type TslNode = {
  add(value: TslNode): TslNode;
  div(value: TslNode): TslNode;
  mul(value: TslNode): TslNode;
  r: TslNode;
  g: TslNode;
  b: TslNode;
  rgb: TslNode;
  xyz: TslNode;
  x: TslNode;
  y: TslNode;
  z: TslNode;
};

function buildGrassBlendNodes(textures: TerrainBlendTextureSet) {
  const grassUv = uv() as TslNode;
  const weightsRaw = (vertexColor() as TslNode).xyz;
  const weightSum = max(weightsRaw.x.add(weightsRaw.y).add(weightsRaw.z), float(0.0001) as TslNode) as TslNode;
  const w = weightsRaw.div(weightSum);

  const meadowColor = texture(textures.meadow.albedo, grassUv) as TslNode;
  const denseColor = texture(textures.dense.albedo, grassUv) as TslNode;
  const dryColor = texture(textures.dry.albedo, grassUv) as TslNode;
  const colorNode = meadowColor.rgb
    .mul(w.x)
    .add(denseColor.rgb.mul(w.y))
    .add(dryColor.rgb.mul(w.z));

  const meadowNormal = texture(textures.meadow.normal, grassUv) as TslNode;
  const denseNormal = texture(textures.dense.normal, grassUv) as TslNode;
  const dryNormal = texture(textures.dry.normal, grassUv) as TslNode;
  const blendedNormalSample = meadowNormal.mul(w.x).add(denseNormal.mul(w.y)).add(dryNormal.mul(w.z));
  const normalNode = normalMap(blendedNormalSample);

  const meadowRoughness = (texture(textures.meadow.roughness, grassUv) as TslNode).r;
  const denseRoughness = (texture(textures.dense.roughness, grassUv) as TslNode).r;
  const dryRoughness = (texture(textures.dry.roughness, grassUv) as TslNode).r;
  const roughnessNode = meadowRoughness.mul(w.x).add(denseRoughness.mul(w.y)).add(dryRoughness.mul(w.z));

  const meadowAo = (texture(textures.meadow.ao!, grassUv) as TslNode).r;
  const denseAo = (texture(textures.dense.ao!, grassUv) as TslNode).r;
  const dryAo = (texture(textures.dry.ao!, grassUv) as TslNode).r;
  const aoNode = meadowAo.mul(w.x).add(denseAo.mul(w.y)).add(dryAo.mul(w.z));

  return { colorNode, normalNode, roughnessNode, aoNode, grassUv, weights: w };
}

function buildFarGrassLodNodes(
  nearColor: TslNode,
  nearRoughness: TslNode,
  nearNormal: TslNode,
  nearAo: TslNode,
  grassUv: TslNode,
  weights: TslNode,
  farTextures: TextureSet,
  shoreBlend: TslNode,
  roadWear: TslNode,
) {
  const camDist = distance(positionWorld as TslNode, cameraPosition as TslNode) as TslNode;
  const lodBlend = smoothstep(float(GRASS_LOD.near) as TslNode, float(GRASS_LOD.far) as TslNode, camDist) as TslNode;

  const farColor = (texture(farTextures.albedo, grassUv) as TslNode).rgb;
  const farRoughness = (texture(farTextures.roughness, grassUv) as TslNode).r;
  const farNormal = normalMap(texture(farTextures.normal, grassUv) as TslNode);
  const farAo = farTextures.ao
    ? (texture(farTextures.ao, grassUv) as TslNode).r
    : (float(1) as TslNode);

  // Keep worn shore and road patches brown; dry grass stays patchier at distance.
  const wornMask = max(shoreBlend, roadWear) as TslNode;
  const meadowWeight = weights.x as TslNode;
  const dryWeight = weights.z as TslNode;
  const grassMask = sub(
    float(1) as TslNode,
    max(wornMask, dryWeight.mul(float(0.72) as TslNode) as TslNode) as TslNode,
  ) as TslNode;
  const effectiveLod = lodBlend.mul(grassMask).mul(mix(float(0.55) as TslNode, float(1) as TslNode, meadowWeight) as TslNode) as TslNode;

  const colorNode = mix(nearColor, farColor, effectiveLod) as TslNode;
  const roughnessNode = mix(nearRoughness, farRoughness, effectiveLod);
  const normalNode = mix(nearNormal, farNormal, effectiveLod.mul(float(0.85) as TslNode) as TslNode);
  const aoNode = mix(nearAo, farAo, effectiveLod.mul(float(0.7) as TslNode) as TslNode);

  return { colorNode, normalNode, roughnessNode, aoNode };
}

function buildMuddyRoadColorNode(textures: TextureSet, grassUv: TslNode): TslNode {
  const sample = texture(textures.albedo, grassUv) as TslNode;
  const luminance = sample.r
    .mul(float(0.299) as TslNode)
    .add(sample.g.mul(float(0.587) as TslNode))
    .add(sample.b.mul(float(0.114) as TslNode));
  const desaturated = mix(
    sample.rgb,
    vec3(luminance, luminance, luminance) as TslNode,
    float(0.34) as TslNode,
  ) as TslNode;
  const warmTint = desaturated.mul(vec3(0.72, 0.54, 0.38) as TslNode);
  return warmTint.mul(float(0.86) as TslNode);
}

export function createTerrainGrassMaterial(textures: TerrainBlendTextureSet): MeshStandardNodeMaterial {
  const blendNodes = buildGrassBlendNodes(textures);
  const material = new MeshStandardNodeMaterial();
  material.name = 'Grass blend terrain';
  material.color.set(0xffffff);
  material.roughness = 1;
  material.metalness = 0;
  material.colorNode = blendNodes.colorNode;
  material.normalNode = blendNodes.normalNode;
  material.roughnessNode = blendNodes.roughnessNode;
  material.aoNode = blendNodes.aoNode;
  return material;
}

function buildTrampledWearColorNode(textures: TextureSet, grassUv: TslNode): TslNode {
  const sample = texture(textures.albedo, grassUv) as TslNode;
  const luminance = sample.r
    .mul(float(0.299) as TslNode)
    .add(sample.g.mul(float(0.587) as TslNode))
    .add(sample.b.mul(float(0.114) as TslNode));
  const desaturated = mix(
    sample.rgb,
    vec3(luminance, luminance, luminance) as TslNode,
    float(0.52) as TslNode,
  ) as TslNode;
  const wornTint = desaturated.mul(vec3(0.62, 0.58, 0.46) as TslNode);
  return wornTint.mul(float(0.78) as TslNode);
}

export function createTerrainGrassMaterialWithRiverShore(
  grassTextures: TerrainBlendTextureSet,
  roadTextures: TextureSet,
  farGrassTextures: TextureSet,
): MeshStandardNodeMaterial {
  const blendNodes = buildGrassBlendNodes(grassTextures);
  const mudColor = buildMuddyRoadColorNode(roadTextures, blendNodes.grassUv);
  const wearColor = buildTrampledWearColorNode(roadTextures, blendNodes.grassUv);
  const shoreBlend = pow(attribute('shoreBlend', 'float') as TslNode, float(0.82) as TslNode) as TslNode;
  const roadWear = pow(attribute('roadWearBlend', 'float') as TslNode, float(0.78) as TslNode) as TslNode;
  const grassWithShore = mix(blendNodes.colorNode, mudColor, shoreBlend) as TslNode;
  const nearColor = mix(grassWithShore, wearColor, roadWear) as TslNode;

  const roadRoughness = (texture(roadTextures.roughness, blendNodes.grassUv) as TslNode).r;
  const muddyRoughness = mix(roadRoughness, float(0.58) as TslNode, float(0.42) as TslNode);
  const wornRoughness = mix(roadRoughness, float(0.72) as TslNode, float(0.38) as TslNode);
  const roughnessWithShore = mix(blendNodes.roughnessNode, muddyRoughness, shoreBlend);
  const nearRoughness = mix(roughnessWithShore, wornRoughness, roadWear);

  const lodNodes = buildFarGrassLodNodes(
    nearColor,
    nearRoughness as TslNode,
    blendNodes.normalNode as TslNode,
    blendNodes.aoNode as TslNode,
    blendNodes.grassUv,
    blendNodes.weights,
    farGrassTextures,
    shoreBlend,
    roadWear,
  );

  const material = new MeshStandardNodeMaterial();
  material.name = 'Grass blend terrain with river shore';
  material.color.set(0xffffff);
  material.roughness = 1;
  material.metalness = 0;
  material.colorNode = lodNodes.colorNode;
  material.normalNode = lodNodes.normalNode;
  material.roughnessNode = lodNodes.roughnessNode;
  material.aoNode = lodNodes.aoNode;
  return material;
}
