import * as THREE from 'three';
import type { TerrainProjector } from '../terrain/TerrainProjector.ts';
import type { RoadNetwork, RoadNetworkSnapshot } from './RoadNetwork.ts';
import type { RoadSelection } from './RoadSelection.ts';
import type { SceneManager } from '../scene/SceneManager.ts';
import { RoadPreview } from './RoadPreview.ts';
import {
  isRoadPlacementValid,
  validateRoadPlacement,
  type RoadPlacementFailureReason,
} from './RoadPlacementValidation.ts';

const ROAD_WIDTH = 4.2;
const MIN_POINT_DISTANCE = 1.05;
const MIN_COMMIT_LENGTH = 3.5;
const CURVE_WHEEL_STEP = 1.35;
const MAX_CURVE_OFFSET = 34;
const CURVE_EPSILON = 0.05;
const SNAP_DISTANCE = 5.6;

export type RoadDeleteRequest = {
  edgeId: string;
  clientX: number;
  clientY: number;
};

export type RoadPlacementRejectedEvent = {
  reason: RoadPlacementFailureReason;
  action: 'exit';
};

export class RoadTool {
  private readonly options: {
    domElement: HTMLElement;
    network: RoadNetwork;
    sceneManager: SceneManager;
    selection: RoadSelection;
    terrainProjector: TerrainProjector;
    onNetworkChanged: () => void;
    onStateChanged: () => void;
    onDeleteRequested: (request: RoadDeleteRequest | null) => void;
    onPlacementRejected?: (event: RoadPlacementRejectedEvent) => void;
  };
  private enabled = false;
  private points: THREE.Vector3[] = [];
  private segmentCurves: number[] = [];
  private pendingCurve = 0;
  private hoverPoint: THREE.Vector3 | null = null;
  private latestSnapPoint: THREE.Vector3 | null = null;
  private undoStack: RoadNetworkSnapshot[] = [];
  private readonly preview: RoadPreview;

  constructor(options: {
    domElement: HTMLElement;
    network: RoadNetwork;
    sceneManager: SceneManager;
    selection: RoadSelection;
    terrainProjector: TerrainProjector;
    onNetworkChanged: () => void;
    onStateChanged: () => void;
    onDeleteRequested: (request: RoadDeleteRequest | null) => void;
    onPlacementRejected?: (event: RoadPlacementRejectedEvent) => void;
  }) {
    this.options = options;
    this.preview = new RoadPreview(options.sceneManager.roadMeshBuilder, options.sceneManager.materials);
    options.sceneManager.previewGroup.add(this.preview.group);
    options.domElement.addEventListener('mousedown', this.onPointerDown, { capture: true });
    options.domElement.addEventListener('mousemove', this.onPointerMove);
    options.domElement.addEventListener('wheel', this.onWheel, { passive: false, capture: true });
    window.addEventListener('keydown', this.onKeyDown);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  hasDraft(): boolean {
    return this.points.length > 0;
  }

  isDraftBuildable(): boolean {
    return isRoadPlacementValid(this.buildDraftPath(), this.options.sceneManager, ROAD_WIDTH, MIN_COMMIT_LENGTH);
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.options.onDeleteRequested(null);
    this.options.selection.setSelected(null);
    if (!enabled) this.cancelDraft(false);
    this.options.onStateChanged();
  }

  getCursor(): string | null {
    if (!this.enabled) return null;
    return this.hasDraft() ? 'crosshair' : 'copy';
  }

  getBuildButtonPosition(): { clientX: number; clientY: number } | null {
    if (!this.enabled || !this.isDraftBuildable()) return null;
    const lastPoint = this.points[this.points.length - 1];
    const rect = this.options.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    const projected = lastPoint.clone();
    projected.y += 1.2;
    projected.project(this.options.sceneManager.camera);
    if (projected.z < -1 || projected.z > 1) return null;

    return {
      clientX: rect.left + (projected.x * 0.5 + 0.5) * rect.width,
      clientY: rect.top + (-projected.y * 0.5 + 0.5) * rect.height,
    };
  }

  update(_dt: number): void {}

  commitDraft(): void {
    const path = this.buildDraftPath();
    if (!isRoadPlacementValid(path, this.options.sceneManager, ROAD_WIDTH, MIN_COMMIT_LENGTH)) return;
    const snapshot = this.options.network.snapshot();
    const added = this.options.network.addRoadPath(path, ROAD_WIDTH);
    if (added.length === 0) return;
    this.undoStack.push(snapshot);
    this.cancelDraft(false);
    this.options.selection.setSelected(null);
    this.options.onNetworkChanged();
    this.options.onStateChanged();
  }

  undo(): void {
    const snapshot = this.undoStack.pop();
    if (!snapshot) return;
    this.options.network.restore(snapshot);
    this.options.selection.setSelected(null);
    this.options.onNetworkChanged();
  }

  deleteSelected(): void {
    const snapshot = this.options.network.snapshot();
    if (this.options.selection.deleteSelected()) {
      this.undoStack.push(snapshot);
      this.options.onNetworkChanged();
    }
  }

  confirmDelete(edgeId: string): void {
    const snapshot = this.options.network.snapshot();
    if (!this.options.network.deleteEdge(edgeId)) return;
    this.undoStack.push(snapshot);
    this.options.selection.setSelected(null);
    this.options.onNetworkChanged();
    this.refreshPreview();
    this.options.onStateChanged();
  }

  shouldBlockCameraInput(event: MouseEvent | WheelEvent): boolean {
    if (!this.enabled || !this.hasDraft()) return false;
    if (event instanceof WheelEvent) return event.ctrlKey;
    return event.button === 2;
  }

  dispose(): void {
    this.options.domElement.removeEventListener('mousedown', this.onPointerDown, true);
    this.options.domElement.removeEventListener('mousemove', this.onPointerMove);
    this.options.domElement.removeEventListener('wheel', this.onWheel, true);
    window.removeEventListener('keydown', this.onKeyDown);
    this.preview.dispose();
  }

  private readonly onPointerDown = (event: MouseEvent): void => {
    if (!this.enabled) return;
    if (event.button === 0 && event.altKey) {
      this.requestDelete(event);
      return;
    }
    if (event.button === 2 && this.hasDraft()) {
      event.preventDefault();
      event.stopPropagation();
      this.undoLastPoint();
      return;
    }
    if (event.button !== 0) return;
    const hit = this.options.terrainProjector.pick(event.clientX, event.clientY);
    if (!hit) return;
    event.preventDefault();
    event.stopPropagation();
    const exitReason = this.getInvalidClickExitReason();
    if (exitReason) {
      this.setEnabled(false);
      this.options.onPlacementRejected?.({ reason: exitReason, action: 'exit' });
      return;
    }
    this.options.onDeleteRequested(null);
    this.options.selection.setSelected(null);
    this.addRoadPoint(this.applySnap(hit));
  };

  private readonly onPointerMove = (event: MouseEvent): void => {
    if (!this.enabled || !this.hasDraft()) return;
    const hit = this.options.terrainProjector.pick(event.clientX, event.clientY);
    if (!hit) return;
    this.hoverPoint = this.applySnap(hit);
    this.refreshPreview();
  };

  private readonly onWheel = (event: WheelEvent): void => {
    if (!this.enabled || !this.hasDraft() || !event.ctrlKey || event.deltaY === 0) return;
    const target = this.getCurveTarget();
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    const direction = event.deltaY > 0 ? -1 : 1;
    const steps = Math.max(1, Math.ceil(Math.abs(event.deltaY) / 100));
    const delta = direction * CURVE_WHEEL_STEP * steps;
    if (target === 'pending') {
      this.pendingCurve = clampCurve(this.pendingCurve + delta);
    } else {
      this.segmentCurves[target] = clampCurve((this.segmentCurves[target] ?? 0) + delta);
    }
    this.refreshPreview();
    this.options.onStateChanged();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (isTypingTarget(event.target)) return;
    const key = event.key.toLowerCase();
    if (key === 'r') {
      event.preventDefault();
      this.setEnabled(true);
      return;
    }
    if (key === 'escape') {
      if (this.hasDraft()) this.cancelDraft();
      else if (this.enabled) this.setEnabled(false);
      return;
    }
    if (key === 'enter' && this.hasDraft()) {
      event.preventDefault();
      this.commitDraft();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && key === 'z') {
      event.preventDefault();
      if (this.hasDraft()) this.undoLastPoint();
      else this.undo();
      return;
    }
    if (key === 'delete' || key === 'backspace') this.deleteSelected();
  };

  private addRoadPoint(point: THREE.Vector3): void {
    const last = this.points[this.points.length - 1];
    if (last) {
      if (distanceXZ(last, point) < MIN_POINT_DISTANCE) return;
      this.segmentCurves.push(this.pendingCurve);
    }
    this.points.push(point.clone());
    this.pendingCurve = 0;
    this.hoverPoint = null;
    this.latestSnapPoint = null;
    this.refreshPreview();
    this.options.onStateChanged();
  }

  private undoLastPoint(): void {
    if (!this.hasDraft()) return;
    this.points.pop();
    if (this.segmentCurves.length >= this.points.length) this.segmentCurves.pop();
    this.pendingCurve = 0;
    this.hoverPoint = null;
    this.latestSnapPoint = null;
    if (this.points.length === 0) this.cancelDraft();
    else {
      this.refreshPreview();
      this.options.onStateChanged();
    }
  }

  private requestDelete(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const edgeId = this.options.selection.pickEdgeId(event.clientX, event.clientY);
    if (!edgeId) {
      this.options.selection.setSelected(null);
      this.options.onDeleteRequested(null);
      return;
    }
    this.options.selection.setSelected(edgeId);
    this.options.onDeleteRequested({ edgeId, clientX: event.clientX, clientY: event.clientY });
  }

  private refreshPreview(): void {
    if (!this.hasDraft()) {
      this.preview.clear();
      return;
    }
    const hover = this.getUsableHoverPoint();
    const anchors = hover ? [...this.points, hover] : [...this.points];
    const curves = hover ? [...this.segmentCurves, this.pendingCurve] : this.segmentCurves;
    const path = this.buildPathFromAnchors(anchors, curves);
    const valid = isRoadPlacementValid(path, this.options.sceneManager, ROAD_WIDTH, MIN_COMMIT_LENGTH);
    this.preview.update(path, valid, ROAD_WIDTH, this.latestSnapPoint, anchors);
  }

  private applySnap(point: THREE.Vector3): THREE.Vector3 {
    const networkSnap = this.options.network.findSnap(point, SNAP_DISTANCE);
    const draftSnap = this.findDraftSnap(point, SNAP_DISTANCE);
    const snap = pickNearestSnap(networkSnap, draftSnap);
    this.latestSnapPoint = snap?.point.clone() ?? null;
    if (snap) return snap.point.clone();
    return this.options.sceneManager.terrain.getPointAt(point.x, point.z, 0);
  }

  private findDraftSnap(point: THREE.Vector3, maxDistance: number): { point: THREE.Vector3; distance: number } | null {
    let best: { point: THREE.Vector3; distance: number } | null = null;
    const lastIndex = this.points.length - 1;
    for (let i = 0; i < this.points.length; i++) {
      if (i === lastIndex) continue;
      const anchor = this.points[i];
      const distance = distanceXZ(point, anchor);
      if (distance <= maxDistance && (!best || distance < best.distance)) {
        best = { point: anchor.clone(), distance };
      }
    }
    return best;
  }

  private cancelDraft(notify = true): void {
    this.points = [];
    this.segmentCurves = [];
    this.pendingCurve = 0;
    this.hoverPoint = null;
    this.latestSnapPoint = null;
    this.preview.clear();
    this.options.onDeleteRequested(null);
    if (notify) this.options.onStateChanged();
  }

  private buildDraftPath(): THREE.Vector3[] {
    return this.buildPathFromAnchors(this.points, this.segmentCurves);
  }

  private buildPathFromAnchors(anchors: THREE.Vector3[], curves: number[]): THREE.Vector3[] {
    if (anchors.length === 0) return [];
    const path = [anchors[0].clone()];
    for (let i = 0; i < anchors.length - 1; i++) {
      const a = anchors[i];
      const b = anchors[i + 1];
      const curve = curves[i] ?? 0;
      if (Math.abs(curve) > CURVE_EPSILON) {
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const length = Math.hypot(dx, dz);
        if (length > 0.001) {
          const normalX = -dz / length;
          const normalZ = dx / length;
          const x = (a.x + b.x) * 0.5 + normalX * curve;
          const z = (a.z + b.z) * 0.5 + normalZ * curve;
          const clamped = this.options.sceneManager.terrain.clampXZ(x, z);
          const midpoint = this.options.sceneManager.terrain.getPointAt(clamped.x, clamped.z, 0);
          if (distanceXZ(path[path.length - 1], midpoint) >= 0.1 && distanceXZ(midpoint, b) >= 0.1) path.push(midpoint);
        }
      }
      path.push(b.clone());
    }
    return path;
  }

  private getUsableHoverPoint(): THREE.Vector3 | null {
    if (!this.hoverPoint || this.points.length === 0) return null;
    const last = this.points[this.points.length - 1];
    return distanceXZ(last, this.hoverPoint) >= MIN_POINT_DISTANCE ? this.hoverPoint : null;
  }

  private getCurveTarget(): 'pending' | number | null {
    if (this.getUsableHoverPoint()) return 'pending';
    if (this.segmentCurves.length > 0) return this.segmentCurves.length - 1;
    return null;
  }

  private getInvalidClickExitReason(): RoadPlacementFailureReason | null {
    const hover = this.getUsableHoverPoint();
    if (!hover || !this.hasDraft()) return null;
    const path = this.buildPathFromAnchors(
      [...this.points, hover],
      [...this.segmentCurves, this.pendingCurve],
    );
    if (path.length < 2) return null;

    const result = validateRoadPlacement(path, this.options.sceneManager, ROAD_WIDTH, MIN_COMMIT_LENGTH);
    if (result.ok || result.reason === 'too_short') return null;
    return result.reason;
  }
}

function distanceXZ(a: THREE.Vector3, b: THREE.Vector3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function pickNearestSnap(
  first: { point: THREE.Vector3; distance: number } | null,
  second: { point: THREE.Vector3; distance: number } | null,
): { point: THREE.Vector3; distance: number } | null {
  if (!first) return second;
  if (!second) return first;
  return first.distance <= second.distance ? first : second;
}

function clampCurve(value: number): number {
  return THREE.MathUtils.clamp(value, -MAX_CURVE_OFFSET, MAX_CURVE_OFFSET);
}

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  const tag = element?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || Boolean(element?.isContentEditable);
}
