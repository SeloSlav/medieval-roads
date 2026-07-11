import { ForagingMapIcons } from '../map/ForagingMapIcons.ts';
import { QuarryMapIcons } from '../map/QuarryMapIcons.ts';
import type { GameState } from '../resources/types.ts';
import type { WorldLayoutRegistry } from '../resources/WorldLayoutRegistry.ts';
import type { Terrain } from '../terrain/Terrain.ts';
import type * as THREE from 'three';

export type WorldMapIconsBundle = {
  quarry: QuarryMapIcons;
  foraging: ForagingMapIcons;
};

export function createWorldMapIcons(options: {
  uiRoot: HTMLElement;
  domElement: HTMLElement;
  terrain: Terrain;
  registry: WorldLayoutRegistry;
  getCamera: () => THREE.PerspectiveCamera | null;
  getZoomPercent: () => number;
  getGameState: () => GameState;
  onQuarrySelect: (quarryId: string) => void;
  onForagingSelect: (nodeId: string) => void;
  isBlocked: () => boolean;
}): WorldMapIconsBundle {
  const {
    uiRoot,
    domElement,
    terrain,
    registry,
    getCamera,
    getZoomPercent,
    getGameState,
    onQuarrySelect,
    onForagingSelect,
    isBlocked,
  } = options;

  const quarry = new QuarryMapIcons({
    uiRoot,
    domElement,
    terrain,
    registry,
    getCamera,
    getZoomPercent,
    onQuarrySelect,
    isBlocked,
  });

  const foraging = new ForagingMapIcons({
    uiRoot,
    domElement,
    terrain,
    registry,
    getCamera,
    getZoomPercent,
    getForagingNodes: () => getGameState().foragingNodes,
    onForagingSelect,
    isBlocked,
  });

  return { quarry, foraging };
}
