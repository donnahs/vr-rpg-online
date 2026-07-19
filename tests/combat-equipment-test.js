"use strict";

const {
  GameWorld,
  Player,
  Enemy,
  ITEM_TIERS,
  generateEquipment,
  setEquipmentRarity,
} = require("../src/game");

let passed = 0;
let failed = 0;

function assert(condition, label, details = "") {
  if (condition) {
    passed++;
    console.log(`  ✅ ${label}${details ? ` — ${details}` : ""}`);
  } else {
    failed++;
    console.log(`  ❌ ${label}${details ? ` — ${details}` : ""}`);
  }
}

function sequenceRng(values) {
  let index = 0;
  return () => values[index++ % values.length];
}

console.log("=== Combat & Equipment Correctness Regression Test ===\n");

console.log("Test 1: Equipment generation is deterministic with supplied RNG");
const equipmentA = generateEquipment("weapon", sequenceRng([0.9, 0.5]));
const equipmentB = generateEquipment("weapon", sequenceRng([0.9, 0.5]));
assert(JSON.stringify(equipmentA) === JSON.stringify(equipmentB), "Identical RNG sequences generate identical equipment");
assert(equipmentA.rarity === "rare", "Rarity roll uses supplied RNG", `rarity=${equipmentA.rarity}`);
assert(equipmentA.name.includes("(rare)"), "Generated name matches rarity", equipmentA.name);

console.log("\nTest 2: Rarity upgrades keep all equipment metadata coherent");
const baseBonus = equipmentA.bonus.str;
setEquipmentRarity(equipmentA, "epic", 5);
assert(equipmentA.rarity === "epic", "Rarity upgraded to epic");
assert(equipmentA.color === ITEM_TIERS.epic.color, "Colour matches epic tier", equipmentA.color);
assert(equipmentA.name.includes("(epic)"), "Name matches upgraded rarity", equipmentA.name);
assert(equipmentA.bonus.str === baseBonus + 5, "Upgrade bonus applied exactly once", `STR=${equipmentA.bonus.str}`);

console.log("\nTest 3: Equipment swaps clamp current resources to new maxima");
const tank = new Player("tank", "Tank", "warrior");
tank.equipItem({ slot: "armor", name: "Heavy Plate", bonus: { vit: 10 } });
tank.hp = tank.maxHp;
const highMaxHp = tank.maxHp;
tank.equipItem({ slot: "armor", name: "Light Vest", bonus: { vit: 1 } });
assert(tank.maxHp < highMaxHp, "Weaker armour reduces maximum HP", `${highMaxHp} → ${tank.maxHp}`);
assert(tank.hp === tank.maxHp, "Current HP is clamped to reduced maximum", `HP=${tank.hp}/${tank.maxHp}`);

console.log("\nTest 4: Absorb, reduction, and expiry are enforced by takeDamage");
const defender = new Player("defender", "Defender", "warrior");
const hpBefore = defender.hp;
defender.buffs = [
  { type: "shield", absorb: 10, expiresAt: Date.now() + 10000 },
  { type: "shield", reduction: 0.5, expiresAt: Date.now() + 10000 },
  { type: "shield", reduction: 0.9, expiresAt: Date.now() - 1 },
];
const actualDamage = defender.takeDamage(30);
assert(actualDamage === 10, "10 absorb then 50% reduction turns 30 incoming into 10 damage", `actual=${actualDamage}`);
assert(defender.hp === hpBefore - 10, "HP loss matches returned damage");
assert(defender.buffs.length === 1 && defender.buffs[0].reduction === 0.5, "Consumed and expired buffs are removed");

console.log("\nTest 5: Enemy attacks route through Player.takeDamage");
const combatWorld = new GameWorld(101);
combatWorld.enemies.clear();
const target = combatWorld.addPlayer("target", "Target", "warrior");
target.buffs = [{ type: "shield", reduction: 0.5, expiresAt: Date.now() + 10000 }];
const attacker = new Enemy("attacker", target.pos.x, target.pos.z, "orc");
attacker.lastAttack = 0;
combatWorld.enemies.set(attacker.id, attacker);
const targetHpBefore = target.hp;
combatWorld._updateEnemy(attacker, Date.now());
assert(targetHpBefore - target.hp === Math.floor(attacker.damage * 0.5), "Enemy attack respects damage reduction", `lost=${targetHpBefore - target.hp}`);
assert(combatWorld.events[0].text.includes(`for ${Math.floor(attacker.damage * 0.5)}`), "Combat event reports actual mitigated damage", combatWorld.events[0].text);

console.log("\nTest 6: Melee crit flag and damage use one critical decision");
const critWorld = new GameWorld(202);
critWorld.enemies.clear();
const striker = critWorld.addPlayer("striker", "Striker", "rogue");
striker.critChance = 100;
const victim = new Enemy("victim", striker.pos.x, striker.pos.z, "orc");
victim.hp = 9999;
victim.maxHp = 9999;
critWorld.enemies.set(victim.id, victim);
const normalDamage = striker.getMeleeDamage(false);
const critResult = critWorld.playerAttack(striker.id);
assert(critResult.crit === true, "Forced critical hit is reported as critical");
assert(critResult.damage === Math.floor(normalDamage * striker.critMult), "Critical multiplier is applied exactly once", `normal=${normalDamage}, crit=${critResult.damage}`);
assert(victim.hp === 9999 - critResult.damage, "Target HP loss equals reported damage");

console.log("\nTest 7: Lethal enemy attacks perform a complete authoritative respawn");
const respawnWorld = new GameWorld(303);
respawnWorld.enemies.clear();
const fallen = respawnWorld.addPlayer("fallen-player", "Fallen", "mage");
fallen.hp = 1;
fallen.mana = 0;
fallen.buffs = [{ type: "shield", reduction: 0.2, expiresAt: Date.now() + 10000 }];
fallen.stealth = true;
fallen.cooldowns[0] = Date.now() + 5000;
fallen.gold = 77;
const cooldownBeforeDeath = fallen.cooldowns[0];
const killer = new Enemy("killer", fallen.pos.x, fallen.pos.z, "orc");
killer.damage = 100;
killer.lastAttack = 0;
const watcher = new Enemy("watcher", fallen.pos.x + 10, fallen.pos.z, "goblin");
watcher.target = fallen;
watcher.state = "chase";
respawnWorld.enemies.set(killer.id, killer);
respawnWorld.enemies.set(watcher.id, watcher);
respawnWorld._updateEnemy(killer, Date.now());
const onSpawnPoint = respawnWorld.spawnPoints.some((spawn) =>
  spawn.x === fallen.pos.x && spawn.y === fallen.pos.y && spawn.z === fallen.pos.z
);
assert(fallen.deaths === 1, "Death count increments exactly once", `deaths=${fallen.deaths}`);
assert(fallen.hp === fallen.maxHp && fallen.mana === fallen.maxMana, "Respawn fully restores HP and mana", `HP=${fallen.hp}, mana=${fallen.mana}`);
assert(fallen.buffs.length === 0 && fallen.stealth === false, "Respawn clears temporary combat state");
assert(onSpawnPoint, "Respawn moves the player to a valid dungeon spawn point");
assert(killer.target === null && watcher.target === null, "All enemies release the respawned player target");
assert(killer.state === "patrol" && watcher.state === "patrol", "Released enemies return to patrol");
assert(fallen.cooldowns[0] === cooldownBeforeDeath && fallen.gold === 77, "Permanent state and cooldowns survive death");
const serializedFallen = respawnWorld.serialize().players.find((player) => player.id === fallen.id);
assert(serializedFallen.deaths === 1, "Serialized player state exposes death count");
assert(respawnWorld.events.some((event) => event.text.includes("was slain by orc")), "World records the death event");
assert(respawnWorld.events.some((event) => event.text.includes("respawned at the sanctuary")), "World records the respawn event");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  console.log("❌ REGRESSION TESTS FAILED");
  process.exit(1);
}
console.log("✅ ALL REGRESSION TESTS PASSED");
