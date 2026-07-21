#!/usr/bin/env node
/**
 * Death Persistence Regression Test
 * Verifies that player deaths are saved to and loaded from MySQL.
 */

const mysql = require('../src/mysql.js');

function assert(cond, msg, detail = '') {
  if (cond) {
    console.log(`   ✅ ${msg}`);
  } else {
    console.log(`   ❌ ${msg} ${detail}`);
    process.exitCode = 1;
  }
}

async function run() {
  console.log('=== Death Persistence Regression Test ===\n');

  // Clean up any prior test character
  try {
    await mysql.POOL.execute("DELETE FROM vrpg.characters WHERE name = 'TestDeathHero'");
  } catch (e) {}

  // 1. Create a character using account_id=1 (test account exists)
  const charId = await mysql.createCharacter(1, 'TestDeathHero', 'warrior');
  assert(charId > 0, 'Character created in MySQL', `id=${charId}`);

  // 2. Load it back — deaths should be 0
  let dbChar = await mysql.getCharacterByName('TestDeathHero');
  assert(dbChar.deaths === 0, 'New character has 0 deaths', `deaths=${dbChar.deaths}`);

  // 3. Simulate a death by updating via saveCharacter
  await mysql.saveCharacter(charId, {
    name: dbChar.name, class: dbChar.class, level: dbChar.level, xp: dbChar.xp, gold: dbChar.gold,
    hp: dbChar.hp, maxHp: dbChar.max_hp, mana: dbChar.mana, maxMana: dbChar.max_mana,
    str: dbChar.str, dex: dbChar.dex, int: dbChar.int_stat, vit: dbChar.vit, deaths: 1,
    pos: { x: dbChar.pos_x, y: dbChar.pos_y, z: dbChar.pos_z }, isOnline: true,
  });

  // 4. Reload and verify death persisted
  dbChar = await mysql.getCharacterByName('TestDeathHero');
  assert(dbChar.deaths === 1, 'Death count persisted after save', `deaths=${dbChar.deaths}`);

  // 5. Simulate multiple deaths
  await mysql.saveCharacter(charId, {
    name: dbChar.name, class: dbChar.class, level: dbChar.level, xp: dbChar.xp, gold: dbChar.gold,
    hp: dbChar.hp, maxHp: dbChar.max_hp, mana: dbChar.mana, maxMana: dbChar.max_mana,
    str: dbChar.str, dex: dbChar.dex, int: dbChar.int_stat, vit: dbChar.vit, deaths: 5,
    pos: { x: dbChar.pos_x, y: dbChar.pos_y, z: dbChar.pos_z }, isOnline: true,
  });
  dbChar = await mysql.getCharacterByName('TestDeathHero');
  assert(dbChar.deaths === 5, 'Multiple deaths persisted correctly', `deaths=${dbChar.deaths}`);

  // 6. Cleanup
  await mysql.POOL.execute("DELETE FROM vrpg.characters WHERE name = 'TestDeathHero'");
  console.log('   ✅ Test character cleaned up');

  await mysql.POOL.end();
  console.log('\n=== Results: Death persistence tests passed ===');
}

run().catch((err) => {
  console.error('Test error:', err.message);
  process.exitCode = 1;
});
