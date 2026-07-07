const Database = require("better-sqlite3");
const path = require("path");

const DB_PATH = path.join(__dirname, "..", "vrpg.db");
const db = new Database(DB_PATH);

// ── Schema ──
db.exec(`
  CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    class TEXT NOT NULL DEFAULT 'warrior',
    level INTEGER NOT NULL DEFAULT 1,
    xp INTEGER NOT NULL DEFAULT 0,
    gold INTEGER NOT NULL DEFAULT 0,
    hp INTEGER NOT NULL DEFAULT 100,
    max_hp INTEGER NOT NULL DEFAULT 100,
    mana INTEGER NOT NULL DEFAULT 30,
    max_mana INTEGER NOT NULL DEFAULT 30,
    str INTEGER NOT NULL DEFAULT 8,
    dex INTEGER NOT NULL DEFAULT 4,
    int INTEGER NOT NULL DEFAULT 3,
    vit INTEGER NOT NULL DEFAULT 7,
    pos_x REAL DEFAULT 0,
    pos_y REAL DEFAULT 1.6,
    pos_z REAL DEFAULT 0,
    created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
    last_login INTEGER DEFAULT (strftime('%s','now') * 1000)
  );

  CREATE TABLE IF NOT EXISTS inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id TEXT NOT NULL,
    item_type TEXT NOT NULL,
    item_name TEXT NOT NULL,
    rarity TEXT DEFAULT 'common',
    stat_bonus TEXT,
    equipped INTEGER DEFAULT 0,
    FOREIGN KEY (player_id) REFERENCES players(id)
  );
`);

// ── Prepared Statements ──
const stmtGetPlayer = db.prepare("SELECT * FROM players WHERE id = ?");
const stmtInsertPlayer = db.prepare(`
  INSERT INTO players (id, name, class, level, xp, gold, hp, max_hp, mana, max_mana, str, dex, int, vit, pos_x, pos_y, pos_z)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const stmtUpdatePlayer = db.prepare(`
  UPDATE players SET
    name = ?, class = ?, level = ?, xp = ?, gold = ?,
    hp = ?, max_hp = ?, mana = ?, max_mana = ?,
    str = ?, dex = ?, int = ?, vit = ?,
    pos_x = ?, pos_y = ?, pos_z = ?,
    last_login = ?
  WHERE id = ?
`);
const stmtDeletePlayer = db.prepare("DELETE FROM players WHERE id = ?");
const stmtGetInventory = db.prepare("SELECT * FROM inventory WHERE player_id = ?");
const stmtAddItem = db.prepare("INSERT INTO inventory (player_id, item_type, item_name, rarity, stat_bonus, equipped) VALUES (?, ?, ?, ?, ?, ?)");
const stmtEquipItem = db.prepare("UPDATE inventory SET equipped = ? WHERE id = ?");
const stmtDeleteItem = db.prepare("DELETE FROM inventory WHERE id = ?");

module.exports = {
  db,
  getPlayer(id) { return stmtGetPlayer.get(id); },
  createPlayer(id, data) {
    const now = Date.now();
    stmtInsertPlayer.run(
      id, data.name, data.class, data.level || 1, data.xp || 0, data.gold || 0,
      data.hp || 100, data.maxHp || 100, data.mana || 30, data.maxMana || 30,
      data.str || 8, data.dex || 4, data.int || 3, data.vit || 7,
      data.pos?.x || 0, data.pos?.y || 1.6, data.pos?.z || 0
    );
    return { id, ...data, created_at: now, last_login: now };
  },
  savePlayer(id, data) {
    const now = Date.now();
    stmtUpdatePlayer.run(
      data.name, data.class, data.level, data.xp, data.gold,
      data.hp, data.maxHp, data.mana, data.maxMana,
      data.str, data.dex, data.int, data.vit,
      data.pos?.x || 0, data.pos?.y || 1.6, data.pos?.z || 0,
      now, id
    );
  },
  deletePlayer(id) { stmtDeletePlayer.run(id); },
  getInventory(playerId) { return stmtGetInventory.all(playerId); },
  addItem(playerId, item) {
    return stmtAddItem.run(playerId, item.type, item.name, item.rarity, JSON.stringify(item.bonus || {}), item.equipped ? 1 : 0);
  },
  equipItem(itemId, equipped) { stmtEquipItem.run(equipped ? 1 : 0, itemId); },
  removeItem(itemId) { stmtDeleteItem.run(itemId); },
};
