import * as THREE from 'three';
import type { TerrainProjector } from '../terrain/TerrainProjector.ts';
import type { RoadNetwork, RoadNetworkSnapshot } from './RoadNetwork.ts';
import type { RoadSelection } from './RoadSelection.ts';
import type { SceneManager } from '../scene/SceneManager.ts';
import { RoadPreview } from './RoadPreview.ts';
import {
  validateRoadPlacement,
  isRoadPlacementValid,
  type RoadPlacementFailureReason,
  type RoadPlacementResult,
} from './RoadPlacementValidation.ts';
import { downsamplePath } from '../utils/pathGeometry.ts';
import { ROAD_PLACED_SAMPLE_SPACING } from './RoadMeshBuilder.ts';
import { computePendingRoadAutoCurve, mergeManualAndAutoCurve } from './roadAutoCurve.ts';
import type { GameState } from '../resources/types.ts';

const ROAD_WIDTH = 4.2;
const MIN_POINT_DISTANCE = 1.05;
const MIN_COMMIT_LENGTH = 3.5;
const CURVE_WHEEL_STEP = 1.35;
const MAX_CURVE_OFFSET = 34;
const CURVE_EPSILON = 0.05;
const SNAP_DISTANCE = 5.6;
const HOVER_PREVIEW_MOVE_THRESHOLD = 0.75;
const VALIDATION_INTERVAL_MS = 180;
const PREVIEW_MESH_SAMPLE_SPACING = ROAD_PLACED_SAMPLE_SPACING;
const PREVIEW_MESH_MAX_SAMPLES = 240;
const COMMIT_VALIDATION_SAMPLE_SPACING = 1.25;

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
    onToggle?: () => void;
    getGameState?: () => GameState | undefined;
  };
  private enabled = false;
  private points: THREE.Vector3[] = [];
  private segmentCurves: number[] = [];
  private pendingCurve = 0;
  private hoverPoint: THREE.Vector3 | null = null;
  private latestSnapPoint: THREE.Vector3 | null = null;
  private undoStack: RoadNetworkSnapshot[] = [];
  private redoStack: RoadNetworkSnapshot[] = [];
  private readonly preview: RoadPreview;
  private lastHoverPreviewX = Number.NaN;
  private lastHoverPreviewZ = Number.NaN;
  private cachedDraftValidation: RoadPlacementResult | null = null;
  private lastValidationTime = 0;
  private validationDirty = true;
  private pointerClientX = 0;
  private pointerClientY = 0;
  private pointerDirty = false;
  private validationScheduled = false;
  private readonly previewSampleScratch: THREE.Vector3[] = [];
  private readonly validationPathScratch: THREE.Vector3[] = [];
  private readonly anchorScratch: THREE.Vector3[] = [];
  private readonly curveScratch: number[] = [];
  private readonly projectScratch = new THREE.Vector3();

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
    onToggle?: () => void;
    getGameState?: () => GameState | undefined;
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
    return this.cachedDraftValidation?.ok ?? false;
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
    if (!lastPoint) return null;
    const rect = this.options.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    const projected = this.projectScratch.copy(lastPoint);
    projected.y += 1.2;
    projected.project(this.options.sceneManager.camera);
    if (projected.z < -1 || projected.z > 1) return null;

    return {
      clientX: rect.left + (projected.x * 0.5 + 0.5) * rect.width,
      clientY: rect.top + (-projected.y * 0.5 + 0.5) * rect.height,
    };
  }

  update(_dt: number): void {
    if (!this.enabled || !this.hasDraft()) return;
    if (this.pointerDirty) {
      this.pointerDirty = false;
      this.processPointerHover(this.pointerClientX, this.pointerClientY);
      return;
    }
    this.maybeRunDeferredValidation(false);
  }

  commitDraft(): void {
    const path = this.buildDraftPath();
    const meshBuilder = this.options.sceneManager.roadMeshBuilder;
    const sampledPath = meshBuilder.samplePath(path, COMMIT_VALIDATION_SAMPLE_SPACING);
    if (!isRoadPlacementValid(path, this.options.sceneManager, ROAD_WIDTH, MIN_COMMIT_LENGTH, { sampledPath })) return;
    const snapshot = this.options.network.snapshot();
    const added = this.options.network.addRoadPath(path, ROAD_WIDTH);
    if (added.length === 0) return;
    this.undoStack.push(snapshot);
    this.redoStack.length = 0;
    this.cancelDraft(false);
    this.options.selection.setSelected(null);
    this.options.onNetworkChanged();
    this.options.onStateChanged();
  }

  undo(): void {
    const snapshot = this.undoStack.pop();
    if (!snapshot) return;
    this.redoStack.push(this.options.network.snapshot());
    this.options.network.restore(snapshot);
    this.options.selection.setSelected(null);
    this.options.onNetworkChanged();
  }

  redo(): void {
    const snapshot = this.redoStack.pop();
    if (!snapshot) return;
    this.undoStack.push(this.options.network.snapshot());
    this.options.network.restore(snapshot);
    this.options.selection.setSelected(null);
    this.options.onNetworkChanged();
  }

  deleteSelected(): void {
    const snapshot = this.options.network.snapshot();
    if (this.options.selection.deleteSelected()) {
      this.undoStack.push(snapshot);
      this.redoStack.length = 0;
      this.options.onNetworkChanged();
    }
  }

  confirmDelete(edgeId: string): void {
    const snapshot = this.options.network.snapshot();
    if (!this.options.network.deleteEdge(edgeId)) return;
    this.undoStack.push(snapshot);
    this.redoStack.length = 0;
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
    this.pointerClientX = event.clientX;
    this.pointerClientY = event.clientY;
    this.pointerDirty = true;
  };

  private processPointerHover(clientX: number, clientY: number): void {
    const hit = this.options.terrainProjector.pick(clientX, clientY);
    if (!hit) return;
    const snapped = this.applySnap(hit);
    if (this.shouldSkipHoverPreview(snapped)) return;
    this.hoverPoint = snapped;
    this.lastHoverPreviewX = snapped.x;
    this.lastHoverPreviewZ = snapped.z;
    this.refreshPreviewVisual();
    this.validationDirty = true;
    this.scheduleDeferredValidation();
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
      if (this.options.onToggle) this.options.onToggle();
      else this.setEnabled(!this.enabled);
      return;
    }
    if (key === 'escape') {
      event.preventDefault();
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
    if ((event.ctrlKey || event.metaKey) && (key === 'y' || (event.shiftKey && key === 'z'))) {
      event.preventDefault();
      this.redo();
      return;
    }
    if (key === 'delete' || key === 'backspace') this.deleteSelected();
  };

  private addRoadPoint(point: THREE.Vector3): void {
    const last = this.points[this.points.length - 1];
    if (last) {
      if (distanceXZ(last, point) < MIN_POINT_DISTANCE) return;
      this.segmentCurves.push(this.getEffectivePendingCurve(last, point));
    }
    this.points.push(point.clone());
    this.pendingCurve = 0;
    this.hoverPoint = null;
    this.latestSnapPoint = null;
    this.resetHoverPreviewCache();
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
    this.resetHoverPreviewCache();
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
    this.refreshPreviewVisual();
    this.runValidation(true);
  }

  private refreshPreviewVisual(): void {
    if (!this.hasDraft()) {
      this.preview.clear();
      this.cachedDraftValidation = null;
      return;
    }

    const { anchors, path } = this.buildPreviewAnchors();
    const valid = this.cachedDraftValidation?.ok ?? true;
    if (path.length < 2) {
      this.preview.update(path, valid, ROAD_WIDTH, this.latestSnapPoint, anchors);
      return;
    }

    const meshBuilder = this.options.sceneManager.roadMeshBuilder;
    meshBuilder.samplePathInto(
      path,
      PREVIEW_MESH_SAMPLE_SPACING,
      this.previewSampleScratch,
      PREVIEW_MESH_MAX_SAMPLES,
    );
    this.preview.update(path, valid, ROAD_WIDTH, this.latestSnapPoint, anchors, this.previewSampleScratch);
  }

  private scheduleDeferredValidation(): void {
    if (this.validationScheduled) return;
    this.validationScheduled = true;
    requestAnimationFrame(() => {
      this.validationScheduled = false;
      this.maybeRunDeferredValidation(false);
    });
  }

  private maybeRunDeferredValidation(force: boolean): void {
    if (!this.hasDraft()) return;
    if (!force && !this.validationDirty) return;
    const now = performance.now();
    if (!force && now - this.lastValidationTime < VALIDATION_INTERVAL_MS) return;
    this.runValidation(force);
  }

  private runValidation(_force: boolean): void {
    if (!this.hasDraft()) return;
    const { path } = this.buildPreviewAnchors();
    if (path.length < 2) {
      this.cachedDraftValidation = { ok: false, reason: 'too_short' };
      this.validationDirty = false;
      this.preview.setValidity(false);
      return;
    }

    if (this.previewSampleScratch.length < 2) {
      const meshBuilder = this.options.sceneManager.roadMeshBuilder;
      meshBuilder.samplePathInto(
        path,
        PREVIEW_MESH_SAMPLE_SPACING,
        this.previewSampleScratch,
        PREVIEW_MESH_MAX_SAMPLES,
      );
    }

    const validationSample = downsamplePath(this.previewSampleScratch, 2.5, this.validationPathScratch);
    const rockCheckPath = downsamplePath(validationSample, 4.0);
    const validation = validateRoadPlacement(path, this.options.sceneManager, ROAD_WIDTH, MIN_COMMIT_LENGTH, {
      sampledPath: validationSample,
      rockCheckPath,
    });
    this.cachedDraftValidation = validation;
    this.validationDirty = false;
    this.lastValidationTime = performance.now();
    this.preview.setValidity(validation.ok);
  }

  private buildPreviewAnchors(): { anchors: THREE.Vector3[]; path: THREE.Vector3[] } {
    const hover = this.getUsableHoverPoint();
    this.anchorScratch.length = 0;
    this.anchorScratch.push(...this.points);
    if (hover) this.anchorScratch.push(hover);

    this.curveScratch.length = 0;
    this.curveScratch.push(...this.segmentCurves);
    if (hover) {
      const lastAnchor = this.anchorScratch[this.anchorScratch.length - 2];
      this.curveScratch.push(
        lastAnchor
          ? this.getEffectivePendingCurve(lastAnchor, hover)
          : this.pendingCurve,
      );
    }

    const path = this.buildPathFromAnchors(this.anchorScratch, this.curveScratch);
    return { anchors: this.anchorScratch, path };
  }

  private getEffectivePendingCurve(start: THREE.Vector3, end: THREE.Vector3): number {
    const autoCurve = computePendingRoadAutoCurve(
      start,
      end,
      this.options.getGameState?.(),
      ROAD_WIDTH * 0.5,
      MAX_CURVE_OFFSET,
    );
    return clampCurve(mergeManualAndAutoCurve(this.pendingCurve, autoCurve));
  }

  private shouldSkipHoverPreview(point: THREE.Vector3): boolean {
    const dx = point.x - this.lastHoverPreviewX;
    const dz = point.z - this.lastHoverPreviewZ;
    if (!Number.isFinite(this.lastHoverPreviewX)) return false;
    return Math.hypot(dx, dz) < HOVER_PREVIEW_MOVE_THRESHOLD;
  }

  private resetHoverPreviewCache(): void {
    this.lastHoverPreviewX = Number.NaN;
    this.lastHoverPreviewZ = Number.NaN;
    this.pointerDirty = false;
  }

  private applySnap(point: THREE.Vector3): THREE.Vector3 {
    const networkSnap = this.options.network.findSnap(point, SNAP_DISTANCE);
    const draftSnap = this.findDraftSnap(point, SNAP_DISTANCE);
    const snap = pickNearestSnap(networkSnap, draftSnap);
    this.latestSnapPoint = snap ? snap.point.clone() : null;
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
        best = { point: anchor, distance };
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
    this.cachedDraftValidation = null;
    this.validationDirty = true;
    this.resetHoverPreviewCache();
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
    const last = this.points[this.points.length - 1];
    const path = this.buildPathFromAnchors(
      [...this.points, hover],
      [...this.segmentCurves, this.getEffectivePendingCurve(last, hover)],
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
