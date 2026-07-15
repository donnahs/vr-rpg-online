# Night Build Plan — Combat and Equipment Correctness

**Date:** 2026-07-15
**Kanban:** `t_c2b8b73f`
**Primary concern:** Fix gameplay correctness bugs and prove them with regression tests.

## Scope

1. Make equipment rarity rolls use the supplied seeded RNG.
2. Keep equipment name, colour, rarity, and bonus coherent when dungeon depth or boss loot upgrades rarity.
3. Make melee critical-hit damage and the returned `crit` flag come from one roll.
4. Route enemy attacks through `Player.takeDamage()` so Iron Skin and Arcane Shield work.
5. Consume absorb shields, remove expired buffs, and clamp HP/mana after equipment swaps reduce maxima.
6. Add a standalone Node regression suite and expose a single `npm test` command for all tests.
7. Verify syntax, all tests, and live HTTP health/world endpoints.

## Acceptance Criteria

- Seeded equipment generation returns identical equipment for identical RNG sequences.
- Upgraded drops have names/colours matching their rarity.
- A forced crit reports `crit: true` and applies exactly one critical multiplier.
- Enemy attacks respect reduction and absorb buffs.
- Swapping high-VIT armour for weaker armour never leaves HP above max HP.
- `npm test` exits 0.
- `/health` and `/api/world` return HTTP 200 from the running server.
