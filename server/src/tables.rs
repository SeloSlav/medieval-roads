use spacetimedb::Identity;

#[spacetimedb::table(accessor = world_config, public)]
pub struct WorldConfig {
    #[primary_key]
    pub id: u8,
    pub seed: u64,
    pub next_building_id: u64,
    pub sim_tick: u64,
    /// 0 = small, 1 = medium, 2 = large
    #[default(1)]
    pub map_size: u8,
    #[default(50)]
    pub topography: u8,
    #[default(50)]
    pub hydrology: u8,
    #[default(50)]
    pub forest_density: u8,
    /// False until a client publishes generation settings via configure_world.
    #[default(false)]
    pub configured: bool,
}

#[spacetimedb::table(accessor = player_resources, public)]
pub struct PlayerResources {
    #[primary_key]
    pub owner: Identity,
    /// Treasury timber — included in aggregate totals with building storage.
    pub timber: f64,
    pub stone: f64,
    /// Treasury firewood (usually zero; residences and lodges hold stock).
    pub firewood: f64,
    pub water: f64,
    /// Treasury gold from taxed village economic activity.
    #[default(0.0)]
    pub gold: f64,
    /// Treasury food from demolished suppliers and undeposited delivery overflow.
    #[default(0.0)]
    pub food: f64,
    #[default(0.0)]
    pub grain: f64,
    #[default(0.0)]
    pub flour: f64,
    #[default(0.0)]
    pub ale: f64,
    #[default(0.0)]
    pub preserved_food: f64,
    #[default(0.0)]
    pub honey: f64,
    #[default(0.0)]
    pub wine: f64,
    /// Mayor tax rate on village economic activity (0–1 fraction).
    #[default(0.18)]
    pub economic_activity_tax_rate: f64,
    /// Sweep coffer surplus above reserve into treasury on interval.
    #[default(false)]
    pub chapel_auto_sweep_enabled: bool,
    /// Gold kept in coffer for parish operations before auto-sweep.
    #[default(80.0)]
    pub chapel_coffer_reserve_gold: f64,
    /// When true and a staffed chapel exists, villagers rest on Sundays.
    #[default(false)]
    pub sabbath_observance_enabled: bool,
    /// Fraction of parish tithe income transferred to a linked Pauline monastery.
    #[default(0.3)]
    pub monastery_tithe_share: f64,
    /// When true, linked monasteries observe the three annual settlement feast days.
    #[default(true)]
    pub monastery_feasts_enabled: bool,
    /// Lifetime gold manually collected from chapel coffers.
    #[default(0.0)]
    pub parish_manual_collect_total: f64,
    /// Lifetime gold auto-swept from chapel coffers to treasury.
    #[default(0.0)]
    pub parish_auto_sweep_total: f64,
    /// Lifetime priest salary paid from chapel coffers.
    #[default(0.0)]
    pub parish_salary_paid_total: f64,
    /// Lifetime chapel upkeep paid from chapel coffers.
    #[default(0.0)]
    pub parish_upkeep_paid_total: f64,
    /// Lifetime poor-relief charity paid from chapel coffers.
    #[default(0.0)]
    pub parish_charity_paid_total: f64,
    #[default(0.0)]
    pub monastery_tithe_paid_total: f64,
    #[default(0.0)]
    pub monastery_pilgrimage_gold_total: f64,
    #[default(0.0)]
    pub monastery_food_charity_total: f64,
}

#[spacetimedb::table(accessor = quarry, public)]
pub struct Quarry {
    #[primary_key]
    pub quarry_id: String,
    pub x: f64,
    pub z: f64,
    pub max_yield: f64,
    pub remaining: f64,
}

#[spacetimedb::table(accessor = foraging_node, public)]
pub struct ForagingNode {
    #[primary_key]
    pub node_id: String,
    pub node_kind: String,
    pub x: f64,
    pub z: f64,
    pub max_yield: f64,
    pub remaining: f64,
    pub respawn_cooldown: f64,
    pub anchor_x: f64,
    pub anchor_z: f64,
}

#[spacetimedb::table(accessor = tree_entity, public)]
pub struct TreeEntity {
    #[primary_key]
    pub tree_id: String,
    pub layout_index: u32,
    pub phase: String,
    pub growth_progress: f64,
    pub wood_yield: f64,
    pub x: f64,
    pub z: f64,
}

#[spacetimedb::table(accessor = building, public, index(accessor = owner, btree(columns = [owner])))]
#[derive(Clone)]
pub struct Building {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub owner: Identity,
    pub kind: String,
    pub x: f64,
    pub z: f64,
    pub work_radius: f64,
    pub action_cooldown: f64,
    pub timber: f64,
    pub firewood: f64,
    pub stone: f64,
    pub water: f64,
    pub food: f64,
    #[default(0.0)]
    pub grain: f64,
    #[default(0.0)]
    pub flour: f64,
    #[default(0.0)]
    pub ale: f64,
    #[default(0.0)]
    pub preserved_food: f64,
    #[default(0.0)]
    pub honey: f64,
    #[default(0.0)]
    pub wine: f64,
    pub water_capacity: f64,
    pub assigned_labor: u32,
    /// Chapel coffer gold (tithes); other buildings keep this at zero.
    #[default(0.0)]
    pub gold: f64,
}

/// A player-drawn arable parcel worked by a nearby farmstead (`threshing_barn`).
/// Corners are stored clockwise and describe an oriented rectangle authored by the field tool.
#[spacetimedb::table(
    accessor = farm_field,
    public,
    index(accessor = owner, btree(columns = [owner])),
    index(accessor = farmstead_id, btree(columns = [farmstead_id]))
)]
#[derive(Clone)]
pub struct FarmField {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub owner: Identity,
    pub farmstead_id: u64,
    pub corner_ax: f64,
    pub corner_az: f64,
    pub corner_bx: f64,
    pub corner_bz: f64,
    pub corner_cx: f64,
    pub corner_cz: f64,
    pub corner_dx: f64,
    pub corner_dz: f64,
    /// Square meters measured from the authoritative polygon.
    pub area: f64,
    /// Average terrain slope supplied by the deterministic client terrain sampler.
    pub average_slope_degrees: f64,
    /// Groundwater/valley moisture sampled authoritatively from the shared hydrology grid.
    pub moisture: f64,
    /// Persistent soil fertility, depleted by cereals and restored by fallow.
    pub fertility: f64,
    /// 0 = rye, 1 = oats, 2 = fallow.
    pub crop: u8,
    /// Crop scheduled for the next cycle; may be changed while the current crop grows.
    #[default(0u8)]
    pub next_crop: u8,
    /// 0 = ploughing, 1 = sowing, 2 = growing, 3 = harvesting.
    pub stage: u8,
    /// Normalized progress through the current stage.
    pub stage_progress: f64,
    /// 0-3; higher values are worked first by the farmstead.
    #[default(1)]
    pub priority: u8,
    /// Finished harvest cycles, useful for UI and deterministic tests.
    #[default(0u32)]
    pub harvest_count: u32,
    /// Grain from the latest completed harvest.
    #[default(0.0)]
    pub last_yield: f64,
}

#[spacetimedb::table(accessor = road_network_state, public)]
pub struct RoadNetworkState {
    #[primary_key]
    pub owner: Identity,
    pub snapshot_json: String,
}

#[spacetimedb::table(accessor = burgage_zone, public, index(accessor = owner, btree(columns = [owner])))]
pub struct BurgageZone {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub owner: Identity,
    pub corner_ax: f64,
    pub corner_az: f64,
    pub corner_bx: f64,
    pub corner_bz: f64,
    pub corner_cx: f64,
    pub corner_cz: f64,
    pub corner_dx: f64,
    pub corner_dz: f64,
    pub frontage_edge: u8,
    pub plot_count: u32,
}

#[spacetimedb::table(accessor = residence, public, index(accessor = zone_id, btree(columns = [zone_id])), index(accessor = owner, btree(columns = [owner])))]
pub struct Residence {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub zone_id: u64,
    pub owner: Identity,
    pub parcel_index: u32,
    pub x: f64,
    pub z: f64,
    pub yaw: f64,
    pub population: u32,
    pub population_capacity: u32,
    /// 1 = cottage, 2 = house, 3 = prosperous house.
    #[default(1)]
    pub tier: u8,
    pub settlement_ticks: u32,
    pub abandoned: bool,
    /// Gold saved by the household from marketplace garden sales (capped).
    #[default(0.0)]
    pub household_wealth: f64,
    /// Last sim tick this household auto-ordered provender from the marketplace.
    #[default(0u64)]
    pub last_household_market_tick: u64,
}

#[spacetimedb::table(
    accessor = backyard_garden,
    public,
    index(accessor = residence_id, btree(columns = [residence_id])),
    index(accessor = owner, btree(columns = [owner]))
)]
pub struct BackyardGarden {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub residence_id: u64,
    pub owner: Identity,
    /// Matches `BackyardGardenKind` in balance_generated.
    pub kind: u8,
}

/// Simulated regional market prices and neighbor trade conditions for a player.
#[spacetimedb::table(accessor = market_state, public)]
pub struct MarketState {
    #[primary_key]
    pub owner: Identity,
    /// Buy/sell price multipliers per tradable resource (1.0 = base balance price).
    #[default(1.0)]
    pub timber_price_mult: f64,
    #[default(1.0)]
    pub stone_price_mult: f64,
    #[default(1.0)]
    pub firewood_price_mult: f64,
    #[default(1.0)]
    pub food_price_mult: f64,
    /// Simulated neighboring-region supply/demand indices (0–1).
    #[default(0.5)]
    pub regional_timber_supply: f64,
    #[default(0.5)]
    pub regional_stone_supply: f64,
    #[default(0.5)]
    pub regional_firewood_demand: f64,
    #[default(0.5)]
    pub regional_food_demand: f64,
    #[default(0.5)]
    pub regional_food_supply: f64,
    #[default(0u64)]
    pub last_price_tick: u64,
    /// Flavor bulletin for the marketplace UI.
    pub bulletin: String,
}

/// Active road delivery agent — position and phase are authoritative; cargo unloads on arrival.
#[spacetimedb::table(
    accessor = delivery_trip,
    public,
    index(accessor = building_id, btree(columns = [building_id])),
    index(accessor = residence_id, btree(columns = [residence_id])),
    index(accessor = target_building_id, btree(columns = [target_building_id])),
    index(accessor = owner, btree(columns = [owner]))
)]
pub struct DeliveryTrip {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub owner: Identity,
    pub building_id: u64,
    pub residence_id: u64,
    /// 0 = residence delivery, 1 = building supply (see `target_building_id`)
    pub destination_kind: u8,
    /// Lodge or other building receiving a supply haul when `destination_kind == 1`.
    pub target_building_id: u64,
    /// 0 = firewood, 1 = water, 2 = food, 3 = timber, 4+ = expanded commodities.
    pub cargo_kind: u8,
    /// Cargo still on the cart (decreases when unloaded at residence).
    pub amount: f64,
    /// 0 = outbound, 1 = unloading, 2 = inbound
    pub phase: u8,
    pub x: f64,
    pub z: f64,
    /// Meters traveled along the current leg (outbound or inbound).
    pub progress: f64,
    pub speed_mps: f64,
    pub unload_seconds: f64,
    pub unload_remaining: f64,
    pub delivery_workers: u32,
    /// Total road-graph travel distance for the outbound leg (cached at trip start).
    pub path_distance: f64,
    /// Carpenter road-link speed bonus captured when the trip starts.
    pub travel_speed_multiplier: f64,
    /// JSON array of `[x, z]` polyline samples for authoritative movement.
    pub route_polyline_json: String,
}

#[spacetimedb::table(
    accessor = residence_need,
    public,
    index(accessor = residence_id, btree(columns = [residence_id]))
)]
pub struct ResidenceNeed {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub residence_id: u64,
    pub need_kind: u8,
    pub stock: f64,
    pub deficit_ticks: u32,
}
