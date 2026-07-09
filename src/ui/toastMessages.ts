import type { RoadPlacementFailureReason } from '../roads/RoadPlacementValidation.ts';

export const TOAST_MESSAGES = {
  'road.placement.river': 'A river was in the way',
  'road.placement.rocks': 'Rocks were in the way',
  'road.placement.too_steep': 'The slope is too steep for a road',
} as const;

export type ToastMessageId = keyof typeof TOAST_MESSAGES;

export function getToastMessage(id: ToastMessageId): string {
  return TOAST_MESSAGES[id];
}

export function roadPlacementReasonToToastId(reason: RoadPlacementFailureReason): ToastMessageId | null {
  switch (reason) {
    case 'river':
      return 'road.placement.river';
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
