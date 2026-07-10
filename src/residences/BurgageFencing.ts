import * as THREE from 'three';
import type { Point2 } from '../utils/polygonGeometry.ts';
import type { BurgageZoneState } from '../resources/types.ts';
import { timberMaterial } from '../buildings/buildingMaterials.ts';
import { getParcelFenceSegments } from './burgageLayout.ts';
import { layoutFromBurgageZone } from './burgageZoneLayout.ts';

const MAX_POSTS = 640;
const MAX_RAILS = 1920;
const POST_SPACING = 2.2;
const POST_HEIGHT = 1.08;
const RAIL_HEIGHTS = [0.34, 0.64, 0.9] as const;
const TERRAIN_LIFT = 0.14;

type FenceSegment = readonly [Point2, Point2];

function fenceSignature(segments: FenceSegment[]): string {
  return segments
    .map(([start, end]) => `${start.x.toFixed(2)},${start.z.toFixed(2)}-${end.x.toFixed(2)},${end.z.toFixed(2)}`)
    .join('|');
}

function collectFenceSegments(zones: Iterable<BurgageZoneState>): FenceSegment[] {
  const segments: FenceSegment[] = [];
  for (const zone of zones) {
    const layout = layoutFromBurgageZone(zone);
    if (!layout) continue;
    segments.push(...getParcelFenceSegments(layout));
  }
  return segments;
}

export class BurgageFencing {
  private readonly root = new THREE.Group();
  private readonly posts: THREE.InstancedMesh;
  private readonly rails: THREE.InstancedMesh;
  private readonly postMaterial = timberMaterial('weathered');
  private readonly railMaterial = timberMaterial('mid');
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private lastSignature = '';

  constructor(parent: THREE.Group) {
    this.root.name = 'Burgage fencing';
    this.root.frustumCulled = false;

    this.posts = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      this.postMaterial,
      MAX_POSTS,
    );
    this.posts.name = 'Fence posts';
    this.posts.count = 0;
    this.posts.frustumCulled = false;
    this.posts.castShadow = true;
    this.posts.receiveShadow = false;

    this.rails = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      this.railMaterial,
      MAX_RAILS,
    );
    this.rails.name = 'Fence rails';
    this.rails.count = 0;
    this.rails.frustumCulled = false;
    this.rails.castShadow = true;
    this.rails.receiveShadow = false;

    this.root.add(this.posts, this.rails);
    parent.add(this.root);
  }

  syncZones(
    zones: Iterable<BurgageZoneState>,
    getHeightAt: (x: number, z: number) => number,
  ): void {
    const segments = collectFenceSegments(zones);
    const signature = fenceSignature(segments);
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;

    let postCount = 0;
    let railCount = 0;

    for (const [start, end] of segments) {
      if (postCount >= MAX_POSTS || railCount >= MAX_RAILS) break;

      const dx = end.x - start.x;
      const dz = end.z - start.z;
      const length = Math.hypot(dx, dz);
      if (length < 0.5) continue;

      const dirX = dx / length;
      const dirZ = dz / length;
      const yaw = Math.atan2(dirX, dirZ);
      this.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);

      const postSteps = Math.max(2, Math.floor(length / POST_SPACING) + 1);
      for (let step = 0; step < postSteps && postCount < MAX_POSTS; step++) {
        const t = step / (postSteps - 1);
        const x = start.x + dirX * length * t;
        const z = start.z + dirZ * length * t;
        const y = getHeightAt(x, z) + TERRAIN_LIFT + POST_HEIGHT * 0.5;
        this.scale.set(0.13, POST_HEIGHT, 0.13);
        this.position.set(x, y, z);
        this.matrix.compose(this.position, this.quaternion, this.scale);
        this.posts.setMatrixAt(postCount, this.matrix);
        postCount += 1;
      }

      const midX = (start.x + end.x) * 0.5;
      const midZ = (start.z + end.z) * 0.5;
      for (const railHeight of RAIL_HEIGHTS) {
        if (railCount >= MAX_RAILS) break;
        const y = getHeightAt(midX, midZ) + TERRAIN_LIFT + railHeight;
        this.scale.set(0.07, 0.055, length);
        this.position.set(midX, y, midZ);
        this.matrix.compose(this.position, this.quaternion, this.scale);
        this.rails.setMatrixAt(railCount, this.matrix);
        railCount += 1;
      }
    }

    this.posts.count = postCount;
    this.posts.instanceMatrix.needsUpdate = postCount > 0;
    this.rails.count = railCount;
    this.rails.instanceMatrix.needsUpdate = railCount > 0;
    this.root.visible = postCount > 0 || railCount > 0;
  }

  dispose(): void {
    this.posts.geometry.dispose();
    this.rails.geometry.dispose();
    this.postMaterial.dispose();
    this.railMaterial.dispose();
    this.root.removeFromParent();
  }
}
