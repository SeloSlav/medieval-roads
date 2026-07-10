use spacetimedb::ReducerContext;

use crate::db::*;

use crate::constants::{
    LUMBER_MILL_INTERVAL, LUMBER_MILL_RADIUS, REFORESTER_RADIUS, STONE_QUARRY_INTERVAL,
    STONE_QUARRY_RADIUS, WOODCUTTERS_LODGE_RADIUS,
};

pub fn building_params(kind: &str) -> Result<(f64, f64), String> {
    match kind {
        "lumber_mill" => Ok((LUMBER_MILL_RADIUS, LUMBER_MILL_INTERVAL)),
        "reforester" => Ok((REFORESTER_RADIUS, 0.0)),
        "woodcutters_lodge" => Ok((WOODCUTTERS_LODGE_RADIUS, 0.0)),
        "stone_quarry" => Ok((STONE_QUARRY_RADIUS, STONE_QUARRY_INTERVAL)),
        _ => Err(format!("Unknown building kind: {kind}")),
    }
}

pub fn find_nearest_mature_tree(
    ctx: &ReducerContext,
    x: f64,
    z: f64,
    radius: f64,
) -> Option<crate::tables::TreeEntity> {
    let radius_sq = radius * radius;
    let mut best: Option<crate::tables::TreeEntity> = None;
    let mut best_dist = f64::INFINITY;

    for tree in ctx.db.tree_entity().iter() {
        if tree.phase != "mature" {
            continue;
        }
        let dx = tree.x - x;
        let dz = tree.z - z;
        let dist_sq = dx * dx + dz * dz;
        if dist_sq > radius_sq || dist_sq >= best_dist {
            continue;
        }
        best_dist = dist_sq;
        best = Some(tree);
    }

    best
}

pub fn find_nearest_quarry(
    ctx: &ReducerContext,
    x: f64,
    z: f64,
    radius: f64,
) -> Option<crate::tables::Quarry> {
    let radius_sq = radius * radius;
    let mut best: Option<crate::tables::Quarry> = None;
    let mut best_dist = f64::INFINITY;

    for quarry in ctx.db.quarry().iter() {
        if quarry.remaining <= 0.0 {
            continue;
        }
        let dx = quarry.x - x;
        let dz = quarry.z - z;
        let dist_sq = dx * dx + dz * dz;
        if dist_sq > radius_sq || dist_sq >= best_dist {
            continue;
        }
        best_dist = dist_sq;
        best = Some(quarry);
    }

    best
}
