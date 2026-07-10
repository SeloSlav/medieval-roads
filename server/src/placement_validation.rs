use spacetimedb::ReducerContext;

use crate::burgage::{zone_corners_polygon, zone_overlaps_footprint, ZoneCorners};
use crate::constants::{
    LUMBER_MILL_PICK_RADIUS, REFORESTER_PICK_RADIUS, STONE_QUARRY_PICK_RADIUS,
    WOODCUTTERS_LODGE_PICK_RADIUS,
};
use crate::db::*;

const LARGE_QUARRY_PIT_RADIUS: f64 = 58.0;
const SMALL_QUARRY_PIT_RADIUS: f64 = 30.0;

pub fn building_pick_radius(kind: &str) -> Option<f64> {
    match kind {
        "lumber_mill" => Some(LUMBER_MILL_PICK_RADIUS),
        "reforester" => Some(REFORESTER_PICK_RADIUS),
        "woodcutters_lodge" => Some(WOODCUTTERS_LODGE_PICK_RADIUS),
        "stone_quarry" => Some(STONE_QUARRY_PICK_RADIUS),
        _ => None,
    }
}

pub fn building_overlaps_residence_zone(
    ctx: &ReducerContext,
    kind: &str,
    x: f64,
    z: f64,
) -> bool {
    let Some(pick_radius) = building_pick_radius(kind) else {
        return false;
    };

    for zone in ctx.db.burgage_zone().iter() {
        let zone_polygon = [
            crate::burgage::Point2 {
                x: zone.corner_ax,
                z: zone.corner_az,
            },
            crate::burgage::Point2 {
                x: zone.corner_bx,
                z: zone.corner_bz,
            },
            crate::burgage::Point2 {
                x: zone.corner_cx,
                z: zone.corner_cz,
            },
            crate::burgage::Point2 {
                x: zone.corner_dx,
                z: zone.corner_dz,
            },
        ];
        if zone_overlaps_footprint(&zone_polygon, x, z, pick_radius) {
            return true;
        }
    }

    false
}

pub fn burgage_zone_overlaps_buildings(ctx: &ReducerContext, corners: &ZoneCorners) -> bool {
    let candidate = zone_corners_polygon(corners);
    for building in ctx.db.building().iter() {
        let Some(pick_radius) = building_pick_radius(&building.kind) else {
            continue;
        };
        if zone_overlaps_footprint(&candidate, building.x, building.z, pick_radius) {
            return true;
        }
    }
    false
}

pub fn is_on_quarry_pit(ctx: &ReducerContext, x: f64, z: f64) -> bool {
    for quarry in ctx.db.quarry().iter() {
        let radius = if quarry.quarry_id.contains("large") {
            LARGE_QUARRY_PIT_RADIUS
        } else {
            SMALL_QUARRY_PIT_RADIUS
        };
        let dx = quarry.x - x;
        let dz = quarry.z - z;
        if dx * dx + dz * dz <= radius * radius {
            return true;
        }
    }
    false
}
