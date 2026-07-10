import * as THREE from 'three';
import type { TerrainProjector } from '../terrain/TerrainProjector.ts';
import type { BuildingKind, GameState } from '../resources/types.ts';
import { computeResourceTotals } from '../resources/resourceTotals.ts';
import { getBuildingDefinition } from '../resources/buildings.ts';
import type { BuildingPlacementFailureReason, BuildingPlacementResult } from './BuildingPlacementValidation.ts';
import { validateBuildingPlacement } from './BuildingPlacementValidation.ts';
import type { BuildingMarkers } from './BuildingMarkers.ts';
import type { BuildingTerrainSource } from './BuildingTerrainLayout.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';

export type BuildingToolMode = BuildingKind | 'off';

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  const tag = element?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || Boolean(element?.isContentEditable);
}

type BuildingToolOptions = {
  domElement: HTMLElement;
  terrainProjector: TerrainProjector;
  markers: BuildingMarkers;
  getState: () => GameState;
  onPlaceBuilding: (kind: BuildingKind, x: number, z: number) => void | Promise<void>;
  isWaterAt: (x: number, z: number) => boolean;
  isQuarryPitAt?: (x: number, z: number) => boolean;
  getNaturalHeightAt: (x: number, z: number) => number;
  countMatureTreesInRadius?: (x: number, z: number, radius: number) => number;
  getRoadNetwork?: () => RoadNetwork;
  onPreviewChange?: (preview: BuildingTerrainSource | null) => void;
  onModeChanged: () => void;
  onPlacementRejected?: (reason: BuildingPlacementFailureReason) => void;
  onPlacementFailed?: (message: string) => void;
  isBlocked: () => boolean;
};

export class BuildingTool {
  private readonly options: BuildingToolOptions;
  private mode: BuildingToolMode = 'off';
  private pointerX = 0;
  private pointerY = 0;
  private pointerInside = false;
  private pointerDirty = false;
  private lastPreviewX = Number.NaN;
  private lastPreviewZ = Number.NaN;
  private lastPreviewValidation: BuildingPlacementResult | null = null;
  private lastTerrainPreviewX = Number.NaN;
  private lastTerrainPreviewZ = Number.NaN;
  private readonly previewMoveThreshold = 0.35;
  private readonly terrainPreviewMoveThreshold = 0.45;

  constructor(options: BuildingToolOptions) {
    this.options = options;
    options.domElement.addEventListener('mousedown', this.onPointerDown, { capture: true });
    options.domElement.addEventListener('mousemove', this.onPointerMove);
    options.domElement.addEventListener('mouseenter', this.onPointerEnter);
    options.domElement.addEventListener('mouseleave', this.onPointerLeave);
    window.addEventListener('keydown', this.onKeyDown);
  }

  getMode(): BuildingToolMode {
    return this.mode;
  }

  isEnabled(): boolean {
    return this.mode !== 'off';
  }

  setMode(mode: BuildingToolMode): void {
    this.mode = mode;
    this.resetPreviewCache();
    if (mode === 'off') {
      this.clearPreview();
      this.options.onPreviewChange?.(null);
    } else {
      this.refreshPreview();
    }
    this.options.onModeChanged();
  }

  toggleMode(kind: BuildingKind): void {
    this.setMode(this.mode === kind ? 'off' : kind);
  }

  update(): void {
    if (this.mode === 'off') return;
    if (this.options.isBlocked()) {
      this.clearPreview();
      this.options.onPreviewChange?.(null);
      return;
    }
    if (this.pointerDirty) {
      this.pointerDirty = false;
      this.processPointerHover();
    }
  }

  dispose(): void {
    this.options.domElement.removeEventListener('mousedown', this.onPointerDown, { capture: true });
    this.options.domElement.removeEventListener('mousemove', this.onPointerMove);
    this.options.domElement.removeEventListener('mouseenter', this.onPointerEnter);
    this.options.domElement.removeEventListener('mouseleave', this.onPointerLeave);
    window.removeEventListener('keydown', this.onKeyDown);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (this.mode === 'off' || this.options.isBlocked()) return;
    if (isTypingTarget(event.target)) return;
    if (event.key !== 'Escape') return;
    event.preventDefault();
    this.setMode('off');
  };

  private readonly onPointerEnter = (): void => {
    this.pointerInside = true;
    this.pointerDirty = true;
  };

  private readonly onPointerLeave = (): void => {
    this.pointerInside = false;
    this.clearPreview();
    this.options.onPreviewChange?.(null);
  };

  private readonly onPointerMove = (event: MouseEvent): void => {
    this.pointerX = event.clientX;
    this.pointerY = event.clientY;
    if (this.mode === 'off' || !this.pointerInside || this.options.isBlocked()) return;
    this.pointerDirty = true;
  };

  private processPointerHover(): void {
    const point = this.options.terrainProjector.pick(this.pointerX, this.pointerY);
    if (!point) {
      this.clearPreview();
      this.options.onPreviewChange?.(null);
      return;
    }

    const dx = point.x - this.lastPreviewX;
    const dz = point.z - this.lastPreviewZ;
    if (Number.isFinite(this.lastPreviewX) && Math.hypot(dx, dz) < this.previewMoveThreshold) {
      return;
    }

    this.refreshPreviewAt(point);
  }

  private readonly onPointerDown = (event: MouseEvent): void => {
    if (event.button !== 0 || this.mode === 'off') return;
    if (this.options.isBlocked()) return;

    const point = this.options.terrainProjector.pick(event.clientX, event.clientY);
    if (!point) return;

    const validation = this.validate(this.mode, point.x, point.z);
    if (!validation.ok) {
      event.preventDefault();
      event.stopPropagation();
      this.options.onPlacementRejected?.(validation.reason);
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    void this.placeAt(this.mode, point.x, point.z);
  };

  private async placeAt(kind: BuildingKind, x: number, z: number): Promise<void> {
    try {
      await this.options.onPlaceBuilding(kind, x, z);
      this.setMode('off');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Building placement failed.';
      console.error('Building placement failed:', error);
      this.options.onPlacementFailed?.(message);
    }
  }

  private refreshPreview(): void {
    if (this.mode === 'off' || this.options.isBlocked()) {
      this.clearPreview();
      this.options.onPreviewChange?.(null);
      return;
    }

    const point = this.options.terrainProjector.pick(this.pointerX, this.pointerY);
    if (!point) {
      this.clearPreview();
      this.options.onPreviewChange?.(null);
      return;
    }

    this.refreshPreviewAt(point);
  }

  private refreshPreviewAt(point: THREE.Vector3): void {
    if (this.mode === 'off') return;
    const kind = this.mode;
    const definition = getBuildingDefinition(kind);
    const validation = this.validateAt(point.x, point.z);
    this.updateTerrainPreview(point.x, point.z);
    this.options.markers.setPlacementPreview(
      kind,
      point.x,
      point.z,
      definition.workRadius,
      validation.ok,
      true,
    );
  }

  private validateAt(x: number, z: number): BuildingPlacementResult {
    const dx = x - this.lastPreviewX;
    const dz = z - this.lastPreviewZ;
    if (this.lastPreviewValidation && Number.isFinite(this.lastPreviewX) && Math.hypot(dx, dz) < 0.02) {
      return this.lastPreviewValidation;
    }

    const result = this.validate(this.mode as BuildingKind, x, z);
    this.lastPreviewX = x;
    this.lastPreviewZ = z;
    this.lastPreviewValidation = result;
    return result;
  }

  private resetPreviewCache(): void {
    this.pointerDirty = false;
    this.lastPreviewX = Number.NaN;
    this.lastPreviewZ = Number.NaN;
    this.lastPreviewValidation = null;
    this.lastTerrainPreviewX = Number.NaN;
    this.lastTerrainPreviewZ = Number.NaN;
  }

  private updateTerrainPreview(x: number, z: number): void {
    const dx = x - this.lastTerrainPreviewX;
    const dz = z - this.lastTerrainPreviewZ;
    if (Number.isFinite(this.lastTerrainPreviewX) && Math.hypot(dx, dz) < this.terrainPreviewMoveThreshold) {
      return;
    }

    this.lastTerrainPreviewX = x;
    this.lastTerrainPreviewZ = z;
    this.options.onPreviewChange?.({ kind: this.mode as BuildingKind, x, z });
  }

  private validate(kind: BuildingKind, x: number, z: number) {
    const state = this.options.getState();
    const totals = computeResourceTotals(state);
    return validateBuildingPlacement(kind, x, z, {
      buildings: state.buildings.values(),
      burgageZones: state.burgageZones.values(),
      quarries: state.quarries.values(),
      stockpile: totals,
      isWaterAt: this.options.isWaterAt,
      isQuarryPitAt: this.options.isQuarryPitAt,
      getNaturalHeightAt: this.options.getNaturalHeightAt,
      countMatureTreesInRadius: this.options.countMatureTreesInRadius,
      roadNetwork: this.options.getRoadNetwork?.(),
    });
  }

  private clearPreview(): void {
    this.resetPreviewCache();
    this.options.markers.clearPlacementPreview();
  }
}

export function getBuildingToolLabel(mode: BuildingToolMode): string {
  if (mode === 'off') return 'Building tool off';
  return `${getBuildingDefinition(mode).label} placement`;
}
