"""Game state engine for VR RPG Online.
Authoritative server-side world simulation.
"""
import random
import math
import time
from typing import Dict, List, Optional, Any

TILE_SIZE = 2.0  # meters per tile in VR space

class Vec3:
    def __init__(self, x=0, y=0, z=0):
        self.x = float(x)
        self.y = float(y)
        self.z = float(z)
    def to_dict(self):
        return {"x": self.x, "y": self.y, "z": self.z}
    def distance_to(self, other):
        dx = self.x - other.x
        dy = self.y - other.y
        dz = self.z - other.z
        return math.sqrt(dx*dx + dy*dy + dz*dz)
    def __repr__(self):
        return f"Vec3({self.x:.2f}, {self.y:.2f}, {self.z:.2f})"

class Player:
    def __init__(self, pid: str, name: str):
        self.id = pid
        self.name = name[:18] or "Hero"
        self.pos = Vec3(0, 1.6, 0)  # eye height in VR
        self.rot = Vec3(0, 0, 0)    # yaw, pitch, roll
        self.hp = 100
        self.max_hp = 100
        self.level = 1
        self.xp = 0
        self.gold = 0
        self.speed = 3.0  # m/s
        self.in_vr = False
        self.controller_left = {"pos": Vec3(-0.2, 1.2, -0.3), "rot": Vec3()}
        self.controller_right = {"pos": Vec3(0.2, 1.2, -0.3), "rot": Vec3()}
        self.inventory = []
        self.last_update = time.time()
        self.connected_at = time.time()
        self.color = self._pick_color(pid)

    def _pick_color(self, pid):
        colors = ["#e74c3c", "#3498db", "#2ecc71", "#f39c12", "#9b59b6", "#1abc9c", "#e91e63", "#00bcd4"]
        h = hash(pid) % len(colors)
        return colors[h]

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "pos": self.pos.to_dict(),
            "rot": self.rot.to_dict(),
            "hp": self.hp,
            "maxHp": self.max_hp,
            "level": self.level,
            "xp": self.xp,
            "gold": self.gold,
            "inVR": self.in_vr,
            "controllerLeft": {"pos": self.controller_left["pos"].to_dict(), "rot": self.controller_left["rot"].to_dict()},
            "controllerRight": {"pos": self.controller_right["pos"].to_dict(), "rot": self.controller_right["rot"].to_dict()},
            "inventory": self.inventory,
            "color": self.color,
        }

class Enemy:
    def __init__(self, eid: str, x: float, z: float, etype: str = "goblin"):
        self.id = eid
        self.etype = etype
        self.pos = Vec3(x, 0.5, z)
        self.hp = 30 if etype == "goblin" else 60
        self.max_hp = self.hp
        self.damage = 5 if etype == "goblin" else 12
        self.speed = 1.5
        self.state = "patrol"
        self.patrol_center = Vec3(x, 0.5, z)
        self.patrol_radius = 4.0
        self.target = None
        self.last_attack = 0
        self.attack_cooldown = 1.5
        self.awareness_radius = 8.0
        self.color = "#e74c3c" if etype == "goblin" else "#c0392b"

    def to_dict(self):
        return {
            "id": self.id,
            "type": self.etype,
            "pos": self.pos.to_dict(),
            "hp": self.hp,
            "maxHp": self.max_hp,
            "state": self.state,
            "color": self.color,
        }

class Item:
    def __init__(self, iid: str, x: float, z: float, itype: str, value: int = 1):
        self.id = iid
        self.pos = Vec3(x, 0.3, z)
        self.itype = itype  # "gold", "potion", "sword", "shield"
        self.value = value
        self.picked_up = False
        self.color = {"gold": "#f1c40f", "potion": "#e91e63", "sword": "#95a5a6", "shield": "#3498db"}.get(itype, "#fff")

    def to_dict(self):
        return {
            "id": self.id,
            "type": self.itype,
            "pos": self.pos.to_dict(),
            "value": self.value,
            "color": self.color,
        }

class GameWorld:
    def __init__(self, seed: int = 42):
        self.seed = seed
        self.rng = random.Random(seed)
        self.players: Dict[str, Player] = {}
        self.enemies: Dict[str, Enemy] = {}
        self.items: Dict[str, Item] = {}
        self.events: List[Dict] = []
        self.dungeon_size = 20
        self.walls = []
        self.spawn_points = []
        self.tick_rate = 0.05  # 20 ticks/sec
        self.last_tick = time.time()
        self._generate_dungeon()
        self._spawn_enemies(6)
        self._spawn_items(10)

    def _generate_dungeon(self):
        """Generate simple dungeon walls as AABB boxes."""
        size = self.dungeon_size
        # Outer walls
        for x in range(-size, size + 1):
            self.walls.append({"min": Vec3(x * TILE_SIZE, 0, -size * TILE_SIZE), "max": Vec3((x+1) * TILE_SIZE, 3, (-size+1) * TILE_SIZE)})
            self.walls.append({"min": Vec3(x * TILE_SIZE, 0, size * TILE_SIZE), "max": Vec3((x+1) * TILE_SIZE, 3, (size+1) * TILE_SIZE)})
        for z in range(-size + 1, size):
            self.walls.append({"min": Vec3(-size * TILE_SIZE, 0, z * TILE_SIZE), "max": Vec3((-size+1) * TILE_SIZE, 3, (z+1) * TILE_SIZE)})
            self.walls.append({"min": Vec3(size * TILE_SIZE, 0, z * TILE_SIZE), "max": Vec3((size+1) * TILE_SIZE, 3, (z+1) * TILE_SIZE)})
        # Internal walls (random pillars)
        for _ in range(12):
            wx = self.rng.randint(-size + 2, size - 2)
            wz = self.rng.randint(-size + 2, size - 2)
            self.walls.append({"min": Vec3(wx * TILE_SIZE, 0, wz * TILE_SIZE), "max": Vec3((wx+1) * TILE_SIZE, 3, (wz+1) * TILE_SIZE)})
        # Spawn points
        self.spawn_points = [Vec3(0, 1.6, 0), Vec3(4, 1.6, 4), Vec3(-4, 1.6, -4), Vec3(4, 1.6, -4), Vec3(-4, 1.6, 4)]

    def _spawn_enemies(self, count: int):
        for i in range(count):
            x = self.rng.uniform(-15, 15)
            z = self.rng.uniform(-15, 15)
            etype = "goblin" if self.rng.random() > 0.3 else "orc"
            e = Enemy(f"enemy_{i}", x, z, etype)
            self.enemies[e.id] = e

    def _spawn_items(self, count: int):
        types = ["gold"] * 4 + ["potion"] * 3 + ["sword"] * 2 + ["shield"] * 1
        for i in range(count):
            x = self.rng.uniform(-15, 15)
            z = self.rng.uniform(-15, 15)
            itype = self.rng.choice(types)
            value = {"gold": self.rng.randint(5, 25), "potion": 30, "sword": 10, "shield": 5}[itype]
            item = Item(f"item_{i}", x, z, itype, value)
            self.items[item.id] = item

    def add_player(self, pid: str, name: str) -> Player:
        idx = len(self.players) % len(self.spawn_points)
        p = Player(pid, name)
        p.pos = Vec3(self.spawn_points[idx].x, self.spawn_points[idx].y, self.spawn_points[idx].z)
        self.players[pid] = p
        self._add_event(f"{p.name} joined the dungeon.")
        return p

    def remove_player(self, pid: str):
        if pid in self.players:
            self._add_event(f"{self.players[pid].name} left.")
            del self.players[pid]

    def update_player(self, pid: str, data: Dict):
        if pid not in self.players:
            return
        p = self.players[pid]
        if "pos" in data:
            d = data["pos"]
            p.pos = Vec3(d.get("x", p.pos.x), d.get("y", p.pos.y), d.get("z", p.pos.z))
        if "rot" in data:
            d = data["rot"]
            p.rot = Vec3(d.get("x", p.rot.x), d.get("y", p.rot.y), d.get("z", p.rot.z))
        if "inVR" in data:
            p.in_vr = data["inVR"]
        if "controllers" in data:
            c = data["controllers"]
            if "left" in c:
                p.controller_left["pos"] = Vec3(c["left"]["x"], c["left"]["y"], c["left"]["z"])
            if "right" in c:
                p.controller_right["pos"] = Vec3(c["right"]["x"], c["right"]["y"], c["right"]["z"])
        p.last_update = time.time()

    def tick(self):
        """Server tick: update enemies, physics, combat."""
        now = time.time()
        self.last_tick = now
        for e in list(self.enemies.values()):
            self._update_enemy(e, now)

    def _update_enemy(self, e: Enemy, now: float):
        # Find nearest player
        nearest = None
        nearest_dist = float('inf')
        for p in self.players.values():
            d = e.pos.distance_to(p.pos)
            if d < nearest_dist:
                nearest_dist = d
                nearest = p
        if nearest and nearest_dist < e.awareness_radius:
            e.target = nearest
            e.state = "chase"
        else:
            e.target = None
            e.state = "patrol"
        # Movement
        if e.state == "chase" and e.target:
            dx = e.target.pos.x - e.pos.x
            dz = e.target.pos.z - e.pos.z
            dist = math.sqrt(dx*dx + dz*dz)
            if dist > 0.5:
                speed = e.speed * self.tick_rate
                e.pos.x += (dx / dist) * speed
                e.pos.z += (dz / dist) * speed
            elif now - e.last_attack > e.attack_cooldown:
                e.target.hp -= e.damage
                e.last_attack = now
                self._add_event(f"{e.etype.capitalize()} hit {e.target.name} for {e.damage}!")
                if e.target.hp <= 0:
                    e.target.hp = 0
                    self._add_event(f"{e.target.name} was slain by {e.etype}!")
                    # Respawn
                    idx = hash(e.target.id) % len(self.spawn_points)
                    e.target.pos = Vec3(self.spawn_points[idx].x, self.spawn_points[idx].y, self.spawn_points[idx].z)
                    e.target.hp = e.target.max_hp
        elif e.state == "patrol":
            dx = e.patrol_center.x - e.pos.x
            dz = e.patrol_center.z - e.pos.z
            dist = math.sqrt(dx*dx + dz*dz)
            if dist > e.patrol_radius:
                # Return to center
                if dist > 0.5:
                    speed = e.speed * 0.5 * self.tick_rate
                    e.pos.x += (dx / dist) * speed
                    e.pos.z += (dz / dist) * speed
            else:
                # Random wander
                angle = self.rng.uniform(0, 2 * math.pi)
                speed = e.speed * 0.3 * self.tick_rate
                e.pos.x += math.cos(angle) * speed
                e.pos.z += math.sin(angle) * speed

    def player_attack(self, pid: str) -> Optional[Dict]:
        if pid not in self.players:
            return None
        p = self.players[pid]
        damage = 15 + p.level * 2
        # Find nearest enemy in front of player
        nearest = None
        nearest_dist = 3.0
        for e in self.enemies.values():
            d = p.pos.distance_to(e.pos)
            if d < nearest_dist:
                nearest = e
                nearest_dist = d
        if nearest:
            nearest.hp -= damage
            self._add_event(f"{p.name} hit {nearest.etype} for {damage}!")
            if nearest.hp <= 0:
                self._add_event(f"{p.name} defeated {nearest.etype}!")
                p.xp += 10
                p.gold += self.rng.randint(3, 12)
                if p.xp >= p.level * 50:
                    p.level += 1
                    p.max_hp += 20
                    p.hp = p.max_hp
                    self._add_event(f"{p.name} reached level {p.level}!")
                del self.enemies[nearest.id]
                # Respawn enemy elsewhere
                x = self.rng.uniform(-15, 15)
                z = self.rng.uniform(-15, 15)
                etype = "goblin" if self.rng.random() > 0.3 else "orc"
                ne = Enemy(f"enemy_{self.rng.randint(1000,9999)}", x, z, etype)
                self.enemies[ne.id] = ne
            return {"target": nearest.id, "damage": damage, "killed": nearest.hp <= 0}
        return None

    def pickup_item(self, pid: str) -> Optional[Dict]:
        if pid not in self.players:
            return None
        p = self.players[pid]
        nearest = None
        nearest_dist = 2.0
        for item in self.items.values():
            if item.picked_up:
                continue
            d = p.pos.distance_to(item.pos)
            if d < nearest_dist:
                nearest = item
                nearest_dist = d
        if nearest:
            nearest.picked_up = True
            del self.items[nearest.id]
            if nearest.itype == "gold":
                p.gold += nearest.value
                self._add_event(f"{p.name} picked up {nearest.value} gold.")
            elif nearest.itype == "potion":
                p.hp = min(p.max_hp, p.hp + nearest.value)
                self._add_event(f"{p.name} used a health potion (+{nearest.value} HP).")
            elif nearest.itype == "sword":
                self._add_event(f"{p.name} found a sword (+{nearest.value} damage).")
            elif nearest.itype == "shield":
                p.max_hp += nearest.value
                p.hp += nearest.value
                self._add_event(f"{p.name} found a shield (+{nearest.value} HP).")
            return {"item": nearest.to_dict()}
        return None

    def _add_event(self, text: str):
        self.events.insert(0, {"text": text, "at": time.time()})
        self.events = self.events[:20]

    def serialize(self) -> Dict[str, Any]:
        return {
            "players": [p.to_dict() for p in self.players.values()],
            "enemies": [e.to_dict() for e in self.enemies.values()],
            "items": [i.to_dict() for i in self.items.values() if not i.picked_up],
            "walls": [{"min": w["min"].to_dict(), "max": w["max"].to_dict()} for w in self.walls],
            "events": self.events[:8],
            "dungeonSize": self.dungeon_size,
        }
