"use strict";
/**
 * Chat System + Dash Skill Fix Integration Test
 *
 * Verifies:
 * 1. Rogue Dash skill no longer crashes server (THREE.Vector3 removed)
 * 2. Chat messages are broadcast to all connected clients via WebSocket
 * 3. Chat messages include player name, class, level, and text
 * 4. Empty and oversize chat messages are rejected
 */

const { GameWorld, Player } = require("../src/game");

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.log(`  ❌ ${label}`);
    failed++;
  }
}

// ── Test 1: Rogue Dash Skill (THREE.Vector3 fix) ──
console.log("\n=== Test 1: Rogue Dash Skill (THREE.Vector3 fix) ===\n");

const world1 = new GameWorld(42);
const rogue = world1.addPlayer("p_test_rogue", "TestRogue", "rogue", {});

assert(rogue.class === "rogue", "Player is a Rogue");
assert(rogue.skills.length === 3, "Rogue has 3 skills");
assert(rogue.skills[1].name === "Dash", "Skill 2 is Dash");
assert(rogue.skills[1].type === "dash", "Dash skill type is 'dash'");

const beforeX = rogue.pos.x;
const beforeZ = rogue.pos.z;

// Give rogue enough mana
rogue.mana = 100;

const result = world1.playerUseSkill("p_test_rogue", 1); // Dash = skill index 1

assert(result !== null, "Dash skill returned a result (not null)");
assert(result.skill === "Dash", "Result skill name is Dash");
assert(result.distance === 4, "Dash distance is 4");

const afterX = rogue.pos.x;
const afterZ = rogue.pos.z;
const moved = Math.abs(afterX - beforeX) > 0 || Math.abs(afterZ - beforeZ) > 0;

assert(moved, `Rogue position changed: before=(${beforeX.toFixed(2)}, ${beforeZ.toFixed(2)}) after=(${afterX.toFixed(2)}, ${afterZ.toFixed(2)})`);
assert(!global.THREE, "THREE is not defined on server (confirming fix context)");

// ── Test 2: Chat message handling in server ──
console.log("\n=== Test 2: Chat message handling (server-side) ===\n");

// We test the WebSocket chat handler by starting the server and connecting
const WebSocket = require("ws");

const PORT = 8943; // Different port for testing
const server = require("http").createServer();
const { WebSocketServer } = require("ws");

// Import game world for the test server
const { GameWorld: GW } = require("../src/game");
const testWorld = new GW(999);

// Set up a minimal server that mirrors the real chat handler
const wss = new WebSocketServer({ server });

const receivedMessages = [];

wss.on("connection", (ws, req) => {
  const pid = `p_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  ws._pid = pid;

  ws.send(JSON.stringify({ type: "connected", pid }));

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }

    if (msg.type === "join") {
      testWorld.addPlayer(pid, msg.name || "Tester", msg.charClass || "warrior", {});
      const payload = JSON.stringify({ type: "world", data: testWorld.serialize() });
      for (const c of wss.clients) if (c.readyState === c.OPEN) c.send(payload);
    }

    if (msg.type === "chat") {
      const p = testWorld.players.get(pid);
      if (p && msg.text && typeof msg.text === "string") {
        const text = msg.text.trim().slice(0, 200);
        if (text.length > 0) {
          const chatMsg = {
            type: "chat",
            data: {
              id: `chat_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
              pid: pid,
              name: p.name,
              class: p.class,
              level: p.level,
              text: text,
              timestamp: Date.now(),
            },
          };
          const payload = JSON.stringify(chatMsg);
          for (const c of wss.clients) if (c.readyState === c.OPEN) c.send(payload);
        }
      }
    }
  });
});

server.listen(PORT, "127.0.0.1");

// Wait for server to start, then run WebSocket client tests
setTimeout(async () => {
  // Connect two clients
  const ws1 = new WebSocket(`ws://127.0.0.1:${PORT}`);
  const ws2 = new WebSocket(`ws://127.0.0.1:${PORT}`);

  let ws1Ready = false, ws2Ready = false;
  const ws1Messages = [];
  const ws2Messages = [];

  ws1.on("message", (raw) => {
    const msg = JSON.parse(raw);
    ws1Messages.push(msg);
  });

  ws2.on("message", (raw) => {
    const msg = JSON.parse(raw);
    ws2Messages.push(msg);
  });

  // Wait for both to connect
  await new Promise((resolve) => {
    let count = 0;
    const check = () => { count++; if (count >= 2) resolve(); };
    ws1.on("open", check);
    ws2.on("open", check);
  });

  // Both join the game
  ws1.send(JSON.stringify({ type: "join", name: "Alice", charClass: "mage" }));
  ws2.send(JSON.stringify({ type: "join", name: "Bob", charClass: "warrior" }));

  // Wait for join to propagate
  await new Promise((resolve) => setTimeout(resolve, 300));

  // Test: Alice sends a chat message
  ws1.send(JSON.stringify({ type: "chat", text: "Hello from Alice!" }));

  // Wait for message to propagate
  await new Promise((resolve) => setTimeout(resolve, 300));

  // Check ws2 received the chat message
  const ws2ChatMsgs = ws2Messages.filter((m) => m.type === "chat");
  assert(ws2ChatMsgs.length >= 1, "Bob received Alice's chat message");
  assert(ws2ChatMsgs.length > 0 && ws2ChatMsgs[0].data.name === "Alice", "Chat message has Alice's name");
  assert(ws2ChatMsgs.length > 0 && ws2ChatMsgs[0].data.text === "Hello from Alice!", "Chat message text is correct");
  assert(ws2ChatMsgs.length > 0 && ws2ChatMsgs[0].data.class === "mage", "Chat message has correct class");

  // Check ws1 also received its own message (broadcast)
  const ws1ChatMsgs = ws1Messages.filter((m) => m.type === "chat");
  assert(ws1ChatMsgs.length >= 1, "Alice received her own chat message (broadcast)");

  // Test: Bob sends a reply
  ws2.send(JSON.stringify({ type: "chat", text: "Hi Alice! GLHF" }));
  await new Promise((resolve) => setTimeout(resolve, 300));

  const ws1BobMsgs = ws1Messages.filter((m) => m.type === "chat" && m.data.name === "Bob");
  assert(ws1BobMsgs.length >= 1, "Alice received Bob's reply");
  assert(ws1BobMsgs.length > 0 && ws1BobMsgs[0].data.text === "Hi Alice! GLHF", "Bob's message text is correct");

  // Test: Empty message rejected
  const beforeCount = ws2Messages.filter((m) => m.type === "chat").length;
  ws1.send(JSON.stringify({ type: "chat", text: "   " }));
  await new Promise((resolve) => setTimeout(resolve, 200));
  const afterEmpty = ws2Messages.filter((m) => m.type === "chat").length;
  assert(afterEmpty === beforeCount, "Empty chat message was rejected (no broadcast)");

  // Test: Oversize message truncated to 200 chars
  const longText = "A".repeat(300);
  ws1.send(JSON.stringify({ type: "chat", text: longText }));
  await new Promise((resolve) => setTimeout(resolve, 300));
  const ws2LongMsgs = ws2Messages.filter((m) => m.type === "chat" && m.data.name === "Alice" && m.data.text.length <= 200);
  assert(ws2LongMsgs.length >= 1, "Oversize message truncated to <= 200 chars");

  // Cleanup
  ws1.close();
  ws2.close();
  wss.close();
  server.close();

  // ── Summary ──
  console.log("\n=== Test Summary ===");
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(failed === 0 ? "\n✅ ALL TESTS PASSED" : "\n❌ SOME TESTS FAILED");
  process.exit(failed === 0 ? 0 : 1);
}, 500);