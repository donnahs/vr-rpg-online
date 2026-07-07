# Character System Design — VR RPG Online
**Date:** 2026-07-07

---

## Character Classes

| Class | Role | Key Stat | Playstyle |
|---|---|---|---|
| **Warrior** | Tank / Melee | STR | High HP, slow heavy hits, taunt enemies |
| **Rogue** | DPS / Stealth | DEX | Fast attacks, critical hits, dodge |
| **Mage** | Ranged / AOE | INT | Spell damage, mana, area attacks |

## Base Stats (per class)

| Stat | Warrior | Rogue | Mage |
|---|---|---|---|
| STR | 8 | 4 | 3 |
| DEX | 4 | 8 | 4 |
| INT | 3 | 4 | 8 |
| VIT | 7 | 5 | 4 |

## Stat Effects

| Stat | Effect |
|---|---|
| **STR** | Melee damage × (1 + STR/20), knockback chance |
| **DEX** | Attack speed bonus, crit chance = DEX%, move speed |
| **INT** | Spell damage × (1 + INT/15), max mana = INT×10 |
| **VIT** | Max HP = 80 + VIT×15, HP regen per tick |

## Skills (Active + Passive)

### Warrior
| Skill | Key | Cooldown | Effect |
|---|---|---|---|
| Heavy Strike | 1 | 3s | 2× damage, stuns enemy 1s |
| Taunt | 2 | 8s | Forces nearby enemies to attack you |
| Iron Skin | 3 | 15s | -50% damage taken for 5s |
| Cleave (passive) | — | — | 25% chance to hit adjacent enemies |

### Rogue
| Skill | Key | Cooldown | Effect |
|---|---|---|---|
| Backstab | 1 | 4s | 3× damage if behind enemy |
| Dash | 2 | 6s | Teleport 4m forward through enemies |
| Smoke Bomb | 3 | 12s | Invisible 3s, enemies lose target |
| Critical Eye (passive) | — | — | Crits deal 2.5× instead of 2× |

### Mage
| Skill | Key | Cooldown | Effect |
|---|---|---|---|
| Fireball | 1 | 2s | Ranged spell, 1.5× damage, area splash |
| Frost Nova | 2 | 10s | Freeze all enemies within 4m for 2s |
| Arcane Shield | 3 | 15s | Absorb damage = INT×5 for 5s |
| Mana Regen (passive) | — | — | +2 mana/sec |

## Character Creation Flow

1. **Enter name** (existing field)
2. **Pick class** (Warrior/Rogue/Mage cards with descriptions)
3. **Allocate 10 bonus stat points** (STR/DEX/INT/VIT)
4. **Confirm** → save to localStorage + server

---

## Implementation Plan

| File | Changes |
|---|---|
| `src/game.js` | Rewrite Player class with stats, skills, mana, cooldowns |
| `public/index.html` | Add character creation overlay (class cards, stat sliders) |
| `public/app.js` | Handle creation UI, skill keybinds (1-3), cooldown visuals |
| `src/server.js` | Handle skill messages, process skill effects |

---

*Design ready. Building now.*
