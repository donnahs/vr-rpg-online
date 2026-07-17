"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { GameWorld } = require("../src/game");

const TILE_SIZE = 2;
let passed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✅ ${name}`);
  } catch (error) {
    console.error(`  ❌ ${name}`);
    throw error;
  }
}

function cellKey(cell) {
  return `${cell.x},${cell.y}`;
}

function layoutSignature(world) {
  return JSON.stringify({
    dimensions: world.dungeonDimensions,
    rooms: world._rooms,
    floorCells: world._floorCells,
    walls: world.walls,
    spawnPoints: world.spawnPoints,
  });
}

function reachableFloorCount(world) {
  const floor = new Set(world._floorCells.map(cellKey));
  const startRoom = world._rooms.find((room) => room.role === "start");
  assert.ok(startRoom, "a start room is required");

  const start = { x: Math.floor(startRoom.cx), y: Math.floor(startRoom.cy) };
  const queue = [start];
  const visited = new Set([cellKey(start)]);
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const next = { x: current.x + dx, y: current.y + dy };
      const key = cellKey(next);
      if (floor.has(key) && !visited.has(key)) {
        visited.add(key);
        queue.push(next);
      }
    }
  }
  return visited.size;
}

function entityCell(entity) {
  return {
    x: Math.floor(entity.pos.x / TILE_SIZE),
    y: Math.floor(entity.pos.z / TILE_SIZE),
  };
}

console.log("=== Procedural Dungeon Regression Test ===\n");

for (const seed of [42, 123, 456, 789, 999]) {
  console.log(`Seed ${seed}`);
  const world = new GameWorld(seed);
  const duplicate = new GameWorld(seed);

  test("same seed produces the same layout", () => {
    assert.equal(layoutSignature(world), layoutSignature(duplicate));
  });

  test("layout contains multiple rooms, floor cells, and walls", () => {
    assert.ok(world._rooms.length >= 5, `expected at least 5 rooms, got ${world._rooms.length}`);
    assert.ok(world._floorCells.length > 0);
    assert.ok(world.walls.length > 0);
  });

  test("all floor tiles are reachable from the start room", () => {
    assert.equal(reachableFloorCount(world), world._floorCells.length);
  });

  test("room roles contain one start, one boss, and one treasure room", () => {
    assert.equal(world._rooms.filter((room) => room.role === "start").length, 1);
    assert.equal(world._rooms.filter((room) => room.role === "boss").length, 1);
    assert.equal(world._rooms.filter((room) => room.role === "treasure").length, 1);
  });

  test("boss spawns inside the designated boss room", () => {
    const room = world._rooms.find((candidate) => candidate.role === "boss");
    const boss = world.enemies.get("boss_1");
    assert.ok(boss);
    const bx = boss.pos.x / TILE_SIZE;
    const by = boss.pos.z / TILE_SIZE;
    assert.ok(bx >= room.x && bx <= room.x + room.w);
    assert.ok(by >= room.y && by <= room.y + room.h);
  });

  test("all enemies and items spawn on traversable floor", () => {
    const floor = new Set(world._floorCells.map(cellKey));
    for (const entity of [...world.enemies.values(), ...world.items.values()]) {
      assert.ok(floor.has(cellKey(entityCell(entity))), `${entity.id} spawned outside floor`);
    }
  });

  console.log(`  rooms=${world._rooms.length} floor=${world._floorCells.length} walls=${world.walls.length}\n`);
}

const shallow = new GameWorld(2026);
const deep = new GameWorld(2026);
for (let floor = 1; floor < 7; floor += 1) deep._advanceDungeon();

test("deeper floors scale dimensions and room count", () => {
  assert.equal(shallow.dungeonDimensions.width, 30);
  assert.equal(deep.dungeonDepth, 7);
  assert.equal(deep.dungeonDimensions.width, 42);
  assert.ok(deep._rooms.length >= shallow._rooms.length,
    `floor 7 rooms (${deep._rooms.length}) should be >= floor 1 (${shallow._rooms.length})`);
});

test("layout regeneration increments the serialized revision", () => {
  assert.equal(shallow.serialize().dungeonRevision, 1);
  const previousRevision = shallow.dungeonRevision;
  shallow._advanceDungeon();
  const state = shallow.serialize();
  assert.equal(state.dungeonRevision, previousRevision + 1);
  assert.equal(state.dungeonSeed, shallow.seed);
  assert.deepEqual(state.dungeonDimensions, shallow.dungeonDimensions);
  assert.equal(state.rooms.length, shallow._rooms.length);
});

test("client reconciles stale walls and aligns the floor to dungeon dimensions", () => {
  const clientSource = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
  assert.match(clientSource, /if \(!activeWallIds\.has\(id\)\)/,
    "client must remove walls absent from the latest floor");
  assert.match(clientSource, /floor\.scale\.set\(dungeonWidth \/ 80, dungeonHeight \/ 80, 1\)/,
    "client must resize the floor from both serialized dimensions");
  assert.match(clientSource, /floor\.position\.set\(dungeonWidth \/ 2, 0, dungeonHeight \/ 2\)/,
    "client must centre the floor under the positive-coordinate dungeon grid");
});

console.log(`\n=== Results: ${passed} assertions passed ===`);
console.log("✅ PROCEDURAL DUNGEON REGRESSION TESTS PASSED");
