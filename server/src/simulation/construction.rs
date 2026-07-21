//! Material reservations, construction hauling, and builder progress.

use spacetimedb::ReducerContext;

use crate::balance_generated::{
    CONSTRUCTION_DELIVERY_UNLOAD_SEC, CONSTRUCTION_TREASURY_TRANSFER_PER_SEC,
    CONSTRUCTION_WORK_PER_WORKER_PER_SEC, TICK_DT,
};
use crate::building_defs::building_def;
use crate::db::*;
use crate::economy::{available_building_labor, building_commodity_stock, CommodityKind};
use crate::reducers::livestock::{starter_herd, SPECIES_CATTLE, SPECIES_SWINE};
use crate::simulation::delivery_trips::{
    building_has_active_trip, try_start_construction_supply_trip, DELIVERY_DESTINATION_BUILDING,
};
use crate::simulation::{labor_and_logistics_paused, GameClock, SimTickContext};
use crate::tables::Building;

pub fn step_construction_sites(ctx: &ReducerContext, tick: &SimTickContext, clock: &GameClock) {
    let site_ids: Vec<u64> = ctx
        .db
        .building()
        .iter()
        .filter(|building| !building.construction_complete)
        .map(|building| building.id)
        .collect();

    for site_id in site_ids {
        let Some(mut site) = ctx.db.building().id().find(&site_id) else {
            continue;
        };

        transfer_treasury_reserve(ctx, clock, &mut site);
        dispatch_reserved_stock(ctx, tick, clock, &mut site, CommodityKind::Stone);
        dispatch_reserved_stock(ctx, tick, clock, &mut site, CommodityKind::Timber);
        advance_builder_work(ctx, clock, site);
    }
}

fn transfer_treasury_reserve(ctx: &ReducerContext, clock: &GameClock, site: &mut Building) {
    if site.assigned_labor == 0 || labor_and_logistics_paused(ctx, site.owner, clock) {
        return;
    }
    let Some(mut treasury) = ctx.db.player_resources().owner().find(&site.owner) else {
        return;
    };
    let mut transfer_budget =
        CONSTRUCTION_TREASURY_TRANSFER_PER_SEC * site.assigned_labor as f64 * TICK_DT;

    let stone = transfer_budget
        .min(site.construction_treasury_stone)
        .min(treasury.stone);
    if stone > 1e-6 {
        treasury.stone -= stone;
        site.construction_treasury_stone -= stone;
        site.construction_reserved_stone = (site.construction_reserved_stone - stone).max(0.0);
        site.construction_delivered_stone += stone;
        transfer_budget -= stone;
    }

    let timber = transfer_budget
        .min(site.construction_treasury_timber)
        .min(treasury.timber);
    if timber > 1e-6 {
        treasury.timber -= timber;
        site.construction_treasury_timber -= timber;
        site.construction_reserved_timber = (site.construction_reserved_timber - timber).max(0.0);
        site.construction_delivered_timber += timber;
    }

    ctx.db.player_resources().owner().update(treasury);
    ctx.db.building().id().update(site.clone());
}

fn dispatch_reserved_stock(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    site: &mut Building,
    commodity: CommodityKind,
) {
    let physical_reserved = match commodity {
        CommodityKind::Timber => {
            (site.construction_reserved_timber - site.construction_treasury_timber).max(0.0)
        }
        CommodityKind::Stone => {
            (site.construction_reserved_stone - site.construction_treasury_stone).max(0.0)
        }
        _ => 0.0,
    };
    if physical_reserved <= 1e-6 || site_has_inbound_cargo(ctx, site.id, commodity) {
        return;
    }
    let Some(network) = tick.road_network(site.owner) else {
        return;
    };
    let allow_offroad = building_def(&site.kind).is_some_and(|def| !def.requires_road);

    let mut sources: Vec<Building> = ctx
        .db
        .building()
        .owner()
        .filter(&site.owner)
        .filter(|source| {
            source.id != site.id
                && source.construction_complete
                && !building_has_active_trip(ctx, source.id)
                && building_commodity_stock(source, commodity) > 1e-6
        })
        .collect();
    sources.sort_by(|left, right| {
        source_priority(left)
            .cmp(&source_priority(right))
            .then_with(|| {
                squared_distance(left.x, left.z, site.x, site.z)
                    .total_cmp(&squared_distance(right.x, right.z, site.x, site.z))
            })
            .then_with(|| left.id.cmp(&right.id))
    });

    for mut source in sources {
        let free_haulers = available_construction_haulers(ctx, site.owner);
        if try_start_construction_supply_trip(
            ctx,
            clock,
            &network,
            &mut source,
            site,
            commodity,
            allow_offroad,
            free_haulers,
        ) {
            return;
        }
    }
}

fn advance_builder_work(ctx: &ReducerContext, clock: &GameClock, mut site: Building) {
    if site.assigned_labor == 0 || labor_and_logistics_paused(ctx, site.owner, clock) {
        return;
    }
    let required_total = site.construction_required_timber + site.construction_required_stone;
    let delivered_total = site.construction_delivered_timber + site.construction_delivered_stone;
    let material_readiness = if required_total <= 1e-6 {
        1.0
    } else {
        (delivered_total / required_total).clamp(0.0, 1.0)
    };
    let work_step = if required_total <= 1e-6 {
        1.0
    } else {
        CONSTRUCTION_WORK_PER_WORKER_PER_SEC * site.assigned_labor as f64 * TICK_DT / required_total
    };
    site.construction_progress = (site.construction_progress + work_step).min(material_readiness);

    let timber_ready =
        site.construction_delivered_timber + 1e-6 >= site.construction_required_timber;
    let stone_ready = site.construction_delivered_stone + 1e-6 >= site.construction_required_stone;
    if timber_ready && stone_ready && site.construction_progress >= 1.0 - 1e-6 {
        complete_site(ctx, &mut site);
    }
    ctx.db.building().id().update(site);
}

fn complete_site(ctx: &ReducerContext, site: &mut Building) {
    site.construction_complete = true;
    site.construction_progress = 1.0;
    site.construction_reserved_timber = 0.0;
    site.construction_reserved_stone = 0.0;
    site.construction_treasury_timber = 0.0;
    site.construction_treasury_stone = 0.0;
    site.assigned_labor = 0;

    if site.kind == "pastoral_farmstead"
        && ctx
            .db
            .livestock_herd()
            .building_id()
            .find(&site.id)
            .is_none()
    {
        ctx.db
            .livestock_herd()
            .insert(starter_herd(site.id, site.owner, SPECIES_CATTLE));
    } else if site.kind == "swineherd"
        && ctx
            .db
            .livestock_herd()
            .building_id()
            .find(&site.id)
            .is_none()
    {
        ctx.db
            .livestock_herd()
            .insert(starter_herd(site.id, site.owner, SPECIES_SWINE));
    }
}

fn site_has_inbound_cargo(ctx: &ReducerContext, site_id: u64, commodity: CommodityKind) -> bool {
    ctx.db
        .delivery_trip()
        .target_building_id()
        .filter(&site_id)
        .any(|trip| {
            trip.destination_kind == DELIVERY_DESTINATION_BUILDING
                && trip.cargo_kind == commodity.as_u8()
        })
}

fn available_construction_haulers(ctx: &ReducerContext, owner: spacetimedb::Identity) -> u32 {
    let active_free_haulers: u32 = ctx
        .db
        .delivery_trip()
        .owner()
        .filter(&owner)
        .filter(|trip| {
            if trip.destination_kind != DELIVERY_DESTINATION_BUILDING {
                return false;
            }
            let is_construction_cargo =
                matches!(
                    CommodityKind::from_u8(trip.cargo_kind),
                    Some(CommodityKind::Timber | CommodityKind::Stone)
                ) && (trip.unload_seconds - CONSTRUCTION_DELIVERY_UNLOAD_SEC).abs() <= 1e-6;
            let origin_is_unstaffed = ctx
                .db
                .building()
                .id()
                .find(&trip.building_id)
                .is_some_and(|origin| origin.assigned_labor == 0);
            is_construction_cargo && origin_is_unstaffed
        })
        .map(|trip| trip.delivery_workers)
        .sum();

    available_building_labor(ctx, owner).saturating_sub(active_free_haulers)
}

fn source_priority(source: &Building) -> u8 {
    let kind_priority = match source.kind.as_str() {
        "village_storehouse" => 0,
        "carpenter" => 1,
        "lumber_mill" | "stone_quarry" => 2,
        _ => 3,
    };
    if source.assigned_labor > 0 {
        kind_priority
    } else {
        kind_priority + 4
    }
}

fn squared_distance(ax: f64, az: f64, bx: f64, bz: f64) -> f64 {
    (ax - bx).powi(2) + (az - bz).powi(2)
}
