# Night Build Plan — Finalize Procedural Dungeon Hardening

**Date:** 2026-07-17
**Kanban:** `t_7a727cf9`
**Primary concern:** Audit, regression-test, live-verify, and commit the procedural dungeon implementation left uncommitted by the prior night build.

## Scope

1. Scale grid dimensions and room count with dungeon depth while retaining safe caps.
2. Assign start, boss, and treasure room roles; spawn the boss in the designated boss room.
3. Serialize dungeon seed/revision/dimensions/room metadata for clients and diagnostics.
4. Remove stale client wall meshes when a regenerated floor replaces the previous layout.
5. Replace the smoke-only dungeon test with regression assertions for determinism, connectivity, room roles, floor-only entities, depth scaling, and serialized metadata.
6. Verify syntax, the complete npm test suite, and live `/health` plus `/api/world` responses.
7. Keep the client floor plane aligned with the positive-coordinate dungeon as dimensions grow.

## Acceptance Criteria

- Identical seeds and depth produce identical room/floor/wall layouts.
- Every generated floor tile is reachable from the start room.
- Every dungeon has exactly one start room and one boss room, with the boss inside its assigned room.
- A deeper floor has a larger layout target and at least as many rooms as floor 1.
- Regenerated layouts expose a changed `dungeonRevision`, and clients remove walls absent from the latest state.
- The visual floor is sized and centred from serialized dungeon dimensions rather than remaining centred at the world origin.
- `npm test` exits 0.
- Live `/health` and `/api/world` return HTTP 200 and world metadata contains the procedural dungeon fields.
