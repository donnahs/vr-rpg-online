"use strict";
/**
 * VR RPG Online — Server
 * Node.js HTTP static server + WebSocket for authoritative world sync
 */

const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");
const { WebSocketServer } = require("ws");
const { GameWorld } = require("./game");
const mysql = require("./mysql");

const PORT = Number(process.env.PORT || 8942);
const LEADERBOARD_API = process.env.LEADERBOARD_API || "http://127.0.0.1:8900";

// ── Leaderboard submission helper ──
function submitScore(player) {
  if (!player || !player.name) return;
  const payload = JSON.stringify({
    player_id: player.id || 0,
    player_name: player.name,
    kills: player.kills || 0,
    deaths: player.deaths || 0,
    level: player.level || 1,
    xp: player.xp || 0,
  });
  const url = new URL("/leaderboard/score", LEADERBOARD_API);
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload,
  }).catch((err) => {
    // Silent fail — game works without leaderboard
  });
}
const PUBLIC_DIR = path.join(__dirname, "..", "public");

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".svg": "image/svg+xml",
};

const world = new GameWorld(Date.now() % 100000);

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify({
      ok: true,
      players: world.players.size,
      enemies: world.enemies.size,
      items: Array.from(world.items.values()).filter(i => !i.pickedUp).length,
    }));
    return;
  }
  if (req.url === "/api/world") {
    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify(world.serialize()));
    return;
  }
  if (req.url.startsWith("/api/leaderboard")) {
    const limit = new URL(req.url, `http://localhost:${PORT}`).searchParams.get("limit") || "10";
    fetch(`${LEADERBOARD_API}/leaderboard/top?limit=${limit}`)
      .then((r) => r.json())
      .then((data) => {
        res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        res.end(JSON.stringify(data));
      })
      .catch(() => {
        res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        res.end(JSON.stringify({ error: "leaderboard unavailable", top: [] }));
      });
    return;
  }

  const requested = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  const filePath = path.normalize(path.join(PUBLIC_DIR, requested));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); res.end("Forbidden"); return;
  }

  fs.readFile(filePath, (err, content) => {
    if (err) { res.writeHead(404); res.end("Not found"); return; }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": mimeTypes[ext] || "text/plain", "Access-Control-Allow-Origin": "*" });
    res.end(content);
  });
});

const wss = new WebSocketServer({ server });

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(msg) {
  const payload = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(payload);
  }
}

function broadcastWorld() {
  broadcast({ type: "world", data: world.serialize() });
}

wss.on("connection", (ws, req) => {
  const pid = `p_${Date.now()}_${Math.floor(Math.random()*10000)}`;
  ws._pid = pid;
  console.log(`[WS] Connect ${pid} from ${req.socket.remoteAddress}`);

  send(ws, { type: "connected", pid });

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }

    if (msg.type === "join") {
      const charClass = msg.charClass || "warrior";
      const bonusStats = msg.bonusStats || {};
      const name = msg.name || "Hero";
      
      // Try to load existing character from MySQL
      mysql.getCharacterByName(name).then((dbChar) => {
        if (dbChar) {
          // Load existing character
          console.log(`[DB] Loaded character ${name} (Lv.${dbChar.level})`);
          ws._charId = dbChar.id;
          world.addPlayer(pid, name, charClass, bonusStats, dbChar);
          mysql.setCharacterOnline(ws._charId, true).catch(()=>{});
          broadcastWorld();
        } else {
          // Create new character in DB
          mysql.createCharacter(1, name, charClass, bonusStats).then((charId) => {
            console.log(`[DB] Created character ${name} (ID:${charId})`);
            ws._charId = charId;
            world.addPlayer(pid, name, charClass, bonusStats);
            mysql.setCharacterOnline(ws._charId, true);
            broadcastWorld();
          }).catch((err) => {
            console.warn(`[DB] Failed to create character ${name} — playing in-memory.`, err.message);
            world.addPlayer(pid, name, charClass, bonusStats);
            broadcastWorld();
          });
        }
      });
    }
    if (msg.type === "update") {
      world.updatePlayer(pid, msg.data || {});
    }
    if (msg.type === "attack") {
      const result = world.playerAttack(pid, msg.data || {});
      if (result) {
        const p = world.players.get(pid);
        if (p && result.killed) submitScore(p);
        broadcastWorld();
      }
    }
    if (msg.type === "skill") {
      const result = world.playerUseSkill(pid, msg.skillIndex || 0);
      if (result) {
        const p = world.players.get(pid);
        if (p) submitScore(p);
        broadcastWorld();
      }
    }
    if (msg.type === "pickup") {
      const result = world.pickupItem(pid);
      if (result) broadcastWorld();
    }
    if (msg.type === "chat") {
      const p = world.players.get(pid);
      if (p && msg.text && typeof msg.text === "string") {
        const text = msg.text.trim().slice(0, 200);
        if (text.length > 0) {
          const chatMsg = {
            type: "chat",
            data: {
              id: `chat_${Date.now()}_${Math.floor(Math.random()*10000)}`,
              pid: pid,
              name: p.name,
              class: p.class,
              level: p.level,
              text: text,
              timestamp: Date.now(),
            },
          };
          broadcast(chatMsg);
          console.log(`[CHAT] ${p.name}: ${text}`);
        }
      }
    }
  });

  ws.on("close", () => {
    const p = world.players.get(pid);
    if (p && ws._charId) {
      mysql.saveCharacter(ws._charId, {
        name: p.name, class: p.class, level: p.level, xp: p.xp, gold: p.gold,
        hp: p.hp, maxHp: p.maxHp, mana: p.mana, maxMana: p.maxMana,
        str: p.str, dex: p.dex, int: p.int, vit: p.vit,
        pos: p.pos, isOnline: false,
      }).catch(() => {});
      mysql.setCharacterOnline(ws._charId, false).catch(() => {});
    }
    world.removePlayer(pid);
    broadcastWorld();
    console.log(`[WS] Disconnect ${pid}`);
  });
});

// Server tick loop (20 Hz)
let tickCount = 0;
setInterval(() => {
  world.tick();
  broadcastWorld();
  tickCount++;
  
  // Auto-save all online players every 600 ticks (~30 seconds)
  if (tickCount % 600 === 0) {
    for (const [pid, p] of world.players) {
      const ws = [...wss.clients].find((c) => c._pid === pid);
      if (ws && ws._charId) {
        mysql.saveCharacter(ws._charId, {
          name: p.name, class: p.class, level: p.level, xp: p.xp, gold: p.gold,
          hp: p.hp, maxHp: p.maxHp, mana: p.mana, maxMana: p.maxMana,
          str: p.str, dex: p.dex, int: p.int, vit: p.vit,
          pos: p.pos, isOnline: true,
        }).catch(() => {});
      }
    }
  }
}, 50);

// Verify MySQL on startup
mysql.POOL.getConnection().then((conn) => {
  console.log("[DB] MySQL connected ✓");
  conn.release();
}).catch((err) => {
  console.error("[DB] MySQL connection failed:", err.message);
  console.log("[DB] Game will run with in-memory characters only");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`VR RPG Online running at http://0.0.0.0:${PORT}`);
  console.log(`WebSocket endpoint: ws://0.0.0.0:${PORT}`);
});
