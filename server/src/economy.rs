//! Building costs, salvage rates, and starting stockpile.
//! Quarry yields live in generated world bootstrap data (see client yields.ts).

pub struct ResourceAmount {
    pub wood: f64,
    pub stone: f64,
}

/// Enough for one lumber mill + one stone quarry, plus reserve for early residences.
pub const STARTING_WOOD: f64 = 120.0;
pub const STARTING_STONE: f64 = 140.0;

pub const STONE_SALVAGE_FRACTION: f64 = 0.92;
pub const WOOD_SALVAGE_FRACTION: f64 = 0.70;

pub fn building_cost(kind: &str) -> Result<ResourceAmount, String> {
    match kind {
        "lumber_mill" => Ok(ResourceAmount {
            wood: 45.0,
            stone: 15.0,
        }),
        "reforester" => Ok(ResourceAmount {
            wood: 35.0,
            stone: 10.0,
        }),
        "woodcutters_lodge" => Ok(ResourceAmount {
            wood: 40.0,
            stone: 12.0,
        }),
        "stone_quarry" => Ok(ResourceAmount {
            wood: 25.0,
            stone: 40.0,
        }),
        _ => Err(format!("Unknown building kind: {kind}")),
    }
}

pub fn building_salvage_refund(kind: &str) -> Result<ResourceAmount, String> {
    let cost = building_cost(kind)?;
    Ok(ResourceAmount {
        wood: (cost.wood * WOOD_SALVAGE_FRACTION).round(),
        stone: (cost.stone * STONE_SALVAGE_FRACTION).round(),
    })
}

pub const RESIDENCE_WOOD_COST: f64 = 8.0;
pub const RESIDENCE_STONE_COST: f64 = 12.0;

pub fn residence_zone_cost(residence_count: u32) -> ResourceAmount {
    ResourceAmount {
        wood: RESIDENCE_WOOD_COST * residence_count as f64,
        stone: RESIDENCE_STONE_COST * residence_count as f64,
    }
}

pub fn can_afford(resources: &ResourceAmount, cost: &ResourceAmount) -> bool {
    resources.wood >= cost.wood && resources.stone >= cost.stone
}

pub fn spend(resources: &mut ResourceAmount, cost: &ResourceAmount) -> Result<(), String> {
    if !can_afford(resources, cost) {
        return Err(format!(
            "Not enough resources (need {} wood, {} stone).",
            cost.wood.round() as i64,
            cost.stone.round() as i64
        ));
    }
    resources.wood -= cost.wood;
    resources.stone -= cost.stone;
    Ok(())
}

pub fn credit(resources: &mut ResourceAmount, refund: &ResourceAmount) {
    resources.wood += refund.wood;
    resources.stone += refund.stone;
}
