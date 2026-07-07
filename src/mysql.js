const mysql = require("mysql2/promise");

const POOL = mysql.createPool({
  host: "localhost",
  user: "vrpg",
  password: "vrpg_secret_2026",
  database: "vrpg",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// ── Accounts ──
async function createAccount(username, passwordHash, email = null) {
  const [result] = await POOL.execute(
    "INSERT INTO accounts (username, password_hash, email) VALUES (?, ?, ?)",
    [username, passwordHash, email]
  );
  return result.insertId;
}

async function getAccountByUsername(username) {
  const [rows] = await POOL.execute("SELECT * FROM accounts WHERE username = ?", [username]);
  return rows[0] || null;
}

// ── Characters ──
async function createCharacter(accountId, name, charClass, stats = {}) {
  const base = {
    str: 8, dex: 4, int_stat: 3, vit: 7,
    max_hp: 180, max_mana: 30,
    ...stats,
  };
  const [result] = await POOL.execute(
    `INSERT INTO characters
      (account_id, name, class, str, dex, int_stat, vit, max_hp, max_mana, hp, mana)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [accountId, name, charClass, base.str, base.dex, base.int_stat, base.vit,
     base.max_hp, base.max_mana, base.max_hp, base.max_mana]
  );
  return result.insertId;
}

async function getCharacterByName(name) {
  const [rows] = await POOL.execute("SELECT * FROM characters WHERE name = ?", [name]);
  return rows[0] || null;
}

async function getCharactersByAccount(accountId) {
  const [rows] = await POOL.execute("SELECT * FROM characters WHERE account_id = ?", [accountId]);
  return rows;
}

async function saveCharacter(charId, data) {
  await POOL.execute(
    `UPDATE characters SET
      level = ?, xp = ?, gold = ?, hp = ?, max_hp = ?, mana = ?, max_mana = ?,
      str = ?, dex = ?, int_stat = ?, vit = ?,
      pos_x = ?, pos_y = ?, pos_z = ?, is_online = ?, last_saved = NOW()
     WHERE id = ?`,
    [data.level, data.xp, data.gold, data.hp, data.maxHp, data.mana, data.maxMana,
     data.str, data.dex, data.int, data.vit,
     data.pos?.x || 0, data.pos?.y || 1.6, data.pos?.z || 0,
     data.isOnline ? 1 : 0, charId]
  );
}

async function setCharacterOnline(charId, isOnline) {
  await POOL.execute("UPDATE characters SET is_online = ? WHERE id = ?", [isOnline ? 1 : 0, charId]);
}

// ── Inventory ──
async function getInventory(characterId) {
  const [rows] = await POOL.execute("SELECT * FROM inventory WHERE character_id = ?", [characterId]);
  return rows;
}

async function addItem(characterId, item) {
  const [result] = await POOL.execute(
    "INSERT INTO inventory (character_id, item_type, item_name, rarity, stat_bonus, equipped, quantity) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [characterId, item.type, item.name, item.rarity, JSON.stringify(item.bonus || {}), item.equipped ? 1 : 0, item.quantity || 1]
  );
  return result.insertId;
}

async function equipItem(itemId, equipped) {
  await POOL.execute("UPDATE inventory SET equipped = ? WHERE id = ?", [equipped ? 1 : 0, itemId]);
}

async function removeItem(itemId) {
  await POOL.execute("DELETE FROM inventory WHERE id = ?", [itemId]);
}

// ── World State ──
async function loadWorldState() {
  const [rows] = await POOL.execute("SELECT * FROM world_state WHERE id = 1");
  return rows[0] || null;
}

async function saveWorldState(seed, tickCount) {
  await POOL.execute(
    "INSERT INTO world_state (id, seed, tick_count) VALUES (1, ?, ?) ON DUPLICATE KEY UPDATE seed = ?, tick_count = ?",
    [seed, tickCount, seed, tickCount]
  );
}

module.exports = {
  POOL,
  createAccount, getAccountByUsername,
  createCharacter, getCharacterByName, getCharactersByAccount, saveCharacter, setCharacterOnline,
  getInventory, addItem, equipItem, removeItem,
  loadWorldState, saveWorldState,
};
