pub const DEFAULT_WORLD_SEED: u64 = 0x71a2e0d;

pub const TICK_MICROS: i64 = 200_000;
pub const TICK_DT: f64 = 0.2;

pub const LUMBER_MILL_RADIUS: f64 = 210.0;
/// One mature tree every 9s — visible harvest cadence without clearing forests instantly.
pub const LUMBER_MILL_INTERVAL: f64 = 9.0;
pub const LUMBER_MILL_PICK_RADIUS: f64 = 8.0;

pub const REFORESTER_RADIUS: f64 = 190.0;
pub const REFORESTER_PICK_RADIUS: f64 = 8.0;
/// ~71s stump-to-mature; paired with mill interval keeps ~8 trees in regrow per mill.
pub const REFORESTER_REGROW_PER_SEC: f64 = 0.014;

pub const WOODCUTTERS_LODGE_RADIUS: f64 = 0.0;
pub const WOODCUTTERS_LODGE_PICK_RADIUS: f64 = 8.0;

pub const STONE_QUARRY_RADIUS: f64 = 55.0;
pub const STONE_QUARRY_PICK_RADIUS: f64 = 10.0;
/// 3 stone / 9s ≈ 20/min; large quarry (1500) lasts ~75 min of active harvesting.
pub const STONE_QUARRY_INTERVAL: f64 = 9.0;
pub const STONE_PER_HARVEST: f64 = 3.0;
