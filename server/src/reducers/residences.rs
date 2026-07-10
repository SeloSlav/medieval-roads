use spacetimedb::{reducer, ReducerContext, Table};

use crate::burgage::{
    compute_burgage_layout, convex_zones_overlap, max_zone_depth, measure_zone_depth, min_zone_depth,
    zone_corners_polygon, ZoneCorners,
};
use crate::db::*;
use crate::economy::{
    credit_treasury_stone, credit_treasury_timber, residence_population, residence_zone_cost,
    spend_aggregate_stone, spend_aggregate_timber, total_stone, total_timber,
    TIMBER_SALVAGE_FRACTION, STONE_SALVAGE_FRACTION, ResourceAmount,
};
use crate::lifecycle::ensure_player_resources;
use crate::placement_validation::{burgage_zone_overlaps_buildings, is_on_quarry_pit};
use crate::tables::{BurgageZone, Residence};

#[reducer]
pub fn place_burgage_zone(
    ctx: &ReducerContext,
    corner_ax: f64,
    corner_az: f64,
    corner_bx: f64,
    corner_bz: f64,
    corner_cx: f64,
    corner_cz: f64,
    corner_dx: f64,
    corner_dz: f64,
    frontage_edge: u8,
    plot_count: u32,
) -> Result<(), String> {
    let owner = ctx.sender();
    ensure_player_resources(ctx, owner);

    let corners = ZoneCorners {
        a: crate::burgage::Point2 {
            x: corner_ax,
            z: corner_az,
        },
        b: crate::burgage::Point2 {
            x: corner_bx,
            z: corner_bz,
        },
        c: crate::burgage::Point2 {
            x: corner_cx,
            z: corner_cz,
        },
        d: crate::burgage::Point2 {
            x: corner_dx,
            z: corner_dz,
        },
    };

    let candidate_polygon = zone_corners_polygon(&corners);
    for corner in candidate_polygon {
        if is_on_quarry_pit(ctx, corner.x, corner.z) {
            return Err("Cannot place residences on a quarry pit.".to_string());
        }
    }

    for existing in ctx.db.burgage_zone().iter() {
        let existing_polygon = [
            crate::burgage::Point2 {
                x: existing.corner_ax,
                z: existing.corner_az,
            },
            crate::burgage::Point2 {
                x: existing.corner_bx,
                z: existing.corner_bz,
            },
            crate::burgage::Point2 {
                x: existing.corner_cx,
                z: existing.corner_cz,
            },
            crate::burgage::Point2 {
                x: existing.corner_dx,
                z: existing.corner_dz,
            },
        ];
        if convex_zones_overlap(&candidate_polygon, &existing_polygon) {
            return Err("Residence plot overlaps an existing zone.".to_string());
        }
    }

    if burgage_zone_overlaps_buildings(ctx, &corners) {
        return Err("Residence plot overlaps an existing building.".to_string());
    }

    let zone_depth = measure_zone_depth(&corners, frontage_edge);
    if zone_depth + 1e-6 < min_zone_depth() {
        return Err("Plot is too shallow — pull the back edge farther from the road.".to_string());
    }
    if zone_depth > max_zone_depth() + 0.05 {
        return Err("Plot is too deep — shorten the backyard behind the road.".to_string());
    }

    let layout = compute_burgage_layout(&corners, frontage_edge, plot_count)
        .ok_or_else(|| "Could not fit residences in this zone.".to_string())?;

    let cost = residence_zone_cost(layout.plot_count);
    if total_timber(ctx, owner) + 1e-6 < cost.timber {
        return Err(format!(
            "Not enough timber (need {} timber).",
            cost.timber.round() as i64
        ));
    }
    if total_stone(ctx, owner) + 1e-6 < cost.stone {
        return Err(format!(
            "Not enough stone (need {} stone).",
            cost.stone.round() as i64
        ));
    }
    spend_aggregate_timber(ctx, owner, cost.timber)?;
    spend_aggregate_stone(ctx, owner, cost.stone)?;

    ctx.db.burgage_zone().insert(BurgageZone {
        id: 0,
        owner,
        corner_ax,
        corner_az,
        corner_bx,
        corner_bz,
        corner_cx,
        corner_cz,
        corner_dx,
        corner_dz,
        frontage_edge,
        plot_count: layout.plot_count,
    });

    let zone_id = ctx
        .db
        .burgage_zone()
        .iter()
        .map(|zone| zone.id)
        .max()
        .ok_or_else(|| "Failed to resolve residence zone id.".to_string())?;

    let population = residence_population();
    for residence in layout.residences {
        ctx.db.residence().insert(Residence {
            id: 0,
            zone_id,
            owner,
            parcel_index: residence.parcel_index,
            x: residence.x,
            z: residence.z,
            yaw: residence.yaw,
            population,
            firewood_stock: 0.0,
            abandoned: false,
            needs_deficit_ticks: 0,
        });
    }

    Ok(())
}

#[reducer]
pub fn demolish_burgage_zone(ctx: &ReducerContext, zone_id: u64) -> Result<(), String> {
    let owner = ctx.sender();
    let zone = ctx
        .db
        .burgage_zone()
        .id()
        .find(&zone_id)
        .ok_or_else(|| "Residence zone not found.".to_string())?;

    if zone.owner != owner {
        return Err("You do not own this residence zone.".to_string());
    }

    let residence_count = ctx
        .db
        .residence()
        .zone_id()
        .filter(&zone_id)
        .count() as u32;
    let refund = residence_zone_cost(residence_count);
    let salvage = ResourceAmount {
        timber: (refund.timber * TIMBER_SALVAGE_FRACTION).round(),
        stone: (refund.stone * STONE_SALVAGE_FRACTION).round(),
    };
    credit_treasury_timber(ctx, owner, salvage.timber);
    credit_treasury_stone(ctx, owner, salvage.stone);

    for residence in ctx.db.residence().zone_id().filter(&zone_id) {
        ctx.db.residence().id().delete(residence.id);
    }
    ctx.db.burgage_zone().id().delete(zone_id);
    Ok(())
}
