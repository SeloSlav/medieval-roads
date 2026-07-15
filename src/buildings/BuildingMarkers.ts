import * as THREE from 'three';
import { BUILDING_STORAGE_CAPS } from '../generated/gameBalance.ts';
import { disposeObject3D } from '../utils/dispose.ts';
import type { BuildingKind, BuildingState } from '../resources/types.ts';
import type { Terrain } from '../terrain/Terrain.ts';
import { areBuildingShadowsEnabled } from '../scene/shadowPreference.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import { buildingPlacementYaw } from './buildingPlacement.ts';
import { getBuildingExtent } from './buildingExtents.ts';
import { createBuildingShadowProxy } from './buildingShadowProxy.ts';
import { createBuildingMesh } from './BuildingMeshes.ts';
import {
  createBuildingPreviewMesh,
  disposeBuildingPreviewMesh,
  updateBuildingPreviewAppearance,
} from './BuildingPlacementPreview.ts';

type BuildingMarkersOptions = {
  terrain: Terrain;
  parent: THREE.Group;
  getRoadNetwork?: () => RoadNetwork | null;
};

export class BuildingMarkers {
  private readonly terrain: Terrain;
  private readonly getRoadNetwork?: () => RoadNetwork | null;
  private readonly group = new THREE.Group();
  private readonly buildingMeshes = new Map<string, THREE.Group>();
  private extentOverlayMesh: THREE.Mesh | null = null;
  private extentOverlayKind: BuildingKind | null = null;
  private previewMesh: THREE.Mesh | null = null;
  private previewBuilding: THREE.Group | null = null;
  private previewKind: BuildingKind | null = null;
  private previewValid: boolean | null = null;
  private lastPreviewSignature = '';

  constructor(options: BuildingMarkersOptions) {
    this.terrain = options.terrain;
    this.getRoadNetwork = options.getRoadNetwork;
    this.group.name = 'Building markers';
    options.parent.add(this.group);
  }

  setBuildingExtentOverlay(building: BuildingState | null): void {
    const extent = building
      ? getBuildingExtent(building.kind, building.workRadius)
      : null;
    if (!building || !extent) {
      if (this.extentOverlayMesh) this.extentOverlayMesh.visible = false;
      return;
    }

    const color = buildingExtentColor(building.kind);
    if (!this.extentOverlayMesh || this.extentOverlayKind !== building.kind) {
      if (this.extentOverlayMesh) {
        disposeObject3D(this.extentOverlayMesh);
        this.extentOverlayMesh.removeFromParent();
      }
      this.extentOverlayMesh = createRadiusRing(color, 0.14);
      this.extentOverlayKind = building.kind;
      this.group.add(this.extentOverlayMesh);
    }

    const y = this.terrain.getHeightAt(building.x, building.z);
    this.extentOverlayMesh.visible = true;
    this.extentOverlayMesh.position.set(building.x, y + 0.15, building.z);
    this.extentOverlayMesh.scale.set(extent.radius, 1, extent.radius);
  }

  syncBuildings(buildings: Iterable<BuildingState>): void {
    const nextIds = new Set<string>();
    for (const building of buildings) {
      nextIds.add(building.id);
      this.upsertBuilding(building);
    }

    for (const id of this.buildingMeshes.keys()) {
      if (nextIds.has(id)) continue;
      this.removeBuilding(id);
    }
  }

  clearPlacementPreview(): void {
    if (this.previewMesh) this.previewMesh.visible = false;
    if (this.previewBuilding) this.previewBuilding.visible = false;
    this.previewValid = null;
    this.lastPreviewSignature = '';
  }

  setPlacementPreview(
    kind: BuildingKind,
    x: number,
    z: number,
    extentRadius: number,
    valid: boolean,
    visible: boolean,
  ): void {
    const signature = `${kind}|${x.toFixed(2)}|${z.toFixed(2)}|${valid ? 1 : 0}|${visible ? 1 : 0}|${extentRadius.toFixed(1)}`;
    if (signature === this.lastPreviewSignature) return;
    this.lastPreviewSignature = signature;
    if (!visible) {
      if (this.previewMesh) this.previewMesh.visible = false;
      if (this.previewBuilding) this.previewBuilding.visible = false;
      return;
    }

    const ringColor = valid ? 0x00cc66 : 0xff4444;
    if (!this.previewMesh) {
      this.previewMesh = createRadiusRing(ringColor, 0.22);
      this.group.add(this.previewMesh);
    } else if (this.previewValid !== valid) {
      (this.previewMesh.material as THREE.MeshBasicMaterial).color.setHex(ringColor);
    }

    if (!this.previewBuilding || this.previewKind !== kind) {
      if (this.previewBuilding) {
        disposeBuildingPreviewMesh(this.previewBuilding);
        this.previewBuilding.removeFromParent();
      }
      this.previewBuilding = createBuildingPreviewMesh(kind);
      this.previewKind = kind;
      this.previewValid = valid;
      this.previewBuilding.rotation.y = buildingPlacementYaw(kind, x, z, this.getRoadNetwork?.() ?? null);
      this.group.add(this.previewBuilding);
    } else if (this.previewValid !== valid) {
      updateBuildingPreviewAppearance(this.previewBuilding, valid);
      this.previewValid = valid;
    }

    const y = this.terrain.getHeightAt(x, z);
    const yaw = buildingPlacementYaw(kind, x, z, this.getRoadNetwork?.() ?? null);
    this.previewMesh.visible = extentRadius > 0;
    this.previewMesh.position.set(x, y + 0.2, z);
    this.previewMesh.scale.set(extentRadius, 1, extentRadius);

    this.previewBuilding.visible = true;
    this.previewBuilding.rotation.y = yaw;
    this.previewBuilding.position.set(x, y, z);
  }

  dispose(): void {
    if (this.previewMesh) {
      disposeObject3D(this.previewMesh);
      this.previewMesh = null;
    }
    if (this.previewBuilding) {
      disposeBuildingPreviewMesh(this.previewBuilding);
      this.previewBuilding = null;
      this.previewKind = null;
    }
    if (this.extentOverlayMesh) {
      disposeObject3D(this.extentOverlayMesh);
      this.extentOverlayMesh = null;
      this.extentOverlayKind = null;
    }
    for (const id of [...this.buildingMeshes.keys()]) {
      this.removeBuilding(id);
    }
    this.group.removeFromParent();
  }

  private upsertBuilding(building: BuildingState): void {
    let marker = this.buildingMeshes.get(building.id);
    if (!marker) {
      marker = createBuildingMesh(building.kind);
      const shadowProxy = createBuildingShadowProxy(building.kind);
      shadowProxy.castShadow = areBuildingShadowsEnabled();
      marker.add(shadowProxy);
      marker.rotation.y = buildingPlacementYaw(
        building.kind,
        building.x,
        building.z,
        this.getRoadNetwork?.() ?? null,
      );
      this.buildingMeshes.set(building.id, marker);
      this.group.add(marker);
    }

    const y = this.terrain.getHeightAt(building.x, building.z);
    marker.position.set(building.x, y, building.z);
    syncBuildingVisualState(marker, building);
    if (!marker.getObjectByName('Building shadow proxy')) {
      const shadowProxy = createBuildingShadowProxy(building.kind);
      shadowProxy.castShadow = areBuildingShadowsEnabled();
      marker.add(shadowProxy);
    }
  }

  private removeBuilding(id: string): void {
    const marker = this.buildingMeshes.get(id);
    if (!marker) return;
    this.group.remove(marker);
    // Construction materials and textures belong to BuildingMaterialLibrary;
    // individual buildings own only their geometry.
    disposeObject3D(marker);
    this.buildingMeshes.delete(id);
  }
}

function syncBuildingVisualState(marker: THREE.Group, building: BuildingState): void {
  if (building.kind !== 'lumber_mill') return;
  const stockpile = marker.getObjectByName('TimberStockpile');
  if (!(stockpile instanceof THREE.Group)) return;

  const capacity = BUILDING_STORAGE_CAPS.lumber_mill.timber;
  const fill = THREE.MathUtils.clamp(building.timber / capacity, 0, 1);
  const segments = stockpile.children.filter((child) => child.name === 'TimberStockSegment');
  const visibleCount = fill > 0 ? Math.max(1, Math.ceil(fill * segments.length)) : 0;
  stockpile.visible = visibleCount > 0;
  segments.forEach((segment, index) => {
    segment.visible = index < visibleCount;
  });
}

const BUILDING_EXTENT_COLORS: Partial<Record<BuildingKind, number>> = {
  lumber_mill: 0xd7b463,
  reforester: 0x00cc66,
  stone_quarry: 0xa8a29e,
  well: 0x4f9fd4,
  hunters_hall: 0x8a6d45,
  foragers_shed: 0xb05c76,
  threshing_barn: 0xb8894c,
  monastery: 0xe4dfd2,
};

function buildingExtentColor(kind: BuildingKind): number {
  return BUILDING_EXTENT_COLORS[kind] ?? 0xd7b463;
}

function createRadiusRing(color: number, opacity: number): THREE.Mesh {
  const geometry = new THREE.RingGeometry(0.94, 1, 64);
  geometry.rotateX(-Math.PI * 0.5);
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 8;
  return mesh;
}
