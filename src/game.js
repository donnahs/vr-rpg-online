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

function pickColor(pid) {
  const colors = ["#e74c3c","#3498db","#2ecc71","#f39c12","#9b59b6","#1abc9c","#e91e63","#00bcd4"];
  let h = 0;
  for (let i = 0; i < pid.length; i++) h = ((h * 31) + pid.charCodeAt(i)) % colors.length;
  return colors[h];
}

class Player {
  constructor(pid, name) {
    this.id = pid;
    this.name = (name || "Hero").trim().slice(0, 18) || "Hero";
    this.pos = Vec3(0, 1.6, 0);
    this.rot = Vec3(0, 0, 0);
    this.hp = 100;
    this.maxHp = 100;
    this.level = 1;
    this.xp = 0;
    this.gold = 0;
    this.speed = 3.0;
    this.inVR = false;
    this.controllerLeft = { pos: Vec3(-0.2, 1.2, -0.3), rot: Vec3() };
    this.controllerRight = { pos: Vec3(0.2, 1.2, -0.3), rot: Vec3() };
    this.inventory = [];
    this.lastUpdate = Date.now();
    this.connectedAt = Date.now();
    this.color = pickColor(pid);
  }
  toDict() {
    return {
      id: this.id, name: this.name,
      pos: this.pos, rot: this.rot,
      hp: this.hp, maxHp: this.maxHp,
      level: this.level, xp: this.xp, gold: this.gold,
      inVR: this.inVR,
      controllerLeft: this.controllerLeft,
      controllerRight: this.controllerRight,
      inventory: this.inventory,
      color: this.color,
    };
  }
}

class Enemy {
  constructor(eid, x, z, etype = "goblin") {
    this.id = eid;
    this.etype = etype;
    this.pos = Vec3(x, 0.5, z);
    this.hp = etype === "goblin" ? 30 : 60;
    this.maxHp = this.hp;
    this.damage = etype === "goblin" ? 5 : 12;
    this.speed = 1.5;
    this.state = "patrol";
    this.patrolCenter = Vec3(x, 0.5, z);
    this.patrolRadius = 4.0;
    this.target = null;
    this.lastAttack = 0;
    this.attackCooldown = 1500;
    this.awarenessRadius = 8.0;
    this.color = etype === "goblin" ? "#e74c3c" : "#c0392b";
  }
  toDict() {
    return {
      id: this.id, type: this.etype,
      pos: this.pos, hp: this.hp, maxHp: this.maxHp,
      state: this.state, color: this.color,
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
    this.color = { gold: "#f1c40f", potion: "#e91e63", sword: "#95a5a6", shield: "#3498db" }[itype] || "#fff";
  }
  toDict() {
    return { id: this.id, type: this.itype, pos: this.pos, value: this.value, color: this.color };
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
    this._generateDungeon();
    this._spawnEnemies(6);
    this._spawnItems(10);
  }

  _generateDungeon() {
    const s = this.dungeonSize;
    for (let x = -s; x <= s; x++) {
      this.walls.push({ min: Vec3(x * TILE_SIZE, 0, -s * TILE_SIZE), max: Vec3((x+1) * TILE_SIZE, 3, (-s+1) * TILE_SIZE) });
      this.walls.push({ min: Vec3(x * TILE_SIZE, 0, s * TILE_SIZE), max: Vec3((x+1) * TILE_SIZE, 3, (s+1) * TILE_SIZE) });
    }
    for (let z = -s + 1; z < s; z++) {
      this.walls.push({ min: Vec3(-s * TILE_SIZE, 0, z * TILE_SIZE), max: Vec3((-s+1) * TILE_SIZE, 3, (z+1) * TILE_SIZE) });
      this.walls.push({ min: Vec3(s * TILE_SIZE, 0, z * TILE_SIZE), max: Vec3((s+1) * TILE_SIZE, 3, (z+1) * TILE_SIZE) });
    }
    for (let i = 0; i < 12; i++) {
      const wx = Math.floor(this.rng() * (2*s - 4) - s + 2);
      const wz = Math.floor(this.rng() * (2*s - 4) - s + 2);
      this.walls.push({ min: Vec3(wx * TILE_SIZE, 0, wz * TILE_SIZE), max: Vec3((wx+1) * TILE_SIZE, 3, (wz+1) * TILE_SIZE) });
    }
    this.spawnPoints = [Vec3(0, 1.6, 0), Vec3(4, 1.6, 4), Vec3(-4, 1.6, -4), Vec3(4, 1.6, -4), Vec3(-4, 1.6, 4)];
  }

  _spawnEnemies(count) {
    for (let i = 0; i < count; i++) {
      const x = this.rng() * 30 - 15;
      const z = this.rng() * 30 - 15;
      const etype = this.rng() > 0.3 ? "goblin" : "orc";
      const e = new Enemy(`enemy_${i}`, x, z, etype);
      this.enemies.set(e.id, e);
    }
  }

  _spawnItems(count) {
    const types = ["gold","gold","gold","gold","potion","potion","potion","sword","sword","shield"];
    for (let i = 0; i < count; i++) {
      const x = this.rng() * 30 - 15;
      const z = this.rng() * 30 - 15;
      const itype = types[Math.floor(this.rng() * types.length)];
      const value = itype === "gold" ? Math.floor(this.rng() * 20 + 5) : itype === "potion" ? 30 : itype === "sword" ? 10 : 5;
      const item = new Item(`item_${i}`, x, z, itype, value);
      this.items.set(item.id, item);
    }
  }

  addPlayer(pid, name) {
    const idx = this.players.size % this.spawnPoints.length;
    const p = new Player(pid, name);
    p.pos = Vec3(this.spawnPoints[idx].x, this.spawnPoints[idx].y, this.spawnPoints[idx].z);
    this.players.set(pid, p);
    this._addEvent(`${p.name} joined the dungeon.`);
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
        e.target.hp -= e.damage;
        e.lastAttack = now;
        this._addEvent(`${e.etype.charAt(0).toUpperCase() + e.etype.slice(1)} hit ${e.target.name} for ${e.damage}!`);
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

  playerAttack(pid) {
    const p = this.players.get(pid);
    if (!p) return null;
    const damage = 15 + p.level * 2;
    let nearest = null, nearestDist = 3.0;
    for (const e of this.enemies.values()) {
      const d = dist(p.pos, e.pos);
      if (d < nearestDist) { nearest = e; nearestDist = d; }
    }
    if (nearest) {
      nearest.hp -= damage;
      this._addEvent(`${p.name} hit ${nearest.etype} for ${damage}!`);
      if (nearest.hp <= 0) {
        this._addEvent(`${p.name} defeated ${nearest.etype}!`);
        p.xp += 10;
        p.gold += Math.floor(this.rng() * 9 + 3);
        if (p.xp >= p.level * 50) {
          p.level += 1;
          p.maxHp += 20;
          p.hp = p.maxHp;
          this._addEvent(`${p.name} reached level ${p.level}!`);
        }
        this.enemies.delete(nearest.id);
        const x = this.rng() * 30 - 15;
        const z = this.rng() * 30 - 15;
        const etype = this.rng() > 0.3 ? "goblin" : "orc";
        const ne = new Enemy(`enemy_${Math.floor(this.rng()*9000+1000)}`, x, z, etype);
        this.enemies.set(ne.id, ne);
      }
      return { target: nearest.id, damage, killed: nearest.hp <= 0 };
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
      } else if (nearest.itype === "sword") {
        this._addEvent(`${p.name} found a sword (+${nearest.value} damage).`);
      } else if (nearest.itype === "shield") {
        p.maxHp += nearest.value; p.hp += nearest.value;
        this._addEvent(`${p.name} found a shield (+${nearest.value} HP).`);
      }
      return { item: nearest.toDict() };
    }
    return null;
  }

  _addEvent(text) {
    this.events.unshift({ text, at: Date.now() });
    if (this.events.length > 20) this.events.length = 20;
  }

  serialize() {
    return {
      players: Array.from(this.players.values()).map(p => p.toDict()),
      enemies: Array.from(this.enemies.values()).map(e => e.toDict()),
      items: Array.from(this.items.values()).filter(i => !i.pickedUp).map(i => i.toDict()),
      walls: this.walls.map(w => ({ min: w.min, max: w.max })),
      events: this.events.slice(0, 8),
      dungeonSize: this.dungeonSize,
    };
  }
}

module.exports = { GameWorld, Vec3, dist, Player, Enemy, Item };
