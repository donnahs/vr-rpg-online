// Quick test: generate a dungeon and verify rooms
const { GameWorld } = require("../src/game");

console.log("=== Procedural Dungeon Generator Test ===\n");

const seeds = [123, 456, 789, 42, 999];

for (const seed of seeds) {
  const world = new GameWorld(seed);
  const rooms = world._rooms || [];
  const walls = world.walls || [];
  const enemies = world.enemies.size;
  const items = world.items.size;
  
  console.log(`Seed ${seed}:`);
  console.log(`  Rooms:     ${rooms.length}`);
  console.log(`  Walls:     ${walls.length}`);
  console.log(`  Enemies:   ${enemies}`);
  console.log(`  Items:     ${items}`);
  console.log(`  Spawn pts: ${world.spawnPoints.length}`);
  
  if (rooms.length >= 2) {
    console.log("  ✅ Multiple rooms generated");
  } else {
    console.log("  ❌ Failed to generate multiple rooms");
  }
  
  if (walls.length > 0) {
    console.log("  ✅ Walls generated");
  } else {
    console.log("  ❌ No walls generated");
  }
  
  console.log("");
}

console.log("=== Test Complete ===");
