import { MeshStandardNodeMaterial } from 'three/webgpu';
import { attribute, float, mix, normalMap, pow, smoothstep, sub, texture, uv, vec3 } from 'three/tsl';
import type { TextureSet } from './RoadTextureLoader.ts';

type TslNode = {
  add(value: TslNode): TslNode;
  mul(value: TslNode): TslNode;
  r: TslNode;
  g: TslNode;
  b: TslNode;
  rgb: TslNode;
  x: TslNode;
};

function greyCoolRoadColor(map: TslNode, desaturate: number, tint: [number, number, number]): TslNode {
  const luminance = map.r
    .mul(float(0.299) as TslNode)
    .add(map.g.mul(float(0.587) as TslNode))
    .add(map.b.mul(float(0.114) as TslNode));
  const desaturated = mix(map.rgb, vec3(luminance, luminance, luminance) as TslNode, float(desaturate) as TslNode) as TslNode;
  return desaturated.mul(vec3(tint[0], tint[1], tint[2]) as TslNode);
}

function buildRoadColorNode(textures: TextureSet, desaturate: number, tint: [number, number, number]): TslNode {
  const sample = texture(textures.albedo, uv() as TslNode) as TslNode;
  return greyCoolRoadColor(sample, desaturate, tint);
}

function buildMuddyBankColorNode(textures: TextureSet): TslNode {
  const sample = texture(textures.albedo, uv() as TslNode) as TslNode;
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

function buildBankOpacityNode(textures: TextureSet): TslNode {
  const uvNode = uv() as TslNode;
  const radialFade = pow(
    smoothstep(float(0.08) as TslNode, float(0.96) as TslNode, uvNode.x),
    float(0.62) as TslNode,
  ) as TslNode;
  const edgeMaskSample = textures.edgeMask
    ? (texture(textures.edgeMask, uvNode) as TslNode).r
    : (float(1) as TslNode);
  return radialFade.mul(edgeMaskSample).mul(float(0.94) as TslNode);
}

function buildRiverBankOpacityNode(textures: TextureSet): TslNode {
  const uvNode = uv() as TslNode;
  const radialFade = pow(smoothstep(float(0.08) as TslNode, float(0.92) as TslNode, uvNode.x), float(0.55) as TslNode) as TslNode;
  const edgeMaskSample = textures.edgeMask
    ? (texture(textures.edgeMask, uvNode) as TslNode).r
    : (float(1) as TslNode);
  return radialFade.mul(edgeMaskSample).mul(float(0.96) as TslNode);
}

export function createRoadCoreMaterial(dirtTextures: TextureSet, bridgeTextures?: TextureSet): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial();
  material.name = 'Road core';
  material.color.set(0xffffff);
  material.roughness = 0.99;
  material.metalness = 0;
  material.polygonOffset = true;
  material.polygonOffsetFactor = -2;
  material.polygonOffsetUnits = -2;

  const dirtColor = buildRoadColorNode(dirtTextures, 0.72, [0.9, 0.9, 0.88]);
  if (bridgeTextures) {
    const woodColor = buildRoadColorNode(bridgeTextures, 0.38, [1.02, 0.96, 0.88]);
    const bridgeBlend = pow(attribute('bridgeBlend', 'float') as TslNode, float(0.92) as TslNode) as TslNode;
    material.colorNode = mix(dirtColor, woodColor, bridgeBlend) as TslNode;

    const dirtNormal = normalMap(texture(dirtTextures.normal, uv()));
    const woodNormal = normalMap(texture(bridgeTextures.normal, uv()));
    material.normalNode = mix(dirtNormal, woodNormal, bridgeBlend);

    const dirtRough = (texture(dirtTextures.roughness, uv() as TslNode) as TslNode).r;
    const woodRough = (texture(bridgeTextures.roughness, uv() as TslNode) as TslNode).r;
    material.roughnessNode = mix(dirtRough, woodRough.mul(float(0.94) as TslNode), bridgeBlend);
    if (dirtTextures.ao) material.aoNode = (texture(dirtTextures.ao, uv() as TslNode) as TslNode).r;
  } else {
    material.colorNode = dirtColor;
    material.normalNode = normalMap(texture(dirtTextures.normal, uv()));
    material.roughnessNode = (texture(dirtTextures.roughness, uv() as TslNode) as TslNode).r;
    if (dirtTextures.ao) material.aoNode = (texture(dirtTextures.ao, uv() as TslNode) as TslNode).r;
  }
  return material;
}

export function createRoadEdgeMaterial(textures: TextureSet, fadeBridgeEdges = true): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial();
  material.name = 'Road edge blend';
  material.color.set(0xffffff);
  material.roughness = 1;
  material.metalness = 0;
  material.transparent = true;
  material.premultipliedAlpha = true;
  material.opacity = 1;
  material.depthWrite = false;
  material.polygonOffset = true;
  material.polygonOffsetFactor = -3;
  material.polygonOffsetUnits = -8;
  material.colorNode = buildRoadColorNode(textures, 0.78, [0.92, 0.91, 0.89]);
  material.roughnessNode = (texture(textures.roughness, uv() as TslNode) as TslNode).r;
  let opacity = buildBankOpacityNode(textures);
  if (fadeBridgeEdges) {
    const bridgeBlendAttr = attribute('bridgeBlend', 'float') as TslNode;
    const edgeKeep = sub(float(1) as TslNode, bridgeBlendAttr) as TslNode;
    opacity = opacity.mul(edgeKeep) as TslNode;
  }
  material.opacityNode = opacity;
  return material;
}

export function createRiverBankMaterial(textures: TextureSet): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial();
  material.name = 'River bank mud';
  material.color.set(0xffffff);
  material.roughness = 0.9;
  material.metalness = 0;
  material.transparent = true;
  material.opacity = 1;
  material.depthWrite = false;
  if (textures.edgeMask) material.alphaMap = textures.edgeMask;
  material.colorNode = buildMuddyBankColorNode(textures);
  material.normalNode = normalMap(texture(textures.normal, uv()));
  const roughSample = (texture(textures.roughness, uv() as TslNode) as TslNode).r;
  material.roughnessNode = mix(roughSample, float(0.58) as TslNode, float(0.42) as TslNode);
  if (textures.ao) material.aoNode = (texture(textures.ao, uv() as TslNode) as TslNode).r;
  material.opacityNode = buildRiverBankOpacityNode(textures);
  return material;
}
