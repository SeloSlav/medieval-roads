import type { TerrainProjector } from '../terrain/TerrainProjector.ts';
import type { BuildingKind, GameState } from '../resources/types.ts';
import { placeBuilding } from '../resources/GameState.ts';
import { getBuildingDefinition } from '../resources/buildings.ts';
import type { BuildingPlacementFailureReason } from './BuildingPlacementValidation.ts';
import { validateBuildingPlacement } from './BuildingPlacementValidation.ts';
import type { BuildingMarkers } from './BuildingMarkers.ts';

export type BuildingToolMode = BuildingKind | 'off';

type BuildingToolOptions = {
  domElement: HTMLElement;
  terrainProjector: TerrainProjector;
  markers: BuildingMarkers;
  getState: () => GameState;
  onPlaced: (state: GameState) => void;
  /** When set (SpacetimeDB connected), placement goes through the server reducer. */
  onPlaceBuilding?: (kind: BuildingKind, x: number, z: number) => void | Promise<void>;
  isWaterAt: (x: number, z: number) => boolean;
  getHeightAt: (x: number, z: number) => number;
  onModeChanged: () => void;
  onPlacementRejected?: (reason: BuildingPlacementFailureReason) => void;
  isBlocked: () => boolean;
};

export class BuildingTool {
  private readonly options: BuildingToolOptions;
  private mode: BuildingToolMode = 'off';
  private pointerX = 0;
  private pointerY = 0;
  private pointerInside = false;

  constructor(options: BuildingToolOptions) {
    this.options = options;
    options.domElement.addEventListener('mousedown', this.onPointerDown, { capture: true });
    options.domElement.addEventListener('mousemove', this.onPointerMove);
    options.domElement.addEventListener('mouseenter', this.onPointerEnter);
    options.domElement.addEventListener('mouseleave', this.onPointerLeave);
  }

  getMode(): BuildingToolMode {
    return this.mode;
  }

  isEnabled(): boolean {
    return this.mode !== 'off';
  }

  setMode(mode: BuildingToolMode): void {
    this.mode = mode;
    if (mode === 'off') {
      this.clearPreview();
    } else {
      this.refreshPreview();
    }
    this.options.onModeChanged();
  }

  toggleMode(kind: BuildingKind): void {
    this.setMode(this.mode === kind ? 'off' : kind);
  }

  update(): void {
    if (this.mode === 'off' || !this.pointerInside) return;
    this.refreshPreview();
  }

  dispose(): void {
    this.options.domElement.removeEventListener('mousedown', this.onPointerDown, { capture: true });
    this.options.domElement.removeEventListener('mousemove', this.onPointerMove);
    this.options.domElement.removeEventListener('mouseenter', this.onPointerEnter);
    this.options.domElement.removeEventListener('mouseleave', this.onPointerLeave);
  }

  private readonly onPointerEnter = (): void => {
    this.pointerInside = true;
  };

  private readonly onPointerLeave = (): void => {
    this.pointerInside = false;
    this.clearPreview();
  };

  private readonly onPointerMove = (event: MouseEvent): void => {
    this.pointerX = event.clientX;
    this.pointerY = event.clientY;
    if (this.mode === 'off') return;
    this.refreshPreview();
  };

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
      if (this.options.onPlaceBuilding) {
        await this.options.onPlaceBuilding(kind, x, z);
      } else {
        const result = placeBuilding(this.options.getState(), kind, x, z);
        if (!result.ok) return;
        this.options.onPlaced(result.state);
        this.options.markers.syncBuildings(result.state.buildings.values());
      }
      this.setMode('off');
    } catch (error) {
      console.error('Building placement failed:', error);
    }
  }

  private refreshPreview(): void {
    if (this.mode === 'off' || this.options.isBlocked()) {
      this.clearPreview();
      return;
    }

    const point = this.options.terrainProjector.pick(this.pointerX, this.pointerY);
    if (!point) {
      this.clearPreview();
      return;
    }

    const definition = getBuildingDefinition(this.mode);
    const validation = this.validate(this.mode, point.x, point.z);
    this.options.markers.setPlacementPreview(
      this.mode,
      point.x,
      point.z,
      definition.workRadius,
      validation.ok,
      true,
    );
  }

  private validate(kind: BuildingKind, x: number, z: number) {
    return validateBuildingPlacement(kind, x, z, {
      buildings: this.options.getState().buildings.values(),
      isWaterAt: this.options.isWaterAt,
      getHeightAt: this.options.getHeightAt,
    });
  }

  private clearPreview(): void {
    this.options.markers.clearPlacementPreview();
  }
}

export function getBuildingToolLabel(mode: BuildingToolMode): string {
  if (mode === 'off') return 'Building tool off';
  return `${getBuildingDefinition(mode).label} placement`;
}
