//! Chapel coffer gold is stored on `Building.gold` for chapel buildings only.
//! Tithes deposit here first; parish expenses withdraw in-place; overflow and
//! manual collect credit player treasury.

use spacetimedb::ReducerContext;

use crate::balance_generated::CHAPEL_COFFER_CAPACITY;
use crate::db::*;
use crate::economy::credit_treasury_gold;
use crate::economy::parish_accounting::{record_parish_ledger, ParishLedgerKind};
use crate::tables::Building;

pub fn chapel_coffer_gold(building: &Building) -> f64 {
    if building.kind == "chapel" {
        building.gold
    } else {
        0.0
    }
}

pub fn chapel_coffer_capacity() -> f64 {
    CHAPEL_COFFER_CAPACITY
}

pub fn deposit_coffer_in_place(chapel: &mut Building, amount: f64) -> f64 {
    if chapel.kind != "chapel" || amount <= 1e-9 {
        return 0.0;
    }

    let room = (chapel_coffer_capacity() - chapel_coffer_gold(chapel)).max(0.0);
    let deposited = amount.min(room);
    if deposited <= 1e-9 {
        return 0.0;
    }

    chapel.gold += deposited;
    deposited
}

pub fn withdraw_coffer_in_place(chapel: &mut Building, amount: f64) -> f64 {
    if chapel.kind != "chapel" || amount <= 1e-9 {
        return 0.0;
    }

    let withdrawn = amount.min(chapel_coffer_gold(chapel).max(0.0));
    if withdrawn <= 1e-9 {
        return 0.0;
    }

    chapel.gold -= withdrawn;
    withdrawn
}

pub fn clear_coffer_in_place(chapel: &mut Building) -> f64 {
    let collected = chapel_coffer_gold(chapel);
    if chapel.kind == "chapel" {
        chapel.gold = 0.0;
    }
    collected
}

/// Deposit tithe gold into a chapel coffer. Returns amount actually stored.
pub fn deposit_chapel_coffer(ctx: &ReducerContext, chapel_id: u64, amount: f64) -> f64 {
    let Some(mut chapel) = ctx.db.building().id().find(&chapel_id) else {
        return 0.0;
    };

    let deposited = deposit_coffer_in_place(&mut chapel, amount);
    if deposited <= 1e-9 {
        return 0.0;
    }

    ctx.db.building().id().update(chapel);
    deposited
}

pub fn collect_chapel_coffer(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    chapel_id: u64,
) -> Result<f64, String> {
    let chapel = ctx
        .db
        .building()
        .id()
        .find(&chapel_id)
        .ok_or_else(|| "Chapel not found.".to_string())?;

    validate_chapel_owner(&chapel, owner)?;

    let collected = chapel_coffer_gold(&chapel);
    if collected <= 1e-9 {
        return Ok(0.0);
    }

    let mut updated = chapel;
    clear_coffer_in_place(&mut updated);
    ctx.db.building().id().update(updated);
    credit_treasury_gold(ctx, owner, collected);
    record_parish_ledger(ctx, owner, ParishLedgerKind::ManualCollect, collected);
    Ok(collected)
}

fn validate_chapel_owner(chapel: &Building, owner: spacetimedb::Identity) -> Result<(), String> {
    if chapel.owner != owner {
        return Err("You do not own this chapel.".to_string());
    }
    if chapel.kind != "chapel" {
        return Err("Building is not a chapel.".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{chapel_coffer_capacity, chapel_coffer_gold, deposit_coffer_in_place, withdraw_coffer_in_place};
    use crate::tables::Building;

    fn sample_chapel(gold: f64) -> Building {
        Building {
            id: 1,
            owner: spacetimedb::Identity::ZERO,
            kind: "chapel".to_string(),
            x: 0.0,
            z: 0.0,
            work_radius: 0.0,
            action_cooldown: 0.0,
            timber: 0.0,
            firewood: 0.0,
            stone: 0.0,
            water: 0.0,
            food: 0.0,
            grain: 0.0,
            flour: 0.0,
            ale: 0.0,
            preserved_food: 0.0,
            honey: 0.0,
            wine: 0.0,
            water_capacity: 0.0,
            assigned_labor: 1,
            gold,
            storehouse_accepts_timber: true,
            storehouse_accepts_stone: true,
            storehouse_accepts_firewood: true,
        }
    }

    #[test]
    fn coffer_capacity_is_positive() {
        assert!(chapel_coffer_capacity() > 0.0);
    }

    #[test]
    fn non_chapel_reads_zero() {
        let mut building = sample_chapel(12.0);
        building.kind = "well".to_string();
        assert_eq!(chapel_coffer_gold(&building), 0.0);
        assert_eq!(withdraw_coffer_in_place(&mut building, 5.0), 0.0);
    }

    #[test]
    fn withdraw_caps_at_balance() {
        let mut chapel = sample_chapel(3.0);
        assert!((withdraw_coffer_in_place(&mut chapel, 10.0) - 3.0).abs() < 1e-9);
        assert!((chapel_coffer_gold(&chapel)).abs() < 1e-9);
    }

    #[test]
    fn deposit_respects_capacity() {
        let mut chapel = sample_chapel(chapel_coffer_capacity() - 2.0);
        assert!((deposit_coffer_in_place(&mut chapel, 10.0) - 2.0).abs() < 1e-9);
    }
}
