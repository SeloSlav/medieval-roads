import * as THREE from 'three';
import type { BuildingTerrainSource } from '../buildings/BuildingTerrainLayout.ts';
import { getBuildingPadParams } from '../buildings/BuildingTerrainLayout.ts';
import { buildingPlacementYaw } from '../buildings/buildingPlacement.ts';
import type { Point2 } from '../utils/polygonGeometry.ts';
import type { Terrain } from '../terrain/Terrain.ts';
import type { RoadEdge } from '../roads/RoadEdge.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import { distancePointToPolylineXZ, type RockObstacle } from '../utils/pathGeometry.ts';
import { distancePointToPolygon2 } from '../utils/polygonGeometry.ts';
import type { UndergrowthInstances, UndergrowthKind, UndergrowthPlacement } from './ForestUndergrowth.ts';
import {
  computeRoadStumpPlacements,
  createRoadStumpMesh,
  createHarvestStumpMesh,
  isUndergrowthNearAnyEdge,
  updateRoadStumpInstances,
  updateHarvestStumpInstance,
} from './RoadStumps.ts';
import { createTreeSaplingMesh, updateTreeSaplingInstance } from './TreeSaplings.ts';
import type { TreePhase } from '../resources/types.ts';
import type { SeedThreeForestController } from '../vegetation/seedthree/seedThreeForestTypes.ts';

const ROAD_CLEAR_MARGIN = 1.35;
const BUILDING_CLEAR_MARGIN = 1.35;
const UNDERGROWTH_CLEAR_MARGIN = 0.95;

export type ForestPlacementClearance = {
  roadNetwork?: RoadNetwork | null;
  buildings?: Iterable<BuildingTerrainSource>;
  burgageParcelPolygons?: Iterable<Point2[]>;
};

type TreePlacement = {
  x: number;
  z: number;
  form: 'narrow' | 'broad' | 'young' | 'midstory';
  species: string;
  scale: number;
};

export type ForestTreeLayout = TreePlacement & {
  layoutIndex: number;
};

export type MixedForestInstances = {
  group: THREE.Group;
  trunkMesh: THREE.InstancedMesh;
  coniferFoliageMesh: THREE.InstancedMesh;
  broadleafFoliageMesh: THREE.InstancedMesh;
  coniferShadowMesh: THREE.InstancedMesh;
  broadleafShadowMesh: THREE.InstancedMesh;
  placements: TreePlacement[];
  coniferLayerCounts: number[];
  broadleafLayerCounts: number[];
  coniferStartIndex: number[];
  broadleafStartIndex: number[];
  trunkMatrices: THREE.Matrix4[];
  coniferFoliageMatrices: THREE.Matrix4[];
  broadleafFoliageMatrices: THREE.Matrix4[];
};

export class ForestManager {
  readonly group: THREE.Group;
  readonly rockPlacements: ReadonlyArray<RockObstacle>;
  private readonly disposeResources: () => void;
  private readonly placements: TreePlacement[];
  private readonly trunkMesh: THREE.InstancedMesh;
  private readonly coniferFoliageMesh: THREE.InstancedMesh;
  private readonly broadleafFoliageMesh: THREE.InstancedMesh;
  private readonly coniferShadowMesh: THREE.InstancedMesh;
  private readonly broadleafShadowMesh: THREE.InstancedMesh;
  private readonly coniferLayerCounts: number[];
  private readonly broadleafLayerCounts: number[];
  private readonly coniferStartIndex: number[];
  private readonly broadleafStartIndex: number[];
  private readonly trunkMatrices: THREE.Matrix4[];
  private readonly coniferFoliageMatrices: THREE.Matrix4[];
  private readonly broadleafFoliageMatrices: THREE.Matrix4[];
  private readonly undergrowth: UndergrowthInstances | null;
  private readonly undergrowthPlacements: UndergrowthPlacement[];
  private readonly stumpMesh: THREE.InstancedMesh;
  private readonly harvestStumpMesh: THREE.InstancedMesh;
  private readonly saplingMesh: THREE.InstancedMesh;
  private readonly terrain: Terrain;
  private readonly seedThreeForest: SeedThreeForestController | null;
  private readonly hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
  private removedTrees = new Set<number>();
  private removedUndergrowth = new Set<number>();
  private treePhases = new Map<number, TreePhase>();
  private treeGrowthProgress = new Map<number, number>();

  constructor(
    root: THREE.Group,
    forestInstances: MixedForestInstances,
    rockPlacements: ReadonlyArray<RockObstacle>,
    undergrowth: UndergrowthInstances | null,
    undergrowthPlacements: UndergrowthPlacement[],
    terrain: Terrain,
    disposeResources: () => void,
    seedThreeForest: SeedThreeForestController | null = null,
  ) {
    this.seedThreeForest = seedThreeForest;
    this.group = root;
    this.rockPlacements = rockPlacements;
    this.disposeResources = disposeResources;
    this.placements = forestInstances.placements;
    this.trunkMesh = forestInstances.trunkMesh;
    this.coniferFoliageMesh = forestInstances.coniferFoliageMesh;
    this.broadleafFoliageMesh = forestInstances.broadleafFoliageMesh;
    this.coniferShadowMesh = forestInstances.coniferShadowMesh;
    this.broadleafShadowMesh = forestInstances.broadleafShadowMesh;
    this.coniferLayerCounts = forestInstances.coniferLayerCounts;
    this.broadleafLayerCounts = forestInstances.broadleafLayerCounts;
    this.coniferStartIndex = forestInstances.coniferStartIndex;
    this.broadleafStartIndex = forestInstances.broadleafStartIndex;
    this.trunkMatrices = forestInstances.trunkMatrices;
    this.coniferFoliageMatrices = forestInstances.coniferFoliageMatrices;
    this.broadleafFoliageMatrices = forestInstances.broadleafFoliageMatrices;
    this.undergrowth = undergrowth;
    this.undergrowthPlacements = undergrowthPlacements;
    this.terrain = terrain;
    this.stumpMesh = createRoadStumpMesh();
    this.harvestStumpMesh = createHarvestStumpMesh(this.placements.length);
    this.saplingMesh = createTreeSaplingMesh(this.placements.length);
    this.group.add(this.stumpMesh);
    this.group.add(this.harvestStumpMesh);
    this.group.add(this.saplingMesh);
    for (let i = 0; i < this.placements.length; i++) {
      this.hideHarvestStump(i);
      this.hideSapling(i);
    }
  }

  getTreeLayouts(): ForestTreeLayout[] {
    return this.placements.map((placement, layoutIndex) => ({
      layoutIndex,
      ...placement,
    }));
  }

  applyTreePhase(layoutIndex: number, phase: TreePhase, growthProgress: number): void {
    if (layoutIndex < 0 || layoutIndex >= this.placements.length) return;
    this.treePhases.set(layoutIndex, phase);
    this.treeGrowthProgress.set(layoutIndex, growthProgress);

    if (this.removedTrees.has(layoutIndex)) {
      this.hideTree(layoutIndex);
      this.hideHarvestStump(layoutIndex);
      this.hideSapling(layoutIndex);
      this.commitTreeInstanceUpdates();
      return;
    }

    this.restoreTreePhaseVisual(layoutIndex, phase, growthProgress);
    this.commitTreeInstanceUpdates();
  }

  private restoreTreePhaseVisual(
    layoutIndex: number,
    phase: TreePhase = this.treePhases.get(layoutIndex) ?? 'mature',
    growthProgress: number = this.treeGrowthProgress.get(layoutIndex) ?? 1,
  ): void {
    switch (phase) {
      case 'mature':
        this.hideHarvestStump(layoutIndex);
        this.hideSapling(layoutIndex);
        this.showTree(layoutIndex);
        break;
      case 'stump':
        this.hideTree(layoutIndex);
        this.hideSapling(layoutIndex);
        this.showHarvestStump(layoutIndex);
        break;
      case 'growing':
        this.hideTree(layoutIndex);
        this.hideHarvestStump(layoutIndex);
        this.showSapling(layoutIndex, growthProgress);
        break;
      default: {
        const unreachable: never = phase;
        return unreachable;
      }
    }
  }

  setTreeShadowsEnabled(enabled: boolean): void {
    this.seedThreeForest?.setShadows(enabled);
    this.trunkMesh.castShadow = enabled;
    this.coniferShadowMesh.castShadow = enabled;
    this.broadleafShadowMesh.castShadow = enabled;
    this.saplingMesh.castShadow = enabled;
    this.stumpMesh.castShadow = enabled;
    this.harvestStumpMesh.castShadow = enabled;
    if (this.undergrowth) {
      this.undergrowth.bushShadowMesh.castShadow = enabled;
      this.undergrowth.fernShadowMesh.castShadow = enabled;
      this.undergrowth.juniperShadowMesh.castShadow = enabled;
    }
    this.group.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (mesh.name.toLowerCase().includes('shadow')) {
        mesh.castShadow = enabled;
      }
    });
  }

  syncRoadClearance(network: RoadNetwork): void {
    this.syncPlacementClearance({ roadNetwork: network });
  }

  syncPlacementClearance(clearance: ForestPlacementClearance): void {
    const edges = clearance.roadNetwork ? [...clearance.roadNetwork.edges.values()] : [];
    const buildings = clearance.buildings ? [...clearance.buildings] : [];
    const burgageParcelPolygons = clearance.burgageParcelPolygons ? [...clearance.burgageParcelPolygons] : [];
    const nextRemoved = new Set<number>();

    for (let treeIndex = 0; treeIndex < this.placements.length; treeIndex++) {
      const placement = this.placements[treeIndex];
      if (this.isTreeNearAnyEdge(placement, edges)) {
        nextRemoved.add(treeIndex);
        continue;
      }
      if (this.isTreeNearAnyBuilding(placement, buildings)) {
        nextRemoved.add(treeIndex);
        continue;
      }
      if (this.isTreeNearAnyBurgageParcel(placement, burgageParcelPolygons)) {
        nextRemoved.add(treeIndex);
      }
    }

    const treesChanged = !removedIndexSetsEqual(nextRemoved, this.removedTrees);
    if (treesChanged) {
      const previousRemoved = this.removedTrees;
      this.removedTrees = nextRemoved;

      for (let treeIndex = 0; treeIndex < this.placements.length; treeIndex++) {
        const wasRemoved = previousRemoved.has(treeIndex);
        const isRemoved = nextRemoved.has(treeIndex);
        if (wasRemoved === isRemoved) continue;

        if (isRemoved) {
          this.hideTree(treeIndex);
          this.hideHarvestStump(treeIndex);
          this.hideSapling(treeIndex);
        } else {
          this.restoreTreePhaseVisual(treeIndex);
        }
      }

      this.commitTreeInstanceUpdates();
    }

    this.syncUndergrowthClearance(edges, buildings, burgageParcelPolygons);
    if (clearance.roadNetwork) {
      this.syncRoadStumps(clearance.roadNetwork);
    }
  }

  dispose(): void {
    this.stumpMesh.geometry.dispose();
    (this.stumpMesh.material as THREE.Material).dispose();
    this.harvestStumpMesh.geometry.dispose();
    (this.harvestStumpMesh.material as THREE.Material).dispose();
    this.saplingMesh.geometry.dispose();
    (this.saplingMesh.material as THREE.Material).dispose();
    this.disposeResources();
  }

  private syncUndergrowthClearance(
    edges: RoadEdge[],
    buildings: BuildingTerrainSource[],
    burgageParcelPolygons: Point2[][],
  ): void {
    if (!this.undergrowth) return;

    const nextRemoved = new Set<number>();
    for (let index = 0; index < this.undergrowthPlacements.length; index++) {
      const placement = this.undergrowthPlacements[index];
      if (isUndergrowthNearAnyEdge(placement.x, placement.z, edges, UNDERGROWTH_CLEAR_MARGIN)) {
        nextRemoved.add(index);
        continue;
      }
      if (this.isUndergrowthNearAnyBuilding(placement.x, placement.z, buildings)) {
        nextRemoved.add(index);
        continue;
      }
      if (this.isUndergrowthNearAnyBurgageParcel(placement.x, placement.z, burgageParcelPolygons)) {
        nextRemoved.add(index);
      }
    }

    for (let index = 0; index < this.undergrowthPlacements.length; index++) {
      const shouldRemove = nextRemoved.has(index);
      if (shouldRemove === this.removedUndergrowth.has(index)) continue;
      const placement = this.undergrowthPlacements[index];
      const mesh = undergrowthMeshFor(this.undergrowth, placement.kind);
      const shadowMesh = undergrowthShadowMeshFor(this.undergrowth, placement.kind);
      const matrices = undergrowthMatricesFor(this.undergrowth, placement.kind);
      const matrix = shouldRemove ? this.hiddenMatrix : matrices[placement.meshIndex];
      mesh.setMatrixAt(placement.meshIndex, matrix);
      shadowMesh.setMatrixAt(placement.meshIndex, matrix);
    }

    this.removedUndergrowth = nextRemoved;
    this.undergrowth.bushMesh.instanceMatrix.needsUpdate = true;
    this.undergrowth.fernMesh.instanceMatrix.needsUpdate = true;
    this.undergrowth.juniperMesh.instanceMatrix.needsUpdate = true;
    this.undergrowth.bushShadowMesh.instanceMatrix.needsUpdate = true;
    this.undergrowth.fernShadowMesh.instanceMatrix.needsUpdate = true;
    this.undergrowth.juniperShadowMesh.instanceMatrix.needsUpdate = true;
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

  private isTreeNearAnyBuilding(placement: TreePlacement, buildings: BuildingTerrainSource[]): boolean {
    for (const building of buildings) {
      if (treeWithinBuildingPad(placement, building)) return true;
    }
    return false;
  }

  private isTreeNearAnyBurgageParcel(placement: TreePlacement, parcelPolygons: Point2[][]): boolean {
    for (const polygon of parcelPolygons) {
      if (treeWithinBurgageParcel(placement, polygon)) return true;
    }
    return false;
  }

  private isUndergrowthNearAnyBuilding(x: number, z: number, buildings: BuildingTerrainSource[]): boolean {
    for (const building of buildings) {
      if (pointWithinBuildingPad(x, z, building, 0)) return true;
    }
    return false;
  }

  private isUndergrowthNearAnyBurgageParcel(x: number, z: number, parcelPolygons: Point2[][]): boolean {
    for (const polygon of parcelPolygons) {
      if (distancePointToPolygon2({ x, z }, polygon) <= UNDERGROWTH_CLEAR_MARGIN) return true;
    }
    return false;
  }

  private hideTree(treeIndex: number): void {
    if (this.seedThreeForest) {
      this.seedThreeForest.hideTree(treeIndex);
      return;
    }
    this.trunkMesh.setMatrixAt(treeIndex, this.hiddenMatrix);
    this.hideConiferLayers(treeIndex);
    this.hideBroadleafLayers(treeIndex);
  }

  private showTree(treeIndex: number): void {
    if (this.seedThreeForest) {
      this.seedThreeForest.showTree(treeIndex);
      return;
    }
    this.trunkMesh.setMatrixAt(treeIndex, this.trunkMatrices[treeIndex]);
    this.showConiferLayers(treeIndex);
    this.showBroadleafLayers(treeIndex);
  }

  private showHarvestStump(layoutIndex: number): void {
    const placement = this.placements[layoutIndex];
    updateHarvestStumpInstance(
      this.harvestStumpMesh,
      layoutIndex,
      placement.x,
      placement.z,
      this.terrain.getHeightAt(placement.x, placement.z),
      placement.scale,
    );
  }

  private hideHarvestStump(layoutIndex: number): void {
    this.harvestStumpMesh.setMatrixAt(layoutIndex, this.hiddenMatrix);
  }

  private showSapling(layoutIndex: number, growthProgress: number): void {
    const placement = this.placements[layoutIndex];
    updateTreeSaplingInstance(
      this.saplingMesh,
      layoutIndex,
      placement.x,
      placement.z,
      this.terrain.getHeightAt(placement.x, placement.z),
      growthProgress,
      isConiferSpecies(placement.species),
    );
  }

  private hideSapling(layoutIndex: number): void {
    this.saplingMesh.setMatrixAt(layoutIndex, this.hiddenMatrix);
  }

  private commitTreeInstanceUpdates(): void {
    if (this.seedThreeForest) {
      this.seedThreeForest.commit();
    } else {
      this.trunkMesh.instanceMatrix.needsUpdate = true;
      this.coniferFoliageMesh.instanceMatrix.needsUpdate = true;
      this.broadleafFoliageMesh.instanceMatrix.needsUpdate = true;
      this.coniferShadowMesh.instanceMatrix.needsUpdate = true;
      this.broadleafShadowMesh.instanceMatrix.needsUpdate = true;
    }
    this.harvestStumpMesh.instanceMatrix.needsUpdate = true;
    this.saplingMesh.instanceMatrix.needsUpdate = true;
  }

  private hideConiferLayers(treeIndex: number): void {
    const foliageStart = this.coniferStartIndex[treeIndex];
    const foliageCount = this.coniferLayerCounts[treeIndex];
    for (let i = 0; i < foliageCount; i++) {
      const layerIndex = foliageStart + i;
      this.coniferFoliageMesh.setMatrixAt(layerIndex, this.hiddenMatrix);
      this.coniferShadowMesh.setMatrixAt(layerIndex, this.hiddenMatrix);
    }
  }

  private showConiferLayers(treeIndex: number): void {
    const foliageStart = this.coniferStartIndex[treeIndex];
    const foliageCount = this.coniferLayerCounts[treeIndex];
    for (let i = 0; i < foliageCount; i++) {
      const layerIndex = foliageStart + i;
      this.coniferFoliageMesh.setMatrixAt(layerIndex, this.coniferFoliageMatrices[layerIndex]);
      this.coniferShadowMesh.setMatrixAt(layerIndex, this.coniferFoliageMatrices[layerIndex]);
    }
  }

  private hideBroadleafLayers(treeIndex: number): void {
    const foliageStart = this.broadleafStartIndex[treeIndex];
    const foliageCount = this.broadleafLayerCounts[treeIndex];
    for (let i = 0; i < foliageCount; i++) {
      const layerIndex = foliageStart + i;
      this.broadleafFoliageMesh.setMatrixAt(layerIndex, this.hiddenMatrix);
      this.broadleafShadowMesh.setMatrixAt(layerIndex, this.hiddenMatrix);
    }
  }

  private showBroadleafLayers(treeIndex: number): void {
    const foliageStart = this.broadleafStartIndex[treeIndex];
    const foliageCount = this.broadleafLayerCounts[treeIndex];
    for (let i = 0; i < foliageCount; i++) {
      const layerIndex = foliageStart + i;
      this.broadleafFoliageMesh.setMatrixAt(layerIndex, this.broadleafFoliageMatrices[layerIndex]);
      this.broadleafShadowMesh.setMatrixAt(layerIndex, this.broadleafFoliageMatrices[layerIndex]);
    }
  }
}

function isConiferSpecies(species: string): boolean {
  return species === 'norwaySpruce'
    || species === 'scotsPine'
    || species === 'blackPine'
    || species === 'silverFir'
    || species === 'larch';
}

function treeCanopyRadius(placement: TreePlacement): number {
  if (placement.form === 'broad') return 4.1 * placement.scale;
  if (placement.form === 'young' || placement.form === 'midstory') return 2.3 * placement.scale;
  return 3.3 * placement.scale;
}

function treeClearRadius(placement: TreePlacement, roadWidth: number): number {
  return roadWidth * 0.5 + treeCanopyRadius(placement) + ROAD_CLEAR_MARGIN;
}

function treeWithinBuildingPad(placement: TreePlacement, building: BuildingTerrainSource): boolean {
  const canopyRadius = treeCanopyRadius(placement) + BUILDING_CLEAR_MARGIN;
  return pointWithinBuildingPad(placement.x, placement.z, building, canopyRadius);
}

function treeWithinBurgageParcel(placement: TreePlacement, polygon: Point2[]): boolean {
  const distance = distancePointToPolygon2({ x: placement.x, z: placement.z }, polygon);
  return distance <= treeCanopyRadius(placement) + BUILDING_CLEAR_MARGIN;
}

function pointWithinBuildingPad(
  x: number,
  z: number,
  building: BuildingTerrainSource,
  canopyRadius: number,
): boolean {
  const params = getBuildingPadParams(building.kind);
  const rotation = buildingPlacementYaw(building.kind, building.x, building.z);
  const dx = x - building.x;
  const dz = z - building.z;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const localX = dx * cos + dz * sin;
  const localZ = -dx * sin + dz * cos;
  const normDist = Math.hypot(localX / params.radiusX, localZ / params.radiusZ);
  const clearOuter = params.outerFade * 1.04 + canopyRadius / Math.min(params.radiusX, params.radiusZ);
  return normDist <= clearOuter;
}

function undergrowthMeshFor(instances: UndergrowthInstances, kind: UndergrowthKind): THREE.InstancedMesh {
  switch (kind) {
    case 'bush':
      return instances.bushMesh;
    case 'fern':
      return instances.fernMesh;
    case 'juniper':
      return instances.juniperMesh;
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

function undergrowthShadowMeshFor(instances: UndergrowthInstances, kind: UndergrowthKind): THREE.InstancedMesh {
  switch (kind) {
    case 'bush':
      return instances.bushShadowMesh;
    case 'fern':
      return instances.fernShadowMesh;
    case 'juniper':
      return instances.juniperShadowMesh;
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

function undergrowthMatricesFor(instances: UndergrowthInstances, kind: UndergrowthKind): THREE.Matrix4[] {
  switch (kind) {
    case 'bush':
      return instances.bushMatrices;
    case 'fern':
      return instances.fernMatrices;
    case 'juniper':
      return instances.juniperMatrices;
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

function removedIndexSetsEqual(a: Set<number>, b: Set<number>): boolean {
  if (a.size !== b.size) return false;
  for (const index of a) {
    if (!b.has(index)) return false;
  }
  return true;
}
