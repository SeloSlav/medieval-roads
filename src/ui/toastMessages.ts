import type { RoadPlacementFailureReason } from '../roads/RoadPlacementValidation.ts';
import type { BuildingPlacementFailureReason } from '../buildings/BuildingPlacementValidation.ts';
import type { BurgagePlacementFailureReason } from '../residences/burgagePlacementValidation.ts';

export const TOAST_MESSAGES = {
  'road.placement.river': 'A river was in the way',
  'road.placement.river_too_wide': 'The river is too wide for a wooden bridge',
  'road.placement.rocks': 'Rocks were in the way',
  'road.placement.too_steep': 'The slope is too steep for a road',
  'building.placement.water': 'Cannot build on water',
  'building.placement.too_steep': 'The slope is too steep here',
  'building.placement.too_close': 'Too close to another building',
  'building.placement.within_work_radius': 'Another building of the same type already covers this area',
  'building.placement.within_residence_zone': 'Cannot build inside a residence plot',
  'building.placement.on_quarry_pit': 'Cannot build on a quarry pit',
  'building.placement.no_quarry_in_range': 'No quarry stone within work range',
  'building.placement.no_trees_in_range': 'No mature trees within work range',
  'building.placement.insufficient_resources': 'Not enough wood or stone',
  'burgage.placement.water': 'Cannot place residences on water',
  'burgage.placement.too_steep': 'The slope is too steep here',
  'burgage.placement.invalid_shape': 'Invalid residence plot shape',
  'burgage.placement.too_small': 'Zone is too shallow — pull the back edge farther from the road',
  'burgage.placement.no_road_frontage': 'Frontage must face a road',
  'burgage.placement.overlaps_existing': 'Overlaps an existing residence plot',
  'burgage.placement.overlaps_building': 'Overlaps an existing building',
  'burgage.placement.on_quarry_pit': 'Cannot place residences on a quarry pit',
  'burgage.placement.insufficient_resources': 'Not enough wood or stone',
  'burgage.placement.no_fit': 'Too many plots for this frontage — press − to reduce plot count',
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

export function burgagePlacementReasonToToastId(reason: BurgagePlacementFailureReason): ToastMessageId {
  switch (reason) {
    case 'water':
      return 'burgage.placement.water';
    case 'too_steep':
      return 'burgage.placement.too_steep';
    case 'invalid_shape':
      return 'burgage.placement.invalid_shape';
    case 'too_small':
      return 'burgage.placement.too_small';
    case 'no_road_frontage':
      return 'burgage.placement.no_road_frontage';
    case 'overlaps_existing':
      return 'burgage.placement.overlaps_existing';
    case 'overlaps_building':
      return 'burgage.placement.overlaps_building';
    case 'on_quarry_pit':
      return 'burgage.placement.on_quarry_pit';
    case 'insufficient_resources':
      return 'burgage.placement.insufficient_resources';
    case 'no_fit':
      return 'burgage.placement.no_fit';
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
    case 'within_work_radius':
      return 'building.placement.within_work_radius';
    case 'within_residence_zone':
      return 'building.placement.within_residence_zone';
    case 'on_quarry_pit':
      return 'building.placement.on_quarry_pit';
    case 'no_quarry_in_range':
      return 'building.placement.no_quarry_in_range';
    case 'no_trees_in_range':
      return 'building.placement.no_trees_in_range';
    case 'insufficient_resources':
      return 'building.placement.insufficient_resources';
    default: {
      const unhandled: never = reason;
      return unhandled;
    }
  }
}
