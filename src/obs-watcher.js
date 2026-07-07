"use strict";
/**
 * VR RPG — OBS Auto-Capture Watcher
 * Connects to game WebSocket, records highlight events to JSONL + OBS text files.
 *
 * Usage:
 *   node obs-watcher.js
 *
 * Outputs:
 *   highlights/highlights.jsonl  — machine-readable event log
 *   highlights/obs-kill.txt      — latest kill text for OBS Text Source
 *   highlights/obs-loot.txt      — latest epic drop text for OBS Text Source
 *   highlights/obs-level.txt     — latest level-up text for OBS Text Source
 *   highlights/session.json      — current session metadata
 */

const fs = require("node:fs");
const path = require("node:path");
const { WebSocket } = require("ws");

const GAME_WS = process.env.VRPG_WS || "ws://localhost:8942";
const OUT_DIR = process.env.VRPG_OUT || path.join(__dirname, "..", "highlights");
const RECORD_SECONDS = Number(process.env.VRPG_RECORD_SECS || 15);

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const jsonlPath = path.join(OUT_DIR, "highlights.jsonl");
const sessionPath = path.join(OUT_DIR, "session.json");

let session = {
  startedAt: new Date().toISOString(),
  kills: 0,
  levels: 0,
  epics: 0,
  rares: 0,
  totalGold: 0,
  highlights: [],
};

function saveSession() {
  fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2));
}

function appendHighlight(entry) {
  const line = JSON.stringify(entry) + "\n";
  fs.appendFileSync(jsonlPath, line);
  session.highlights.push(entry);
}

function writeObsText(file, text) {
  fs.writeFileSync(path.join(OUT_DIR, file), text + "\n");
}

function nowIso() {
  return new Date().toISOString();
}

function connect() {
  const ws = new WebSocket(GAME_WS);

  ws.on("open", () => {
    console.log(`[OBS-Watcher] Connected to ${GAME_WS}`);
    ws.send(JSON.stringify({ type: "join", name: "OBSWatcher", charClass: "warrior" }));
  });

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }

    if (msg.type !== "world" || !msg.data) return;
    const data = msg.data;

    // Track our own player stats
    const me = (data.players || []).find(p => p.name === "OBSWatcher");
    if (me) {
      session.player = {
        name: me.name,
        level: me.level,
        gold: me.gold,
        kills: me.kills,
        class: me.class,
      };
    }

    // Listen for highlights (kill, level_up, loot)
    if (data.highlights && data.highlights.length > 0) {
      for (const h of data.highlights.slice(0, 3)) {
        if (!h) continue;
        if (h.type === 'kill') {
          const entry = { t: nowIso(), type: 'kill', text: `${h.player} defeated ${h.target}!` };
          session.kills += 1;
          appendHighlight(entry);
          writeObsText('obs-kill.txt', `⚔️ KILL: ${h.player} → ${h.target}`);
          console.log(`[KILL] ${h.player} defeated ${h.target}`);
        }
        if (h.type === 'level_up') {
          const entry = { t: nowIso(), type: 'level_up', text: `${h.player} reached level ${h.level}!` };
          session.levels += 1;
          appendHighlight(entry);
          writeObsText('obs-level.txt', `⬆️ LEVEL ${h.level}!`);
          console.log(`[LEVEL] ${h.player} reached level ${h.level}`);
        }
        if (h.type === 'loot') {
          const entry = { t: nowIso(), type: 'loot', text: h.item || 'Found loot' };
          const isEpic = (h.rarity === 'epic') || (h.item && /epic/i.test(h.item));
          const isRare = (h.rarity === 'rare') || (h.item && /rare/i.test(h.item));
          if (isEpic) session.epics += 1;
          if (isRare) session.rares += 1;
          appendHighlight(entry);
          if (isEpic || isRare) {
            writeObsText('obs-loot.txt', `💎 LOOT: ${h.item}`);
            console.log(`[LOOT] ${h.item}`);
          }
        }
      }
    }

    // Also process text events for gold tracking
    if (data.events && data.events.length > 0) {
      for (const ev of data.events.slice(0, 3)) {
        if (!ev.text) continue;
        const match = ev.text.match(/(\d+)\s+gold/i);
        if (match) session.totalGold += Number(match[1]);
      }
    }

    saveSession();
  });

  ws.on("close", () => {
    console.log("[OBS-Watcher] Disconnected, reconnecting in 3s…");
    setTimeout(connect, 3000);
  });

  ws.on("error", (err) => {
    console.error("[OBS-Watcher] WS error:", err.message);
  });
}

// Initial session file
saveSession();
connect();

// Heartbeat log every 60s
setInterval(() => {
  console.log(`[Session] Kills:${session.kills} Levels:${session.levels} Epics:${session.epics} Gold:${session.totalGold}`);
}, 60000);
