use spacetimedb::{reducer, ReducerContext};

use crate::constants::DEFAULT_WORLD_SEED;
use crate::db::*;
use crate::tables::WorldConfig;
use crate::world_entities::{clear_global_world_entities, has_global_world_entities};

const MAP_SIZE_SMALL: u8 = 0;
const MAP_SIZE_MEDIUM: u8 = 1;
const MAP_SIZE_LARGE: u8 = 2;

#[reducer]
pub fn configure_world(
    ctx: &ReducerContext,
    seed: u64,
    map_size: u8,
    topography: u8,
    hydrology: u8,
    forest_density: u8,
) -> Result<(), String> {
    validate_map_size(map_size)?;
    validate_percent(topography, "topography")?;
    validate_percent(hydrology, "hydrology")?;
    validate_percent(forest_density, "forest_density")?;

    let config = ctx
        .db
        .world_config()
        .id()
        .find(&0)
        .ok_or_else(|| "world_config row missing".to_string())?;

    let generation_changed = config.seed != seed
        || config.map_size != map_size
        || config.topography != topography
        || config.hydrology != hydrology
        || config.forest_density != forest_density;

    // Only lock generation after a client has published settings. The sim scheduler
    // may be running while configured=false (e.g. idle server before first connect).
    if generation_changed && config.configured && config.sim_tick > 0 {
        return Err("Cannot change world generation after the simulation has started.".into());
    }

    if generation_changed && has_global_world_entities(ctx) {
        clear_global_world_entities(ctx);
    }

    if generation_changed || !config.configured {
        ctx.db.world_config().id().update(WorldConfig {
            seed,
            map_size,
            topography,
            hydrology,
            forest_density,
            configured: true,
            // Repair idle ticks that ran before the first client published settings.
            sim_tick: if !config.configured { 0 } else { config.sim_tick },
            ..config
        });
    }

    Ok(())
}

fn validate_map_size(map_size: u8) -> Result<(), String> {
    if map_size == MAP_SIZE_SMALL || map_size == MAP_SIZE_MEDIUM || map_size == MAP_SIZE_LARGE {
        return Ok(());
    }
    Err(format!("map_size must be {MAP_SIZE_SMALL}, {MAP_SIZE_MEDIUM}, or {MAP_SIZE_LARGE}"))
}

fn validate_percent(value: u8, label: &str) -> Result<(), String> {
    if value <= 100 {
        return Ok(());
    }
    Err(format!("{label} must be between 0 and 100"))
}

pub fn default_world_config() -> WorldConfig {
    WorldConfig {
        id: 0,
        seed: DEFAULT_WORLD_SEED,
        next_building_id: 1,
        sim_tick: 0,
        map_size: MAP_SIZE_MEDIUM,
        topography: 50,
        hydrology: 50,
        forest_density: 50,
        configured: false,
    }
}
