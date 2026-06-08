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

function createEnemyMesh(etype) {
  const color = etype === "goblin" ? 0xe74c3c : 0xc0392b;
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.25, 0.5, 4, 8), new THREE.MeshStandardMaterial({ color, emissive: 0x220000 }));
  body.position.y = 0.5;
  body.castShadow = true;
  g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 8), new THREE.MeshStandardMaterial({ color }));
  head.position.y = 0.9;
  g.add(head);
  // Red eyes
  const eyeGeo = new THREE.SphereGeometry(0.04, 4, 4);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
  const eyeL = new THREE.Mesh(eyeGeo, eyeMat); eyeL.position.set(-0.08, 0.92, 0.15);
  const eyeR = new THREE.Mesh(eyeGeo, eyeMat); eyeR.position.set(0.08, 0.92, 0.15);
  g.add(eyeL, eyeR);
  // HP bar
  const barGeo = new THREE.PlaneGeometry(0.6, 0.08);
  const barMat = new THREE.MeshBasicMaterial({ color: 0x2ecc71 });
  const bar = new THREE.Mesh(barGeo, barMat);
  bar.position.y = 1.15;
  bar.userData.baseWidth = 0.6;
  g.add(bar);
  g.userData.hpBar = bar;
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

// ── WebSocket ──
function connect() {
  ws = new WebSocket(WS_URL);
  ws.onopen = () => {
    logEvent("Connected to server");
    send({ type: "join", name: myName });
  };
  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch (e) { return; }
    if (msg.type === "connected") { pid = msg.pid; }
    if (msg.type === "world") { worldState = msg.data; }
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
  document.getElementById("p-name").textContent = myPlayer.name;
  document.getElementById("p-level").textContent = `Lv.${myPlayer.level}`;
  document.getElementById("p-hp").textContent = myPlayer.hp;
  document.getElementById("p-maxhp").textContent = myPlayer.maxHp;
  document.getElementById("hp-bar").style.width = `${(myPlayer.hp / myPlayer.maxHp) * 100}%`;
  document.getElementById("p-gold").textContent = myPlayer.gold;
  document.getElementById("p-xp").textContent = myPlayer.xp;
  document.getElementById("player-stats").style.display = "block";

  // Update events from server
  const el = document.getElementById("events-log");
  if (worldState.events && worldState.events.length > 0) {
    const latest = worldState.events[0];
    if (el.firstChild && el.firstChild.textContent !== latest.text) {
      const div = document.createElement("div");
      div.textContent = latest.text;
      el.insertBefore(div, el.firstChild);
      while (el.children.length > 20) el.removeChild(el.lastChild);
    }
  }
}

// ── Attack ──
function doAttack() {
  send({ type: "attack" });
  // Visual feedback
  const flash = new THREE.PointLight(0xffaa00, 2, 5);
  flash.position.set(0, 0, -1).applyQuaternion(camera.quaternion).add(camera.position);
  scene.add(flash);
  setTimeout(() => scene.remove(flash), 100);
}

document.getElementById("attack-btn").addEventListener("click", doAttack);
document.getElementById("pickup-btn").addEventListener("click", () => send({ type: "pickup" }));

// ── Login ──
document.getElementById("join-btn").addEventListener("click", () => {
  const name = document.getElementById("name-input").value.trim();
  if (name) myName = name;
  document.getElementById("login-overlay").classList.add("hidden");
  document.getElementById("player-stats").style.display = "block";
  lockPointer();
  connect();
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
    send({ type: "update", data: { inVR: true } });
    logEvent("VR session started");
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
    }
  }
}

// ── Render sync ──
function syncScene() {
  // Find self
  myPlayer = worldState.players.find(p => p.id === pid) || null;

  // Walls (static, only add new ones)
  for (const w of worldState.walls || []) {
    const wid = `${w.min.x},${w.min.z}`;
    getOrCreate("walls", wid, () => createWallMesh(w));
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
    const m = getOrCreate("enemies", e.id, () => createEnemyMesh(e.type));
    m.position.set(e.pos.x, 0, e.pos.z);
    // HP bar
    if (m.userData.hpBar) {
      const hpPct = e.hp / e.maxHp;
      m.userData.hpBar.scale.x = hpPct;
      m.userData.hpBar.material.color.setHex(hpPct > 0.5 ? 0x2ecc71 : hpPct > 0.25 ? 0xf39c12 : 0xe74c3c);
      m.userData.hpBar.position.x = (1 - hpPct) * -0.3;
    }
  }
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

// ── Loop ──
function animate() {
  const dt = clock.getDelta();
  camera.rotation.order = "YXZ";
  camera.rotation.y = yaw;
  camera.rotation.x = pitch;

  if (renderer.xr.isPresenting) {
    // In VR: camera controlled by headset, send controller data
    const session = renderer.xr.getSession();
    if (session) {
      // We'll rely on the default camera for headset position
      // Controllers handled by XR controller meshes if present
    }
  } else {
    updateMovement(dt);
  }

  syncScene();
  updateHUD();
  renderer.render(scene, camera);
}
renderer.setAnimationLoop(animate);

// ── Resize ──
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

console.log("VR RPG Online client loaded");
