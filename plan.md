# Night Build Plan — Player Death & Respawn Hardening

**Date:** 2026-07-19
**Kanban:** `t_779a89e3`
**Primary concern:** Make player death and respawn server-authoritative, complete, observable, and regression-tested.

## Scope

1. Track player deaths and expose the count in serialized player/world state.
2. Centralize respawn behavior in `GameWorld` instead of mutating a subset of player fields inside enemy AI.
3. On death, restore HP and mana, clear temporary buffs and stealth, move to a deterministic valid dungeon spawn, and detach enemy targets.
4. Preserve cooldowns/equipment/progression so death cannot reset combat cooldowns or erase permanent state.
5. Add regression coverage for lethal attacks, respawn state, death count, enemy target reset, serialized output, and event text.
6. Run syntax checks, the full npm test suite, and live HTTP checks for `/health` and `/api/world`.
7. Commit the verified changes.

## Acceptance Criteria

- A lethal enemy hit increments `deaths` exactly once.
- Respawn restores `hp === maxHp` and `mana === maxMana`.
- Respawn clears temporary buffs and stealth without clearing equipment, XP, gold, or skill cooldowns.
- Respawn position is one of the current dungeon's spawn points.
- Enemies no longer retain a target reference to the respawned player.
- Serialized player state includes the current death count.
- Combat events record both the killing blow and respawn.
- `npm test` exits 0.
- Live `/health` and `/api/world` return HTTP 200.
