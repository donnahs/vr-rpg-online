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

const PORT = Number(process.env.PORT || 8942);
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
      world.addPlayer(pid, msg.name || "Hero");
      broadcastWorld();
    }
    if (msg.type === "update") {
      world.updatePlayer(pid, msg.data || {});
    }
    if (msg.type === "attack") {
      const result = world.playerAttack(pid);
      if (result) broadcastWorld();
    }
    if (msg.type === "pickup") {
      const result = world.pickupItem(pid);
      if (result) broadcastWorld();
    }
  });

  ws.on("close", () => {
    world.removePlayer(pid);
    broadcastWorld();
    console.log(`[WS] Disconnect ${pid}`);
  });
});

// Server tick loop (20 Hz)
setInterval(() => {
  world.tick();
  broadcastWorld();
}, 50);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`VR RPG Online running at http://0.0.0.0:${PORT}`);
  console.log(`WebSocket endpoint: ws://0.0.0.0:${PORT}`);
});
