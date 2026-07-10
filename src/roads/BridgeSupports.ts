import * as THREE from 'three';
import type { BridgeSamplingContext, BridgeSpan } from './RiverBridgeSpans.ts';
import { bridgeBlendAtDistance, samplePathAtDistance } from './RiverBridgeSpans.ts';

const POST_SPACING = 3.4;
const DECK_THICKNESS = 0.14;
const POST_INSET = 0.88;
const POST_WIDTH = 0.28;
const POST_DEPTH = 0.3;
const WATER_PENETRATION = 0.45;

export function buildBridgeSupports(
  path: THREE.Vector3[],
  width: number,
  spans: BridgeSpan[],
  ctx: BridgeSamplingContext,
  material: THREE.Material,
): THREE.Group | null {
  if (spans.length === 0 || path.length < 2) return null;

  const distances = cumulativeDistances(path);
  const placements: Array<{ x: number; y: number; z: number; height: number }> = [];
  const half = width * 0.5 * POST_INSET;

  for (const span of spans) {
    const deckLength = span.deckEnd - span.deckStart;
    if (deckLength < POST_SPACING * 0.5) continue;

    const postCount = Math.max(2, Math.floor(deckLength / POST_SPACING) + 1);
    const spacing = deckLength / (postCount - 1);

    for (let postIndex = 0; postIndex < postCount; postIndex++) {
      const distance = span.deckStart + postIndex * spacing;
      const sample = samplePathAtDistance(path, distances, distance);
      if (!sample) continue;

      const blend = bridgeBlendAtDistance(distance, spans);
      if (blend < 0.92) continue;

      const { point, tangent } = sample;
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
      const deckBottomY = point.y - DECK_THICKNESS;
      const waterY = ctx.getWaterSurfaceY(point.x, point.z);
      const bedY = ctx.getTerrainY(point.x, point.z);
      const bottomY = Math.min(waterY, bedY) - WATER_PENETRATION;
      const height = Math.max(0.45, deckBottomY - bottomY);
      const centerY = bottomY + height * 0.5;

      for (const side of [-1, 1]) {
        const offset = normal.clone().multiplyScalar(half * side);
        placements.push({
          x: point.x + offset.x,
          y: centerY,
          z: point.z + offset.z,
          height,
        });
      }
    }
  }

  if (placements.length === 0) return null;

  const group = new THREE.Group();
  group.name = 'Bridge supports';
  const geometry = new THREE.BoxGeometry(POST_WIDTH, 1, POST_DEPTH);
  const mesh = new THREE.InstancedMesh(geometry, material, placements.length);
  mesh.name = 'Bridge support posts';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.renderOrder = 1.05;

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);

  placements.forEach((post, index) => {
    position.set(post.x, post.y, post.z);
    quaternion.identity();
    scale.set(1, post.height, 1);
    matrix.compose(position, quaternion, scale);
    mesh.setMatrixAt(index, matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  group.add(mesh);
  return group;
}

function cumulativeDistances(path: THREE.Vector3[]): number[] {
  const result = [0];
  for (let i = 1; i < path.length; i++) {
    result.push(result[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z));
  }
  return result;
}
