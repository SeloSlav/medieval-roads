//! Simulated regional market — price multipliers drift from neighbor trade and local demand.

use spacetimedb::{Identity, ReducerContext};

use crate::balance_generated::{
    TradeResource, CALENDAR_SECONDS_PER_DAY, MARKET_LOCAL_FOOD_DEMAND_WEIGHT,
    MARKET_PRICE_MULTIPLIER_MAX, MARKET_PRICE_MULTIPLIER_MIN, MARKET_PRICE_UPDATE_INTERVAL_TICKS,
    MARKET_REGIONAL_INDEX_DRIFT, RESIDENCE_FOOD_PER_PERSON_PER_SEC,
};
use crate::db::*;
use crate::simulation::residence_needs::{load_needs, need_stock, ResidenceNeedKind};
use crate::tables::MarketState;

pub fn ensure_market_state(ctx: &ReducerContext, owner: Identity) {
    if ctx.db.market_state().owner().find(&owner).is_some() {
        return;
    }
    ctx.db.market_state().insert(MarketState {
        owner,
        timber_price_mult: 1.0,
        stone_price_mult: 1.0,
        firewood_price_mult: 1.0,
        food_price_mult: 1.0,
        regional_timber_supply: 0.5,
        regional_stone_supply: 0.5,
        regional_firewood_demand: 0.5,
        regional_food_demand: 0.5,
        regional_food_supply: 0.5,
        last_price_tick: 0,
        bulletin: "Caravans from Kvarner and Lika report steady trade.".to_string(),
    });
}

pub fn price_multiplier_for(state: &MarketState, resource: TradeResource) -> f64 {
    match resource {
        TradeResource::Timber => state.timber_price_mult,
        TradeResource::Stone => state.stone_price_mult,
        TradeResource::Firewood => state.firewood_price_mult,
        TradeResource::Food => state.food_price_mult,
    }
}

pub fn scaled_gold_cost(base: f64, multiplier: f64) -> f64 {
    (base * multiplier).ceil().max(1.0)
}

pub fn scaled_gold_yield(base: f64, multiplier: f64) -> f64 {
    (base * multiplier).floor().max(0.0)
}

pub fn step_regional_markets(ctx: &ReducerContext, sim_tick: u64) {
    let owners: Vec<Identity> = ctx
        .db
        .player_resources()
        .iter()
        .map(|row| row.owner)
        .collect();

    for owner in owners {
        ensure_market_state(ctx, owner);
        let Some(mut state) = ctx.db.market_state().owner().find(&owner) else {
            continue;
        };
        if sim_tick.saturating_sub(state.last_price_tick) < MARKET_PRICE_UPDATE_INTERVAL_TICKS {
            continue;
        }
        update_market_state(ctx, owner, sim_tick, &mut state);
        ctx.db.market_state().owner().update(state);
    }
}

fn update_market_state(
    ctx: &ReducerContext,
    owner: Identity,
    sim_tick: u64,
    state: &mut MarketState,
) {
    let seed = sim_tick.wrapping_mul(0x9E37_79B9).wrapping_add(hash_identity(owner));

    state.regional_timber_supply =
        drift_index(state.regional_timber_supply, seed.wrapping_add(1));
    state.regional_stone_supply = drift_index(state.regional_stone_supply, seed.wrapping_add(2));
    state.regional_firewood_demand =
        drift_index(state.regional_firewood_demand, seed.wrapping_add(3));
    state.regional_food_demand = drift_index(state.regional_food_demand, seed.wrapping_add(4));
    state.regional_food_supply = drift_index(state.regional_food_supply, seed.wrapping_add(5));

    let local_food_pressure = local_food_demand_pressure(ctx, owner);
    state.timber_price_mult = clamp_multiplier(price_from_supply_demand(
        state.regional_timber_supply,
        1.0 - state.regional_timber_supply,
    ));
    state.stone_price_mult = clamp_multiplier(price_from_supply_demand(
        state.regional_stone_supply,
        1.0 - state.regional_stone_supply,
    ));
    state.firewood_price_mult = clamp_multiplier(price_from_supply_demand(
        1.0 - state.regional_firewood_demand,
        state.regional_firewood_demand,
    ));
    let food_demand = (state.regional_food_demand * (1.0 - MARKET_LOCAL_FOOD_DEMAND_WEIGHT)
        + local_food_pressure * MARKET_LOCAL_FOOD_DEMAND_WEIGHT)
        .clamp(0.0, 1.0);
    state.food_price_mult =
        clamp_multiplier(price_from_supply_demand(state.regional_food_supply, food_demand));

    state.bulletin = compose_bulletin(state);
    state.last_price_tick = sim_tick;
}

fn local_food_demand_pressure(ctx: &ReducerContext, owner: Identity) -> f64 {
    let mut runway_days_sum = 0.0;
    let mut active = 0u32;

    for residence in ctx.db.residence().owner().filter(&owner) {
        if residence.abandoned || residence.population == 0 {
            continue;
        }
        let needs = load_needs(ctx, residence.id);
        let stock = need_stock(&needs, ResidenceNeedKind::Food);
        let use_per_sec = residence.population as f64 * RESIDENCE_FOOD_PER_PERSON_PER_SEC;
        if use_per_sec <= 1e-9 {
            continue;
        }
        let runway_sec = stock / use_per_sec;
        let runway_days = runway_sec / CALENDAR_SECONDS_PER_DAY;
        runway_days_sum += runway_days;
        active += 1;
    }

    if active == 0 {
        return 0.5;
    }

    let avg_runway_days = runway_days_sum / active as f64;
    // Low runway (< 0.5 days) pushes demand toward 1.0; comfortable stocks (> 4 days) toward 0.15.
    if avg_runway_days <= 0.5 {
        1.0
    } else if avg_runway_days >= 4.0 {
        0.15
    } else {
        1.0 - (avg_runway_days - 0.5) / 3.5 * 0.85
    }
}

fn drift_index(current: f64, seed: u64) -> f64 {
    let roll = hash_to_unit(seed);
    let delta = (roll - 0.5) * 2.0 * MARKET_REGIONAL_INDEX_DRIFT;
    (current + delta).clamp(0.05, 0.95)
}

fn price_from_supply_demand(supply: f64, demand: f64) -> f64 {
    let imbalance = demand - supply;
    1.0 + imbalance * 0.55
}

fn clamp_multiplier(value: f64) -> f64 {
    value.clamp(MARKET_PRICE_MULTIPLIER_MIN, MARKET_PRICE_MULTIPLIER_MAX)
}

fn compose_bulletin(state: &MarketState) -> String {
    if state.food_price_mult >= 1.18 {
        return "Lamb and veal scarce in the highlands — provender prices are up.".to_string();
    }
    if state.food_price_mult <= 0.88 {
        return "A surplus harvest reached Kvarner — food imports are cheap this week.".to_string();
    }
    if state.timber_price_mult >= 1.15 {
        return "Timber merchants from Lika are paying well for oak.".to_string();
    }
    if state.stone_price_mult <= 0.85 {
        return "Quarry wagons from the coast flooded the stone market.".to_string();
    }
    if state.regional_firewood_demand >= 0.72 {
        return "Cold snaps inland are driving firewood demand.".to_string();
    }
    "Caravans from Kvarner and the nearby highlands report steady trade.".to_string()
}

fn hash_identity(owner: Identity) -> u64 {
    let bytes = owner.to_byte_array();
    u64::from_le_bytes(bytes[0..8].try_into().unwrap_or([0; 8]))
}

fn hash_to_unit(seed: u64) -> f64 {
    let mixed = seed.wrapping_mul(0x517CC1B7_27220A95);
    (mixed % 10_000) as f64 / 10_000.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scaled_gold_cost_rounds_up() {
        assert_eq!(scaled_gold_cost(10.0, 1.21), 13.0);
    }

    #[test]
    fn price_from_supply_demand_balanced_is_neutral() {
        assert!((price_from_supply_demand(0.5, 0.5) - 1.0).abs() < 1e-6);
    }
}
