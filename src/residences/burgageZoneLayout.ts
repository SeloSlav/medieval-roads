import type { BurgageZoneState } from '../resources/types.ts';
import {
  computeBurgageLayout,
  cornersFromPoints,
  type BurgageLayoutResult,
} from './burgageLayout.ts';

export function layoutFromBurgageZone(zone: BurgageZoneState): BurgageLayoutResult | null {
  const corners = cornersFromPoints([
    zone.cornerA,
    zone.cornerB,
    zone.cornerC,
    zone.cornerD,
  ]);
  if (!corners) return null;
  return computeBurgageLayout(corners, zone.frontageEdge, zone.plotCount);
}
