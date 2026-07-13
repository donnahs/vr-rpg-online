"use strict";
/**
 * Dungeon Progression System Test
 * Verifies: floor clearing, depth scaling, enemy stat growth, loot scaling
 */

const { GameWorld, Vec3, Enemy } = require("../src/game");

let pass = 0, fail = 0;

function assert(cond, msg) {
  if (cond) { pass++; console.log(`  ✅ ${msg}`); }
  else { fail++; console.log(`  ❌ ${msg}`); }
}

console.log("=== Dungeon Progression System Test ===\n");

// ── Test 1: Initial state ──
console.log("Test 1: Initial dungeon state");
const world = new GameWorld(42);
assert(world.dungeonDepth === 1, "Dungeon starts at depth 1");
assert(world.enemies.size > 0, "Dungeon has enemies on start");
assert(world._floorCleared === false, "Floor is not cleared initially");
console.log(`  Enemies on floor 1: ${world.enemies.size}`);

// ── Test 2: Depth scaling of enemy stats ──
console.log("\nTest 2: Enemy stat scaling with depth");
const goblinFloor1 = new Enemy("e1", 0, 0, "goblin", false, 1);
const goblinFloor3 = new Enemy("e2", 0, 0, "goblin", false, 3);
const goblinFloor5 = new Enemy("e3", 0, 0, "goblin", false, 5);
assert(goblinFloor3.hp > goblinFloor1.hp, `Floor 3 goblin HP (${goblinFloor3.hp}) > Floor 1 (${goblinFloor1.hp})`);
assert(goblinFloor5.hp > goblinFloor3.hp, `Floor 5 goblin HP (${goblinFloor5.hp}) > Floor 3 (${goblinFloor3.hp})`);
assert(goblinFloor5.damage > goblinFloor1.damage, `Floor 5 goblin damage (${goblinFloor5.damage}) > Floor 1 (${goblinFloor1.damage})`);
assert(goblinFloor5.attackCooldown < goblinFloor1.attackCooldown, `Floor 5 goblin attacks faster (${goblinFloor5.attackCooldown}ms) than Floor 1 (${goblinFloor1.attackCooldown}ms)`);

// ── Test 3: Boss scaling with depth ──
console.log("\nTest 3: Boss stat scaling with depth");
const bossFloor1 = new Enemy("b1", 0, 0, "demon", true, 1);
const bossFloor5 = new Enemy("b2", 0, 0, "demon", true, 5);
assert(bossFloor5.hp > bossFloor1.hp, `Floor 5 boss HP (${bossFloor5.hp}) > Floor 1 (${bossFloor1.hp})`);
assert(bossFloor5.damage > bossFloor1.damage, `Floor 5 boss damage (${bossFloor5.damage}) > Floor 1 (${bossFloor1.damage})`);
assert(bossFloor5.color === "#ff0066", `Floor 5 boss has menacing color: ${bossFloor5.color}`);

// ── Test 4: Floor clears when all enemies defeated ──
console.log("\nTest 4: Floor clearing triggers progression");
const world2 = new GameWorld(99);
const initialEnemyCount = world2.enemies.size;
console.log(`  Initial enemies: ${initialEnemyCount}`);
// Simulate killing all enemies
world2.enemies.clear();
world2._checkFloorCleared();
assert(world2._floorCleared === true, "Floor marked as cleared when enemies.size === 0");
assert(world2.dungeonDepth === 1, "Depth still 1 immediately after clear (3s delay before advance)");

// ── Test 5: Floor advance after delay ──
console.log("\nTest 5: Dungeon advances after clear");
world2._advanceDungeon();
assert(world2.dungeonDepth === 2, `Depth incremented to 2 after advance (got ${world2.dungeonDepth})`);
assert(world2.enemies.size > 0, "New floor has enemies");
assert(world2._floorCleared === false, "Floor cleared flag reset on new floor");
const floor2EnemyCount = world2.enemies.size;
console.log(`  Floor 2 enemies: ${floor2EnemyCount}`);
assert(floor2EnemyCount >= 7, `Floor 2 has more enemies than base 6 (got ${floor2EnemyCount})`);

// ── Test 6: Serialize includes dungeon depth ──
console.log("\nTest 6: Serialization includes progression data");
const serialized = world2.serialize();
assert(serialized.dungeonDepth === 2, `Serialized depth = 2 (got ${serialized.dungeonDepth})`);
assert(typeof serialized.enemyCount === "number", "Serialized enemyCount is a number");
assert(serialized.enemyCount === world2.enemies.size, `Serialized enemyCount matches actual (${serialized.enemyCount})`);

// ── Test 7: Players get HP heal on floor advance ──
console.log("\nTest 7: Player HP heal on floor advance");
const world3 = new GameWorld(77);
world3.addPlayer("p_test", "TestHero", "warrior", {});
const p = world3.players.get("p_test");
p.hp = Math.floor(p.maxHp * 0.3); // Set HP to 30%
const hpBefore = p.hp;
world3.enemies.clear();
world3._advanceDungeon();
const hpAfter = p.hp;
assert(hpAfter > hpBefore, `Player HP increased after floor advance (${hpBefore} → ${hpAfter})`);
const expectedHeal = Math.floor(p.maxHp * 0.25);
assert(hpAfter - hpBefore === expectedHeal, `Heal amount = 25% maxHP (${expectedHeal}), got ${hpAfter - hpBefore}`);

// ── Test 8: Multiple floor advances scale correctly ──
console.log("\nTest 8: Multiple floor advances");
const world4 = new GameWorld(123);
for (let i = 0; i < 4; i++) {
  world4.enemies.clear();
  world4._advanceDungeon();
}
assert(world4.dungeonDepth === 5, `After 4 advances, depth = 5 (got ${world4.dungeonDepth})`);
const depth5Enemies = Array.from(world4.enemies.values());
const hasBoss = depth5Enemies.some(e => e.isBoss);
assert(hasBoss, "Floor 5 has a boss");
const normalEnemies = depth5Enemies.filter(e => !e.isBoss);
assert(normalEnemies.length >= 10, `Floor 5 has ≥10 normal enemies (got ${normalEnemies.length})`);

// ── Test 9: Enemy toDict includes depth ──
console.log("\nTest 9: Enemy toDict includes depth field");
const e = new Enemy("test_e", 0, 0, "goblin", false, 3);
const eDict = e.toDict();
assert(eDict.depth === 3, `Enemy toDict depth = 3 (got ${eDict.depth})`);

// ── Results ──
console.log(`\n=== Results: ${pass} passed, ${fail} failed ===`);
if (fail > 0) {
  console.log("❌ SOME TESTS FAILED");
  process.exit(1);
} else {
  console.log("✅ ALL TESTS PASSED");
  process.exit(0);
}