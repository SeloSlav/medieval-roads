import * as THREE from 'three';
import type { Terrain } from '../terrain/Terrain.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import { distancePointToPolylineXZ } from '../utils/pathGeometry.ts';

const WEAR_INNER_MARGIN = 0.55;
const WEAR_OUTER_MARGIN = 4.8;

export function updateTerrainRoadWear(terrain: Terrain, network: RoadNetwork): void {
  const geometry = terrain.mesh.geometry;
  const wearAttr = geometry.getAttribute('roadWearBlend') as THREE.BufferAttribute | undefined;
  if (!wearAttr) return;

  const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
  const edges = [...network.edges.values()];
  const roadPaths = edges
    .map((edge) => ({
      path: edge.sampledPath.length >= 2 ? edge.sampledPath : edge.controlPoints,
      halfWidth: edge.width * 0.5,
    }))
    .filter((entry) => entry.path.length >= 2);

  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const z = positions.getZ(i);
    let wear = 0;

    for (const { path, halfWidth } of roadPaths) {
      const distance = distancePointToPolylineXZ(x, z, path);
      const inner = halfWidth + WEAR_INNER_MARGIN;
      const outer = halfWidth + WEAR_OUTER_MARGIN;
      if (distance <= outer) {
        const edgeWear = 1 - smoothstep(inner, outer, distance);
        wear = Math.max(wear, edgeWear);
      }
    }

    wearAttr.setX(i, wear);
  }

  wearAttr.needsUpdate = true;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge1 === edge0) return value < edge0 ? 0 : 1;
  const t = THREE.MathUtils.clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
