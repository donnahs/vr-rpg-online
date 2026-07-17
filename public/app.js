"use strict";
/**
 * VR RPG Online — Three.js Client
 * First-person dungeon crawler with optional WebXR
 */

import * as THREE from "three";
import { XRControllerModelFactory } from "three/addons/webxr/XRControllerModelFactory.js";

// ── Config ──
const WS_URL = `ws://${location.host}`;
const MOVE_SPEED = 3.5;
const SENSITIVITY = 0.002;

// ── State ──
let ws, pid, myName = "Hero";
let worldState = { players:[], enemies:[], items:[], walls:[], events:[] };
let myPlayer = null;
let keys = {};
let mouseLocked = false;
let yaw = 0, pitch = 0;
let clock = new THREE.Clock();

// ── Effect Tracking ──
let previousEnemyHps = new Map();
let previousEvents = new Set();
let previousHighlights = new Set();

// ── VR Gesture Combat Tracking ──
let controllerHistory = [];       // Recent controller poses for velocity calc
const HISTORY_MS = 150;           // 150ms window for gesture detection
let vrWeaponMesh = null;           // Visual sword/bow attached to dominant hand
let bowChargeStart = 0;            // Timestamp when bow draw began
let bowChargeLevel = 0;            // 0-1 charge amount
let vrLastAttackTime = 0;          // Cooldown tracking
let vrGestureState = "idle";       // idle | swing | overhead | draw

// ── Three.js setup ──
const container = document.getElementById("canvas-container");
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0a0a);
scene.fog = new THREE.FogExp2(0x0a0a0a, 0.035);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 1.6, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.xr.enabled = true;
container.appendChild(renderer.domElement);

// ── Lights ──
const ambient = new THREE.AmbientLight(0x404060, 0.6);
scene.add(ambient);
const moon = new THREE.DirectionalLight(0x8899ff, 0.8);
moon.position.set(10, 20, 10);
moon.castShadow = true;
scene.add(moon);

// ── Materials ──
const matFloor = new THREE.MeshStandardMaterial({ color: 0x1a1a2e, roughness: 0.9 });
const matWall = new THREE.MeshStandardMaterial({ color: 0x2c3e50, roughness: 0.7 });
const matEnemy = new THREE.MeshStandardMaterial({ color: 0xe74c3c, emissive: 0x440000 });
const matItemGold = new THREE.MeshStandardMaterial({ color: 0xf1c40f, emissive: 0x554400 });
const matItemPotion = new THREE.MeshStandardMaterial({ color: 0xe91e63, emissive: 0x440022 });
const matItemSword = new THREE.MeshStandardMaterial({ color: 0x95a5a6 });
const matItemShield = new THREE.MeshStandardMaterial({ color: 0x3498db });

// ── Floor ──
const floorGeo = new THREE.PlaneGeometry(80, 80);
const floor = new THREE.Mesh(floorGeo, matFloor);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

// ── Object pools ──
const meshes = { players: new Map(), enemies: new Map(), items: new Map(), walls: new Map() };

function getOrCreate(type, id, createFn) {
  let m = meshes[type].get(id);
  if (!m) { m = createFn(); meshes[type].set(id, m); scene.add(m); }
  return m;
}

function createPlayerMesh(color) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.8, 4, 8), new THREE.MeshStandardMaterial({ color }));
  body.position.y = 0.7;
  body.castShadow = true;
  g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8), new THREE.MeshStandardMaterial({ color }));
  head.position.y = 1.45;
  g.add(head);
  // Name label
  const canvas = document.createElement("canvas");
  canvas.width = 256; canvas.height = 64;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = "#fff";
  ctx.font = "bold 24px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Name", 128, 40);
  const tex = new THREE.CanvasTexture(canvas);
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  label.position.y = 1.9;
  label.scale.set(1.2, 0.3, 1);
  g.add(label);
  g.userData.label = label;
  g.userData.labelCanvas = canvas;
  g.userData.labelCtx = ctx;
  return g;
}

function createEnemyMesh(etype, isBoss = false) {
  const color = isBoss ? 0xff00ff : (etype === "goblin" ? 0xe74c3c : 0xc0392b);
  const scale = isBoss ? 3.0 : 1.0;
  const g = new THREE.Group();
  
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.25 * scale, 0.5 * scale, 4, 8),
    new THREE.MeshStandardMaterial({ color, emissive: isBoss ? 0x440044 : 0x220000, metalness: isBoss ? 0.8 : 0.2, roughness: 0.4 })
  );
  body.position.y = 0.5 * scale;
  body.castShadow = true;
  g.add(body);
  
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.2 * scale, 8, 8),
    new THREE.MeshStandardMaterial({ color, metalness: isBoss ? 0.9 : 0.1 })
  );
  head.position.y = 0.9 * scale;
  g.add(head);
  
  // Eyes
  const eyeGeo = new THREE.SphereGeometry(0.04 * scale, 4, 4);
  const eyeMat = new THREE.MeshBasicMaterial({ color: isBoss ? 0xffff00 : 0xff0000 });
  const eyeL = new THREE.Mesh(eyeGeo, eyeMat); eyeL.position.set(-0.08 * scale, 0.92 * scale, 0.15 * scale);
  const eyeR = new THREE.Mesh(eyeGeo, eyeMat); eyeR.position.set(0.08 * scale, 0.92 * scale, 0.15 * scale);
  g.add(eyeL, eyeR);
  
  // Boss horns
  if (isBoss) {
    const hornGeo = new THREE.ConeGeometry(0.08 * scale, 0.3 * scale, 4);
    const hornMat = new THREE.MeshStandardMaterial({ color: 0x444444, metalness: 0.9 });
    const hornL = new THREE.Mesh(hornGeo, hornMat); hornL.position.set(-0.15 * scale, 1.2 * scale, 0); hornL.rotation.z = 0.3;
    const hornR = new THREE.Mesh(hornGeo, hornMat); hornR.position.set(0.15 * scale, 1.2 * scale, 0); hornR.rotation.z = -0.3;
    g.add(hornL, hornR);
  }
  
  // HP bar
  const barGeo = new THREE.PlaneGeometry(0.6 * scale, 0.08 * scale);
  const barMat = new THREE.MeshBasicMaterial({ color: 0x2ecc71 });
  const bar = new THREE.Mesh(barGeo, barMat);
  bar.position.y = 1.3 * scale;
  bar.userData.baseWidth = 0.6 * scale;
  g.add(bar);
  g.userData.hpBar = bar;
  g.userData.isBoss = isBoss;
  return g;
}

function createItemMesh(itype) {
  let color, geo;
  if (itype === "gold") { color = matItemGold; geo = new THREE.OctahedronGeometry(0.2, 0); }
  else if (itype === "potion") { color = matItemPotion; geo = new THREE.SphereGeometry(0.18, 8, 8); }
  else if (itype === "sword") { color = matItemSword; geo = new THREE.BoxGeometry(0.05, 0.4, 0.05); }
  else { color = matItemShield; geo = new THREE.BoxGeometry(0.25, 0.35, 0.06); }
  const m = new THREE.Mesh(geo, color);
  m.castShadow = true;
  m.userData.floatOffset = Math.random() * Math.PI * 2;
  return m;
}

function createWallMesh(w) {
  const wdx = w.max.x - w.min.x;
  const wdy = w.max.y - w.min.y;
  const wdz = w.max.z - w.min.z;
  const geo = new THREE.BoxGeometry(wdx, wdy, wdz);
  const m = new THREE.Mesh(geo, matWall);
  m.position.set(w.min.x + wdx/2, w.min.y + wdy/2, w.min.z + wdz/2);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// ── VR Weapon Meshes ──
function createSwordMesh() {
  const g = new THREE.Group();
  // Blade
  const blade = new THREE.Mesh(
    new THREE.BoxGeometry(0.04, 0.5, 0.02),
    new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.9, roughness: 0.2 })
  );
  blade.position.y = 0.25;
  blade.castShadow = true;
  g.add(blade);
  // Hilt
  const hilt = new THREE.Mesh(
    new THREE.CylinderGeometry(0.02, 0.02, 0.15),
    new THREE.MeshStandardMaterial({ color: 0x8b4513, metalness: 0.3 })
  );
  hilt.position.y = -0.05;
  g.add(hilt);
  // Guard
  const guard = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.02, 0.04),
    new THREE.MeshStandardMaterial({ color: 0xdaa520, metalness: 0.8 })
  );
  guard.position.y = 0.02;
  g.add(guard);
  g.userData.type = "sword";
  return g;
}

function createBowMesh() {
  const g = new THREE.Group();
  // Bow curve (approximated with a bent tube or just a curved shape)
  const curve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(-0.15, 0.2, 0),
    new THREE.Vector3(0, -0.1, 0),
    new THREE.Vector3(0.15, 0.2, 0)
  );
  const tubeGeo = new THREE.TubeGeometry(curve, 8, 0.015, 4, false);
  const bowMat = new THREE.MeshStandardMaterial({ color: 0x8b4513, metalness: 0.3 });
  const bow = new THREE.Mesh(tubeGeo, bowMat);
  bow.castShadow = true;
  g.add(bow);
  // String
  const stringGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-0.15, 0.2, 0),
    new THREE.Vector3(0, -0.1, 0),
    new THREE.Vector3(0.15, 0.2, 0),
  ]);
  const stringMat = new THREE.LineBasicMaterial({ color: 0xdddddd });
  const stringLine = new THREE.Line(stringGeo, stringMat);
  g.add(stringLine);
  g.userData.type = "bow";
  g.userData.stringLine = stringLine;
  return g;
}

function createArrowMesh() {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.01, 0.01, 0.4),
    new THREE.MeshStandardMaterial({ color: 0x8b4513 })
  );
  shaft.rotation.z = Math.PI / 2;
  g.add(shaft);
  const tip = new THREE.Mesh(
    new THREE.ConeGeometry(0.02, 0.08, 4),
    new THREE.MeshStandardMaterial({ color: 0xaaaaaa, metalness: 0.8 })
  );
  tip.rotation.z = -Math.PI / 2;
  tip.position.x = 0.24;
  g.add(tip);
  const fletch = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.02, 0.01),
    new THREE.MeshStandardMaterial({ color: 0xcc0000 })
  );
  fletch.position.x = -0.22;
  g.add(fletch);
  return g;
}

// ── WebSocket ──
function connect() {
  ws = new WebSocket(WS_URL);
  ws.onopen = () => {
    logEvent("Connected to server");
    send({ type: "join", name: myName, charClass: selectedClass, bonusStats: {} });
  };
  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch (e) { return; }
    if (msg.type === "connected") { pid = msg.pid; }
    if (msg.type === "world") { worldState = msg.data; }
    if (msg.type === "chat") { handleChatMessage(msg.data); }
  };
  ws.onclose = () => { logEvent("Disconnected — reconnecting..."); setTimeout(connect, 2000); };
  ws.onerror = () => {};
}

function send(msg) { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); }

// ── Input ──
function lockPointer() { renderer.domElement.requestPointerLock(); }
function unlockPointer() { document.exitPointerLock(); }

document.addEventListener("pointerlockchange", () => {
  mouseLocked = !!document.pointerLockElement;
});

renderer.domElement.addEventListener("click", () => {
  if (!mouseLocked && document.getElementById("login-overlay").classList.contains("hidden")) {
    lockPointer();
  }
});

document.addEventListener("mousemove", (e) => {
  if (!mouseLocked) return;
  yaw -= e.movementX * SENSITIVITY;
  pitch -= e.movementY * SENSITIVITY;
  pitch = Math.max(-Math.PI/2 + 0.1, Math.min(Math.PI/2 - 0.1, pitch));
});

document.addEventListener("keydown", (e) => {
  keys[e.key.toLowerCase()] = true;
  if (e.key.toLowerCase() === "e") { send({ type: "pickup" }); }
});
document.addEventListener("keyup", (e) => { keys[e.key.toLowerCase()] = false; });

// Mobile touch controls
let touchStart = null, touchYaw = 0, touchPitch = 0;
renderer.domElement.addEventListener("touchstart", (e) => {
  if (e.touches.length === 1) { touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }
});
renderer.domElement.addEventListener("touchmove", (e) => {
  if (touchStart && e.touches.length === 1) {
    const dx = e.touches[0].clientX - touchStart.x;
    const dy = e.touches[0].clientY - touchStart.y;
    yaw -= dx * SENSITIVITY * 2;
    pitch -= dy * SENSITIVITY * 2;
    pitch = Math.max(-Math.PI/2 + 0.1, Math.min(Math.PI/2 - 0.1, pitch));
    touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }
});
renderer.domElement.addEventListener("touchend", () => { touchStart = null; });

// ── HUD ──
function logEvent(text) {
  const el = document.getElementById("events-log");
  const div = document.createElement("div");
  div.textContent = text;
  el.insertBefore(div, el.firstChild);
  while (el.children.length > 20) el.removeChild(el.lastChild);
}

function updateHUD() {
  if (!myPlayer) return;

  // Track HP loss for hurt sound
  if (typeof updateHUD._prevHp !== "undefined" && myPlayer.hp < updateHUD._prevHp) {
    playSound("hurt", 0.4);
  }
  updateHUD._prevHp = myPlayer.hp;

  document.getElementById("p-name").textContent = myPlayer.name;
  document.getElementById("p-class").textContent = (myPlayer.class || "warrior").charAt(0).toUpperCase() + (myPlayer.class || "warrior").slice(1);
  document.getElementById("p-level").textContent = `Lv.${myPlayer.level}`;
  document.getElementById("p-hp").textContent = myPlayer.hp;
  document.getElementById("p-maxhp").textContent = myPlayer.maxHp;
  document.getElementById("hp-bar").style.width = `${(myPlayer.hp / myPlayer.maxHp) * 100}%`;
  
  // Mana
  const mana = myPlayer.mana || 0;
  const maxMana = myPlayer.maxMana || 30;
  document.getElementById("p-mana").textContent = mana;
  document.getElementById("p-maxmana").textContent = maxMana;
  const manaBar = document.getElementById("mana-bar");
  if (manaBar) manaBar.style.width = `${(mana / maxMana) * 100}%`;
  
  // Stats
  document.getElementById("p-str").textContent = myPlayer.str || 8;
  document.getElementById("p-dex").textContent = myPlayer.dex || 4;
  document.getElementById("p-int").textContent = myPlayer.int || 3;
  document.getElementById("p-vit").textContent = myPlayer.vit || 7;
  
  document.getElementById("p-gold").textContent = myPlayer.gold;
  document.getElementById("p-xp").textContent = myPlayer.xp;
  document.getElementById("p-kills").textContent = myPlayer.kills || 0;
  document.getElementById("player-stats").style.display = "block";

  // Dungeon progression display
  const depthEl = document.getElementById("dungeon-depth");
  const enemyEl = document.getElementById("enemy-count");
  if (depthEl) depthEl.textContent = worldState.dungeonDepth || 1;
  if (enemyEl) enemyEl.textContent = worldState.enemyCount || 0;

  // Equipment
  const eq = myPlayer.equipment || {};
  document.getElementById("eq-weapon").textContent = eq.weapon ? eq.weapon.name : "None";
  document.getElementById("eq-weapon").style.color = eq.weapon ? (eq.weapon.color || "#fff") : "#aaa";
  document.getElementById("eq-armor").textContent = eq.armor ? eq.armor.name : "None";
  document.getElementById("eq-armor").style.color = eq.armor ? (eq.armor.color || "#fff") : "#aaa";
  document.getElementById("eq-ring").textContent = eq.ring ? eq.ring.name : "None";
  document.getElementById("eq-ring").style.color = eq.ring ? (eq.ring.color || "#fff") : "#aaa";

  // Skills bar
  const skillsBar = document.getElementById("skills-bar");
  if (skillsBar && myPlayer.skills) {
    skillsBar.innerHTML = "";
    for (const s of myPlayer.skills) {
      const btn = document.createElement("button");
      btn.className = "action-btn";
      btn.style.fontSize = "0.7rem";
      btn.style.padding = "4px 8px";
      const ready = s.ready ? "" : " [CD]";
      btn.textContent = `${s.key}: ${s.name}${ready}`;
      if (!s.ready) btn.style.opacity = "0.5";
      skillsBar.appendChild(btn);
    }
  }

  // Update events from server
  const el = document.getElementById("events-log");
  if (worldState.events && worldState.events.length > 0) {
    const latest = worldState.events[0];
    if (el.firstChild && el.firstChild.textContent !== latest.text) {
      const div = document.createElement("div");
      div.textContent = latest.text;
      el.insertBefore(div, el.firstChild);
      while (el.children.length > 20) el.removeChild(el.lastChild);
      
      // Sound triggers based on event text
      const text = latest.text;
      if (text.includes("defeated")) playSound("death", 0.4);
      else if (text.includes("reached level")) playSound("levelup", 0.5);
      else if (text.includes("found")) playSound("loot", 0.3);
      else if (text.includes("BOSS")) playSound("bossroar", 0.6);
      else if (text.includes("picked up") || text.includes("looted")) playSound("pickup", 0.3);
      else if (text.includes("equipped")) playSound("equip", 0.3);
      else if (text.includes("FLOOR") && text.includes("CLEARED")) {
        playSound("levelup", 0.6);
        // Floor clear screen flash
        const flash = document.createElement("div");
        flash.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(243,156,18,0.3);z-index:9999;pointer-events:none;animation:fadeOut 2s ease-out forwards;";
        document.body.appendChild(flash);
        setTimeout(() => flash.remove(), 2000);
      }
  }

  // Update stream highlights (kill, level up, rare loot)
  const hlEl = document.getElementById("stream-highlights");
  if (worldState.highlights && worldState.highlights.length > 0) {
    hlEl.style.display = "block";
    // Check for new highlights and play sounds
    for (const h of worldState.highlights.slice(0, 5)) {
      const key = `${h.type}_${h.player}_${h.timestamp}`;
      if (!previousHighlights.has(key)) {
        previousHighlights.add(key);
        if (h.type === "level_up") playSound("levelup", 0.5);
        if (h.type === "loot") playSound("loot", 0.4);
      }
    }
    // Rebuild highlights list
    while (hlEl.children.length > 1) hlEl.removeChild(hlEl.lastChild);
    for (const h of worldState.highlights.slice(0, 5)) {
      const div = document.createElement("div");
      let text = "";
      if (h.type === "kill") text = `⚔️ ${h.player} killed ${h.target}`;
      else if (h.type === "level_up") text = `⬆️ ${h.player} reached Lv.${h.level}`;
      else if (h.type === "loot") text = `💎 ${h.player} found ${h.item}`;
      div.textContent = text;
      hlEl.appendChild(div);
    }
  } else {
    hlEl.style.display = "none";
  }
  
  // Leaderboard
  const lbEl = document.getElementById("leaderboard");
  if (worldState.leaderboard && worldState.leaderboard.length > 0) {
    lbEl.style.display = "block";
    while (lbEl.children.length > 1) lbEl.removeChild(lbEl.lastChild);
    for (const entry of worldState.leaderboard) {
      const div = document.createElement("div");
      const classEmoji = entry.class === "warrior" ? "⚔️" : entry.class === "rogue" ? "🗡️" : "🔮";
      div.textContent = `${classEmoji} ${entry.name} — Lv.${entry.level} (${entry.xp} XP)`;
      lbEl.appendChild(div);
    }
  } else {
    lbEl.style.display = "none";
  }
}

// ── Attack ──
function doAttack() {
  send({ type: "attack" });
  
  // Play sword swing sound
  playSound("swing", 0.4);
  
  // Visual feedback
  const flash = new THREE.PointLight(0xffaa00, 2, 5);
  flash.position.set(0, 0, -1).applyQuaternion(camera.quaternion).add(camera.position);
  scene.add(flash);
  setTimeout(() => scene.remove(flash), 100);
  
  // Screen shake
  screenShake(0.3, 100);
}

// ── Audio Engine ──
let audioCtx = null;
function ensureAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") audioCtx.resume();
}
function playSound(type, volume = 0.3) {
  ensureAudio();
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  gain.gain.value = volume;
  
  const now = audioCtx.currentTime;
  switch (type) {
    case "swing":
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(400, now);
      osc.frequency.exponentialRampToValueAtTime(200, now + 0.1);
      gain.gain.setValueAtTime(volume, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
      osc.start(now);
      osc.stop(now + 0.1);
      break;
    case "hit":
      osc.type = "square";
      osc.frequency.setValueAtTime(150, now);
      osc.frequency.exponentialRampToValueAtTime(80, now + 0.08);
      gain.gain.setValueAtTime(volume, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
      osc.start(now);
      osc.stop(now + 0.08);
      break;
    case "crit":
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(600, now);
      osc.frequency.exponentialRampToValueAtTime(300, now + 0.15);
      gain.gain.setValueAtTime(volume * 1.2, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
      osc.start(now);
      osc.stop(now + 0.15);
      break;
    case "death":
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(200, now);
      osc.frequency.exponentialRampToValueAtTime(50, now + 0.3);
      gain.gain.setValueAtTime(volume, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
      osc.start(now);
      osc.stop(now + 0.3);
      break;
    case "levelup":
      osc.type = "sine";
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.setValueAtTime(554, now + 0.1);
      osc.frequency.setValueAtTime(659, now + 0.2);
      gain.gain.setValueAtTime(volume, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.4);
      osc.start(now);
      osc.stop(now + 0.4);
      break;
    case "loot":
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.setValueAtTime(1100, now + 0.05);
      gain.gain.setValueAtTime(volume, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
      osc.start(now);
      osc.stop(now + 0.1);
      break;

    // ── NEW SOUNDS ──

    case "footstep":
      // Soft thud — low frequency noise burst
      osc.type = "sine";
      osc.frequency.setValueAtTime(80 + Math.random() * 20, now);
      osc.frequency.exponentialRampToValueAtTime(40, now + 0.08);
      gain.gain.setValueAtTime(volume * 0.5, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
      osc.start(now);
      osc.stop(now + 0.08);
      break;

    case "door":
      // Creaky door — descending tone with wobble
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(300, now);
      osc.frequency.setValueAtTime(280, now + 0.05);
      osc.frequency.setValueAtTime(310, now + 0.1);
      osc.frequency.exponentialRampToValueAtTime(150, now + 0.4);
      gain.gain.setValueAtTime(volume * 0.4, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.4);
      osc.start(now);
      osc.stop(now + 0.4);
      break;

    case "potion":
      // Glug-glug — two quick descending tones
      osc.type = "sine";
      osc.frequency.setValueAtTime(600, now);
      osc.frequency.exponentialRampToValueAtTime(400, now + 0.1);
      gain.gain.setValueAtTime(volume * 0.5, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
      osc.start(now);
      osc.stop(now + 0.1);
      // Second glug
      const osc2 = audioCtx.createOscillator();
      const gain2 = audioCtx.createGain();
      osc2.connect(gain2);
      gain2.connect(audioCtx.destination);
      osc2.type = "sine";
      osc2.frequency.setValueAtTime(550, now + 0.12);
      osc2.frequency.exponentialRampToValueAtTime(350, now + 0.22);
      gain2.gain.setValueAtTime(volume * 0.4, now + 0.12);
      gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.22);
      osc2.start(now + 0.12);
      osc2.stop(now + 0.22);
      break;

    case "equip":
      // metallic clink
      osc.type = "triangle";
      osc.frequency.setValueAtTime(1200, now);
      osc.frequency.setValueAtTime(900, now + 0.03);
      osc.frequency.exponentialRampToValueAtTime(600, now + 0.15);
      gain.gain.setValueAtTime(volume * 0.4, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
      osc.start(now);
      osc.stop(now + 0.15);
      break;

    case "bossroar":
      // Deep terrifying roar — layered low oscillators
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(80, now);
      osc.frequency.linearRampToValueAtTime(120, now + 0.1);
      osc.frequency.linearRampToValueAtTime(60, now + 0.3);
      osc.frequency.exponentialRampToValueAtTime(30, now + 1.0);
      gain.gain.setValueAtTime(volume, now);
      gain.gain.setValueAtTime(volume * 0.8, now + 0.3);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 1.0);
      osc.start(now);
      osc.stop(now + 1.0);
      // Add a second detuned oscillator for thickness
      const oscR = audioCtx.createOscillator();
      const gainR = audioCtx.createGain();
      oscR.connect(gainR);
      gainR.connect(audioCtx.destination);
      oscR.type = "square";
      oscR.frequency.setValueAtTime(55, now);
      oscR.frequency.linearRampToValueAtTime(75, now + 0.15);
      oscR.frequency.exponentialRampToValueAtTime(35, now + 1.0);
      gainR.gain.setValueAtTime(volume * 0.5, now);
      gainR.gain.exponentialRampToValueAtTime(0.01, now + 1.0);
      oscR.start(now);
      oscR.stop(now + 1.0);
      break;

    case "pickup":
      // Bright chime — ascending
      osc.type = "sine";
      osc.frequency.setValueAtTime(660, now);
      osc.frequency.setValueAtTime(880, now + 0.06);
      osc.frequency.setValueAtTime(1320, now + 0.12);
      gain.gain.setValueAtTime(volume * 0.5, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
      osc.start(now);
      osc.stop(now + 0.2);
      break;

    case "uiclick":
      // Subtle UI blip
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, now);
      gain.gain.setValueAtTime(volume * 0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.05);
      osc.start(now);
      osc.stop(now + 0.05);
      break;

    case "hurt":
      // Player takes damage — sharp descending tone
      osc.type = "square";
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.exponentialRampToValueAtTime(110, now + 0.2);
      gain.gain.setValueAtTime(volume * 0.6, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
      osc.start(now);
      osc.stop(now + 0.2);
      break;
  }
}

// ── Ambient Dungeon Audio (Expanded) ──
let ambientNodes = null;
let lastFootstepTime = 0;
let lastAmbientSound = 0;
let ambientStarted = false;

// Audio state: 'explore' (calm), 'danger' (enemy near), 'combat' (recently attacked), 'boss' (boss alive & near)
let audioState = "explore";
let audioStateTimer = 0; // seconds since state change
let masterVolume = 0.7;
let musicVolume = 0.3;

// Expanded ambient sound timers
let lastWindGust = 0;
let lastChainRattle = 0;
let lastMagicHum = 0;
let lastTorchCrackle = 0;

function startAmbientAudio() {
  if (ambientStarted) return;
  ambientStarted = true;
  ensureAudio();
  if (!audioCtx) return;

  // Master gain node — all audio routes through here
  const masterGain = audioCtx.createGain();
  masterGain.gain.value = masterVolume;
  masterGain.connect(audioCtx.destination);

  // ── Low rumble drone (exploration layer) — two detuned oscillators through a low-pass filter
  const droneFreq = 55; // A1
  const droneOsc1 = audioCtx.createOscillator();
  const droneOsc2 = audioCtx.createOscillator();
  const droneGain = audioCtx.createGain();
  const droneFilter = audioCtx.createBiquadFilter();

  droneOsc1.type = "sawtooth";
  droneOsc1.frequency.value = droneFreq;
  droneOsc2.type = "sawtooth";
  droneOsc2.frequency.value = droneFreq * 1.005; // slight detune for beating

  droneFilter.type = "lowpass";
  droneFilter.frequency.value = 120;
  droneFilter.Q.value = 1.0;

  droneGain.gain.value = 0.04; // quiet background drone

  droneOsc1.connect(droneFilter);
  droneOsc2.connect(droneFilter);
  droneFilter.connect(droneGain);
  droneGain.connect(masterGain);

  droneOsc1.start();
  droneOsc2.start();

  // Slow LFO on filter for breathing effect
  const lfo = audioCtx.createOscillator();
  const lfoGain = audioCtx.createGain();
  lfo.frequency.value = 0.08; // very slow
  lfoGain.gain.value = 30;
  lfo.connect(lfoGain);
  lfoGain.connect(droneFilter.frequency);
  lfo.start();

  // ── Danger layer: higher-pitched dissonant drone (activates when enemies near)
  const dangerOsc1 = audioCtx.createOscillator();
  const dangerOsc2 = audioCtx.createOscillator();
  const dangerGain = audioCtx.createGain();
  const dangerFilter = audioCtx.createBiquadFilter();

  dangerOsc1.type = "sawtooth";
  dangerOsc1.frequency.value = 110; // A2 — octave up
  dangerOsc2.type = "square";
  dangerOsc2.frequency.value = 116; // dissonant interval

  dangerFilter.type = "lowpass";
  dangerFilter.frequency.value = 200;
  dangerFilter.Q.value = 2.0;

  dangerGain.gain.value = 0.0; // starts silent, ramps up in danger state
  dangerOsc1.connect(dangerFilter);
  dangerOsc2.connect(dangerFilter);
  dangerFilter.connect(dangerGain);
  dangerGain.connect(masterGain);

  dangerOsc1.start();
  dangerOsc2.start();

  // ── Combat layer: fast pulsing beat (activates during combat)
  const combatOsc = audioCtx.createOscillator();
  const combatGain = audioCtx.createGain();
  const combatLFO = audioCtx.createOscillator();
  const combatLFOGain = audioCtx.createGain();

  combatOsc.type = "sawtooth";
  combatOsc.frequency.value = 220; // A3
  combatLFO.type = "square";
  combatLFO.frequency.value = 4.0; // fast pulse — heartbeat-like
  combatLFOGain.gain.value = 0.0; // starts silent

  combatLFO.connect(combatLFOGain);
  combatLFOGain.connect(combatGain.gain);
  combatOsc.connect(combatGain);
  combatGain.connect(masterGain);

  combatOsc.start();
  combatLFO.start();

  // ── Boss layer: deep terrifying low drone (activates when boss is near)
  const bossOsc1 = audioCtx.createOscillator();
  const bossOsc2 = audioCtx.createOscillator();
  const bossGain = audioCtx.createGain();
  const bossFilter = audioCtx.createBiquadFilter();

  bossOsc1.type = "sawtooth";
  bossOsc1.frequency.value = 35; // very low
  bossOsc2.type = "sawtooth";
  bossOsc2.frequency.value = 37; // slightly detuned for unsettling effect

  bossFilter.type = "lowpass";
  bossFilter.frequency.value = 80;
  bossFilter.Q.value = 3.0;

  bossGain.gain.value = 0.0; // starts silent
  bossOsc1.connect(bossFilter);
  bossOsc2.connect(bossFilter);
  bossFilter.connect(bossGain);
  bossGain.connect(masterGain);

  bossOsc1.start();
  bossOsc2.start();

  ambientNodes = { 
    droneOsc1, droneOsc2, droneGain, droneFilter, lfo, 
    masterGain,
    dangerOsc1, dangerOsc2, dangerGain, dangerFilter,
    combatOsc, combatGain, combatLFO, combatLFOGain,
    bossOsc1, bossOsc2, bossGain, bossFilter,
  };
}

function stopAmbientAudio() {
  if (!ambientNodes) return;
  try {
    ambientNodes.droneOsc1.stop();
    ambientNodes.droneOsc2.stop();
    ambientNodes.lfo.stop();
    ambientNodes.dangerOsc1.stop();
    ambientNodes.dangerOsc2.stop();
    ambientNodes.combatOsc.stop();
    ambientNodes.combatLFO.stop();
    ambientNodes.bossOsc1.stop();
    ambientNodes.bossOsc2.stop();
  } catch (e) {}
  ambientNodes = null;
  ambientStarted = false;
}

// ── Adaptive Audio State Manager ──
// Determines which audio layer should be active based on game state
function updateAudioState(dt) {
  if (!ambientNodes || !audioCtx || !myPlayer) return;

  const now = audioCtx.currentTime;
  audioStateTimer += dt;

  // Determine desired state
  let desiredState = "explore";
  
  // Check if boss is alive and near
  let bossNear = false;
  let enemyNear = false;
  let inCombat = false;

  for (const e of worldState.enemies || []) {
    const dx = e.pos.x - myPlayer.pos.x;
    const dz = e.pos.z - myPlayer.pos.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (e.isBoss && d < 20) { bossNear = true; }
    if (d < 8) { enemyNear = true; }
  }

  // Check recent combat (HP changed recently or attacked recently)
  if (typeof updateAudioState._lastHp !== "undefined") {
    if (myPlayer.hp < updateAudioState._lastHp) {
      audioStateTimer = 0; // reset timer — we're in combat
    }
  }
  updateAudioState._lastHp = myPlayer.hp;

  if (bossNear) desiredState = "boss";
  else if (audioStateTimer < 5.0 && (enemyNear || myPlayer.hp < myPlayer.maxHp * 0.5)) desiredState = "combat";
  else if (enemyNear) desiredState = "danger";
  else desiredState = "explore";

  // Smoothly transition gains
  if (desiredState !== audioState) {
    audioState = desiredState;
    audioStateTimer = 0;
  }

  const rampTime = 2.0; // 2s smooth transition
  const exploreVol = audioState === "explore" ? 0.04 : 0.02;
  const dangerVol = audioState === "danger" ? 0.06 : 0.0;
  const combatVol = audioState === "combat" ? 0.08 : 0.0;
  const bossVol = audioState === "boss" ? 0.12 : 0.0;

  ambientNodes.droneGain.gain.setTargetAtTime(exploreVol, now, rampTime);
  ambientNodes.dangerGain.gain.setTargetAtTime(dangerVol, now, rampTime);
  ambientNodes.bossGain.gain.setTargetAtTime(bossVol, now, rampTime);

  // Combat layer: modulate gain with LFO for pulsing effect
  if (audioState === "combat") {
    ambientNodes.combatLFOGain.gain.setTargetAtTime(0.04, now, rampTime);
    ambientNodes.combatGain.gain.setTargetAtTime(0.5, now, rampTime);
  } else {
    ambientNodes.combatLFOGain.gain.setTargetAtTime(0.0, now, rampTime);
    ambientNodes.combatGain.gain.setTargetAtTime(0.0, now, rampTime);
  }

  // Update desktop audio state indicator
  const indicator = document.getElementById("audio-state-indicator");
  if (indicator) {
    const stateInfo = {
      explore: { text: "♪ Exploring", color: "#2ecc71" },
      danger: { text: "♪ Danger Near", color: "#f39c12" },
      combat: { text: "♪ Combat!", color: "#e74c3c" },
      boss: { text: "♪ BOSS THEME", color: "#ff00ff" },
    };
    const info = stateInfo[audioState] || stateInfo.explore;
    if (indicator.textContent !== info.text) {
      indicator.textContent = info.text;
      indicator.style.color = info.color;
    }
    indicator.style.display = "block";
  }
}

// Random ambient cave sounds — drips, distant rumble, whispers, wind gusts, chain rattles, magic hums, torch crackles
function maybePlayAmbientSound() {
  if (!audioCtx || !ambientStarted) return;
  const now = audioCtx.currentTime;
  if (now - lastAmbientSound < 2.5) return; // min 2.5s between sounds
  if (Math.random() > 0.006) return; // ~low probability per frame

  lastAmbientSound = now;

  // Connect through master gain if available
  const dest = ambientNodes ? ambientNodes.masterGain : audioCtx.destination;

  // 7 ambient sound types — more variety in exploration, fewer in combat
  const numTypes = audioState === "combat" ? 3 : 7;
  const soundType = Math.floor(Math.random() * numTypes);

  if (soundType === 0) {
    // Water drip — high pitched sine plink
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(dest);
    osc.type = "sine";
    const freq = 800 + Math.random() * 600;
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.5, now + 0.15);
    gain.gain.setValueAtTime(0.03, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    osc.start(now);
    osc.stop(now + 0.3);
  } else if (soundType === 1) {
    // Distant rumble — short low burst
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(dest);
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(40 + Math.random() * 20, now);
    gain.gain.setValueAtTime(0.02, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    osc.start(now);
    osc.stop(now + 0.5);
  } else if (soundType === 2) {
    // Whisper — filtered noise burst (approximated with high square wave)
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    const filter = audioCtx.createBiquadFilter();
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(dest);
    osc.type = "square";
    osc.frequency.setValueAtTime(200 + Math.random() * 100, now);
    filter.type = "bandpass";
    filter.frequency.value = 300;
    filter.Q.value = 5;
    gain.gain.setValueAtTime(0.015, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    osc.start(now);
    osc.stop(now + 0.4);
  } else if (soundType === 3) {
    // Wind gust — filtered noise sweep (approximated with modulated sawtooth)
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    const filter = audioCtx.createBiquadFilter();
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(dest);
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(50, now);
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(400, now);
    filter.frequency.exponentialRampToValueAtTime(200, now + 1.5);
    filter.Q.value = 1.5;
    gain.gain.setValueAtTime(0.0, now);
    gain.gain.linearRampToValueAtTime(0.025, now + 0.3);
    gain.gain.linearRampToValueAtTime(0.015, now + 1.0);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 1.5);
    osc.start(now);
    osc.stop(now + 1.5);
  } else if (soundType === 4) {
    // Chain rattle — rapid metallic clicks
    const filter = audioCtx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 2000;
    filter.Q.value = 8;
    const gain = audioCtx.createGain();
    gain.gain.value = 0.02;
    filter.connect(gain);
    gain.connect(dest);
    // Create 5-8 quick clicks
    const numClicks = 5 + Math.floor(Math.random() * 4);
    for (let i = 0; i < numClicks; i++) {
      const osc = audioCtx.createOscillator();
      osc.type = "square";
      const t = now + i * 0.06 + Math.random() * 0.02;
      osc.frequency.setValueAtTime(1500 + Math.random() * 500, t);
      osc.frequency.exponentialRampToValueAtTime(800, t + 0.03);
      const clickGain = audioCtx.createGain();
      clickGain.gain.setValueAtTime(0.015, t);
      clickGain.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
      osc.connect(filter);
      osc.start(t);
      osc.stop(t + 0.04);
    }
  } else if (soundType === 5) {
    // Magic hum — ethereal sustained sine with slow vibrato
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    const vibrato = audioCtx.createOscillator();
    const vibratoGain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(dest);
    vibrato.connect(vibratoGain);
    vibratoGain.connect(osc.frequency);
    osc.type = "sine";
    const baseFreq = 440 + Math.random() * 220;
    osc.frequency.value = baseFreq;
    vibrato.type = "sine";
    vibrato.frequency.value = 3.0;
    vibratoGain.gain.value = 5;
    gain.gain.setValueAtTime(0.0, now);
    gain.gain.linearRampToValueAtTime(0.02, now + 0.3);
    gain.gain.setValueAtTime(0.02, now + 0.5);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 1.0);
    osc.start(now);
    vibrato.start(now);
    osc.stop(now + 1.0);
    vibrato.stop(now + 1.0);
  } else {
    // Torch crackle — rapid tiny noise bursts (approximated with high-frequency clicks)
    const filter = audioCtx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 3000;
    const gain = audioCtx.createGain();
    gain.gain.value = 0.015;
    filter.connect(gain);
    gain.connect(dest);
    const numCrackles = 8 + Math.floor(Math.random() * 8);
    for (let i = 0; i < numCrackles; i++) {
      const osc = audioCtx.createOscillator();
      osc.type = "square";
      const t = now + i * 0.04 + Math.random() * 0.03;
      osc.frequency.setValueAtTime(3000 + Math.random() * 2000, t);
      const clickGain = audioCtx.createGain();
      clickGain.gain.setValueAtTime(0.008, t);
      clickGain.gain.exponentialRampToValueAtTime(0.001, t + 0.02);
      osc.connect(filter);
      osc.start(t);
      osc.stop(t + 0.025);
    }
  }
}

// ── Screen Shake ──
let shakeIntensity = 0;
function screenShake(intensity, durationMs) {
  shakeIntensity = intensity;
  setTimeout(() => { shakeIntensity = 0; }, durationMs);
}

// ── Floating Damage Numbers ──
const damageNumbers = [];
function spawnDamageNumber(pos, amount, isCrit = false, isHeal = false) {
  const div = document.createElement("div");
  div.className = "damage-number";
  div.textContent = isHeal ? `+${amount}` : `${amount}`;
  div.style.cssText = `
    position: absolute;
    left: 50%; top: 50%;
    font-weight: bold;
    font-size: ${isCrit ? "1.5rem" : "1rem"};
    color: ${isHeal ? "#2ecc71" : isCrit ? "#e74c3c" : "#fff"};
    text-shadow: 0 0 4px rgba(0,0,0,0.8);
    pointer-events: none;
    transform: translate(-50%, -50%);
    transition: transform ${isCrit ? "1.5s" : "1s"} ease-out, opacity ${isCrit ? "1.5s" : "1s"} ease-out;
    z-index: 1000;
  `;
  document.body.appendChild(div);
  
  requestAnimationFrame(() => {
    div.style.transform = `translate(-50%, -200%) scale(${isCrit ? 1.5 : 1})`;
    div.style.opacity = "0";
  });
  
  setTimeout(() => div.remove(), isCrit ? 1500 : 1000);
  
  // Also play sound
  if (isCrit) playSound("crit", 0.5);
  else if (isHeal) playSound("loot", 0.3);
  else playSound("hit", 0.3);
}

// ── Death Particles ──
function spawnDeathParticles(pos, color = "#e74c3c") {
  playSound("death", 0.4);
  for (let i = 0; i < 12; i++) {
    const geo = new THREE.PlaneGeometry(0.08, 0.08);
    const mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
    const p = new THREE.Mesh(geo, mat);
    p.position.copy(pos);
    p.position.y += 0.5;
    
    const vel = new THREE.Vector3(
      (Math.random() - 0.5) * 3,
      Math.random() * 3 + 1,
      (Math.random() - 0.5) * 3
    );
    
    scene.add(p);
    
    const start = Date.now();
    function anim() {
      const t = (Date.now() - start) / 800;
      if (t >= 1) { scene.remove(p); return; }
      p.position.add(vel.clone().multiplyScalar(0.016));
      vel.y -= 0.08; // gravity
      p.rotation.x += 0.1;
      p.rotation.y += 0.1;
      p.scale.setScalar(1 - t);
      requestAnimationFrame(anim);
    }
    anim();
  }
}

document.getElementById("attack-btn").addEventListener("click", doAttack);
document.getElementById("pickup-btn").addEventListener("click", () => send({ type: "pickup" }));

// ── Character Creation ──
let selectedClass = "warrior";

// ── VR Auto-Login (no keyboard typing in headset) ──
function vrLogin() {
  // Skip HTML login overlay — auto-join with default name + selected class
  myName = "VR Hero";
  selectedClass = document.getElementById("class-select").value || "warrior";
  document.getElementById("login-overlay").classList.add("hidden");
  document.getElementById("player-stats").style.display = "block";
  startAmbientAudio();
  connect();
}

// ── VR In-World HUD (attached to camera, visible in headset) ──
let vrHudMesh = null;
let vrHudCanvas = null;
let vrHudCtx = null;

function createVRHUD() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
  });
  const geometry = new THREE.PlaneGeometry(1.2, 0.6);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 10000;
  // Position: bottom of view, slightly down
  mesh.position.set(0, -0.4, -0.8);
  camera.add(mesh);
  
  vrHudCanvas = canvas;
  vrHudCtx = ctx;
  vrHudMesh = mesh;
  return mesh;
}

function updateVRHUD() {
  if (!renderer.xr.isPresenting || !myPlayer) {
    if (vrHudMesh) vrHudMesh.visible = false;
    return;
  }
  if (!vrHudMesh) createVRHUD();
  vrHudMesh.visible = true;
  
  const ctx = vrHudCtx;
  const cvs = vrHudCanvas;
  ctx.clearRect(0, 0, cvs.width, cvs.height);
  
  // Background panel
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.roundRect(8, 8, cvs.width - 16, cvs.height - 16, 16);
  ctx.fill();
  
  ctx.fillStyle = "#fff";
  ctx.font = "bold 28px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(`${myPlayer.name}  Lv.${myPlayer.level}  ${myPlayer.class || "warrior"}`, 24, 44);
  
  // HP bar
  const hpPct = myPlayer.hp / myPlayer.maxHp;
  ctx.fillStyle = "#333";
  ctx.fillRect(24, 56, 200, 18);
  ctx.fillStyle = hpPct > 0.5 ? "#2ecc71" : hpPct > 0.25 ? "#f39c12" : "#e74c3c";
  ctx.fillRect(24, 56, 200 * hpPct, 18);
  ctx.fillStyle = "#fff";
  ctx.font = "16px sans-serif";
  ctx.fillText(`HP ${myPlayer.hp}/${myPlayer.maxHp}`, 230, 70);
  
  // Mana bar
  const mana = myPlayer.mana || 0;
  const maxMana = myPlayer.maxMana || 30;
  const manaPct = mana / maxMana;
  ctx.fillStyle = "#333";
  ctx.fillRect(24, 82, 160, 14);
  ctx.fillStyle = "#3498db";
  ctx.fillRect(24, 82, 160 * manaPct, 14);
  ctx.fillStyle = "#fff";
  ctx.fillText(`Mana ${mana}/${maxMana}`, 192, 94);
  
  // Stats
  ctx.font = "18px sans-serif";
  ctx.fillText(`STR:${myPlayer.str||8} DEX:${myPlayer.dex||4} INT:${myPlayer.int||3} VIT:${myPlayer.vit||7}`, 24, 124);
  
  // Equipment
  const eq = myPlayer.equipment || {};
  ctx.font = "16px sans-serif";
  const wName = eq.weapon ? eq.weapon.name : "None";
  const aName = eq.armor ? eq.armor.name : "None";
  const rName = eq.ring ? eq.ring.name : "None";
  ctx.fillStyle = eq.weapon ? (eq.weapon.color || "#fff") : "#aaa";
  ctx.fillText(`⚔️ ${wName}`, 24, 150);
  ctx.fillStyle = eq.armor ? (eq.armor.color || "#fff") : "#aaa";
  ctx.fillText(`🛡️ ${aName}`, 24, 172);
  ctx.fillStyle = eq.ring ? (eq.ring.color || "#fff") : "#aaa";
  ctx.fillText(`💍 ${rName}`, 24, 194);
  
  // Gold / Kills
  ctx.fillStyle = "#f1c40f";
  ctx.fillText(`Gold: ${myPlayer.gold}  Kills: ${myPlayer.kills||0}`, 24, 226);
  
  // Dungeon floor depth
  ctx.fillStyle = "#f39c12";
  ctx.font = "bold 18px sans-serif";
  ctx.fillText(`🏰 Floor: ${worldState.dungeonDepth || 1}  👹 ${worldState.enemyCount || 0} enemies`, 24, 248);
  
  // Skills (1/2/3)
  if (myPlayer.skills) {
    ctx.fillStyle = "#fff";
    let sx = 320;
    for (const s of myPlayer.skills) {
      ctx.fillStyle = s.ready ? "#2ecc71" : "#e74c3c";
      ctx.fillRect(sx, 56, 60, 40);
      ctx.fillStyle = "#000";
      ctx.font = "bold 14px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(s.key, sx + 30, 72);
      ctx.font = "10px sans-serif";
      ctx.fillText(s.ready ? "READY" : "CD", sx + 30, 88);
      sx += 68;
    }
  }
  
  // Recent event
  if (worldState.events && worldState.events.length > 0) {
    ctx.textAlign = "left";
    ctx.fillStyle = "#f39c12";
    ctx.font = "14px sans-serif";
    ctx.fillText(worldState.events[0].text.substring(0, 45), 24, 248);
  }
  
  // Leaderboard panel (top-right)
  if (leaderboardData && leaderboardData.length > 0) {
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(124, 92, 252, 0.3)";
    ctx.fillRect(340, 110, 160, 120);
    ctx.fillStyle = "#7C5CFC";
    ctx.font = "bold 14px sans-serif";
    ctx.fillText("LEADERBOARD", 348, 128);
    ctx.font = "12px sans-serif";
    leaderboardData.slice(0, 5).forEach((entry, i) => {
      const y = 146 + i * 16;
      ctx.fillStyle = entry.player_name === myPlayer?.name ? "#f1c40f" : "#fff";
      const name = entry.player_name.substring(0, 12);
      ctx.fillText(`${i+1}. ${name} K:${entry.kills} L:${entry.level}`, 348, y);
    });
  }
  
  // ── VR Minimap panel (top-right of VR HUD) ──
  if (myPlayer) {
    const mmX = 380, mmY = 110;
    const mmSize = 120;
    // Minimap background
    ctx.fillStyle = "rgba(5, 8, 15, 0.9)";
    ctx.fillRect(mmX, mmY, mmSize, mmSize);
    ctx.strokeStyle = "rgba(100, 140, 200, 0.5)";
    ctx.lineWidth = 1;
    ctx.strokeRect(mmX, mmY, mmSize, mmSize);

    // Draw walls in VR minimap (fog-gated)
    const mmScale = mmSize / (MINIMAP_RANGE * 2) * minimapZoom;
    function mmWorldToVr(wx, wz) {
      const dx = (wx - myPlayer.pos.x) * mmScale + mmSize / 2;
      const dz = (wz - myPlayer.pos.z) * mmScale + mmSize / 2;
      return { x: mmX + dx, y: mmY + dz };
    }
    ctx.fillStyle = "rgba(80, 80, 100, 0.7)";
    for (const w of worldState.walls || []) {
      if (!isExplored(w.min.x + 0.5, w.min.z + 0.5)) continue;
      const p1 = mmWorldToVr(w.min.x, w.min.z);
      const p2 = mmWorldToVr(w.max.x, w.max.z);
      const x = Math.min(p1.x, p2.x), y = Math.min(p1.y, p2.y);
      const w2 = Math.abs(p2.x - p1.x), h2 = Math.abs(p2.y - p1.y);
      if (x > mmX - 5 && x < mmX + mmSize + 5 && y > mmY - 5 && y < mmY + mmSize + 5) {
        ctx.fillRect(x, y, Math.max(1, w2), Math.max(1, h2));
      }
    }
    // Enemies on VR minimap
    for (const enemy of worldState.enemies || []) {
      if (!isExplored(enemy.pos.x, enemy.pos.z) && !enemy.isBoss) continue;
      const p = mmWorldToVr(enemy.pos.x, enemy.pos.z);
      if (p.x < mmX || p.x > mmX + mmSize || p.y < mmY || p.y > mmY + mmSize) continue;
      ctx.fillStyle = enemy.isBoss ? "#ff00ff" : "#e74c3c";
      ctx.beginPath();
      ctx.arc(p.x, p.y, enemy.isBoss ? 3 : 2, 0, Math.PI * 2);
      ctx.fill();
    }
    // Items on VR minimap
    for (const item of worldState.items || []) {
      if (!isExplored(item.pos.x, item.pos.z)) continue;
      const p = mmWorldToVr(item.pos.x, item.pos.z);
      if (p.x < mmX || p.x > mmX + mmSize || p.y < mmY || p.y > mmY + mmSize) continue;
      ctx.fillStyle = "#f1c40f";
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // Self arrow
    const myP = mmWorldToVr(myPlayer.pos.x, myPlayer.pos.z);
    ctx.fillStyle = "#2ecc71";
    ctx.beginPath();
    ctx.moveTo(myP.x, myP.y - 4);
    ctx.lineTo(myP.x - 3, myP.y + 3);
    ctx.lineTo(myP.x + 3, myP.y + 3);
    ctx.closePath();
    ctx.fill();
    // Audio state indicator
    const stateColors = { explore: "#2ecc71", danger: "#f39c12", combat: "#e74c3c", boss: "#ff00ff" };
    ctx.fillStyle = stateColors[audioState] || "#aaa";
    ctx.font = "bold 10px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`♪ ${audioState.toUpperCase()}`, mmX + mmSize / 2, mmY - 4);
  }

  vrHudMesh.material.map.needsUpdate = true;
}

// ── Leaderboard fetch ──
let leaderboardData = [];
async function fetchLeaderboard() {
  try {
    const resp = await fetch("/api/leaderboard?limit=10");
    const data = await resp.json();
    if (data.top) leaderboardData = data.top;
    else if (Array.isArray(data)) leaderboardData = data;
  } catch (e) { /* silent */ }
}
setInterval(fetchLeaderboard, 10000); // refresh every 10s
fetchLeaderboard();

// ── Login ──
document.getElementById("join-btn").addEventListener("click", () => {
  playSound("uiclick", 0.3);
  const name = document.getElementById("name-input").value.trim();
  if (name) myName = name;
  selectedClass = document.getElementById("class-select").value || "warrior";
  document.getElementById("login-overlay").classList.add("hidden");
  document.getElementById("player-stats").style.display = "block";
  lockPointer();
  startAmbientAudio();
  connect();
});

// Skill keybinds (1-3)
document.addEventListener("keydown", (e) => {
  const key = e.key.toLowerCase();
  keys[key] = true;
  if (key === "e") { send({ type: "pickup" }); }
  if (key === "1") { send({ type: "skill", skillIndex: 0 }); }
  if (key === "2") { send({ type: "skill", skillIndex: 1 }); }
  if (key === "3") { send({ type: "skill", skillIndex: 2 }); }
  // Chat: Enter to open/focus, Escape to close
  if (e.key === "Enter" && !chatOpen) { openChat(); e.preventDefault(); return; }
  if (e.key === "Escape" && chatOpen) { closeChat(); e.preventDefault(); return; }
});

// ── VR Button ──
const vrBtn = document.getElementById("vr-btn");
if (navigator.xr) {
  navigator.xr.isSessionSupported("immersive-vr").then((ok) => {
    vrBtn.disabled = !ok;
    if (ok) vrBtn.textContent = "Enter VR";
  });
}
vrBtn.addEventListener("click", async () => {
  if (!navigator.xr) return;
  try {
    const session = await navigator.xr.requestSession("immersive-vr", {
      requiredFeatures: ["local-floor"],
      optionalFeatures: ["hand-tracking"],
    });
    renderer.xr.setSession(session);
    
    // Handle session end
    session.addEventListener("end", () => {
      send({ type: "update", data: { inVR: false } });
      logEvent("VR session ended");
    });
    
    // Controller input: trigger = attack (like mouse click), teleport on A/X button if available
    session.addEventListener("select", (e) => {
      // Trigger press = attack (same as desktop click)
      doAttack();
    });
    
    // A/X button (buttons[4]) = skill 1, B/Y button (buttons[5]) = skill 2
    // These fire as "select" on some controllers, so we check gamepad buttons in the render loop
    // Squeeze (grip) = teleport forward 2m
    session.addEventListener("squeeze", (e) => {
      const refSpace = renderer.xr.getReferenceSpace();
      const frame = e.frame;
      const inputSource = e.inputSource;
      if (!inputSource || !frame || !refSpace) return;
      
      const pose = frame.getPose(inputSource.targetRaySpace, refSpace);
      if (!pose) return;
      
      const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(
        new THREE.Quaternion(pose.transform.orientation.x, pose.transform.orientation.y, pose.transform.orientation.z, pose.transform.orientation.w)
      );
      dir.y = 0; dir.normalize();
      
      const newPos = camera.position.clone().add(dir.multiplyScalar(2));
      let blocked = false;
      for (const w of worldState.walls || []) {
        if (newPos.x > w.min.x - 0.3 && newPos.x < w.max.x + 0.3 &&
            newPos.z > w.min.z - 0.3 && newPos.z < w.max.z + 0.3) {
          blocked = true; break;
        }
      }
      if (!blocked) {
        camera.position.copy(newPos);
        send({ type: "update", data: {
          pos: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
        }});
        logEvent("Teleported");
      }
      
      // Haptic feedback on teleport
      if (inputSource.gamepad && inputSource.gamepad.hapticActuators && inputSource.gamepad.hapticActuators[0]) {
        inputSource.gamepad.hapticActuators[0].pulse(0.5, 100);
      }
    });
    
    send({ type: "update", data: { inVR: true } });
    logEvent("VR session started");
    // Auto-login for VR (no keyboard in headset)
    if (!myPlayer) vrLogin();
  } catch (err) {
    logEvent("VR failed: " + err.message);
  }
});

// ── Movement ──
function updateMovement(dt) {
  if (!myPlayer || !mouseLocked) return;
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  forward.y = 0; forward.normalize();
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  right.y = 0; right.normalize();

  const move = new THREE.Vector3();
  if (keys["w"]) move.add(forward);
  if (keys["s"]) move.sub(forward);
  if (keys["a"]) move.sub(right);
  if (keys["d"]) move.add(right);

  // Mobile virtual joystick zone (bottom-left)
  // Simplified: touch-drag in bottom 40% moves

  if (move.lengthSq() > 0) {
    move.normalize().multiplyScalar(MOVE_SPEED * dt);
    const newPos = camera.position.clone().add(move);
    // Simple wall collision
    let blocked = false;
    for (const w of worldState.walls || []) {
      if (newPos.x > w.min.x - 0.3 && newPos.x < w.max.x + 0.3 &&
          newPos.z > w.min.z - 0.3 && newPos.z < w.max.z + 0.3) {
        blocked = true; break;
      }
    }
    if (!blocked) {
      camera.position.copy(newPos);
      send({ type: "update", data: {
        pos: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
        rot: { x: pitch, y: yaw, z: 0 },
      }});
      // Footstep sound — every 0.35s while moving
      const now = performance.now();
      if (now - lastFootstepTime > 350) {
        playSound("footstep", 0.15);
        lastFootstepTime = now;
      }
    }
  }
}

// ── VR Movement (Thumbstick) ──
let snapTurnCooldown = 0;
let comfortVignette = null;
let vrPickupCooldown = 0;
let vrSkillCooldown = 0;

function updateVRMovement(dt) {
  const session = renderer.xr.getSession();
  if (!session) return;

  // ── Proximity auto-pickup (VR — no keyboard 'E') ──
  vrPickupCooldown -= dt;
  if (vrPickupCooldown <= 0 && worldState.items && worldState.items.length > 0) {
    const playerPos = camera.position;
    let nearestDist = Infinity;
    for (const item of worldState.items) {
      const dx = item.pos.x - playerPos.x;
      const dz = item.pos.z - playerPos.z;
      const dist = Math.sqrt(dx*dx + dz*dz);
      if (dist < nearestDist) nearestDist = dist;
      if (dist < 1.5) {
        send({ type: "pickup" });
        vrPickupCooldown = 0.5; // 0.5s cooldown to avoid spam
        logEvent("Picked up " + item.type);
        // Haptic on whichever controller moved us here
        for (const is of session.inputSources || []) {
          if (is.gamepad && is.gamepad.hapticActuators && is.gamepad.hapticActuators[0]) {
            is.gamepad.hapticActuators[0].pulse(0.3, 60);
          }
        }
        break; // one pickup per frame max
      }
    }
  }

  for (const inputSource of session.inputSources || []) {
    if (!inputSource.gamepad) continue;
    const gp = inputSource.gamepad;
    const axes = gp.axes || [0, 0, 0, 0];
    const buttons = gp.buttons || [];
    
    // Thumbstick movement (left stick: axes 0,1 or right stick: axes 2,3)
    const x = axes[2] || axes[0] || 0;
    const y = axes[3] || axes[1] || 0;
    
    if (Math.abs(x) < 0.2 && Math.abs(y) < 0.2) continue;
    
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    forward.y = 0; forward.normalize();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    right.y = 0; right.normalize();
    
    const move = new THREE.Vector3()
      .addScaledVector(forward, -y)
      .addScaledVector(right, x);
    
    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(MOVE_SPEED * dt * 0.5);
      const newPos = camera.position.clone().add(move);
      let blocked = false;
      for (const w of worldState.walls || []) {
        if (newPos.x > w.min.x - 0.3 && newPos.x < w.max.x + 0.3 &&
            newPos.z > w.min.z - 0.3 && newPos.z < w.max.z + 0.3) {
          blocked = true; break;
        }
      }
      if (!blocked) {
        camera.position.copy(newPos);
        send({ type: "update", data: {
          pos: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
          rot: { x: camera.rotation.x, y: camera.rotation.y, z: 0 },
        }});
      }
    }
  }
  
  // Snap turn: right thumbstick x-axis past deadzone = 30° snap turn
  // Only process one snap per cooldown to avoid continuous spinning
  snapTurnCooldown -= dt;
  for (const inputSource of session.inputSources || []) {
    if (!inputSource.gamepad) continue;
    const gp = inputSource.gamepad;
    const axes = gp.axes || [0, 0, 0, 0];
    // Use right stick x (axes[2]) for snap turn if available
    const turnX = axes[2] || 0;
    if (Math.abs(turnX) > 0.7 && snapTurnCooldown <= 0) {
      const turnAngle = turnX > 0 ? -Math.PI / 6 : Math.PI / 6; // 30° snap
      camera.rotation.y += turnAngle;
      snapTurnCooldown = 0.25; // 250ms cooldown
      send({ type: "update", data: {
        rot: { x: camera.rotation.x, y: camera.rotation.y, z: 0 },
      }});
    }
  }
  
  // ── VR Skills: A/X (button 4) = Skill 1, B/Y (button 5) = Skill 2, Menu (button 1) = Skill 3 ──
  vrSkillCooldown -= dt;
  for (const inputSource of session.inputSources || []) {
    if (!inputSource.gamepad) continue;
    const btns = inputSource.gamepad.buttons || [];
    if (vrSkillCooldown <= 0) {
      if (btns[4] && btns[4].pressed) { send({ type: "skill", skillIndex: 0 }); vrSkillCooldown = 0.3; logEvent("Skill 1"); }
      else if (btns[5] && btns[5].pressed) { send({ type: "skill", skillIndex: 1 }); vrSkillCooldown = 0.3; logEvent("Skill 2"); }
      else if (btns[1] && btns[1].pressed) { send({ type: "skill", skillIndex: 2 }); vrSkillCooldown = 0.3; logEvent("Skill 3"); }
    }
    // Haptic on skill use
    if (vrSkillCooldown > 0.25 && inputSource.gamepad.hapticActuators && inputSource.gamepad.hapticActuators[0]) {
      inputSource.gamepad.hapticActuators[0].pulse(0.4, 80);
    }
  }
}

// ── VR Gesture Combat ──
// Tracks controller motion to detect sword swings, overhead smashes, and bow draws
function updateVRGestures(dt) {
  const session = renderer.xr.getSession();
  if (!session || !myPlayer) return;
  
  const now = Date.now();
  const refSpace = renderer.xr.getReferenceSpace();
  if (!refSpace) return;
  
  // Collect poses for all input sources with gripSpace
  const currentPoses = [];
  for (const is of session.inputSources || []) {
    const frame = renderer.xr.getFrame ? renderer.xr.getFrame() : null;
    // Try to get pose from gripSpace (controller in hand)
    let pose = null;
    if (is.gripSpace) {
      try {
        const frame2 = renderer.xr.getFrame ? renderer.xr.getFrame() : null;
        // In WebXR, we can only get poses during the animation frame callback
        // So we store what we can and track velocity
        pose = { position: new THREE.Vector3(), orientation: new THREE.Quaternion() };
      } catch (e) {}
    }
    
    // Use gamepad as fallback for position/orientation
    if (is.gamepad) {
      // We can't get exact 3D pose without frame.getPose(), but we can detect
      // motion from velocity axes if the gamepad reports them
      const gp = is.gamepad;
      const hand = is.handedness; // "left" | "right" | "none"
      
      // Store for velocity tracking (use position from last known if available)
      currentPoses.push({
        id: is,
        hand,
        gamepad: gp,
        timestamp: now,
      });
    }
  }
  
  // ── Velocity-based gesture detection using gamepad axes ──
  // Most VR controllers expose angular velocity or we can infer from thumbstick + buttons
  // But for true gesture detection we need pose. Let's use a simpler approach:
  // Track trigger pulls with timing patterns, and use grip button for "stance"
  
  for (const is of session.inputSources || []) {
    if (!is.gamepad) continue;
    const gp = is.gamepad;
    const btns = gp.buttons || [];
    const hand = is.handedness || "none";
    
    // ── Trigger = release bow / sword swing ──
    // Trigger pull (buttons[0]) with pull velocity
    if (btns[0] && btns[0].pressed) {
      const pullAmount = btns[0].value || 1.0;
      
      // Check for bow draw state
      if (vrGestureState === "draw" && bowChargeStart > 0) {
        const chargeTime = now - bowChargeStart;
        bowChargeLevel = Math.min(chargeTime / 2000, 1.0); // 2s max charge
        
        // Visual: pull back arrow
        if (vrWeaponMesh && vrWeaponMesh.userData.type === "bow") {
          // Slight recoil animation
          vrWeaponMesh.rotation.x = -0.3 * bowChargeLevel;
        }
      }
      
      // Start tracking for gesture
      if (vrLastAttackTime + 500 < now) {
        // Store trigger press time for velocity calc
        controllerHistory.push({
          time: now,
          hand,
          pull: pullAmount,
          triggerPressed: true,
        });
      }
    }
    
    // Trigger release = fire bow / execute swing
    if (btns[0] && !btns[0].pressed && vrLastAttackTime + 400 < now) {
      const recent = controllerHistory.filter(h => now - h.time < 300);
      
      if (vrGestureState === "draw" && bowChargeStart > 0) {
        // ── BOW RELEASE ──
        const chargeTime = now - bowChargeStart;
        const chargePct = Math.min(chargeTime / 2000, 1.0);
        const damageMult = 0.5 + chargePct * 1.5; // 0.5x - 2.0x damage
        
        send({ type: "attack", data: { style: "bow", charge: chargePct, damageMult } });
        logEvent(`Bow shot! ${Math.round(chargePct * 100)}% charge`);
        
        // Reset bow state
        bowChargeStart = 0;
        vrGestureState = "idle";
        if (vrWeaponMesh) vrWeaponMesh.rotation.x = 0;
        
        // Strong haptic
        if (is.gamepad.hapticActuators && is.gamepad.hapticActuators[0]) {
          is.gamepad.hapticActuators[0].pulse(0.6 + chargePct * 0.4, 150);
        }
        
        vrLastAttackTime = now;
        controllerHistory = [];
      } else {
        // ── SWORD SWING ──
        // Analyze recent motion for swing type
        let swingType = "light"; // light | heavy | overhead
        let damageMult = 1.0;
        
        // Check grip button (buttons[1]) for heavy/overhead stance
        const gripHeld = btns[1] && btns[1].pressed;
        
        if (gripHeld && recent.length > 3) {
          // Heavy attack: grip + trigger release
          swingType = "heavy";
          damageMult = 1.5;
        } else if (recent.length > 5 && recent.every(h => h.triggerPressed)) {
          // Rapid trigger = overhead smash (many quick presses)
          swingType = "overhead";
          damageMult = 2.0;
        }
        
        send({ type: "attack", data: { style: swingType, damageMult } });
        logEvent(`${swingType} swing!`);
        
        // Visual sword swing arc
        if (vrWeaponMesh) {
          vrWeaponMesh.rotation.z = hand === "left" ? -0.5 : 0.5;
          setTimeout(() => { if (vrWeaponMesh) vrWeaponMesh.rotation.z = 0; }, 200);
        }
        
        // Haptic
        if (is.gamepad.hapticActuators && is.gamepad.hapticActuators[0]) {
          is.gamepad.hapticActuators[0].pulse(swingType === "heavy" ? 0.7 : 0.5, swingType === "overhead" ? 200 : 100);
        }
        
        vrLastAttackTime = now;
        controllerHistory = [];
      }
    }
    
    // ── Grip (button 1) held = enter bow draw stance ──
    // Grip + trigger held = drawing bow
    if (btns[1] && btns[1].pressed && btns[0] && btns[0].pressed && vrGestureState !== "draw") {
      // Enter bow draw mode
      if (myPlayer.class === "mage" || myPlayer.class === "rogue") {
        vrGestureState = "draw";
        bowChargeStart = now;
        logEvent("Drawing bow...");
        
        // Equip bow visual
        if (!vrWeaponMesh || vrWeaponMesh.userData.type !== "bow") {
          if (vrWeaponMesh) scene.remove(vrWeaponMesh);
          vrWeaponMesh = createBowMesh();
          // Attach to right controller (or camera if no controller tracking)
          camera.add(vrWeaponMesh);
          vrWeaponMesh.position.set(0.2, -0.1, -0.3);
          vrWeaponMesh.rotation.y = -0.3;
        }
      }
    }
    
    // Grip release without trigger = switch back to sword
    if (btns[1] && !btns[1].pressed && vrGestureState === "draw" && bowChargeStart === 0) {
      vrGestureState = "idle";
      if (vrWeaponMesh && vrWeaponMesh.userData.type === "bow") {
        scene.remove(vrWeaponMesh);
        vrWeaponMesh = null;
      }
    }
    
    // Clean old history
    controllerHistory = controllerHistory.filter(h => now - h.time < HISTORY_MS);
  }
}

// ── Comfort Vignette ──
function createComfortVignette() {
  // Create a dark ring around the edges of the view to reduce motion sickness
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  
  // Radial gradient: transparent center, dark edges
  const grad = ctx.createRadialGradient(128, 128, 64, 128, 128, 180);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(1, "rgba(0,0,0,0.6)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);
  
  const texture = new THREE.CanvasTexture(canvas);
  const geometry = new THREE.PlaneGeometry(2, 2);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 9999;
  // Attach to camera so it follows view in both desktop and VR
  mesh.position.set(0, 0, -0.5);
  camera.add(mesh);
  return mesh;
}

function showComfortVignette(active) {
  if (!comfortVignette) {
    comfortVignette = createComfortVignette();
  }
  comfortVignette.visible = active;
}

// ── Render sync ──
function syncScene() {
  // Find self
  myPlayer = worldState.players.find(p => p.id === pid) || null;

  // The generated grid lives in positive X/Z coordinates. Resize and centre
  // the visual floor from serialized dimensions so every tile remains above
  // the floor as deeper layouts grow.
  const tileSize = worldState.dungeonDimensions?.tileSize || 2;
  const dungeonWidth = (worldState.dungeonDimensions?.width || 40) * tileSize;
  const dungeonHeight = (worldState.dungeonDimensions?.height || 40) * tileSize;
  floor.scale.set(dungeonWidth / 80, dungeonHeight / 80, 1);
  floor.position.set(dungeonWidth / 2, 0, dungeonHeight / 2);

  // Walls are static within a floor, but must be reconciled when progression
  // replaces the layout. Without cleanup, stale walls survive every descent.
  const activeWallIds = new Set();
  for (const w of worldState.walls || []) {
    const wid = `${w.min.x},${w.min.z}`;
    activeWallIds.add(wid);
    getOrCreate("walls", wid, () => createWallMesh(w));
  }
  for (const [id, mesh] of meshes.walls) {
    if (!activeWallIds.has(id)) {
      scene.remove(mesh);
      mesh.geometry.dispose();
      meshes.walls.delete(id);
    }
  }

  // Players
  const activePlayerIds = new Set();
  for (const p of worldState.players || []) {
    activePlayerIds.add(p.id);
    const m = getOrCreate("players", p.id, () => createPlayerMesh(p.color));
    m.position.set(p.pos.x, 0, p.pos.z);
    m.rotation.y = p.rot.y || 0;
    // Update label
    if (m.userData.label && m.userData.labelCtx) {
      const ctx = m.userData.labelCtx;
      const canvas = m.userData.labelCanvas;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(0, 0, 256, 64);
      ctx.fillStyle = "#fff";
      ctx.font = "bold 20px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(`${p.name} (Lv.${p.level})`, 128, 40);
      m.userData.label.material.map.needsUpdate = true;
    }
    // Hide self mesh (we're the camera)
    m.visible = p.id !== pid;
  }
  for (const [id, m] of meshes.players) { if (!activePlayerIds.has(id)) { scene.remove(m); meshes.players.delete(id); } }

  // Enemies
  const activeEnemyIds = new Set();
  for (const e of worldState.enemies || []) {
    activeEnemyIds.add(e.id);
    const m = getOrCreate("enemies", e.id, () => createEnemyMesh(e.type, e.isBoss));
    m.position.set(e.pos.x, 0, e.pos.z);
    // HP bar
    if (m.userData.hpBar) {
      const hpPct = e.hp / e.maxHp;
      m.userData.hpBar.scale.x = hpPct;
      m.userData.hpBar.material.color.setHex(hpPct > 0.5 ? 0x2ecc71 : hpPct > 0.25 ? 0xf39c12 : 0xe74c3c);
      m.userData.hpBar.position.x = (1 - hpPct) * -0.3;
    }
    
    // Damage effects
    const prevHp = previousEnemyHps.get(e.id);
    if (prevHp !== undefined && prevHp > e.hp) {
      const damage = prevHp - e.hp;
      spawnDamageNumber(m.position, damage, damage > 30);
    }
    previousEnemyHps.set(e.id, e.hp);
    
    // Death effect
    if (e.hp <= 0 && prevHp > 0) {
      spawnDeathParticles(m.position, e.color);
    }
  }
  // Clean up old enemy HP tracking
  for (const [id] of previousEnemyHps) { if (!activeEnemyIds.has(id)) previousEnemyHps.delete(id); }
  for (const [id, m] of meshes.enemies) { if (!activeEnemyIds.has(id)) { scene.remove(m); meshes.enemies.delete(id); } }

  // Items
  const activeItemIds = new Set();
  for (const item of worldState.items || []) {
    activeItemIds.add(item.id);
    const m = getOrCreate("items", item.id, () => createItemMesh(item.type));
    m.position.set(item.pos.x, item.pos.y + Math.sin(Date.now() * 0.003 + m.userData.floatOffset) * 0.15, item.pos.z);
    m.rotation.y += 0.02;
  }
  for (const [id, m] of meshes.items) { if (!activeItemIds.has(id)) { scene.remove(m); meshes.items.delete(id); } }
}

// ── Minimap (Expanded: fog-of-war, zoom, north indicator, boss alert, VR minimap) ──
let minimapCanvas = null;
let minimapCtx = null;
let minimapZoom = 1.0; // 0.5 = zoomed out (wider area), 2.0 = zoomed in (less area)
let minimapFogCanvas = null; // fog-of-war overlay canvas
let minimapFogCtx = null;
const MINIMAP_SIZE = 160;
const MINIMAP_RANGE = 40; // world units visible in minimap at zoom 1.0
const FOG_CELL_SIZE = 2.0; // world units per fog cell
const FOG_GRID_SIZE = 60; // 60x60 fog cells covering 120x120 world units
let minimapFogGrid = null; // Float32Array — 0 = unexplored, 1 = explored
let minimapInitialized = false;

function initMinimap() {
  if (minimapCanvas) return;
  minimapCanvas = document.createElement("canvas");
  minimapCanvas.id = "minimap";
  minimapCanvas.width = MINIMAP_SIZE;
  minimapCanvas.height = MINIMAP_SIZE;
  minimapCanvas.style.cssText = `
    position: fixed;
    top: 12px;
    right: 12px;
    width: ${MINIMAP_SIZE}px;
    height: ${MINIMAP_SIZE}px;
    border: 2px solid rgba(100, 140, 200, 0.6);
    border-radius: 8px;
    background: rgba(5, 8, 15, 0.85);
    pointer-events: none;
    z-index: 500;
    box-shadow: 0 0 8px rgba(0, 50, 100, 0.5);
  `;
  document.body.appendChild(minimapCanvas);
  minimapCtx = minimapCanvas.getContext("2d");

  // Fog-of-war grid
  minimapFogGrid = new Float32Array(FOG_GRID_SIZE * FOG_GRID_SIZE);

  // Zoom controls (+/- buttons)
  const zoomInBtn = document.createElement("button");
  zoomInBtn.textContent = "+";
  zoomInBtn.style.cssText = `
    position: fixed; top: ${MINIMAP_SIZE + 16}px; right: 12px;
    width: 36px; height: 24px; border: 1px solid rgba(100,140,200,0.5);
    border-radius: 4px; background: rgba(5,8,15,0.85); color: #6c8ccc;
    font-size: 0.9rem; cursor: pointer; z-index: 500; pointer-events: auto;
  `;
  zoomInBtn.onclick = () => { minimapZoom = Math.min(3.0, minimapZoom * 1.25); };
  document.body.appendChild(zoomInBtn);

  const zoomOutBtn = document.createElement("button");
  zoomOutBtn.textContent = "−";
  zoomOutBtn.style.cssText = `
    position: fixed; top: ${MINIMAP_SIZE + 42}px; right: 12px;
    width: 36px; height: 24px; border: 1px solid rgba(100,140,200,0.5);
    border-radius: 4px; background: rgba(5,8,15,0.85); color: #6c8ccc;
    font-size: 0.9rem; cursor: pointer; z-index: 500; pointer-events: auto;
  `;
  zoomOutBtn.onclick = () => { minimapZoom = Math.max(0.3, minimapZoom / 1.25); };
  document.body.appendChild(zoomOutBtn);

  minimapInitialized = true;
}

function getMinimapScale() {
  return MINIMAP_SIZE / (MINIMAP_RANGE * 2) * minimapZoom;
}

function worldToMinimap(wx, wz) {
  if (!myPlayer) return { x: 0, y: 0 };
  const cx = myPlayer.pos.x;
  const cz = myPlayer.pos.z;
  const scale = getMinimapScale();
  const dx = (wx - cx) * scale + MINIMAP_SIZE / 2;
  const dz = (wz - cz) * scale + MINIMAP_SIZE / 2;
  return { x: dx, y: dz };
}

// ── Fog-of-War: mark cells around player as explored ──
function updateFogOfWar() {
  if (!minimapFogGrid || !myPlayer) return;
  const visibilityRadius = 8.0; // world units visible around player
  const px = myPlayer.pos.x;
  const pz = myPlayer.pos.z;

  // Mark cells within visibility as explored
  const cellStartX = Math.floor((px - visibilityRadius) / FOG_CELL_SIZE) + FOG_GRID_SIZE / 2;
  const cellEndX = Math.ceil((px + visibilityRadius) / FOG_CELL_SIZE) + FOG_GRID_SIZE / 2;
  const cellStartZ = Math.floor((pz - visibilityRadius) / FOG_CELL_SIZE) + FOG_GRID_SIZE / 2;
  const cellEndZ = Math.ceil((pz + visibilityRadius) / FOG_CELL_SIZE) + FOG_GRID_SIZE / 2;

  for (let cz = Math.max(0, cellStartZ); cz < Math.min(FOG_GRID_SIZE, cellEndZ); cz++) {
    for (let cx = Math.max(0, cellStartX); cx < Math.min(FOG_GRID_SIZE, cellEndX); cx++) {
      // Check actual distance
      const wx = (cx - FOG_GRID_SIZE / 2) * FOG_CELL_SIZE;
      const wz = (cz - FOG_GRID_SIZE / 2) * FOG_CELL_SIZE;
      const dx = wx - px, dz = wz - pz;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < visibilityRadius) {
        const idx = cz * FOG_GRID_SIZE + cx;
        minimapFogGrid[idx] = Math.min(1.0, minimapFogGrid[idx] + 0.15);
      }
    }
  }
}

// Convert world position to fog grid index
function worldToFogGrid(wx, wz) {
  const cx = Math.floor(wx / FOG_CELL_SIZE) + FOG_GRID_SIZE / 2;
  const cz = Math.floor(wz / FOG_CELL_SIZE) + FOG_GRID_SIZE / 2;
  return { cx, cz };
}

// Check if a world position is in explored fog area
function isExplored(wx, wz) {
  if (!minimapFogGrid) return true; // No fog system = show everything
  const { cx, cz } = worldToFogGrid(wx, wz);
  if (cx < 0 || cx >= FOG_GRID_SIZE || cz < 0 || cz >= FOG_GRID_SIZE) return false;
  return minimapFogGrid[cz * FOG_GRID_SIZE + cx] > 0.1;
}

function updateMinimap() {
  if (!minimapCtx || !myPlayer) return;

  // Update fog-of-war
  updateFogOfWar();

  const ctx = minimapCtx;
  ctx.clearRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);

  // Background
  ctx.fillStyle = "rgba(5, 8, 15, 0.9)";
  ctx.fillRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);

  // Grid lines
  ctx.strokeStyle = "rgba(40, 60, 100, 0.3)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= MINIMAP_SIZE; i += 20) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, MINIMAP_SIZE);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(MINIMAP_SIZE, i);
    ctx.stroke();
  }

  // Draw walls as thin rectangles (only in explored areas)
  ctx.fillStyle = "rgba(80, 80, 100, 0.7)";
  for (const w of worldState.walls || []) {
    if (!isExplored(w.min.x + 0.5, w.min.z + 0.5)) continue; // Fog of war
    const p1 = worldToMinimap(w.min.x, w.min.z);
    const p2 = worldToMinimap(w.max.x, w.max.z);
    const x = Math.min(p1.x, p2.x);
    const y = Math.min(p1.y, p2.y);
    const w2 = Math.abs(p2.x - p1.x);
    const h2 = Math.abs(p2.y - p1.y);
    if (x > -5 && x < MINIMAP_SIZE + 5 && y > -5 && y < MINIMAP_SIZE + 5) {
      ctx.fillRect(x, y, Math.max(1, w2), Math.max(1, h2));
    }
  }

  // Draw items as small gold dots (only in explored areas)
  for (const item of worldState.items || []) {
    if (!isExplored(item.pos.x, item.pos.z)) continue;
    const p = worldToMinimap(item.pos.x, item.pos.z);
    if (p.x < 0 || p.x > MINIMAP_SIZE || p.y < 0 || p.y > MINIMAP_SIZE) continue;
    ctx.fillStyle = item.etype === "equipment" ? "#f39c12" : "#f1c40f";
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Draw enemies as red dots (boss = larger with pulsing ring)
  let bossAlertActive = false;
  for (const enemy of worldState.enemies || []) {
    if (!isExplored(enemy.pos.x, enemy.pos.z) && !enemy.isBoss) continue;
    const p = worldToMinimap(enemy.pos.x, enemy.pos.z);
    if (p.x < 0 || p.x > MINIMAP_SIZE || p.y < 0 || p.y > MINIMAP_SIZE) continue;
    if (enemy.isBoss) {
      bossAlertActive = true;
      // Pulsing ring around boss
      const pulse = Math.sin(Date.now() * 0.005) * 2 + 6;
      ctx.strokeStyle = "rgba(231, 76, 60, 0.5)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, pulse, 0, Math.PI * 2);
      ctx.stroke();
      // Boss dot
      ctx.fillStyle = "#ff00ff";
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#c0392b";
      ctx.lineWidth = 1;
      ctx.stroke();
    } else {
      ctx.fillStyle = "#e74c3c";
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Draw other players as blue dots
  for (const player of worldState.players || []) {
    if (player.id === pid) continue;
    const p = worldToMinimap(player.pos.x, player.pos.z);
    if (p.x < 0 || p.x > MINIMAP_SIZE || p.y < 0 || p.y > MINIMAP_SIZE) continue;
    ctx.fillStyle = "#3498db";
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Draw self as green arrow pointing in facing direction
  const myP = worldToMinimap(myPlayer.pos.x, myPlayer.pos.z);
  ctx.save();
  ctx.translate(myP.x, myP.y);
  ctx.rotate(myPlayer.rot.y);
  ctx.fillStyle = "#2ecc71";
  ctx.beginPath();
  ctx.moveTo(0, -5);   // tip
  ctx.lineTo(-3, 3);   // left
  ctx.lineTo(3, 3);     // right
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#27ae60";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  // ── Fog-of-war overlay: darken unexplored areas ──
  ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
  // Create a fog mask: iterate visible cells and darken non-explored ones
  const cellScale = (FOG_CELL_SIZE * getMinimapScale());
  for (let cz = 0; cz < FOG_GRID_SIZE; cz++) {
    for (let cx = 0; cx < FOG_GRID_SIZE; cx++) {
      const fogVal = minimapFogGrid[cz * FOG_GRID_SIZE + cx];
      if (fogVal >= 0.9) continue; // Fully explored — no fog
      const wx = (cx - FOG_GRID_SIZE / 2) * FOG_CELL_SIZE;
      const wz = (cz - FOG_GRID_SIZE / 2) * FOG_CELL_SIZE;
      const p = worldToMinimap(wx, wz);
      if (p.x < -cellScale || p.x > MINIMAP_SIZE + cellScale || p.y < -cellScale || p.y > MINIMAP_SIZE + cellScale) continue;
      const alpha = (1.0 - fogVal) * 0.6;
      ctx.fillStyle = `rgba(0, 0, 0, ${alpha.toFixed(2)})`;
      ctx.fillRect(p.x, p.y, cellScale + 1, cellScale + 1);
    }
  }

  // ── North indicator (small N arrow at top) ──
  ctx.save();
  ctx.translate(MINIMAP_SIZE / 2, 8);
  ctx.fillStyle = "rgba(100, 180, 255, 0.8)";
  ctx.font = "bold 10px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("N", 0, 8);
  // Small triangle pointing up
  ctx.beginPath();
  ctx.moveTo(0, -2);
  ctx.lineTo(-3, 2);
  ctx.lineTo(3, 2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // ── Boss alert text at bottom ──
  if (bossAlertActive) {
    ctx.fillStyle = "rgba(255, 0, 255, 0.9)";
    ctx.font = "bold 9px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("⚠ BOSS NEARBY", MINIMAP_SIZE / 2, MINIMAP_SIZE - 4);
  }

  // ── Zoom indicator ──
  ctx.fillStyle = "rgba(100, 140, 200, 0.5)";
  ctx.font = "8px sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(`${minimapZoom.toFixed(1)}x`, MINIMAP_SIZE - 4, MINIMAP_SIZE - 4);

  // Border
  ctx.strokeStyle = "rgba(100, 140, 200, 0.6)";
  ctx.lineWidth = 1;
  ctx.strokeRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);
}

// Initialize minimap when player joins
const minimapObserver = new MutationObserver(() => {
  const overlay = document.getElementById("login-overlay");
  if (overlay && overlay.classList.contains("hidden") && !minimapCanvas) {
    initMinimap();
  }
});
minimapObserver.observe(document.getElementById("login-overlay"), { attributes: true, attributeFilter: ["class"] });

// ── Loop ──
function animate() {
  const dt = clock.getDelta();
  camera.rotation.order = "YXZ";
  if (!renderer.xr.isPresenting) {
    camera.rotation.y = yaw;
    camera.rotation.x = pitch;
  }

  if (renderer.xr.isPresenting) {
    // In VR: camera controlled by headset
    updateVRMovement(dt);
    updateVRGestures(dt);
  } else {
    updateMovement(dt);
  }

  syncScene();
  updateHUD();
  updateVRHUD();
  updateAudioState(dt);
  maybePlayAmbientSound();
  updateMinimap();
  
  // Apply screen shake to camera
  if (shakeIntensity > 0) {
    camera.position.x += (Math.random() - 0.5) * shakeIntensity;
    camera.position.y += (Math.random() - 0.5) * shakeIntensity;
    camera.position.z += (Math.random() - 0.5) * shakeIntensity * 0.3;
  }
  
  renderer.render(scene, camera);
  
  // Reset shake offset after render
  if (shakeIntensity > 0) {
    // Camera position will be reset by the sync from world state next frame
  }
}
renderer.setAnimationLoop(animate);

// ── Resize ──
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ── Chat System ──
let chatOpen = false;
const chatPanel = document.getElementById("chat-panel");
const chatLog = document.getElementById("chat-log");
const chatInput = document.getElementById("chat-input");
const chatSendBtn = document.getElementById("chat-send");
const chatToggleBtn = document.getElementById("chat-toggle");

function openChat() {
  chatOpen = true;
  chatPanel.style.display = "flex";
  chatToggleBtn.style.display = "none";
  chatInput.focus();
  if (document.pointerLockElement) document.exitPointerLock();
}

function closeChat() {
  chatOpen = false;
  chatPanel.style.display = "none";
  chatInput.blur();
  chatInput.value = "";
}

function sendChatMessage() {
  const text = chatInput.value.trim();
  if (text.length > 0 && ws && ws.readyState === WebSocket.OPEN) {
    send({ type: "chat", text });
  }
  chatInput.value = "";
  // Keep focus for rapid chat; user can Esc to close
  chatInput.focus();
}

function handleChatMessage(data) {
  const div = document.createElement("div");
  div.className = "chat-msg";
  const nameSpan = document.createElement("span");
  nameSpan.className = `chat-name ${data.class || "warrior"}`;
  nameSpan.textContent = `${data.name} (Lv.${data.level || 1}):`;
  const textSpan = document.createElement("span");
  textSpan.className = "chat-text";
  textSpan.textContent = ` ${data.text}`;
  div.appendChild(nameSpan);
  div.appendChild(textSpan);
  chatLog.appendChild(div);
  // Auto-scroll to bottom
  chatLog.scrollTop = chatLog.scrollHeight;
  // Keep last 50 messages
  while (chatLog.children.length > 50) chatLog.removeChild(chatLog.firstChild);
}

// Chat send button
if (chatSendBtn) chatSendBtn.addEventListener("click", sendChatMessage);

// Chat input: Enter sends, Escape closes
if (chatInput) {
  chatInput.addEventListener("keydown", (e) => {
    e.stopPropagation(); // Prevent game keybinds while typing
    if (e.key === "Enter") { sendChatMessage(); e.preventDefault(); }
    if (e.key === "Escape") { closeChat(); e.preventDefault(); }
  });
  // Prevent game controls from triggering while typing
  chatInput.addEventListener("keypress", (e) => { e.stopPropagation(); });
  chatInput.addEventListener("keyup", (e) => { e.stopPropagation(); });
}

// Chat toggle button (shown when chat is closed but game is active)
if (chatToggleBtn) {
  chatToggleBtn.addEventListener("click", openChat);
}

// Show chat toggle after joining game
const chatShowObserver = new MutationObserver(() => {
  const loginOverlay = document.getElementById("login-overlay");
  if (loginOverlay && loginOverlay.classList.contains("hidden")) {
    chatToggleBtn.style.display = "block";
    // Add a welcome system message
    if (chatLog.children.length === 0) {
      const sysMsg = document.createElement("div");
      sysMsg.className = "chat-msg chat-sys";
      sysMsg.textContent = "Press Enter to chat. Escape to close.";
      chatLog.appendChild(sysMsg);
    }
  }
});
chatShowObserver.observe(document.getElementById("login-overlay"), { attributes: true, attributeFilter: ["class"] });

console.log("VR RPG Online client loaded");
