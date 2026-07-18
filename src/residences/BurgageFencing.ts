import * as THREE from 'three';
import type { Point2 } from '../utils/polygonGeometry.ts';
import type { BurgageZoneState } from '../resources/types.ts';
import { timberMaterial } from '../buildings/buildingMaterials.ts';
import { hashStringSeed } from '../utils/random.ts';
import {
  getParcelFenceSegments,
  type BurgageParcelLayout,
  type ParcelFenceOpening,
} from './burgageLayout.ts';
import { layoutFromBurgageZone } from './burgageZoneLayout.ts';
import {
  pickResidenceAppearance,
  residenceGroundDoorLocalX,
} from './residenceAppearance.ts';

const MAX_POSTS = 640;
const MAX_RAILS = 1920;
const POST_SPACING = 2.2;
const POST_HEIGHT = 1.08;
const POST_BURY_DEPTH = 0.22;
const RAIL_HEIGHTS = [0.34, 0.64, 0.9] as const;
const TERRAIN_LIFT = 0.06;
const FRONT_GATE_WIDTH = 1.8;
const LOCAL_RAIL_AXIS = new THREE.Vector3(0, 0, 1);

type FenceSegment = readonly [Point2, Point2];
export type TerrainFenceBay = {
  start: Point2;
  end: Point2;
  startGroundHeight: number;
  endGroundHeight: number;
};

type FencedResidence = {
  id: string;
  zoneId: string;
  parcelIndex: number;
  x: number;
  z: number;
  yaw: number;
};

function fenceSignature(segmentBays: TerrainFenceBay[][]): string {
  return segmentBays
    .flat()
    .map((bay) => [
      bay.start.x.toFixed(2),
      bay.start.z.toFixed(2),
      bay.startGroundHeight.toFixed(3),
      bay.end.x.toFixed(2),
      bay.end.z.toFixed(2),
      bay.endGroundHeight.toFixed(3),
    ].join(','))
    .join('|');
}

export function sampleTerrainFenceBays(
  start: Point2,
  end: Point2,
  getHeightAt: (x: number, z: number) => number,
): TerrainFenceBay[] {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const length = Math.hypot(dx, dz);
  if (length < 0.5) return [];

  const bayCount = Math.max(1, Math.ceil(length / POST_SPACING));
  const points = Array.from({ length: bayCount + 1 }, (_, index) => {
    const t = index / bayCount;
    const point = {
      x: start.x + dx * t,
      z: start.z + dz * t,
    };
    return {
      point,
      groundHeight: getHeightAt(point.x, point.z),
    };
  });

  return Array.from({ length: bayCount }, (_, index) => ({
    start: points[index].point,
    end: points[index + 1].point,
    startGroundHeight: points[index].groundHeight,
    endGroundHeight: points[index + 1].groundHeight,
  }));
}

function residencesByZone(
  residences: Iterable<FencedResidence>,
): Map<string, FencedResidence[]> {
  const byZone = new Map<string, FencedResidence[]>();
  for (const residence of residences) {
    let zoneResidences = byZone.get(residence.zoneId);
    if (!zoneResidences) {
      zoneResidences = [];
      byZone.set(residence.zoneId, zoneResidences);
    }
    zoneResidences.push(residence);
  }
  return byZone;
}

function projectResidenceDoorToFrontage(
  residence: FencedResidence,
  parcel: BurgageParcelLayout,
): Point2 {
  const appearance = pickResidenceAppearance(hashStringSeed(residence.id));
  const doorLocalX = residenceGroundDoorLocalX(appearance);
  const cos = Math.cos(residence.yaw);
  const sin = Math.sin(residence.yaw);
  const doorPoint = {
    x: residence.x + doorLocalX * cos,
    z: residence.z - doorLocalX * sin,
  };

  const dx = parcel.frontRight.x - parcel.frontLeft.x;
  const dz = parcel.frontRight.z - parcel.frontLeft.z;
  const lengthSq = dx * dx + dz * dz;
  const t = lengthSq <= 1e-6
    ? 0.5
    : THREE.MathUtils.clamp(
      ((doorPoint.x - parcel.frontLeft.x) * dx + (doorPoint.z - parcel.frontLeft.z) * dz) / lengthSq,
      0,
      1,
    );
  return {
    x: parcel.frontLeft.x + dx * t,
    z: parcel.frontLeft.z + dz * t,
  };
}

function collectFenceSegments(
  zones: Iterable<BurgageZoneState>,
  residences: Iterable<FencedResidence>,
): FenceSegment[] {
  const residencesForZone = residencesByZone(residences);
  const segments: FenceSegment[] = [];
  for (const zone of zones) {
    const layout = layoutFromBurgageZone(zone);
    if (!layout) continue;
    const zoneResidences = residencesForZone.get(zone.id);
    if (!zoneResidences || zoneResidences.length === 0) continue;

    const occupied = new Set(zoneResidences.map((residence) => residence.parcelIndex));
    const openings = new Map<number, ParcelFenceOpening>();
    for (const residence of zoneResidences) {
      const parcel = layout.parcels.find((candidate) => candidate.index === residence.parcelIndex);
      if (!parcel) continue;
      openings.set(residence.parcelIndex, {
        center: projectResidenceDoorToFrontage(residence, parcel),
        width: FRONT_GATE_WIDTH,
      });
    }
    segments.push(...getParcelFenceSegments(layout, occupied, openings));
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
  private readonly railDirection = new THREE.Vector3();
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
    this.posts.castShadow = false;
    this.posts.receiveShadow = false;

    this.rails = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      this.railMaterial,
      MAX_RAILS,
    );
    this.rails.name = 'Fence rails';
    this.rails.count = 0;
    this.rails.frustumCulled = false;
    this.rails.castShadow = false;
    this.rails.receiveShadow = false;

    this.root.add(this.posts, this.rails);
    parent.add(this.root);
  }

  syncZones(
    zones: Iterable<BurgageZoneState>,
    residences: Iterable<FencedResidence>,
    getHeightAt: (x: number, z: number) => number,
  ): void {
    const segments = collectFenceSegments(zones, residences);
    const segmentBays = segments.map(([start, end]) => (
      sampleTerrainFenceBays(start, end, getHeightAt)
    ));
    const signature = fenceSignature(segmentBays);
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;

    let postCount = 0;
    let railCount = 0;

    for (const bays of segmentBays) {
      if (bays.length === 0) continue;
      const availableBays = Math.min(
        bays.length,
        MAX_POSTS - postCount - 1,
        Math.floor((MAX_RAILS - railCount) / RAIL_HEIGHTS.length),
      );
      if (availableBays <= 0) break;

      this.quaternion.identity();
      const postMeshHeight = POST_HEIGHT + POST_BURY_DEPTH;
      for (let index = 0; index <= availableBays; index++) {
        const bay = index === 0 ? bays[0] : bays[index - 1];
        const point = index === 0 ? bay.start : bay.end;
        const groundHeight = index === 0 ? bay.startGroundHeight : bay.endGroundHeight;
        const y = groundHeight + (POST_HEIGHT - POST_BURY_DEPTH) * 0.5;
        this.scale.set(0.13, postMeshHeight, 0.13);
        this.position.set(point.x, y, point.z);
        this.matrix.compose(this.position, this.quaternion, this.scale);
        this.posts.setMatrixAt(postCount, this.matrix);
        postCount += 1;
      }

      for (let index = 0; index < availableBays; index++) {
        const bay = bays[index];
        this.railDirection.set(
          bay.end.x - bay.start.x,
          bay.endGroundHeight - bay.startGroundHeight,
          bay.end.z - bay.start.z,
        );
        const railLength = this.railDirection.length();
        if (railLength <= 1e-6) continue;
        this.quaternion.setFromUnitVectors(
          LOCAL_RAIL_AXIS,
          this.railDirection.multiplyScalar(1 / railLength),
        );
        this.position.set(
          (bay.start.x + bay.end.x) * 0.5,
          (bay.startGroundHeight + bay.endGroundHeight) * 0.5 + TERRAIN_LIFT,
          (bay.start.z + bay.end.z) * 0.5,
        );

        for (const railHeight of RAIL_HEIGHTS) {
          this.scale.set(0.07, 0.055, railLength);
          this.position.y = (
            (bay.startGroundHeight + bay.endGroundHeight) * 0.5
            + TERRAIN_LIFT
            + railHeight
          );
          this.matrix.compose(this.position, this.quaternion, this.scale);
          this.rails.setMatrixAt(railCount, this.matrix);
          railCount += 1;
        }
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
    // Timber materials are shared by all buildings and disposed by the
    // BuildingMaterialLibrary at scene teardown.
    this.root.removeFromParent();
  }
}
