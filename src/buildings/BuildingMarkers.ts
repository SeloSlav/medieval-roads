import * as THREE from 'three';
import { disposeObject3D } from '../utils/dispose.ts';
import type { BuildingKind, BuildingState } from '../resources/types.ts';
import type { Terrain } from '../terrain/Terrain.ts';
import { buildingPlacementYaw } from './buildingPlacement.ts';
import { createBuildingMesh } from './BuildingMeshes.ts';
import {
  createBuildingPreviewMesh,
  disposeBuildingPreviewMesh,
  updateBuildingPreviewAppearance,
} from './BuildingPlacementPreview.ts';

type BuildingMarkersOptions = {
  terrain: Terrain;
  parent: THREE.Group;
};

export class BuildingMarkers {
  private readonly terrain: Terrain;
  private readonly group = new THREE.Group();
  private readonly buildingMeshes = new Map<string, THREE.Group>();
  private selectedWorkExtentMesh: THREE.Mesh | null = null;
  private selectedWorkExtentKind: BuildingKind | null = null;
  private previewMesh: THREE.Mesh | null = null;
  private previewBuilding: THREE.Group | null = null;
  private previewKind: BuildingKind | null = null;
  private previewValid: boolean | null = null;
  private lastPreviewSignature = '';

  constructor(options: BuildingMarkersOptions) {
    this.terrain = options.terrain;
    this.group.name = 'Building markers';
    options.parent.add(this.group);
  }

  setSelectedWorkExtent(building: BuildingState | null): void {
    if (!building || building.workRadius <= 0) {
      if (this.selectedWorkExtentMesh) this.selectedWorkExtentMesh.visible = false;
      return;
    }

    const color = workExtentColor(building.kind);
    if (!this.selectedWorkExtentMesh || this.selectedWorkExtentKind !== building.kind) {
      if (this.selectedWorkExtentMesh) {
        disposeObject3D(this.selectedWorkExtentMesh);
        this.selectedWorkExtentMesh.removeFromParent();
      }
      this.selectedWorkExtentMesh = createRadiusRing(color, 0.14);
      this.selectedWorkExtentKind = building.kind;
      this.group.add(this.selectedWorkExtentMesh);
    }

    const y = this.terrain.getHeightAt(building.x, building.z);
    this.selectedWorkExtentMesh.visible = true;
    this.selectedWorkExtentMesh.position.set(building.x, y + 0.15, building.z);
    this.selectedWorkExtentMesh.scale.set(building.workRadius, 1, building.workRadius);
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
    radius: number,
    valid: boolean,
    visible: boolean,
  ): void {
    const signature = `${kind}|${x.toFixed(2)}|${z.toFixed(2)}|${valid ? 1 : 0}|${visible ? 1 : 0}|${radius.toFixed(1)}`;
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
      this.previewBuilding.rotation.y = buildingPlacementYaw(x, z);
      this.group.add(this.previewBuilding);
    } else if (this.previewValid !== valid) {
      updateBuildingPreviewAppearance(this.previewBuilding, valid);
      this.previewValid = valid;
    }

    const y = this.terrain.getHeightAt(x, z);
    const yaw = buildingPlacementYaw(x, z);
    this.previewMesh.visible = radius > 0;
    this.previewMesh.position.set(x, y + 0.2, z);
    this.previewMesh.scale.set(radius, 1, radius);

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
    if (this.selectedWorkExtentMesh) {
      disposeObject3D(this.selectedWorkExtentMesh);
      this.selectedWorkExtentMesh = null;
      this.selectedWorkExtentKind = null;
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
      marker.rotation.y = buildingPlacementYaw(building.x, building.z);
      this.buildingMeshes.set(building.id, marker);
      this.group.add(marker);
    }

    const y = this.terrain.getHeightAt(building.x, building.z);
    marker.position.set(building.x, y, building.z);
  }

  private removeBuilding(id: string): void {
    const marker = this.buildingMeshes.get(id);
    if (marker) {
      disposeObject3D(marker, true);
      this.buildingMeshes.delete(id);
    }
  }
}

function workExtentColor(kind: BuildingKind): number {
  switch (kind) {
    case 'lumber_mill':
      return 0xd7b463;
    case 'reforester':
      return 0x00cc66;
    case 'stone_quarry':
      return 0xa8a29e;
    case 'woodcutters_lodge':
      return 0xd7b463;
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
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
