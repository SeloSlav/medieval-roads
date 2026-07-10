import * as THREE from 'three';
import type { TerrainProjector } from '../terrain/TerrainProjector.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import type { GameState } from '../resources/types.ts';
import { computeResourceTotals } from '../resources/resourceTotals.ts';
import type { BurgageFrontageEdge, BurgageLayoutResult } from './burgageLayout.ts';
import { cornersFromPoints, getZoneEdge, MAX_ZONE_DEPTH, MIN_ZONE_DEPTH, resolveBurgageLayout, suggestPlotCount } from './burgageLayout.ts';
import {
  rectangleCornersToPoints,
  rectangleFromFrontageAndBackPoint,
} from './burgageRectangle.ts';
import { initialPlotCount } from './burgagePlacementValidation.ts';
import { BurgagePreview } from './BurgagePreview.ts';
import {
  countValidFrontageEdges,
  cycleFrontageEdge,
  detectFrontageEdge,
  frontageEdgeLabel,
  validateBurgagePlacement,
  type BurgagePlacementFailureReason,
  type BurgagePlacementResult,
} from './burgagePlacementValidation.ts';

const MIN_POINT_DISTANCE = 1.2;
const SNAP_DISTANCE = 6;
const HOVER_PREVIEW_MOVE_THRESHOLD = 0.35;
const VALIDATION_INTERVAL_MS = 180;

export type BurgageZoneCommit = {
  corners: THREE.Vector3[];
  frontageEdge: BurgageFrontageEdge;
  plotCount: number;
};

export type BurgageLayoutHudState = {
  plotCount: number;
  residenceCount: number | null;
  maxPlotCount: number;
  canDecrease: boolean;
  canIncrease: boolean;
  canRotateFrontage: boolean;
  frontageLabel: string | null;
  valid: boolean;
};

type BurgageToolOptions = {
  domElement: HTMLElement;
  camera: THREE.Camera;
  terrainProjector: TerrainProjector;
  roadNetwork: RoadNetwork;
  getState: () => GameState;
  getHeightAt: (x: number, z: number) => number;
  getNaturalHeightAt: (x: number, z: number) => number;
  isWaterAt: (x: number, z: number) => boolean;
  isQuarryPitAt?: (x: number, z: number) => boolean;
  onCommit: (commit: BurgageZoneCommit) => void | Promise<void>;
  onModeChanged: () => void;
  onPlacementRejected?: (reason: BurgagePlacementFailureReason) => void;
  onPlacementFailed?: (message: string) => void;
  onPickRejected?: (reason: 'missed_terrain' | 'too_close') => void;
  isBlocked: () => boolean;
};

export class BurgageTool {
  private readonly options: BurgageToolOptions;
  private readonly preview: BurgagePreview;
  private enabled = false;
  private points: THREE.Vector3[] = [];
  private depthPoint: THREE.Vector3 | null = null;
  private placementStage = 0;
  private frontageEdge: BurgageFrontageEdge = 0;
  private plotCount = 1;
  private plotCountTouched = false;
  private frontageTouched = false;
  private hoverPoint: THREE.Vector3 | null = null;
  private pointerInside = false;
  private pointerClientX = 0;
  private pointerClientY = 0;
  private pointerDirty = false;
  private lastHoverPreviewX = Number.NaN;
  private lastHoverPreviewZ = Number.NaN;
  private draftValidation: BurgagePlacementResult = { ok: false, reason: 'invalid_shape' };
  private cachedFrontageOptionCount = 0;
  private lastValidationTime = 0;
  private validationDirty = true;
  private validationScheduled = false;
  private previewLayout: BurgageLayoutResult | null = null;

  constructor(options: BurgageToolOptions) {
    this.options = options;
    this.preview = new BurgagePreview();
    options.domElement.addEventListener('mousedown', this.onPointerDown, { capture: true });
    options.domElement.addEventListener('mousemove', this.onPointerMove);
    options.domElement.addEventListener('mouseenter', this.onPointerEnter);
    options.domElement.addEventListener('mouseleave', this.onPointerLeave);
    window.addEventListener('keydown', this.onKeyDown);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getCursor(): string | null {
    if (!this.enabled || this.options.isBlocked()) return null;
    return 'crosshair';
  }

  hasDraft(): boolean {
    return this.placementStage > 0;
  }

  isDraftBuildable(): boolean {
    return this.placementStage >= 4 && this.draftValidation.ok;
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) {
      this.cancelDraft(false);
    } else {
      this.pointerDirty = true;
      this.refreshPreview();
    }
    this.options.onModeChanged();
  }

  getBuildButtonPosition(): { clientX: number; clientY: number } | null {
    if (!this.enabled || !this.isDraftBuildable() || this.placementStage < 4) return null;
    const anchor = this.points[1] ?? this.points[this.points.length - 1];
    const rect = this.options.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const projected = anchor.clone();
    projected.y += 1.4;
    projected.project(this.options.camera);
    if (projected.z < -1 || projected.z > 1) return null;
    return {
      clientX: rect.left + (projected.x * 0.5 + 0.5) * rect.width,
      clientY: rect.top + (-projected.y * 0.5 + 0.5) * rect.height,
    };
  }

  getStatusDetail(): string | null {
    if (!this.enabled) return null;
    if (this.placementStage === 0) {
      return 'Click the first corner along the road';
    }
    if (this.placementStage === 1) {
      return 'Click the second corner along the road';
    }
    if (this.placementStage === 2) {
      return `Click the third corner to set plot depth (${Math.round(MIN_ZONE_DEPTH)}–${Math.round(MAX_ZONE_DEPTH)}m)`;
    }
    if (this.placementStage === 3) {
      return 'Click the fourth corner to close the rectangle — use the plot controls on the zone';
    }
    const validation = this.draftValidation;
    if (!validation.ok) {
      if (validation.reason === 'too_small') return `Draw the plot deeper behind the road (~${Math.round(MIN_ZONE_DEPTH)}m minimum)`;
      if (validation.reason === 'too_deep') return `Shorten the backyard — max depth is ~${Math.round(MAX_ZONE_DEPTH)}m`;
      if (validation.reason === 'no_fit') return 'Too many plots — press − to reduce plot count';
      if (validation.reason === 'insufficient_resources') return 'Not enough timber or stone';
      return 'Adjust plot shape or plot count';
    }
    const count = validation.layout.residences.length;
    const cost = validation.layout.totalCost;
    const frontageOptions = this.cachedFrontageOptionCount;
    const frontageHint = frontageOptions > 1
      ? ` · frontage ${frontageEdgeLabel(this.frontageEdge)} (F to rotate)`
      : '';
    return `${count} ${count === 1 ? 'residence' : 'residences'} — ${cost.timber} timber, ${cost.stone} stone${frontageHint}`;
  }

  getLayoutHudState(): BurgageLayoutHudState | null {
    if (!this.enabled || !this.canAdjustLayout()) return null;
    const maxPlotCount = this.getMaxPlotCount();
    const validation = this.draftValidation;
    const residenceCount = validation.ok ? validation.layout.residences.length : null;
    const frontageOptions = this.cachedFrontageOptionCount;
    return {
      plotCount: this.plotCount,
      residenceCount,
      maxPlotCount,
      canDecrease: this.plotCount > 1,
      canIncrease: this.plotCount < maxPlotCount,
      canRotateFrontage: frontageOptions > 1,
      frontageLabel: frontageOptions > 1 ? frontageEdgeLabel(this.frontageEdge) : null,
      valid: validation.ok,
    };
  }

  getLayoutHudPosition(): { clientX: number; clientY: number } | null {
    if (!this.enabled || !this.canAdjustLayout()) return null;
    const corners = this.resolvePreviewCorners();
    if (corners.length !== 4) return null;
    const zoneCorners = cornersFromPoints(corners.map((point) => ({ x: point.x, z: point.z })));
    if (!zoneCorners) return null;

    const [frontStart, frontEnd] = getZoneEdge(zoneCorners, this.frontageEdge);
    const midX = (frontStart.x + frontEnd.x) * 0.5;
    const midZ = (frontStart.z + frontEnd.z) * 0.5;
    const rect = this.options.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    const projected = new THREE.Vector3(
      midX,
      this.options.getHeightAt(midX, midZ) + 2.4,
      midZ,
    );
    projected.project(this.options.camera);
    if (projected.z < -1 || projected.z > 1) return null;

    return {
      clientX: rect.left + (projected.x * 0.5 + 0.5) * rect.width,
      clientY: rect.top + (-projected.y * 0.5 + 0.5) * rect.height,
    };
  }

  adjustPlotCount(delta: number): void {
    if (!this.canAdjustLayout() || delta === 0) return;
    const maxPlotCount = this.getMaxPlotCount();
    const next = Math.max(1, Math.min(maxPlotCount, this.plotCount + delta));
    if (next === this.plotCount) return;
    this.plotCountTouched = true;
    this.plotCount = next;
    this.refreshPreview();
    this.options.onModeChanged();
  }

  rotateFrontageEdge(): void {
    if (!this.canAdjustLayout()) return;
    const corners = this.getZoneCorners();
    if (!corners) return;
    const next = cycleFrontageEdge(corners, this.options.roadNetwork, this.frontageEdge);
    if (next === this.frontageEdge) return;
    this.frontageTouched = true;
    this.frontageEdge = next;
    if (!this.plotCountTouched) this.syncPlotCountFromFrontage();
    this.refreshPreview();
    this.options.onModeChanged();
  }

  commitDraft(): void {
    if (this.placementStage < 4) return;
    const validation = this.computeValidation();
    if (!validation.ok) {
      this.rejectCommit(validation.reason);
      return;
    }
    void this.commitValidated();
  }

  dispose(): void {
    this.options.domElement.removeEventListener('mousedown', this.onPointerDown, { capture: true });
    this.options.domElement.removeEventListener('mousemove', this.onPointerMove);
    this.options.domElement.removeEventListener('mouseenter', this.onPointerEnter);
    this.options.domElement.removeEventListener('mouseleave', this.onPointerLeave);
    window.removeEventListener('keydown', this.onKeyDown);
    this.preview.dispose();
  }

  attachTo(parent: THREE.Group): void {
    parent.add(this.preview.group);
  }

  update(): void {
    if (!this.enabled) {
      this.preview.clear();
      return;
    }
    if (this.options.isBlocked()) return;
    if (this.pointerDirty) {
      this.pointerDirty = false;
      this.processPointerHover(this.pointerClientX, this.pointerClientY);
      return;
    }
    this.maybeRunDeferredValidation(false);
  }

  private readonly onPointerEnter = (): void => {
    this.pointerInside = true;
    this.pointerDirty = true;
  };

  private readonly onPointerLeave = (): void => {
    this.pointerInside = false;
    this.hoverPoint = null;
    this.lastHoverPreviewX = Number.NaN;
    this.lastHoverPreviewZ = Number.NaN;
    this.refreshPreview();
  };

  private processPointerHover(clientX: number, clientY: number): void {
    if (!this.enabled || this.options.isBlocked() || !this.pointerInside) return;
    const point = this.pickPoint(clientX, clientY);
    if (point && this.shouldSkipHoverPreview(point)) return;
    this.hoverPoint = point;
    this.refreshPreviewVisual();
    this.validationDirty = true;
    this.scheduleDeferredValidation();
  }

  private readonly onPointerMove = (event: MouseEvent): void => {
    if (!this.enabled || this.options.isBlocked()) return;
    this.pointerClientX = event.clientX;
    this.pointerClientY = event.clientY;
    this.pointerDirty = true;
  };

  private shouldSkipHoverPreview(point: THREE.Vector3): boolean {
    const dx = point.x - this.lastHoverPreviewX;
    const dz = point.z - this.lastHoverPreviewZ;
    if (!Number.isFinite(this.lastHoverPreviewX)) return false;
    return Math.hypot(dx, dz) < HOVER_PREVIEW_MOVE_THRESHOLD;
  }

  private readonly onPointerDown = (event: MouseEvent): void => {
    if (!this.enabled || event.button !== 0 || this.options.isBlocked()) return;
    if (event.altKey) return;

    const point = this.pickPoint(event.clientX, event.clientY);
    if (!point) {
      this.options.onPickRejected?.('missed_terrain');
      return;
    }

    if (this.placementStage >= 4) {
      const validation = this.computeValidation();
      if (!validation.ok) {
        event.preventDefault();
        event.stopPropagation();
        this.rejectCommit(validation.reason);
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      void this.commitValidated();
      return;
    }

    if (this.placementStage === 3) {
      const backPoint = this.hoverPoint ?? this.depthPoint ?? point;
      const rectangle = this.buildRectangleFromBackPoint(backPoint);
      if (!rectangle) {
        this.options.onPickRejected?.('too_close');
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      this.points = rectangle;
      this.depthPoint = null;
      this.placementStage = 4;
      this.syncFrontageAndPlotCount();
      this.options.onModeChanged();
      this.refreshPreview();
      return;
    }

    if (this.placementStage === 2) {
      if (this.points.length < 2) return;
      const rectangle = this.buildRectangleFromBackPoint(point);
      if (!rectangle) {
        this.options.onPickRejected?.('too_close');
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      this.depthPoint = point.clone();
      this.placementStage = 3;
      this.options.onModeChanged();
      this.refreshPreview();
      return;
    }

    if (this.points.length > 0) {
      const last = this.points[this.points.length - 1];
      if (Math.hypot(point.x - last.x, point.z - last.z) < MIN_POINT_DISTANCE) {
        this.options.onPickRejected?.('too_close');
        return;
      }
    }

    event.preventDefault();
    event.stopPropagation();
    this.points.push(point);
    this.placementStage = this.points.length;
    this.options.onModeChanged();
    this.refreshPreview();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.enabled || this.options.isBlocked()) return;
    if (isTypingTarget(event.target)) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      if (this.hasDraft()) this.cancelDraft(true);
      else this.setEnabled(false);
      return;
    }

    if (!this.canAdjustLayout()) return;

    if (event.key === 'Enter') {
      event.preventDefault();
      this.commitDraft();
      return;
    }
    if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      this.adjustPlotCount(1);
      return;
    }
    if (event.key === '-' || event.key === '_') {
      event.preventDefault();
      this.adjustPlotCount(-1);
      return;
    }
    if (event.code === 'KeyF') {
      event.preventDefault();
      this.rotateFrontageEdge();
    }
  };

  private async commitValidated(): Promise<void> {
    const validation = this.computeValidation();
    if (!validation.ok) {
      this.rejectCommit(validation.reason);
      return;
    }
    try {
      await this.options.onCommit({
        corners: this.points.map((point) => point.clone()),
        frontageEdge: this.frontageEdge,
        plotCount: validation.layout.plotCount,
      });
      this.setEnabled(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Residence placement failed.';
      this.options.onPlacementFailed?.(message);
    }
  }

  private rejectCommit(reason: BurgagePlacementFailureReason): void {
    this.options.onPlacementRejected?.(reason);
    if (reason === 'insufficient_resources') {
      this.setEnabled(false);
    }
  }

  private cancelDraft(notify: boolean): void {
    this.points = [];
    this.depthPoint = null;
    this.placementStage = 0;
    this.hoverPoint = null;
    this.lastHoverPreviewX = Number.NaN;
    this.lastHoverPreviewZ = Number.NaN;
    this.frontageEdge = 0;
    this.plotCount = 1;
    this.plotCountTouched = false;
    this.frontageTouched = false;
    this.clearDraftValidation();
    this.preview.clear();
    if (notify) this.options.onModeChanged();
  }

  private clearDraftValidation(): void {
    this.draftValidation = { ok: false, reason: 'invalid_shape' };
    this.cachedFrontageOptionCount = 0;
    this.previewLayout = null;
    this.validationDirty = true;
    this.lastValidationTime = 0;
  }

  private computeValidation(
    corners: THREE.Vector3[] = this.points,
    frontageEdge: BurgageFrontageEdge = this.frontageEdge,
    plotCount: number = this.plotCount,
    precomputedLayout: BurgageLayoutResult | null = null,
  ): BurgagePlacementResult {
    const state = this.options.getState();
    const totals = computeResourceTotals(state);
    return validateBurgagePlacement({
      corners,
      frontageEdge,
      plotCount,
      stockpile: totals,
      existingZones: state.burgageZones.values(),
      existingBuildings: state.buildings.values(),
      roadNetwork: this.options.roadNetwork,
      isWaterAt: this.options.isWaterAt,
      isQuarryPitAt: this.options.isQuarryPitAt,
      getNaturalHeightAt: this.options.getNaturalHeightAt,
      precomputedLayout,
      gameState: state,
    });
  }

  private refreshPreview(): void {
    this.refreshPreviewVisual();
    this.runValidation(true);
  }

  private refreshPreviewVisual(): void {
    const corners = this.resolvePreviewCorners();
    const placing = this.placementStage < 4;
    let previewFrontageEdge = this.frontageEdge;
    let previewPlotCount = this.plotCount;
    let layout: BurgageLayoutResult | null = null;

    const zoneCorners = corners.length === 4
      ? cornersFromPoints(corners.map((point) => ({ x: point.x, z: point.z })))
      : null;

    if (zoneCorners && this.canAdjustLayout() && !this.frontageTouched) {
      previewFrontageEdge = detectFrontageEdge(zoneCorners, this.options.roadNetwork);
      if (!this.plotCountTouched) {
        previewPlotCount = initialPlotCount(zoneCorners, previewFrontageEdge);
      }
      if (this.placementStage >= 4) {
        this.frontageEdge = previewFrontageEdge;
        if (!this.plotCountTouched) {
          this.plotCount = previewPlotCount;
        }
      }
    }

    if (zoneCorners) {
      layout = resolveBurgageLayout(zoneCorners, previewFrontageEdge, previewPlotCount);
      this.cachedFrontageOptionCount = countValidFrontageEdges(zoneCorners, this.options.roadNetwork);
    } else {
      this.cachedFrontageOptionCount = 0;
    }

    this.previewLayout = layout;

    if (this.hoverPoint) {
      this.lastHoverPreviewX = this.hoverPoint.x;
      this.lastHoverPreviewZ = this.hoverPoint.z;
    }
    const previewValid = this.draftValidation.ok ?? true;
    this.preview.update(
      corners,
      layout,
      previewValid,
      this.options.getHeightAt,
      placing,
      this.placementStage,
      this.hoverPoint,
      previewFrontageEdge,
    );
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
    if (!this.enabled) return;
    if (!force && !this.validationDirty) return;
    const now = performance.now();
    if (!force && now - this.lastValidationTime < VALIDATION_INTERVAL_MS) return;
    this.runValidation(force);
  }

  private runValidation(force: boolean): void {
    const corners = this.resolvePreviewCorners();
    if (!this.canAdjustLayout() || corners.length !== 4) {
      this.draftValidation = { ok: false, reason: 'invalid_shape' };
      this.validationDirty = false;
      this.preview.setValidity(false);
      if (force) this.options.onModeChanged();
      return;
    }

    const zoneCorners = cornersFromPoints(corners.map((point) => ({ x: point.x, z: point.z })));
    if (!zoneCorners) {
      this.draftValidation = { ok: false, reason: 'invalid_shape' };
      this.validationDirty = false;
      this.preview.setValidity(false);
      if (force) this.options.onModeChanged();
      return;
    }

    let previewFrontageEdge = this.frontageEdge;
    let previewPlotCount = this.plotCount;
    if (!this.frontageTouched) {
      previewFrontageEdge = detectFrontageEdge(zoneCorners, this.options.roadNetwork);
      if (!this.plotCountTouched) {
        previewPlotCount = initialPlotCount(zoneCorners, previewFrontageEdge);
      }
    }

    const layout = this.previewLayout
      ?? resolveBurgageLayout(zoneCorners, previewFrontageEdge, previewPlotCount);
    this.draftValidation = this.computeValidation(
      corners,
      previewFrontageEdge,
      previewPlotCount,
      layout,
    );
    this.validationDirty = false;
    this.lastValidationTime = performance.now();
    this.preview.setValidity(this.draftValidation.ok);
    if (force) this.options.onModeChanged();
  }

  private resolvePreviewCorners(): THREE.Vector3[] {
    if (this.placementStage >= 4) {
      return this.points.map((point) => point.clone());
    }

    if (this.points.length >= 2) {
      const backPoint = this.placementStage >= 3
        ? (this.hoverPoint ?? this.depthPoint ?? this.points[1])
        : (this.depthPoint ?? this.hoverPoint ?? this.points[1]);
      const rectangle = this.buildRectangleFromBackPoint(backPoint);
      if (rectangle) return rectangle;
    }

    if (this.points.length === 1) {
      const corners = [this.points[0].clone()];
      if (this.hoverPoint) corners.push(this.hoverPoint.clone());
      return corners;
    }

    return this.points.map((point) => point.clone());
  }

  private buildRectangleFromBackPoint(backPoint: THREE.Vector3): THREE.Vector3[] | null {
    if (this.points.length < 2) return null;
    const frontStart = { x: this.points[0].x, z: this.points[0].z };
    const frontEnd = { x: this.points[1].x, z: this.points[1].z };
    const rect = rectangleFromFrontageAndBackPoint(
      frontStart,
      frontEnd,
      { x: backPoint.x, z: backPoint.z },
      this.options.roadNetwork,
    );
    if (!rect) return null;

    return rectangleCornersToPoints(rect).map((corner) => {
      const y = this.options.getHeightAt(corner.x, corner.z);
      return new THREE.Vector3(corner.x, y, corner.z);
    });
  }

  private canAdjustLayout(): boolean {
    return this.placementStage >= 3;
  }

  private getZoneCorners() {
    const corners = this.resolvePreviewCorners();
    if (corners.length !== 4) return null;
    return cornersFromPoints(corners.map((point) => ({ x: point.x, z: point.z })));
  }

  private syncFrontageAndPlotCount(): void {
    const corners = this.getZoneCorners();
    if (!corners) return;
    this.frontageEdge = detectFrontageEdge(corners, this.options.roadNetwork);
    this.frontageTouched = false;
    this.syncPlotCountFromFrontage();
  }

  private syncPlotCountFromFrontage(): void {
    const corners = this.getZoneCorners();
    if (!corners) return;
    this.plotCount = initialPlotCount(corners, this.frontageEdge);
  }

  private getMaxPlotCount(): number {
    const corners = this.getZoneCorners();
    if (!corners) return 1;
    const [start, end] = getZoneEdge(corners, this.frontageEdge);
    return suggestPlotCount(Math.hypot(end.x - start.x, end.z - start.z));
  }

  private pickPoint(clientX: number, clientY: number): THREE.Vector3 | null {
    const picked = this.options.terrainProjector.pick(clientX, clientY);
    if (!picked) return null;
    const snapped = this.applyRoadSnap(picked);
    return new THREE.Vector3(snapped.x, snapped.y, snapped.z);
  }

  private applyRoadSnap(point: THREE.Vector3): THREE.Vector3 {
    const snap = this.options.roadNetwork.findSnap(point, SNAP_DISTANCE);
    if (!snap) return point;
    return snap.point.clone();
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  const tag = element?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || Boolean(element?.isContentEditable);
}
