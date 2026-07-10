import type { RoadPlacementFailureReason } from '../roads/RoadPlacementValidation.ts';
import type { BuildingPlacementFailureReason } from '../buildings/BuildingPlacementValidation.ts';

export const TOAST_MESSAGES = {
  'road.placement.river': 'A river was in the way',
  'road.placement.river_too_wide': 'The river is too wide for a wooden bridge',
  'road.placement.rocks': 'Rocks were in the way',
  'road.placement.too_steep': 'The slope is too steep for a road',
  'building.placement.water': 'Cannot build on water',
  'building.placement.too_steep': 'The slope is too steep here',
  'building.placement.too_close': 'Too close to another building',
} as const;

export type ToastMessageId = keyof typeof TOAST_MESSAGES;

export function getToastMessage(id: ToastMessageId): string {
  return TOAST_MESSAGES[id];
}

export function roadPlacementReasonToToastId(reason: RoadPlacementFailureReason): ToastMessageId | null {
  switch (reason) {
    case 'river':
      return 'road.placement.river';
    case 'river_too_wide':
      return 'road.placement.river_too_wide';
    case 'rocks':
      return 'road.placement.rocks';
    case 'too_steep':
      return 'road.placement.too_steep';
    case 'too_short':
      return null;
    default: {
      const unhandled: never = reason;
      return unhandled;
    }
  }
}

export function buildingPlacementReasonToToastId(reason: BuildingPlacementFailureReason): ToastMessageId {
  switch (reason) {
    case 'water':
      return 'building.placement.water';
    case 'too_steep':
      return 'building.placement.too_steep';
    case 'too_close':
      return 'building.placement.too_close';
    default: {
      const unhandled: never = reason;
      return unhandled;
    }
  }
}
