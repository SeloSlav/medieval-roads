import * as THREE from 'three';
import type { Terrain } from '../terrain/Terrain.ts';
import type { RoadEdge } from '../roads/RoadEdge.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import { distancePointToPolylineXZ, type RockObstacle } from '../utils/pathGeometry.ts';
import type { UndergrowthInstances, UndergrowthPlacement } from './ForestUndergrowth.ts';
import {
  computeRoadStumpPlacements,
  createRoadStumpMesh,
  isUndergrowthNearAnyEdge,
  updateRoadStumpInstances,
} from './RoadStumps.ts';

const ROAD_CLEAR_MARGIN = 1.35;
const UNDERGROWTH_CLEAR_MARGIN = 0.95;

type TreePlacement = {
  x: number;
  z: number;
  form: 'narrow' | 'broad' | 'young' | 'midstory';
  scale: number;
};

export type ConiferForestInstances = {
  group: THREE.Group;
  trunkMesh: THREE.InstancedMesh;
  foliageMesh: THREE.InstancedMesh;
  shadowTierMesh: THREE.InstancedMesh;
  placements: TreePlacement[];
  layerCounts: number[];
  foliageStartIndex: number[];
  trunkMatrices: THREE.Matrix4[];
  foliageMatrices: THREE.Matrix4[];
};

export class ForestManager {
  readonly group: THREE.Group;
  readonly rockPlacements: ReadonlyArray<RockObstacle>;
  private readonly disposeResources: () => void;
  private readonly placements: TreePlacement[];
  private readonly trunkMesh: THREE.InstancedMesh;
  private readonly foliageMesh: THREE.InstancedMesh;
  private readonly shadowTierMesh: THREE.InstancedMesh;
  private readonly layerCounts: number[];
  private readonly foliageStartIndex: number[];
  private readonly trunkMatrices: THREE.Matrix4[];
  private readonly foliageMatrices: THREE.Matrix4[];
  private readonly undergrowth: UndergrowthInstances | null;
  private readonly undergrowthPlacements: UndergrowthPlacement[];
  private readonly stumpMesh: THREE.InstancedMesh;
  private readonly terrain: Terrain;
  private readonly hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
  private removedTrees = new Set<number>();
  private removedUndergrowth = new Set<number>();

  constructor(
    root: THREE.Group,
    conifer: ConiferForestInstances,
    rockPlacements: ReadonlyArray<RockObstacle>,
    undergrowth: UndergrowthInstances | null,
    undergrowthPlacements: UndergrowthPlacement[],
    terrain: Terrain,
    disposeResources: () => void,
  ) {
    this.group = root;
    this.rockPlacements = rockPlacements;
    this.disposeResources = disposeResources;
    this.placements = conifer.placements;
    this.trunkMesh = conifer.trunkMesh;
    this.foliageMesh = conifer.foliageMesh;
    this.shadowTierMesh = conifer.shadowTierMesh;
    this.layerCounts = conifer.layerCounts;
    this.foliageStartIndex = conifer.foliageStartIndex;
    this.trunkMatrices = conifer.trunkMatrices;
    this.foliageMatrices = conifer.foliageMatrices;
    this.undergrowth = undergrowth;
    this.undergrowthPlacements = undergrowthPlacements;
    this.terrain = terrain;
    this.stumpMesh = createRoadStumpMesh();
    this.group.add(this.stumpMesh);
  }

  syncRoadClearance(network: RoadNetwork): void {
    const edges = [...network.edges.values()];
    const nextRemoved = new Set<number>();

    for (let treeIndex = 0; treeIndex < this.placements.length; treeIndex++) {
      if (this.isTreeNearAnyEdge(this.placements[treeIndex], edges)) {
        nextRemoved.add(treeIndex);
      }
    }

    for (let treeIndex = 0; treeIndex < this.placements.length; treeIndex++) {
      const shouldRemove = nextRemoved.has(treeIndex);
      if (shouldRemove === this.removedTrees.has(treeIndex)) continue;
      if (shouldRemove) this.hideTree(treeIndex);
      else this.showTree(treeIndex);
    }

    this.removedTrees = nextRemoved;
    this.trunkMesh.instanceMatrix.needsUpdate = true;
    this.foliageMesh.instanceMatrix.needsUpdate = true;
    this.shadowTierMesh.instanceMatrix.needsUpdate = true;

    this.syncUndergrowthClearance(edges);
    this.syncRoadStumps(network);
  }

  dispose(): void {
    this.stumpMesh.geometry.dispose();
    (this.stumpMesh.material as THREE.Material).dispose();
    this.disposeResources();
  }

  private syncUndergrowthClearance(edges: RoadEdge[]): void {
    if (!this.undergrowth) return;

    const nextRemoved = new Set<number>();
    for (let index = 0; index < this.undergrowthPlacements.length; index++) {
      const placement = this.undergrowthPlacements[index];
      if (isUndergrowthNearAnyEdge(placement.x, placement.z, edges, UNDERGROWTH_CLEAR_MARGIN)) {
        nextRemoved.add(index);
      }
    }

    for (let index = 0; index < this.undergrowthPlacements.length; index++) {
      const shouldRemove = nextRemoved.has(index);
      if (shouldRemove === this.removedUndergrowth.has(index)) continue;
      const placement = this.undergrowthPlacements[index];
      const mesh = placement.kind === 'bush' ? this.undergrowth.bushMesh : this.undergrowth.fernMesh;
      const shadowMesh =
        placement.kind === 'bush' ? this.undergrowth.bushShadowMesh : this.undergrowth.fernShadowMesh;
      const matrices = placement.kind === 'bush' ? this.undergrowth.bushMatrices : this.undergrowth.fernMatrices;
      const matrix = shouldRemove ? this.hiddenMatrix : matrices[placement.meshIndex];
      mesh.setMatrixAt(placement.meshIndex, matrix);
      shadowMesh.setMatrixAt(placement.meshIndex, matrix);
    }

    this.removedUndergrowth = nextRemoved;
    this.undergrowth.bushMesh.instanceMatrix.needsUpdate = true;
    this.undergrowth.fernMesh.instanceMatrix.needsUpdate = true;
    this.undergrowth.bushShadowMesh.instanceMatrix.needsUpdate = true;
    this.undergrowth.fernShadowMesh.instanceMatrix.needsUpdate = true;
  }

  private syncRoadStumps(network: RoadNetwork): void {
    const placements = computeRoadStumpPlacements(network);
    updateRoadStumpInstances(this.stumpMesh, placements, this.terrain);
  }

  private isTreeNearAnyEdge(placement: TreePlacement, edges: RoadEdge[]): boolean {
    for (const edge of edges) {
      const path = edge.sampledPath.length >= 2 ? edge.sampledPath : edge.controlPoints;
      if (path.length < 2) continue;
      const distance = distancePointToPolylineXZ(placement.x, placement.z, path);
      if (distance <= treeClearRadius(placement, edge.width)) return true;
    }
    return false;
  }

  private hideTree(treeIndex: number): void {
    this.trunkMesh.setMatrixAt(treeIndex, this.hiddenMatrix);
    const foliageStart = this.foliageStartIndex[treeIndex];
    const foliageCount = this.layerCounts[treeIndex];
    for (let i = 0; i < foliageCount; i++) {
      const layerIndex = foliageStart + i;
      this.foliageMesh.setMatrixAt(layerIndex, this.hiddenMatrix);
      this.shadowTierMesh.setMatrixAt(layerIndex, this.hiddenMatrix);
    }
  }

  private showTree(treeIndex: number): void {
    this.trunkMesh.setMatrixAt(treeIndex, this.trunkMatrices[treeIndex]);
    const foliageStart = this.foliageStartIndex[treeIndex];
    const foliageCount = this.layerCounts[treeIndex];
    for (let i = 0; i < foliageCount; i++) {
      const layerIndex = foliageStart + i;
      this.foliageMesh.setMatrixAt(layerIndex, this.foliageMatrices[layerIndex]);
      this.shadowTierMesh.setMatrixAt(layerIndex, this.foliageMatrices[layerIndex]);
    }
  }
}

function treeClearRadius(placement: TreePlacement, roadWidth: number): number {
  const canopyRadius =
    placement.form === 'broad'
      ? 4.1 * placement.scale
      : placement.form === 'young' || placement.form === 'midstory'
        ? 2.3 * placement.scale
        : 3.3 * placement.scale;
  return roadWidth * 0.5 + canopyRadius + ROAD_CLEAR_MARGIN;
}
