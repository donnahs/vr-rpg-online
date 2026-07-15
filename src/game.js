"use strict";
/**
 * VR RPG Online — Game World Engine
 * Authoritative server-side simulation (Node.js)
 */

const TILE_SIZE = 2.0;

function Vec3(x = 0, y = 0, z = 0) {
  return { x: +x, y: +y, z: +z };
}

function dist(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return Math.sqrt(dx*dx + dy*dy + dz*dz);
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

const ITEM_TIERS = {
  common:    { color: "#95a5a6", chance: 0.55, statRange: [1, 3] },
  uncommon:  { color: "#2ecc71", chance: 0.30, statRange: [2, 5] },
  rare:      { color: "#3498db", chance: 0.12, statRange: [4, 8] },
  epic:      { color: "#9b59b6", chance: 0.03, statRange: [6, 12] },
};

const EQUIPMENT_TYPES = {
  weapon: {
    names: ["Rusty Blade", "Iron Sword", "Steel Katana", "Enchanted Dagger", "Dragon Slayer"],
    slot: "weapon",
    stat: "str",
    baseBonus: 2,
  },
  armor: {
    names: ["Cloth Tunic", "Leather Vest", "Chainmail", "Plate Armor", "Shadow Cloak"],
    slot: "armor",
    stat: "vit",
    baseBonus: 2,
  },
  ring: {
    names: ["Copper Band", "Silver Ring", "Gold Signet", "Ruby Band", "Arcane Loop"],
    slot: "ring",
    stat: "dex",
    baseBonus: 1,
  },
};

function rollRarity(rng = Math.random) {
  const roll = rng();
  let cum = 0;
  for (const [name, tier] of Object.entries(ITEM_TIERS)) {
    cum += tier.chance;
    if (roll <= cum) return name;
  }
  return "common";
}

function setEquipmentRarity(equipment, rarity, bonusIncrease = 0) {
  const tier = ITEM_TIERS[rarity];
  const def = EQUIPMENT_TYPES[equipment.slot];
  if (!tier || !def) return equipment;

  equipment.rarity = rarity;
  equipment.color = tier.color;
  const nameIndex = Math.min(
    Object.keys(ITEM_TIERS).indexOf(rarity),
    def.names.length - 1
  );
  equipment.name = `${def.names[nameIndex]} (${rarity})`;

  const statKey = Object.keys(equipment.bonus || {})[0];
  if (statKey && bonusIncrease) equipment.bonus[statKey] += bonusIncrease;
  return equipment;
}

function generateEquipment(type, rng = Math.random) {
  const def = EQUIPMENT_TYPES[type];
  if (!def) throw new Error(`Unknown equipment type: ${type}`);
  const rarity = rollRarity(rng);
  const tier = ITEM_TIERS[rarity];
  const [min, max] = tier.statRange;
  const bonus = Math.floor(rng() * (max - min + 1)) + min;
  const nameIndex = Math.min(
    Object.keys(ITEM_TIERS).indexOf(rarity),
    def.names.length - 1
  );
  return {
    type: "equipment",
    slot: def.slot,
    name: `${def.names[nameIndex]} (${rarity})`,
    rarity,
    bonus: { [def.stat]: def.baseBonus + bonus },
    color: tier.color,
  };
}
function pickColor(pid) {
  const colors = ["#e74c3c","#3498db","#2ecc71","#f39c12","#9b59b6","#1abc9c","#e91e63","#00bcd4"];
  let h = 0;
  for (let i = 0; i < pid.length; i++) h = ((h * 31) + pid.charCodeAt(i)) % colors.length;
  return colors[h];
}

const CLASS_STATS = {
  warrior: { str: 8, dex: 4, int: 3, vit: 7, hp: 180, mana: 30, speed: 3.0, color: "#e74c3c" },
  rogue:   { str: 4, dex: 8, int: 4, vit: 5, hp: 130, mana: 50, speed: 4.0, color: "#f39c12" },
  mage:    { str: 3, dex: 4, int: 8, vit: 4, hp: 100, mana: 100, speed: 3.2, color: "#3498db" },
};

const CLASS_SKILLS = {
  warrior: {
    active: [
      { name: "Heavy Strike", key: "1", cooldown: 3000, cost: 0, type: "melee", multiplier: 2.0, stun: 1000 },
      { name: "Taunt", key: "2", cooldown: 8000, cost: 0, type: "aoe", radius: 6, duration: 4000 },
      { name: "Iron Skin", key: "3", cooldown: 15000, cost: 0, type: "buff", duration: 5000, reduction: 0.5 },
    ],
    passive: { name: "Cleave", chance: 0.25 },
  },
  rogue: {
    active: [
      { name: "Backstab", key: "1", cooldown: 4000, cost: 15, type: "melee", multiplier: 3.0, behind: true },
      { name: "Dash", key: "2", cooldown: 6000, cost: 10, type: "dash", distance: 4 },
      { name: "Smoke Bomb", key: "3", cooldown: 12000, cost: 20, type: "stealth", duration: 3000 },
    ],
    passive: { name: "Critical Eye", critMult: 2.5 },
  },
  mage: {
    active: [
      { name: "Fireball", key: "1", cooldown: 2000, cost: 15, type: "ranged", multiplier: 1.5, splash: 2.5 },
      { name: "Frost Nova", key: "2", cooldown: 10000, cost: 30, type: "aoe", radius: 4, freeze: 2000 },
      { name: "Arcane Shield", key: "3", cooldown: 15000, cost: 25, type: "shield", absorb: "int", duration: 5000 },
    ],
    passive: { name: "Mana Regen", regen: 2 },
  },
};

class Player {
  constructor(pid, name, charClass = "warrior", bonusStats = {}, dbChar = null) {
    const base = CLASS_STATS[charClass] || CLASS_STATS.warrior;
    this.id = pid;
    this.name = (name || "Hero").trim().slice(0, 18) || "Hero";
    this.class = charClass;
    this.pos = Vec3(0, 1.6, 0);
    this.rot = Vec3(0, 0, 0);
    
    if (dbChar) {
      // Load from database
      this.str = dbChar.str;
      this.dex = dbChar.dex;
      this.int = dbChar.int_stat;
      this.vit = dbChar.vit;
      this.level = dbChar.level;
      this.xp = dbChar.xp;
      this.gold = dbChar.gold;
      this.hp = dbChar.hp;
      this.maxHp = dbChar.max_hp;
      this.mana = dbChar.mana;
      this.maxMana = dbChar.max_mana;
      this.pos = Vec3(dbChar.pos_x, dbChar.pos_y, dbChar.pos_z);
    } else {
      // New character
      this.str = base.str + (bonusStats.str || 0);
      this.dex = base.dex + (bonusStats.dex || 0);
      this.int = base.int + (bonusStats.int || 0);
      this.vit = base.vit + (bonusStats.vit || 0);
      this.level = 1;
      this.xp = 0;
      this.gold = 0;
      this.maxHp = base.hp + this.vit * 15;
      this.hp = this.maxHp;
      this.maxMana = base.mana + this.int * 10;
      this.mana = this.maxMana;
    }
    
    this.speed = base.speed + (this.dex - 5) * 0.15;
    this.critChance = Math.min(this.dex * 0.5, 35);
    this.critMult = CLASS_SKILLS[charClass]?.passive?.critMult || 2.0;
    this.dodgeChance = Math.min(this.dex * 0.3, 25);
    
    this.skills = CLASS_SKILLS[charClass]?.active || [];
    this.passive = CLASS_SKILLS[charClass]?.passive || null;
    this.cooldowns = {};
    this.buffs = [];
    this.stealth = false;
    
    this.inVR = false;
    this.controllerLeft = { pos: Vec3(-0.2, 1.2, -0.3), rot: Vec3() };
    this.controllerRight = { pos: Vec3(0.2, 1.2, -0.3), rot: Vec3() };
    this.inventory = [];
    this.equipment = {
      weapon: null,
      armor: null,
      ring: null,
    };
    this.kills = 0;
    this.lastUpdate = Date.now();
    this.connectedAt = Date.now();
    this.color = base.color;
  }
  
  getEquipBonus(stat) {
    let bonus = 0;
    for (const slot of Object.values(this.equipment)) {
      if (slot && slot.bonus && slot.bonus[stat]) bonus += slot.bonus[stat];
    }
    return bonus;
  }
  
  recalculateStats() {
    const wBonus = this.getEquipBonus("str");
    const aBonus = this.getEquipBonus("vit");
    const rBonus = this.getEquipBonus("dex");
    
    // Update derived stats based on base + equipment
    this.maxHp = (this.class === "warrior" ? 180 : this.class === "rogue" ? 130 : 100) + (this.vit + aBonus) * 15;
    this.maxMana = (this.class === "warrior" ? 30 : this.class === "rogue" ? 50 : 100) + (this.int + this.getEquipBonus("int")) * 10;
    this.critChance = Math.min((this.dex + rBonus) * 0.5, 35);
    this.dodgeChance = Math.min((this.dex + rBonus) * 0.3, 25);
    this.hp = Math.min(this.hp, this.maxHp);
    this.mana = Math.min(this.mana, this.maxMana);
  }
  
  equipItem(item) {
    const slot = item.slot;
    const old = this.equipment[slot];
    if (old) this.inventory.push(old);
    this.equipment[slot] = item;
    this.recalculateStats();
    return old;
  }
  
  unequipItem(slot) {
    const item = this.equipment[slot];
    if (item) {
      this.equipment[slot] = null;
      this.inventory.push(item);
      this.recalculateStats();
    }
    return item;
  }
  
  toDict() {
    return {
      id: this.id, name: this.name,
      class: this.class,
      pos: this.pos, rot: this.rot,
      hp: this.hp, maxHp: this.maxHp,
      mana: this.mana, maxMana: this.maxMana,
      level: this.level, xp: this.xp, gold: this.gold,
      str: this.str, dex: this.dex, int: this.int, vit: this.vit,
      critChance: this.critChance, dodgeChance: this.dodgeChance,
      skills: this.skills.map((s, i) => ({
        name: s.name, key: s.key, ready: (this.cooldowns[i] || 0) <= Date.now(),
        cooldown: s.cooldown,
      })),
      buffs: this.buffs,
      equipment: {
        weapon: this.equipment.weapon,
        armor: this.equipment.armor,
        ring: this.equipment.ring,
      },
      inventory: this.inventory,
      inVR: this.inVR,
      controllerLeft: this.controllerLeft,
      controllerRight: this.controllerRight,
      color: this.color,
    };
  }
  
  getMeleeDamage(isCrit = Math.random() * 100 < this.critChance) {
    const strBonus = this.getEquipBonus("str");
    let dmg = 15 + this.level * 2 + (this.str + strBonus) * 2;
    if (isCrit) dmg *= this.critMult;
    return Math.floor(dmg);
  }
  
  getSpellDamage(multiplier = 1.0) {
    const intBonus = this.getEquipBonus("int");
    let dmg = (10 + (this.int + intBonus) * 3 + this.level) * multiplier;
    if (Math.random() * 100 < this.critChance) {
      dmg *= this.critMult;
    }
    return Math.floor(dmg);
  }
  
  takeDamage(amount) {
    const now = Date.now();
    this.buffs = this.buffs.filter((b) => !b.expiresAt || b.expiresAt > now);

    let remaining = Math.max(0, amount);
    for (const buff of this.buffs) {
      if (!buff.absorb || remaining <= 0) continue;
      const absorbed = Math.min(buff.absorb, remaining);
      buff.absorb -= absorbed;
      remaining -= absorbed;
    }
    this.buffs = this.buffs.filter((b) => !Object.hasOwn(b, "absorb") || b.absorb > 0);

    // Apply percentage reduction after absorb shields.
    let reduction = 0;
    for (const b of this.buffs) {
      if (b.type === "shield") reduction += b.reduction || 0;
    }
    const actual = Math.floor(remaining * (1 - Math.min(reduction, 0.9)));
    this.hp = Math.max(0, this.hp - actual);
    return actual;
  }
  
  regenMana(amount) {
    if (this.passive && this.passive.regen) {
      amount += this.passive.regen;
    }
    this.mana = Math.min(this.maxMana, this.mana + amount);
  }
  
  addXp(amount) {
    this.xp += amount;
    let leveled = false;
    while (this.xp >= this.level * 50) {
      this.xp -= this.level * 50;
      this.level += 1;
      this.maxHp += 20;
      this.hp = this.maxHp;
      this.maxMana += 10;
      this.mana = this.maxMana;
      leveled = true;
    }
    return leveled;
  }
}

class Enemy {
  constructor(eid, x, z, etype = "goblin", isBoss = false, depth = 1) {
    this.id = eid;
    this.etype = etype;
    this.isBoss = isBoss;
    this.pos = Vec3(x, isBoss ? 2.5 : 0.5, z);
    this.depth = depth;

    // Depth scaling: +20% HP, +15% damage per floor above 1
    const depthMult = 1 + (depth - 1) * 0.2;
    const dmgMult = 1 + (depth - 1) * 0.15;

    if (isBoss) {
      this.hp = Math.floor(500 * depthMult);
      this.maxHp = this.hp;
      this.damage = Math.floor(25 * dmgMult);
      this.speed = 2.0;
      this.attackCooldown = Math.max(800, 1200 - (depth - 1) * 50);
      this.awarenessRadius = 15.0;
      this.color = depth >= 5 ? "#ff0066" : "#ff00ff";
      this.patrolRadius = 6.0;
    } else {
      this.hp = Math.floor((etype === "goblin" ? 30 : 60) * depthMult);
      this.maxHp = this.hp;
      this.damage = Math.floor((etype === "goblin" ? 5 : 12) * dmgMult);
      this.speed = 1.5 + (depth - 1) * 0.05;
      this.attackCooldown = Math.max(800, 1500 - (depth - 1) * 30);
      this.awarenessRadius = 8.0 + (depth - 1) * 0.3;
      this.color = etype === "goblin" ? "#e74c3c" : "#c0392b";
      this.patrolRadius = 4.0;
    }

    this.state = "patrol";
    this.patrolCenter = Vec3(x, 0.5, z);
    this.target = null;
    this.lastAttack = 0;
  }
  toDict() {
    return {
      id: this.id, type: this.etype,
      isBoss: this.isBoss,
      pos: this.pos, hp: this.hp, maxHp: this.maxHp,
      state: this.state, color: this.color,
      depth: this.depth,
    };
  }
}

class Item {
  constructor(iid, x, z, itype, value = 1) {
    this.id = iid;
    this.pos = Vec3(x, 0.3, z);
    this.itype = itype;
    this.value = value;
    this.pickedUp = false;
    this.color = { gold: "#f1c40f", potion: "#e91e63", sword: "#95a5a6", shield: "#3498db", equipment: "#f39c12" }[itype] || "#fff";
    this.equipment = null; // filled for equipment items
    this.name = null;
  }
  toDict() {
    const base = { id: this.id, type: this.itype, pos: this.pos, value: this.value, color: this.color };
    if (this.equipment) {
      base.equipment = this.equipment;
      base.name = this.name;
    }
    return base;
  }
}

function mulberry32(seed) {
  return function() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class GameWorld {
  constructor(seed = 42) {
    this.seed = seed;
    this.rng = mulberry32(seed);
    this.players = new Map();
    this.enemies = new Map();
    this.items = new Map();
    this.events = [];
    this.dungeonSize = 20;
    this.walls = [];
    this.spawnPoints = [];
    this.lastTick = Date.now();
    this.dungeonDepth = 1;
    this._floorCleared = false;
    this._generateDungeon();
    this._spawnEnemies(6);
    this._spawnBoss();
    this._spawnItems(10);
  }

  // ── Dungeon Progression System ──
  _checkFloorCleared() {
    if (this._floorCleared) return;
    if (this.enemies.size === 0) {
      this._floorCleared = true;
      this._addEvent(`🏰 FLOOR ${this.dungeonDepth} CLEARED! Descending to floor ${this.dungeonDepth + 1}...`);
      // Broadcast floor-clear event for client visual effects
      this._addEvent(`⚡ Dungeon difficulty increases! Enemies grow stronger...`);
      // Delay 3 seconds before advancing, giving players time to loot
      setTimeout(() => {
        this._advanceDungeon();
      }, 3000);
    }
  }

  _advanceDungeon() {
    this.dungeonDepth += 1;
    this._floorCleared = false;

    // Regenerate with new seed for layout variety
    this.seed = (this.seed + 13337) % 100000;
    this.rng = mulberry32(this.seed);

    // Clear remaining items (unpicked loot from previous floor)
    this.items.clear();

    // Rebuild dungeon layout
    this._generateDungeon();

    // Scale enemy count: 6 + 1 per depth (capped at 15)
    const enemyCount = Math.min(6 + this.dungeonDepth, 15);
    this._spawnEnemies(enemyCount);

    // Boss gets tougher each floor
    this._spawnBoss();

    // Scale loot: more items on deeper floors
    const itemCount = Math.min(10 + this.dungeonDepth * 2, 25);
    this._spawnItems(itemCount);

    // Reposition all players to new spawn points
    let idx = 0;
    for (const p of this.players.values()) {
      if (this.spawnPoints.length > 0) {
        const sp = this.spawnPoints[idx % this.spawnPoints.length];
        p.pos = Vec3(sp.x, sp.y, sp.z);
        p.hp = Math.min(p.maxHp, p.hp + Math.floor(p.maxHp * 0.25)); // 25% HP heal on floor advance
        idx++;
      }
    }

    this._addEvent(`⚔️ FLOOR ${this.dungeonDepth}: ${enemyCount} enemies await. Good luck, heroes.`);
    this._addHighlight({ type: "floor_advance", depth: this.dungeonDepth, timestamp: Date.now() });
  }

  _generateDungeon() {
    const gridW = 30, gridH = 30;
    // 0=void, 1=floor, 2=wall
    const grid = Array(gridH).fill(null).map(() => Array(gridW).fill(0));
    this._rooms = [];
    this._floorCells = [];

    const numRooms = 5 + Math.floor(this.rng() * 4); // 5-8 rooms
    const maxAttempts = 200;

    // ── Place rooms ──
    for (let i = 0; i < numRooms; i++) {
      let placed = false;
      for (let attempt = 0; attempt < maxAttempts && !placed; attempt++) {
        const rw = 3 + Math.floor(this.rng() * 4); // 3-6 cells
        const rh = 3 + Math.floor(this.rng() * 4);
        const rx = 2 + Math.floor(this.rng() * (gridW - rw - 4));
        const ry = 2 + Math.floor(this.rng() * (gridH - rh - 4));

        let overlap = false;
        for (const r of this._rooms) {
          if (rx < r.x + r.w + 1 && rx + rw + 1 > r.x &&
              ry < r.y + r.h + 1 && ry + rh + 1 > r.y) {
            overlap = true; break;
          }
        }

        if (!overlap) {
          for (let y = ry; y < ry + rh; y++) {
            for (let x = rx; x < rx + rw; x++) {
              grid[y][x] = 1;
              this._floorCells.push({ x, y });
            }
          }
          this._rooms.push({
            x: rx, y: ry, w: rw, h: rh,
            cx: rx + rw / 2,
            cy: ry + rh / 2,
          });
          placed = true;
        }
      }
    }

    // ── Connect rooms with L-shaped corridors ──
    for (let i = 1; i < this._rooms.length; i++) {
      const a = this._rooms[i - 1], b = this._rooms[i];
      const ax = Math.floor(a.cx), ay = Math.floor(a.cy);
      const bx = Math.floor(b.cx), by = Math.floor(b.cy);

      if (this.rng() > 0.5) {
        // Horizontal then vertical
        for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++) {
          if (ay >= 0 && ay < gridH) grid[ay][x] = 1;
        }
        for (let y = Math.min(ay, by); y <= Math.max(ay, by); y++) {
          if (bx >= 0 && bx < gridW) grid[y][bx] = 1;
        }
      } else {
        // Vertical then horizontal
        for (let y = Math.min(ay, by); y <= Math.max(ay, by); y++) {
          if (ax >= 0 && ax < gridW) grid[y][ax] = 1;
        }
        for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++) {
          if (by >= 0 && by < gridH) grid[by][x] = 1;
        }
      }
    }

    // Rebuild floor cells after corridors
    this._floorCells = [];
    for (let y = 0; y < gridH; y++) {
      for (let x = 0; x < gridW; x++) {
        if (grid[y][x] === 1) this._floorCells.push({ x, y });
      }
    }

    // ── Mark walls around floor ──
    for (let y = 0; y < gridH; y++) {
      for (let x = 0; x < gridW; x++) {
        if (grid[y][x] === 0) {
          const neighbors = [[0,1],[0,-1],[1,0],[-1,0],[1,1],[1,-1],[-1,1],[-1,-1]];
          for (const [dx, dy] of neighbors) {
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && nx < gridW && ny >= 0 && ny < gridH && grid[ny][nx] === 1) {
              grid[y][x] = 2;
              break;
            }
          }
        }
      }
    }

    // ── Convert walls to AABB ──
    this.walls = [];
    for (let y = 0; y < gridH; y++) {
      for (let x = 0; x < gridW; x++) {
        if (grid[y][x] === 2) {
          this.walls.push({
            min: Vec3(x * TILE_SIZE, 0, y * TILE_SIZE),
            max: Vec3((x + 1) * TILE_SIZE, 3, (y + 1) * TILE_SIZE),
          });
        }
      }
    }

    // ── Spawn points: room centers ──
    this.spawnPoints = this._rooms.map(r =>
      Vec3(r.cx * TILE_SIZE, 1.6, r.cy * TILE_SIZE)
    );
    if (this.spawnPoints.length === 0) {
      this.spawnPoints = [Vec3(0, 1.6, 0)];
    }
  }

  _spawnEnemies(count) {
    for (let i = 0; i < count && this._floorCells.length > 0; i++) {
      const cell = this._floorCells[Math.floor(this.rng() * this._floorCells.length)];
      const x = (cell.x + 0.5) * TILE_SIZE;
      const z = (cell.y + 0.5) * TILE_SIZE;
      const etype = this.rng() > 0.3 ? "goblin" : "orc";
      const e = new Enemy(`enemy_${i}`, x, z, etype, false, this.dungeonDepth);
      e.patrolCenter = Vec3(x, 0.5, z);
      this.enemies.set(e.id, e);
    }
  }

  _spawnBoss() {
    if (this._floorCells.length === 0) return;
    // Spawn boss in the largest room (last generated)
    const cell = this._floorCells[Math.floor(this.rng() * this._floorCells.length)];
    const x = (cell.x + 0.5) * TILE_SIZE;
    const z = (cell.y + 0.5) * TILE_SIZE;
    const boss = new Enemy("boss_1", x, z, "demon", true, this.dungeonDepth);
    boss.patrolCenter = Vec3(x, 0.5, z);
    this.enemies.set(boss.id, boss);
    this._addEvent(`⚠️ A BOSS has appeared on floor ${this.dungeonDepth}!`);
  }

  _spawnItems(count) {
    // Deeper floors have more equipment and better rarity odds
    const depthBias = this.dungeonDepth >= 5 ? 0.4 : this.dungeonDepth >= 3 ? 0.3 : 0.25;
    const lootTable = [
      "gold","gold","gold",
      "potion","potion",
      "equipment","equipment",
    ];
    // Add extra equipment slots based on depth
    const extraEquip = Math.floor(this.dungeonDepth / 2);
    for (let i = 0; i < extraEquip; i++) lootTable.push("equipment");

    for (let i = 0; i < count && this._floorCells.length > 0; i++) {
      const cell = this._floorCells[Math.floor(this.rng() * this._floorCells.length)];
      const x = (cell.x + 0.5) * TILE_SIZE;
      const z = (cell.y + 0.5) * TILE_SIZE;
      const roll = lootTable[Math.floor(this.rng() * lootTable.length)];

      let item;
      if (roll === "gold") {
        // Gold scales with depth
        const goldVal = Math.floor(this.rng() * (20 + this.dungeonDepth * 3) + 5 + this.dungeonDepth * 2);
        item = new Item(`item_${Date.now()}_${i}`, x, z, "gold", goldVal);
      } else if (roll === "potion") {
        // Potions heal more on deeper floors
        const healVal = 30 + Math.floor(this.rng() * 20) + (this.dungeonDepth - 1) * 5;
        item = new Item(`item_${Date.now()}_${i}`, x, z, "potion", healVal);
      } else {
        // Equipment drop: weapon, armor, or ring
        const equipTypes = ["weapon", "armor", "ring"];
        const etype = equipTypes[Math.floor(this.rng() * equipTypes.length)];
        const equip = generateEquipment(etype, this.rng);
        // Depth-based rarity boost: chance to upgrade rarity on deeper floors
        if (this.dungeonDepth >= 3 && equip.rarity === "common" && this.rng() < depthBias) {
          setEquipmentRarity(equip, "uncommon", 2);
        }
        if (this.dungeonDepth >= 5 && equip.rarity === "uncommon" && this.rng() < depthBias * 0.5) {
          setEquipmentRarity(equip, "rare", 3);
        }
        item = new Item(`item_${Date.now()}_${i}`, x, z, "equipment", 0);
        item.equipment = equip;
        item.name = equip.name;
        item.color = equip.color;
      }
      this.items.set(item.id, item);
    }
  }

  addPlayer(pid, name, charClass = "warrior", bonusStats = {}, dbChar = null) {
    const idx = this.players.size % this.spawnPoints.length;
    const p = new Player(pid, name, charClass, bonusStats, dbChar);
    p.pos = Vec3(this.spawnPoints[idx].x, this.spawnPoints[idx].y, this.spawnPoints[idx].z);
    this.players.set(pid, p);
    this._addEvent(`${p.name} (${charClass}) joined the dungeon.`);
    return p;
  }

  removePlayer(pid) {
    const p = this.players.get(pid);
    if (p) {
      this._addEvent(`${p.name} left.`);
      this.players.delete(pid);
    }
  }

  updatePlayer(pid, data) {
    const p = this.players.get(pid);
    if (!p) return;
    if (data.pos) { p.pos.x = data.pos.x ?? p.pos.x; p.pos.y = data.pos.y ?? p.pos.y; p.pos.z = data.pos.z ?? p.pos.z; }
    if (data.rot) { p.rot.x = data.rot.x ?? p.rot.x; p.rot.y = data.rot.y ?? p.rot.y; p.rot.z = data.rot.z ?? p.rot.z; }
    if (typeof data.inVR === "boolean") p.inVR = data.inVR;
    if (data.controllers) {
      if (data.controllers.left) p.controllerLeft.pos = Vec3(data.controllers.left.x, data.controllers.left.y, data.controllers.left.z);
      if (data.controllers.right) p.controllerRight.pos = Vec3(data.controllers.right.x, data.controllers.right.y, data.controllers.right.z);
    }
    p.lastUpdate = Date.now();
  }

  tick() {
    const now = Date.now();
    this.lastTick = now;
    for (const e of this.enemies.values()) this._updateEnemy(e, now);
  }

  _updateEnemy(e, now) {
    let nearest = null, nearestDist = Infinity;
    for (const p of this.players.values()) {
      const d = dist(e.pos, p.pos);
      if (d < nearestDist) { nearestDist = d; nearest = p; }
    }
    if (nearest && nearestDist < e.awarenessRadius) {
      e.target = nearest; e.state = "chase";
    } else {
      e.target = null; e.state = "patrol";
    }
    const dt = 0.05;
    if (e.state === "chase" && e.target) {
      const dx = e.target.pos.x - e.pos.x;
      const dz = e.target.pos.z - e.pos.z;
      const d = Math.sqrt(dx*dx + dz*dz);
      if (d > 0.5) {
        const s = e.speed * dt;
        e.pos.x += (dx / d) * s;
        e.pos.z += (dz / d) * s;
      } else if (now - e.lastAttack > e.attackCooldown) {
        const actualDamage = e.target.takeDamage(e.damage);
        e.lastAttack = now;
        this._addEvent(`${e.etype.charAt(0).toUpperCase() + e.etype.slice(1)} hit ${e.target.name} for ${actualDamage}!`);
        if (e.target.hp <= 0) {
          e.target.hp = 0;
          this._addEvent(`${e.target.name} was slain by ${e.etype}!`);
          const idx = (e.target.id.length) % this.spawnPoints.length;
          e.target.pos = Vec3(this.spawnPoints[idx].x, this.spawnPoints[idx].y, this.spawnPoints[idx].z);
          e.target.hp = e.target.maxHp;
        }
      }
    } else if (e.state === "patrol") {
      const dx = e.patrolCenter.x - e.pos.x;
      const dz = e.patrolCenter.z - e.pos.z;
      const d = Math.sqrt(dx*dx + dz*dz);
      if (d > e.patrolRadius && d > 0.5) {
        const s = e.speed * 0.5 * dt;
        e.pos.x += (dx / d) * s;
        e.pos.z += (dz / d) * s;
      } else {
        const angle = this.rng() * Math.PI * 2;
        const s = e.speed * 0.3 * dt;
        e.pos.x += Math.cos(angle) * s;
        e.pos.z += Math.sin(angle) * s;
      }
    }
  }

  playerAttack(pid, data = {}) {
    const p = this.players.get(pid);
    if (!p) return null;
    
    // Apply VR gesture multipliers
    const damageMult = data.damageMult || 1.0;
    const attackStyle = data.style || "light";
    
    // Check dodge (enemies can't dodge yet, but players can)
    // Get damage based on class/stats
    const isCrit = Math.random() * 100 < p.critChance;
    let damage = p.getMeleeDamage(isCrit);
    let range = 3.0;
    
    // Bow shots are ranged
    if (attackStyle === "bow") {
      range = 15.0; // Long range for bows
      damage = Math.floor(damage * damageMult);
    } else {
      damage = Math.floor(damage * damageMult);
    }
    
    // Rogue passive: slight range boost
    if (p.class === "rogue") range = 3.5;
    
    let nearest = null, nearestDist = range;
    for (const e of this.enemies.values()) {
      if (e.stunned && e.stunned > Date.now()) continue; // Can't attack stunned enemies? Actually they can be attacked
      const d = dist(p.pos, e.pos);
      if (d < nearestDist) { nearest = e; nearestDist = d; }
    }
    if (nearest) {
      nearest.hp -= damage;
      const critText = isCrit ? " CRIT!" : "";
      const styleText = attackStyle !== "light" ? ` [${attackStyle.toUpperCase()}]` : "";
      this._addEvent(`${p.name} hit ${nearest.etype} for ${damage}${critText}!${styleText}`);
      
      // Warrior passive: Cleave (25% chance to hit adjacent)
      if (p.class === "warrior" && p.passive && Math.random() < p.passive.chance) {
        for (const other of this.enemies.values()) {
          if (other.id === nearest.id) continue;
          if (dist(nearest.pos, other.pos) < 2.5) {
            other.hp -= Math.floor(damage * 0.5);
            this._addEvent(`${p.name} cleaved ${other.etype} for ${Math.floor(damage * 0.5)}!`);
            if (other.hp <= 0) {
              this._addEvent(`${p.name} defeated ${other.etype}!`);
              this._addHighlight({ type: "kill", player: p.name, target: other.etype, level: p.level, timestamp: Date.now() });
              this.enemies.delete(other.id);
              this._checkFloorCleared();
            }
          }
        }
      }
      
      if (nearest.hp <= 0) {
        const isBoss = nearest.isBoss;
        this._addEvent(`${p.name} defeated ${nearest.etype}!${isBoss ? ' 🎉 BOSS KILL!' : ''}`);
        this._addHighlight({ type: "kill", player: p.name, target: nearest.etype, level: p.level, timestamp: Date.now() });
        
        // XP system
        let xpGain = nearest.etype === "orc" ? 15 : 10;
        if (isBoss) xpGain = 100;
        const leveled = p.addXp(xpGain);
        p.gold += Math.floor(this.rng() * (isBoss ? 50 : 9) + (isBoss ? 20 : 3));
        p.kills = (p.kills || 0) + 1;
        
        if (leveled) {
          this._addEvent(`${p.name} reached level ${p.level}! 🎉`);
          this._addHighlight({ type: "level_up", player: p.name, level: p.level, timestamp: Date.now() });
        }
        
        // Boss drops guaranteed epic loot
        if (isBoss) {
          const lootPos = { x: nearest.pos.x, z: nearest.pos.z };
          const equipTypes = ["weapon", "armor", "ring"];
          for (let i = 0; i < 3; i++) {
            const etype = equipTypes[i];
            const item = new Item(`boss_drop_${Date.now()}_${i}`, lootPos.x + (i-1)*1.5, lootPos.z, "equipment", 0);
            const equip = generateEquipment(etype, this.rng);
            setEquipmentRarity(equip, "epic", 5); // Guaranteed epic
            item.equipment = equip;
            item.name = equip.name;
            item.color = equip.color;
            this.items.set(item.id, item);
          }
          this._addEvent(`💎 Boss dropped 3 EPIC items!`);
          this._addHighlight({ type: "loot", player: p.name, item: "Boss Epic Loot x3", rarity: "epic", timestamp: Date.now() });
          
          // Respawn boss after 60 seconds
          setTimeout(() => {
            this._spawnBoss();
          }, 60000);
        }
        
        this.enemies.delete(nearest.id);
        this._checkFloorCleared();
        
        // No individual respawn — dungeon progression system handles repopulation
      }
      return { target: nearest.id, damage, killed: nearest.hp <= 0, crit: isCrit };
    }
    return null;
  }

  playerUseSkill(pid, skillIndex) {
    const p = this.players.get(pid);
    if (!p || !p.skills[skillIndex]) return null;
    
    const skill = p.skills[skillIndex];
    const now = Date.now();
    
    // Check cooldown
    if (p.cooldowns[skillIndex] && p.cooldowns[skillIndex] > now) {
      return null; // On cooldown
    }
    
    // Check mana
    if (p.mana < skill.cost) {
      this._addEvent(`${p.name} needs more mana for ${skill.name}!`);
      return null;
    }
    
    // Deduct mana and set cooldown
    p.mana -= skill.cost;
    p.cooldowns[skillIndex] = now + skill.cooldown;
    
    // Process skill effect
    switch (skill.type) {
      case "melee": {
        let damage = p.getMeleeDamage() * skill.multiplier;
        let nearest = null, nearestDist = 3.0;
        for (const e of this.enemies.values()) {
          const d = dist(p.pos, e.pos);
          if (d < nearestDist) { nearest = e; nearestDist = d; }
        }
        if (nearest) {
          nearest.hp -= damage;
          this._addEvent(`${p.name} used ${skill.name}! ${nearest.etype} took ${damage}!`);
          if (skill.stun) nearest.stunned = now + skill.stun;
          if (nearest.hp <= 0) {
            this._addEvent(`${p.name} defeated ${nearest.etype}!`);
            this._addHighlight({ type: "kill", player: p.name, target: nearest.etype, level: p.level, timestamp: Date.now() });
            const xpGain = nearest.etype === "orc" ? 15 : 10;
            const leveled = p.addXp(xpGain);
            if (leveled) {
              this._addEvent(`${p.name} reached level ${p.level}! 🎉`);
              this._addHighlight({ type: "level_up", player: p.name, level: p.level, timestamp: Date.now() });
            }
            this.enemies.delete(nearest.id);
            this._checkFloorCleared();
          }
          return { skill: skill.name, target: nearest.id, damage };
        }
        break;
      }
      case "aoe": {
        // Taunt or Frost Nova
        let hitCount = 0;
        for (const e of this.enemies.values()) {
          if (dist(p.pos, e.pos) <= skill.radius) {
            hitCount++;
            if (skill.freeze) {
              e.stunned = now + skill.freeze;
              this._addEvent(`${e.etype} frozen by ${skill.name}!`);
            }
            if (skill.duration && skill.type === "aoe") {
              // Taunt effect: force target
              e.target = p;
              e.state = "chase";
            }
          }
        }
        this._addEvent(`${p.name} used ${skill.name}! Hit ${hitCount} enemies.`);
        return { skill: skill.name, hitCount };
      }
      case "buff": {
        p.buffs.push({ type: "shield", reduction: skill.reduction, expiresAt: now + skill.duration });
        this._addEvent(`${p.name} used ${skill.name}! Damage reduced ${Math.floor(skill.reduction * 100)}%.`);
        return { skill: skill.name, duration: skill.duration };
      }
      case "dash": {
        // FIX: THREE is not available on server-side — use plain math
        const dashDx = Math.sin(p.rot.y);
        const dashDz = Math.cos(p.rot.y);
        p.pos.x += dashDx * skill.distance;
        p.pos.z += dashDz * skill.distance;
        this._addEvent(`${p.name} dashed forward!`);
        return { skill: skill.name, distance: skill.distance };
      }
      case "stealth": {
        p.stealth = true;
        setTimeout(() => { p.stealth = false; }, skill.duration);
        this._addEvent(`${p.name} vanished into shadows!`);
        return { skill: skill.name, duration: skill.duration };
      }
      case "shield": {
        const absorb = skill.absorb === "int" ? p.int * 5 : 30;
        p.buffs.push({ type: "shield", absorb, expiresAt: now + skill.duration });
        this._addEvent(`${p.name} cast ${skill.name}! Shield: ${absorb} HP.`);
        return { skill: skill.name, absorb };
      }
      case "ranged": {
        // Fireball: find nearest enemy in longer range
        let damage = p.getSpellDamage(skill.multiplier);
        let nearest = null, nearestDist = 10.0;
        for (const e of this.enemies.values()) {
          const d = dist(p.pos, e.pos);
          if (d < nearestDist) { nearest = e; nearestDist = d; }
        }
        if (nearest) {
          nearest.hp -= damage;
          // Splash damage
          if (skill.splash) {
            for (const other of this.enemies.values()) {
              if (other.id === nearest.id) continue;
              if (dist(nearest.pos, other.pos) <= skill.splash) {
                other.hp -= Math.floor(damage * 0.4);
                if (other.hp <= 0) {
                  this._addEvent(`${p.name} defeated ${other.etype} with splash!`);
                  this._addHighlight({ type: "kill", player: p.name, target: other.etype, level: p.level, timestamp: Date.now() });
                  this.enemies.delete(other.id);
                  this._checkFloorCleared();
                }
              }
            }
          }
          this._addEvent(`${p.name} cast ${skill.name}! ${nearest.etype} took ${damage}!`);
          if (nearest.hp <= 0) {
            this._addEvent(`${p.name} defeated ${nearest.etype}!`);
            this._addHighlight({ type: "kill", player: p.name, target: nearest.etype, level: p.level, timestamp: Date.now() });
            const xpGain = nearest.etype === "orc" ? 15 : 10;
            const leveled = p.addXp(xpGain);
            if (leveled) {
              this._addEvent(`${p.name} reached level ${p.level}! 🎉`);
              this._addHighlight({ type: "level_up", player: p.name, level: p.level, timestamp: Date.now() });
            }
            this.enemies.delete(nearest.id);
            this._checkFloorCleared();
          }
          return { skill: skill.name, target: nearest.id, damage };
        }
        break;
      }
    }
    return null;
  }

  pickupItem(pid) {
    const p = this.players.get(pid);
    if (!p) return null;
    let nearest = null, nearestDist = 2.0;
    for (const item of this.items.values()) {
      if (item.pickedUp) continue;
      const d = dist(p.pos, item.pos);
      if (d < nearestDist) { nearest = item; nearestDist = d; }
    }
    if (nearest) {
      nearest.pickedUp = true;
      this.items.delete(nearest.id);
      if (nearest.itype === "gold") {
        p.gold += nearest.value;
        this._addEvent(`${p.name} picked up ${nearest.value} gold.`);
      } else if (nearest.itype === "potion") {
        p.hp = Math.min(p.maxHp, p.hp + nearest.value);
        this._addEvent(`${p.name} used a health potion (+${nearest.value} HP).`);
      } else if (nearest.itype === "equipment" && nearest.equipment) {
        const equip = nearest.equipment;
        const old = p.equipItem(equip);
        const statName = Object.keys(equip.bonus)[0];
        const statVal = equip.bonus[statName];
        const rarity = equip.rarity;
        
        let msg = `${p.name} equipped ${equip.name} (+${statVal} ${statName.toUpperCase()})`;
        if (old) msg += ` (replaced ${old.name})`;
        this._addEvent(msg);
        
        if (["rare", "epic"].includes(rarity)) {
          this._addHighlight({
            type: "loot",
            player: p.name,
            item: equip.name,
            rarity,
            timestamp: Date.now(),
          });
        }
      }
      return { item: nearest.toDict ? nearest.toDict() : nearest };
    }
    return null;
  }

  _addHighlight(data) {
    if (!this.highlights) this.highlights = [];
    this.highlights.unshift(data);
    if (this.highlights.length > 50) this.highlights.length = 50;
  }

  _addEvent(text) {
    this.events.unshift({ text, at: Date.now() });
    if (this.events.length > 20) this.events.length = 20;
  }

  serialize() {
    // Build leaderboard: players sorted by level, then XP
    const leaderboard = Array.from(this.players.values())
      .map(p => ({
        name: p.name,
        level: p.level,
        xp: p.xp,
        kills: p.kills || 0,
        class: p.class,
      }))
      .sort((a, b) => b.level - a.level || b.xp - a.xp)
      .slice(0, 5);
    
    return {
      players: Array.from(this.players.values()).map(p => p.toDict()),
      enemies: Array.from(this.enemies.values()).map(e => e.toDict()),
      items: Array.from(this.items.values()).filter(i => !i.pickedUp).map(i => i.toDict()),
      walls: this.walls.map(w => ({ min: w.min, max: w.max })),
      events: this.events.slice(0, 8),
      highlights: (this.highlights || []).slice(0, 10),
      leaderboard,
      dungeonSize: this.dungeonSize,
      dungeonDepth: this.dungeonDepth,
      enemyCount: this.enemies.size,
    };
  }
}

module.exports = {
  GameWorld, Vec3, dist, Player, Enemy, Item,
  ITEM_TIERS, EQUIPMENT_TYPES, rollRarity, generateEquipment, setEquipmentRarity,
};
