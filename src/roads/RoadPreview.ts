import * as THREE from 'three';
import { disposeObject3D } from '../utils/dispose.ts';
import { RoadMaterialFactory } from './RoadMaterialFactory.ts';
import { RoadMeshBuilder } from './RoadMeshBuilder.ts';

const MAX_ANCHOR_MARKERS = 16;

function geometrySignature(sampledPath: THREE.Vector3[], width: number, snapPoint: THREE.Vector3 | null): string {
  let hash = sampledPath.length;
  for (let i = 0; i < sampledPath.length; i++) {
    const point = sampledPath[i];
    hash = (hash * 31 + Math.round(point.x * 10)) | 0;
    hash = (hash * 31 + Math.round(point.z * 10)) | 0;
  }
  const snapPart = snapPoint ? `${snapPoint.x.toFixed(1)},${snapPoint.z.toFixed(1)}` : 'none';
  return `${hash}|${width.toFixed(1)}|${snapPart}`;
}

export class RoadPreview {
  private readonly meshBuilder: RoadMeshBuilder;
  private readonly materials: RoadMaterialFactory;
  readonly group = new THREE.Group();
  private previewRibbon: THREE.Group | null = null;
  private readonly marker: THREE.Mesh;
  private readonly anchorMarkers: THREE.InstancedMesh;
  private readonly anchorMaterialValid: THREE.MeshBasicMaterial;
  private readonly anchorMaterialInvalid: THREE.MeshBasicMaterial;
  private lastGeometrySignature = '';
  private lastMeshValid: boolean | null = null;
  private lastAnchorSignature = '';
  private lastAnchorValid: boolean | null = null;
  private readonly anchorMatrix = new THREE.Matrix4();

  constructor(meshBuilder: RoadMeshBuilder, materials: RoadMaterialFactory) {
    this.meshBuilder = meshBuilder;
    this.materials = materials;
    this.group.name = 'Road preview';
    this.marker = new THREE.Mesh(new THREE.RingGeometry(2.0, 2.55, 24), materials.snap);
    this.marker.name = 'Snap marker';
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.visible = false;
    this.marker.renderOrder = 30;
    this.marker.castShadow = false;
    this.marker.receiveShadow = false;
    this.anchorMaterialValid = new THREE.MeshBasicMaterial({ color: 0xb0a89e, depthWrite: false });
    this.anchorMaterialInvalid = new THREE.MeshBasicMaterial({ color: 0xcc4444, depthWrite: false });
    this.anchorMarkers = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.45, 6, 6),
      this.anchorMaterialValid,
      MAX_ANCHOR_MARKERS,
    );
    this.anchorMarkers.renderOrder = 31;
    this.anchorMarkers.castShadow = false;
    this.anchorMarkers.receiveShadow = false;
    this.group.add(this.marker, this.anchorMarkers);
  }

  update(
    points: THREE.Vector3[],
    valid: boolean,
    width: number,
    snapPoint: THREE.Vector3 | null,
    anchorPoints: THREE.Vector3[],
    sampledPath?: THREE.Vector3[],
  ): void {
    if (!sampledPath || sampledPath.length < 2) {
      this.clearRibbon();
      this.updateAnchors(anchorPoints, valid);
      this.updateSnapMarker(snapPoint);
      return;
    }

    const signature = geometrySignature(sampledPath, width, snapPoint);
    const geometryChanged = signature !== this.lastGeometrySignature;
    const validityChanged = valid !== this.lastMeshValid;

    if (geometryChanged) {
      this.lastGeometrySignature = signature;
      this.clearRibbon();
      const ribbon = this.meshBuilder.buildPreview(points, width, valid, sampledPath);
      if (ribbon) {
        this.previewRibbon = ribbon;
        this.group.add(ribbon);
      }
      this.lastMeshValid = valid;
      this.updateAnchors(anchorPoints, valid);
    } else if (validityChanged) {
      this.applyValidityMaterials(valid);
      this.lastMeshValid = valid;
      this.updateAnchors(anchorPoints, valid);
    }

    this.updateSnapMarker(snapPoint);
  }

  setValidity(valid: boolean): void {
    if (valid === this.lastMeshValid) return;
    this.applyValidityMaterials(valid);
    this.lastMeshValid = valid;
    if (this.lastAnchorValid !== valid) {
      this.anchorMarkers.material = valid ? this.anchorMaterialValid : this.anchorMaterialInvalid;
      this.lastAnchorValid = valid;
    }
  }

  clear(): void {
    this.clearRibbon();
    this.marker.visible = false;
    this.anchorMarkers.count = 0;
    this.anchorMarkers.instanceMatrix.needsUpdate = true;
    this.lastAnchorSignature = '';
    this.lastAnchorValid = null;
  }

  dispose(): void {
    this.clear();
    this.marker.geometry.dispose();
    this.anchorMarkers.geometry.dispose();
    this.anchorMaterialValid.dispose();
    this.anchorMaterialInvalid.dispose();
  }

  private applyValidityMaterials(valid: boolean): void {
    if (!this.previewRibbon) return;
    const coreMaterial = valid ? this.materials.previewValid : this.materials.previewInvalid;
    const blendMaterial = valid ? this.materials.previewBlendValid : this.materials.previewBlendInvalid;
    for (const child of this.previewRibbon.children) {
      if (!(child instanceof THREE.Mesh)) continue;
      child.material = child.userData.previewPart === 'blend' ? blendMaterial : coreMaterial;
    }
  }

  private clearRibbon(): void {
    this.lastGeometrySignature = '';
    this.lastMeshValid = null;
    if (this.previewRibbon) {
      this.group.remove(this.previewRibbon);
      disposeObject3D(this.previewRibbon);
      this.previewRibbon = null;
    }
  }

  private updateSnapMarker(snapPoint: THREE.Vector3 | null): void {
    if (snapPoint) {
      this.marker.visible = true;
      this.marker.position.set(snapPoint.x, snapPoint.y + 0.22, snapPoint.z);
    } else {
      this.marker.visible = false;
    }
  }

  private updateAnchors(points: THREE.Vector3[], valid: boolean): void {
    let hash = points.length;
    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      hash = (hash * 31 + Math.round(point.x * 10)) | 0;
      hash = (hash * 31 + Math.round(point.z * 10)) | 0;
    }
    const anchorSignature = `${hash}`;
    if (anchorSignature === this.lastAnchorSignature && valid === this.lastAnchorValid) return;
    this.lastAnchorSignature = anchorSignature;
    this.lastAnchorValid = valid;
    this.anchorMarkers.material = valid ? this.anchorMaterialValid : this.anchorMaterialInvalid;

    const step = Math.max(1, Math.floor(points.length / MAX_ANCHOR_MARKERS));
    let count = 0;
    for (let i = 0; i < points.length && count < MAX_ANCHOR_MARKERS; i += step) {
      const point = points[i];
      this.anchorMatrix.identity();
      this.anchorMatrix.setPosition(point.x, point.y + 0.32, point.z);
      this.anchorMarkers.setMatrixAt(count, this.anchorMatrix);
      count += 1;
    }
    this.anchorMarkers.count = count;
    this.anchorMarkers.instanceMatrix.needsUpdate = count > 0;
  }
}
