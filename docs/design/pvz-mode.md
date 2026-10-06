# pvzlite survival mode — Shapers vs Lancer (design spec)

This is the authoritative spec for pvzlite's main mode. It reproduces the rules of the
community arcade mode *Probes vs Zealot 2* (reference: the "How to play a probe" guide and the
rest of the PvZ2 wiki) with pvzlite's original characters:

| PvZ2 term | pvzlite term | internal id |
|---|---|---|
| Probe (player) | **Shaper** | role `shaper`, unit `builder` |
| Zealot (player) | **Lancer** | role `lancer`, unit `lancerHero` |
| Hunter (dead probe helping the zealot) | **Hunter** | form `hunter`, unit `hunter` |
| Probe Spirit (dead probe helping probes) | **Shaper Spirit** | form `spirit`, unit `spirit` |
| Zealot Shop (Factory in the middle) | **Lancer Shop** | building `shop` (neutral, owner -1) |
| Vespene gas / minerals | **gas** / **minerals** | `p.gas` / `p.minerals` |
| Void Prison | **Stasis Prison** | ability `stasis` |
| Chrono Boost | **Overcharge** | ability `overcharge` |
| Force Field | **Barrier Field** | ability `barrierField` |
| Invulnerability | **Invulnerability** | ability `invuln` |
| Blink / Advanced Blink | **Blink** / **Far Blink** | `blink` / `farBlink` |
| Teleport | **Recall** | `recall` |
| Faster Speed | **Swiftness** | `swift` (passive) |
| Cloak | **Cloak** | `cloak` |
| Scanner Sweep | **Scan** | `scan` |
| Teleport to Base | **Return** | `return` |
| Mineral Gloves | **Feed** (passive) | – |
| Magic Immunity | **Spell Immunity** (passive) | – |
| Stalker / Mercenary | **Warden I–IV** | unit `warden`, `tier` 1–4 |
| Automated Mine | **Auto Mine 1–8** | building `autoMine`, `level` 1–8 |
| Ancient Library | **Ancient Library** | building `library` |
| Zealot Detector | **Lancer Detector** | building `detector` |

All numbers below come from the wiki unless marked *(pvzlite)* — those fill gaps the wiki leaves
open and are chosen to keep the guide's build order working exactly as written.

The mode keeps the internal mode id `'survival'` (`World({ mode: 'survival' })`). Classic RTS mode
is untouched.

---

## 1. Overview & flow

- 1 **Lancer** vs 1–9 **Shapers** (max 10 players). Exactly one Lancer: if several players ask for
  `lancer`, the first one gets it and the rest become Shapers; if nobody asks, one player is
  picked with `world.rng` (prefer a human-less pick: any player).
- **0:00** – every Shaper spawns in a ring (radius 6–9) around the **Lancer Shop** at the map
  centre. Each Shaper may build one **Generator 1** for free.
- **0:40** – the Lancer appears at the Shop (`SURVIVAL.lancerSpawn = 40` s). Before that the
  Lancer player sees a countdown and can already shop (they start with 40 minerals).
- **5:00** – gold mineral bases open for building (`SURVIVAL.unlockTime = 300` s) and dead Shapers
  may choose to become Hunters.
- **Win conditions**
  - Shapers win when the **Lancer hero dies** (Hunters do not count), or when the Lancer player
    leaves/is eliminated, or when the optional time limit runs out (`opts.duration`, default
    `0` = no limit).
  - The Lancer team wins when **no Shaper hero is alive** (spirits don't count; a Shaper who
    became a Hunter doesn't count).
- `opts.pace` (1, 2 or 4; default 1) multiplies **every resource income**: generator gas,
  auto-mine gas, miner minerals, gas bonus pickups, the Lancer's passive income and feed. Costs
  are unchanged. *(pvzlite — lets people play shorter games.)*

Teams: `SHAPER_TEAM = 1` (shapers + spirits), `LANCER_TEAM = 2` (lancer + hunters). A Shaper who
becomes a Hunter moves to team 2. All Shapers are allied and share vision.

## 2. Map rules

- The **Shop** is a neutral 5×5 building at `map.cage` (existing field; rename semantics only).
  It is invulnerable, untargetable, blocks movement and gives no vision. Lancer/Hunters within
  **8** cells of its centre heal **25% of max HP per second** and may buy/sell items.
- **Mineral fields** are the existing crystal resources (groves). In survival they never deplete.
  Fields flagged `rich` are **gold**: miners of tier 1–4 gather **double**. Gold groves should sit
  near the centre (within ~30 cells of the Shop), like PvZ2's gold bases north of the shop.
- **Gold lock:** before 5:00 nobody can build within 10 cells of a gold field (miners may still
  mine there).
- **Ramps** on survival maps are **4 cells wide and buildable** (in survival maps only: ramp
  cells keep `CELL_BUILDABLE` and the "cells next to ramps are not buildable" rule is skipped).
  A 2×2 wall in the middle of a ramp leaves a **1-cell gap on each side**: Shapers (radius 0.4)
  walk through, the Lancer and Hunters (2 cells wide) cannot.
- Survival maps should offer many walled bases: plateaus with one 4-wide ramp and a mineral
  grove inside, corner bases far from the Shop, open-field groves, and 2–4 gold groves near the
  centre.
- **Gas bonus pickups** *(wiki: "Gas Bonus")*: every 40 s a pickup appears at a random pathable,
  non-ramp cell ≥ 15 cells from the Shop (max 6 on the map). A Shaper hero touching it
  (distance ≤ 1.2) gains **+10 gas** (× pace). They don't expire.
- **Mineral pallets:** salvaging a Generator of level ≥ 2 leaves a pallet at its position worth
  the table's "pallet" minerals. Only the Lancer/Hunters can pick it up (distance ≤ 1.5). It
  expires after 90 s.

Pickups live in `world.pickups = [{ id, type: 'gasBonus'|'pallet', x, y, amount, expires }]`
(ids from `world.nextId`; `expires` is a tick or `-1`).

## 3. Units

| id | name | HP | barrier | speed | radius | sight | weapon | notes |
|---|---|---|---|---|---|---|---|---|
| `builder` | Shaper | 20 | 20 | 3.94 | 0.4 | 8 | none | can build; dies to ~1–2 early Lancer swings |
| `lancerHero` | Lancer | 500 | 0 | 4.2 | 0.9 | 9 | 5 dmg, 1 strike, cooldown 1.0 s, range 0.2 | 2 cells wide (clearance pathing) |
| `hunter` | Hunter | 250 | 0 | 4.2 | 0.9 | 9 | same as Lancer | no Scan |
| `spirit` | Shaper Spirit | 60 | 0 | 4.6 | 0.4 | 9 | none | respawns 60 s after death, 30 s invulnerable on spawn |
| `miner` | Miner (tier 1–9) | 40 | 0 | 3.0 | 0.35 | 5 | none | auto-mines |
| `warden` | Warden (tier 1–4) | see §6.6 | 0 | 4.0 | 0.5 | 10 | ranged, range 6, 1 shot/s | attacks Lancer/Hunters |

Lancer/Hunter stats are recomputed from items (§7). Lancer, Hunters and Spirits gain no armor.
Use `dr` (damage reduction fraction 0–1) instead of flat armor in survival (§5).

The Lancer and Hunters use **clearance-2 pathing** (§9).

## 4. Shaper economy

`p.gas`, `p.minerals` (floats internally, floor for display). Start: 0 / 0.

### 4.1 Generator (one per Shaper)

Size 2×2. A Shaper may own at most one Generator (alive or under construction). Level 1 is free.
Build time 2 s; each upgrade takes 5 s *(pvzlite)* during which it keeps producing at the old
rate. Income is gas per second (× pace). From level 5 on it has **92% damage reduction**.
Cannot be repaired.

| Level | Gas cost | Mineral cost | Gas/s | Pallet on salvage | HP *(pvzlite)* | Upgrade requires (owned, completed) |
|---|---|---|---|---|---|---|
| 1 | 0 | 0 | 1 | – | 200 | – |
| 2 | 50 | 0 | 2 | 100 | 300 | Wall ≥ 1 |
| 3 | 100 | 0 | 4 | 150 | 400 | Wall ≥ 4 |
| 4 | 200 | 0 | 8 | 175 | 600 | Market ≥ 1 |
| 5 | 400 | 0 | 16 | 200 | 800 | Wall ≥ 6 (Ultra Wall 1) |
| 6 | 800 | 32 | 32 | 400 | 1200 | Market ≥ 2 (Underground Market) |
| 7 | 1600 | 64 | 64 | 5600 | 1800 | Wall ≥ 7 (Ultra Wall 2) |
| 8 | 3200 | 128 | 128 | 6400 | 2700 | Wall ≥ 9 (Ultra Wall 4) |
| 9 | 6400 | 256 | 256 | 9600 | 4000 | Wall ≥ 11 (Mega Wall 1) |
| 10 (Max) | 12800 | 512 | 512 | 12800 | 6000 | Wall ≥ 13 (Mega Wall 3) |

"Requires" = the Shaper owns at least one completed Wall (or Market) at that level or higher
when the upgrade **starts**. (Wiki: each upgrade needs either a wall or a market, alternating, so
players salvage one and build the other.)

### 4.2 Walls

Size 2×2, any number. Built at level 1, upgraded in place (each step costs that level's price).
Upgrading raises HP by the difference in max HP (and shield likewise). Shields regenerate
normally (2.8/s after 7 s without damage). Build/upgrade time *(pvzlite)*: 2 s (Wall 1–5),
3 s (Ultra), 4 s (Mega), 5 s (Power/Final).

| # | Name | Gas | Minerals | HP | Shield | Damage reduction |
|---|---|---|---|---|---|---|
| 1 | Wall 1 | 4 | 0 | 50 | 0 | 0% |
| 2 | Wall 2 | 8 | 0 | 70 | 0 | 0% |
| 3 | Wall 3 | 16 | 0 | 110 | 0 | 0% |
| 4 | Wall 4 | 32 | 0 | 170 | 0 | 0% |
| 5 | Wall 5 | 64 | 0 | 210 | 0 | 0% |
| 6 | Ultra Wall 1 | 128 | 0 | 320 | 0 | 2% |
| 7 | Ultra Wall 2 | 256 | 0 | 640 | 0 | 4% |
| 8 | Ultra Wall 3 | 512 | 0 | 1280 | 0 | 6% |
| 9 | Ultra Wall 4 | 1024 | 0 | 2560 | 0 | 8% |
| 10 | Ultra Wall 5 | 2048 | 0 | 5120 | 0 | 10% |
| 11 | Mega Wall 1 | 4096 | 32 | 10240 | 0 | 12% |
| 12 | Mega Wall 2 | 8192 | 64 | 20480 | 0 | 14% |
| 13 | Mega Wall 3 | 16384 | 128 | 40960 | 0 | 16% |
| 14 | Mega Wall 4 | 32768 | 256 | 81920 | 0 | 18% |
| 15 | Mega Wall 5 | 65536 | 516 | 163840 | 0 | 20% |
| 16 | Power Wall 1 | 131072 | 1020 | 350000 | 0 | 50% |
| 17 | Power Wall 2 | 262144 | 2048 | 400000 | 277680 | 60% |
| 18 | Final Wall | 1000000 | 500000 | 500000 | 500000 | 75% |

### 4.3 Market

Size 2×2, upgraded in place. Build 5 s, upgrades 3 s.

| Level | Name | Gas | HP | Unlocks |
|---|---|---|---|---|
| 1 | Market | 64 | 20 | Generator 4, Turret 3–4, direct Turret 6, trading |
| 2 | Underground Market | 256 | 50 | Generator 6, Turret 5–6 |
| 3 | Global Market | 1024 | 130 | Turret 7–10 |

**Trading** (needs any completed own Market): one global price `world.survival.price` = gas per
10 minerals, starting at **155**.
- *Buy 10 minerals*: pay `price` gas, then `price += 5`.
- *Sell 10 minerals*: receive `max(5, price - 10)` gas *(pvzlite spread, stops buy/sell loops)*,
  then `price = max(20, price - 5)`.
- Commands take `lots` (1 or 10 = 10 or 100 minerals); each lot is a separate transaction.

### 4.4 Turrets

Size 2×2. Built as Turret 1 (8 gas, 4 s) and upgraded in place; or built directly as **Turret 6**
(cumulative cost 512 gas, needs Market ≥ 1, 20 s) or **Turret 11** (cumulative cost, needs Library,
30 s) *(wiki: "If the Turret 6 is built by the Probe, it takes 20 seconds")*. Upgrades take 4 s
(5 s from level 11) and the turret **does not fire while upgrading**. Turrets shoot only the
Lancer/Hunters that are visible to the Shaper team (cloaked = invisible unless detected).
"Damage" is per shot; one shot per `cooldown` seconds. *Cease fire* toggles shooting off.

| Lvl | Gas | Minerals | Damage | Cooldown | Range | HP | Requires |
|---|---|---|---|---|---|---|---|
| 1 | 8 | 0 | 1 | 1.0 | 6 | 20 | – |
| 2 | 24 | 0 | 2 | 1.0 | 6 | 30 | – |
| 3 | 32 | 0 | 4 | 1.0 | 6 | 40 | Market ≥ 1 |
| 4 | 64 | 0 | 8 | 1.0 | 6 | 40 | Market ≥ 1 |
| 5 | 128 | 0 | 16 | 1.0 | 6 | 40 | Market ≥ 2 |
| 6 | 256 | 0 | 32 | 1.0 | 6 | 40 | Market ≥ 2 (Market ≥ 1 when built directly) |
| 7 | 512 | 16 | 64 | 1.0 | 6 | 40 | Market ≥ 3 |
| 8 | 1024 | 32 | 128 | 1.0 | 7 | 40 | Market ≥ 3 |
| 9 | 2048 | 64 | 400 | 1.0 | 7 | 40 | Market ≥ 3 |
| 10 | 4096 | 128 | 700 | 1.0 | 8 | 40 | Market ≥ 3 |
| 11 | 8192 | 15000 | 40960 | 1.0 | 9 | 40 | Library |
| 12 | 8192 | 36000 | 160000 | 1.0 | 10 | 40 | Library |
| 13 | 8192 | 1000960 | 524270 | 0.2 | 11 | 40 | Library |
| 14 (Final Turret) | 0 | 20000000 | 524270 | 0.1 | 7 | 100000 | Library |

### 4.5 Collection Depot, miners, auto mines

- **Collection Depot**: 256 gas *(guide: "256 gas is a lot … selling it")*, 3×3, HP 200, build
  10 s. Trains miners (queue up to 5). Salvageable.
- **Miners** (units) are trained at a Depot, max **15 per Shaper** (alive + queued). They walk to
  the nearest mineral field (gold preferred for tiers 1–4) and gather forever, crediting the
  owner directly (no return trip). Up to 3 miners per field. Train time 5 s (tier ≥ 6: 10 s).
  Not salvageable; *Dismiss* destroys your own miner silently.

| Tier | Name | Gas | Minerals per gather | Gather time |
|---|---|---|---|---|
| 1 | Simple Miner | 512 | 1 | 8 s |
| 2 | Average Miner | 1024 | 1 | 4 s |
| 3 | Advanced Miner | 2048 | 1 | 2 s |
| 4 | Professional Miner | 4096 | 1 | 1 s |
| 5 | Master Miner | 15360 | 6 | 1 s |
| 6 | Ultra Miner | 71680 | 36 | 1 s |
| 7 | Legendary Miner | 299999 | 216 | 1 s |
| 8 | Perfect Miner | 1000000 | 1296 | 1 s |
| 9 | Ludicrous Miner | 10000000 | 17500 | 1 s |

- **Auto Mines** (building `autoMine`, field `level`): built by the Shaper with **minerals**,
  needs a completed Collection Depot, size 2×2, HP 100, build 5 s, produce gas forever.
  Not salvageable, not upgradable; *Dismiss* destroys one.

| Level | Minerals | Gas/s |
|---|---|---|
| 1 | 32 | 1 |
| 2 | 256 | 8 |
| 3 | 1024 | 32 |
| 4 | 4096 | 128 |
| 5 | 16384 | 512 |
| 6 | 65536 | 2048 |
| 7 | 262144 | 8192 |
| 8 | 1000000 | 32768 |

### 4.6 Late game

- **Ancient Library** *(costs pvzlite)*: 4096 gas + 256 minerals, 3×3, HP 300, build 20 s.
  Enables Turret 11+, the Detector and Wardens.
- **Lancer Detector**: 9999 gas + 1024 minerals, 2×2, HP 200, build 10 s. Gives the Shaper team
  vision **and detection** (reveals cloak) of enemy units within **20** cells.
- **Wardens** (trained at the Library, 20 s each), ranged anti-Lancer units:

| Tier | Gas | Minerals | Damage/s | HP *(pvzlite)* |
|---|---|---|---|---|
| I | 35000 | 25000 | 40960 | 20000 |
| II | 100000 | 35000 | 160000 | 60000 |
| III | 5000000 | 1000000 | 2621350 | 500000 |
| IV | 10000000 | 2500000 | 7864050 | 2000000 |

### 4.7 Salvage

Generators, Walls, Turrets, Markets, Collection Depots and Libraries can be salvaged. Salvage
takes **3 s** (`b.salvaging` counts down); if the building dies meanwhile there's no refund.
On completion the Shaper gets back **everything invested** (all levels' gas + minerals) and the
building is removed (silent kill, no feed, no "destroyed" stat). A level ≥ 2 Generator drops a
pallet (§2). Buildings under construction can be cancelled for a full refund instantly.

### 4.8 Sharing

`{ type: 'share', to, gas, minerals }` moves resources to another alive Shaper (wiki `-v`/`-m`).

## 5. Damage & feed

In survival mode `applyDamage` works like this:
1. Ignore if the target is dead, `invulnerable` (ability/spawn) or the Shop.
2. `amount *= (1 - dr)` where `dr` is the target's damage reduction (walls, generators ≥ 5,
   Lancer armor items). Flat armor and upgrades are not used in survival.
3. Barrier (shield) absorbs first, then HP, as now (no MIN_DAMAGE floor below 0.01).
4. **Feed:** if the attacker is the Lancer or a Hunter and the target belongs to a Shaper
   (structure or unit), the attacker's player gains minerals equal to the damage actually
   dealt (barrier + hull, capped by what the target had) × pace. Track `p.stats.fed`.
5. The Lancer gets **+1 mineral/s** passive income (× pace); Hunters too.

## 6. Shaper abilities

At the start each Shaper picks **one control ability** and **one mobility ability**
(`{ type: 'pickAbilities', a: [control, mobility] }`, once per game). If a Shaper hasn't picked
after 20 s, they get `stasis` + `blink`. AI Shapers pick at setup. Cooldowns are *(pvzlite)*
(the wiki gives durations only). Ranges are from the Shaper hero.

| id | row | effect | range | cooldown |
|---|---|---|---|---|
| `stasis` | control | Locks a Lancer/Hunter in place for **4 s**: can't move, attack or use abilities (Return included), and can't be damaged. Then grants spell immunity (§7.3). | 8 | 30 s |
| `overcharge` | control | Own structure works **30% faster for 4 s** (generator/auto mine income, turret fire rate, build/upgrade speed, miner gather speed of miners within 3) | 9 | 12 s |
| `barrierField` | control | Places an impassable 2×2 blocker for **4 s** at a point (not on units) | 9 | 20 s |
| `invuln` | control | Own structure or own hero becomes **invulnerable for 4 s** | 9 | 30 s |
| `blink` | mobility | Teleport up to 8 cells to a **visible** pathable point (ignores cliffs) | 8 | 10 s |
| `farBlink` | mobility | Same, but the destination doesn't need vision | 8 | 30 s |
| `recall` | mobility | Teleport next to an own structure within 30 cells | 30 | 45 s |
| `swift` | mobility | Passive: +50% movement speed | – | – |
| `cloak` | mobility | Invisible to enemies and +50% speed for **10 s** | – | 45 s |

Spells don't affect a target that has spell immunity (error "Target is immune").

## 7. Lancer

### 7.1 Base stats & abilities

Base: 500 HP, 0 HP/s regen, 0% DR, damage 5 per strike, 1 strike per 1.0 s, speed 4.2, sight 9,
starts with **40 minerals**. Feed and passive income per §5.

| id | effect | cooldown |
|---|---|---|
| `scan` | Reveals a circle (radius 13, or the boots' radius) anywhere for **12 s**, including cloaked/hidden units | 30 s (or boots' cooldown) |
| `return` | Instantly teleports to the Shop (not while in stasis) | 180 s |
| `cloak` | Invisible (except to detectors/scans) and +50% speed for **10 s**; ends when attacking | 60 s |
| *Spell Immunity* (passive) | After a Shaper spell (stasis, barrier field) ends, immune to spells for 6 s (+ items) | – |

Hunters have `return` and `cloak` but no `scan`.

### 7.2 Shop & items

Six item slots (`p.items`, array of item ids, max 6). Buy and sell only within 8 cells of the
Shop. Items sell back for their **full price**. Buying an item of a category you already own:
- non-stacking categories (gloves, armor, boots, immunity, sight): the old one is sold
  automatically (refund) and replaced;
- stacking categories (weapon, life, regen): needs a free slot; if all 6 are full, the
  cheapest item of the same category that is cheaper than the new one is sold automatically,
  else error "Inventory full".

**Gas exchange:** 64000 minerals → 1 gas (`{ type: 'exchange', n: 1 }`), or `n: 10`
(640000 → 10). Not reversible.

Stat formulas:
- damage = 5 + Σ weapon damage
- attack speed bonus = **max** over all owned items' attack-speed bonus (blades from Pro Blade on
  have +400%, Final Blade +2400%, gloves as listed); strike cooldown = 1.0 / (1 + bonus)
- max HP = base + Σ life; regen = Σ regen (HP/s, out of combat or not)
- dr = max armor reduction
- speed = 4.2 + max boots speed bonus
- sight = 9 + max(sight bonuses) (Ring of Sight and boots don't add up)
- spell immunity time = 6 + max(immune bonuses)
- scan radius / cooldown = best boots values, else 13 / 30 s

**Weapons (stack)**

| id | Name | Damage | Attack speed | Cost |
|---|---|---|---|---|
| `blade1` | Copper Blade | 2 | – | 100 m |
| `blade2` | Iron Blade | 4 | – | 200 m |
| `blade3` | Steel Blade | 8 | – | 400 m |
| `blade4` | Silver Blade | 16 | – | 800 m |
| `blade5` | Golden Blade | 32 | – | 1600 m |
| `blade6` | Platinum Blade | 64 | – | 3200 m |
| `blade7` | Mithril Blade | 128 | – | 6400 m |
| `blade8` | Diamond Blade | 256 | – | 12800 m |
| `blade9` | Pro Blade | 256 | +400% | 25600 m |
| `blade10` | Energizer Blade | 1280 | +400% | 1 g |
| `blade11` | Pulverizer Blade | 2560 | +400% | 2 g |
| `blade12` | Atomizer Blade | 5120 | +400% | 8 g |
| `blade13` | Elucidator Blade | 20480 | +400% | 32 g |
| `blade14` | Ultimate Blade | 40960 | +400% | 96 g |
| `blade15` | Plutonium Blade | 61440 | +400% | 160 g |
| `blade16` | Radiant Blade | 81920 | +400% | 512 g |
| `blade17` | Final Blade | 260000 | +2400% | 1536 g |

**Gloves (don't stack)** — `glove1..8`: Cloth 20%/100, Leather 40%/200, Reinforced Hide 80%/400,
Scale 100%/800, Bone 150%/1600, Electronic 200%/3200, Mega 300%/6400, Super 400%/12800 (minerals).

**Armor (don't stack)** — `armor1..14`: Wooden 9%/100 m, Reinforced Wooden 18%/200 m, Iron
27%/400 m, Steel 36%/800 m, Silver 45%/1600 m, Gold 54%/3200 m, Platinum 63%/6400 m, Titanium
72%/12800 m, Chromite 92%/1 g, Pyrite 96%/2 g, Tungsten 98%/8 g, Nanocrystal 99%/32 g, Uranium
99.5%/128 g, Rubidium 99.75%/256 g.

**Life (stack)** — `life1..11`: Zircon 250/100 m, Amethyst 500/200 m, Topaz 1000/400 m, Spinel
2000/800 m, Sapphire 4000/1600 m, Emerald 8000/3200 m, Ruby 16000/6400 m, Corundum 32000/12800 m,
Titanium 160000/1 g, Obsidian 320000/2 g, Diamond 471000/8 g (amulets).

**Regeneration (stack)** — `regen1..12`: Minor 4/100 m, Lesser 8/200 m, Common 16/400 m, Greater
32/800 m, Superior 64/1600 m, Major 128/3200 m, Ultra 256/6400 m, Extreme 512/12800 m, Mega
2560/1 g, Eternal 5120/2 g, Ultimate 20480/8 g, Final 61440/256 g (HP/s potions).

**Boots (don't stack)** — `boots1..12`:

| id | Name | Speed | Immunity | Sight | Scan radius / cooldown | Cost |
|---|---|---|---|---|---|---|
| `boots1` | Basic Boots 1 | +1 | – | – | – | 200 m |
| `boots2` | Basic Boots 4 | +1.3 | +1.5 s | – | – | 1600 m |
| `boots3` | Advanced Boots 1 | +1.4 | +2 s | – | – | 3200 m |
| `boots4` | Advanced Boots 2 | +1.5 | +2.5 s | – | – | 6400 m |
| `boots5` | Advanced Boots 3 | +1.6 | +3 s | – | – | 12800 m |
| `boots6` | Magic Boots 1 | +1.7 | +3.5 s | +3.5 | 13 / 30 s | 1 g |
| `boots7` | Magic Boots 2 | +1.8 | +4 s | +7 | 14 / 30 s | 2 g |
| `boots8` | Magic Boots 3 | +1.9 | +4.5 s | +7 | 15 / 30 s | 8 g |
| `boots9` | Magic Boots 4 | +2 | +5 s | +7 | 16 / 30 s | 32 g |
| `boots10` | Legendary Boots 1 | +2.1 | +5.5 s | +7 | 19 / 25 s | 128 g |
| `boots11` | Legendary Boots 2 | +2.2 | +6 s | +7 | 22 / 20 s | 256 g |
| `boots12` | Legendary Boots 3 | +2.3 | +6.5 s | +7 | 25 / 15 s | 512 g |

**Misc (own category each, don't stack):** `immune1` Cloak of Immunity +3 s immunity, 200 m;
`sight1` Ring of Sight +7 sight, 200 m.

### 7.3 Spell immunity

When a stasis/barrier-field effect applied to a Lancer/Hunter ends, `u.immuneUntil = tick +
immunity * TICK_RATE`. While immune, Shaper/Spirit spells targeting that unit fail.

## 8. Death, Spirits and Hunters

- When a Shaper hero dies: `p.alive = false`, event `shaperDown`. If game time < 5:00 the player
  becomes a **Spirit** right away; otherwise they get 15 s to choose
  (`{ type: 'chooseForm', form: 'spirit' | 'hunter' }`; default spirit; AI picks spirit).
  All their structures and miners are destroyed silently when the hero dies (wiki: "all of their
  buildings disappear immediately, not even leaving a mineral pellet").
- **Spirit** (team 1): spawns at a random builder spawn, invulnerable for 30 s, can't build.
  Abilities: `overcharge` (as §6, cd 12 s), `decay` (target Lancer/Hunter strikes 50% slower for
  5 s, range 7, cd 20 s, blocked by spell immunity), `cloak` (10 s, +50% speed, cd 30 s).
  Auras (radius 3): own-team turrets deal +10% damage; own-team miners gather 25% faster.
  When killed it respawns after 60 s.
- **Hunter** (team 2): spawns at the Shop with 0 minerals and its own 6 item slots; same shop,
  feed and abilities as the Lancer minus Scan. When killed it respawns at the Shop after 20 s
  keeping its items.
- When the Lancer hero dies the game ends (Shapers win).

## 9. Movement & pathing changes

- `PathGrid.findPath(..., { clearance: 2 })`: a node (x, y) is walkable only if the 2×2 block
  (x..x+1, y..y+1) is pathable; diagonal steps also need the two side blocks; waypoints are the
  block centres (x + 1, y + 1). Lancer/Hunter `moveTo` uses clearance 2 (`u.def.clearance`).
- `pushOutOfBlocked`: after pushing, if a unit with radius ≥ 0.8 still overlaps blocked cells by
  more than 0.05, restore its previous position (`u.px, u.py`) and drop its path. This stops big
  units from squeezing through 1-cell gaps.
- Shapers, miners and spirits path normally (clearance 1).
- Stasis: a unit in stasis doesn't move, attack or cast and takes no damage.

## 10. Commands (all `survivalCommand`)

Shaper hero (`ids` contains the hero):
- `build { building, level?, bx, by }` — `generator`, `wall`, `turret` (`level` 1 | 6 | 11),
  `market`, `depot`, `autoMine` (`level` 1–8), `library`, `detector`. Costs are paid when the
  hero arrives and placement succeeds (like now).
- `upgrade { id }`, `salvage { id }`, `cancel { id }` (structure under construction),
  `ceaseFire { id, on }`
- `trainMiner { id: depotId, tier }`, `trainWarden { id: libraryId, tier }`, `dismiss { ids }`
- `trade { op: 'buy' | 'sell', lots: 1 | 10 }`
- `ability { ability, x?, y?, target? }`, `pickAbilities { a: [control, mobility] }`
- `share { to, gas, minerals }`, `chooseForm { form }`
Lancer / Hunter: `buy { item }`, `sell { slot }`, `exchange { n }`,
`ability { ability: 'scan' | 'return' | 'cloak', x?, y? }`.
Spirit: `ability { ability: 'overcharge' | 'decay' | 'cloak', target?, x?, y? }`.
Move/stop/hold/attack/attack-move use the existing generic handlers.

Errors go through `world.error(pid, msg)` with clear messages ("Needs Wall 4", "Needs a Market",
"Not enough gas", "Only one Generator", "Gold bases open at 5:00", "Max 15 miners", "Move to the
Shop to buy", "Inventory full", …).

## 11. Events (`world.emit`)

`lancerArrives`, `unlock` (5:00), `upgraded { id, owner, type, level }`, `salvaged { id, owner,
gas, minerals }`, `trade { owner, op, price }`, `bought { owner, item }`, `sold { owner, item }`,
`ability { owner, ability, id?, x?, y?, target? }`, `scan { owner, x, y, r, until }`,
`shaperDown { owner, by, x, y }`, `lancerDown { owner, x, y }`, `hunterDown`, `spiritDown`,
`form { owner, form }`, `pickup { type, owner, amount, x, y }`, `bolt { from, to, heavy }`,
`mined { id, owner, n, x, y }` (throttled: at most one per miner per 2 s), `gameOver`.

## 12. Snapshot additions (protocol)

The sim agent defines these in `src/shared/net/protocol.js` and documents the exact row layout
at the end of this file (§14). Required content:
- buildings: `level`, `upgrading` progress, `salvaging` progress, `ceaseFire`, turret `aim`,
  `dr`, `maxHp`, `maxBarrier`;
- units: miner/warden `tier`, `stasis` remaining, `cloaked`, `invulnerable`, hero stats for the
  Lancer/Hunters (damage, cooldown, dr, maxHp, regen, speed) and Shapers (speed);
- players: `role`, `form`, `alive`, public Lancer `items`; own `gas`, `minerals`, `abilities`,
  `cooldowns`, `genLevel`, `minersCount`;
- global `survival`: `phase`, `lancerIn`, `unlockIn`, `elapsed`, `timeLeft`, `price`, `reason`,
  visible `pickups`, own team's active `scans`.

## 13. AI (survivalAi.js)

**Shaper AI** follows the guide's build order:
1. Generator at the Shop; run to a far base (avoid gold, avoid the centre); Wall in a corner away
   from the ramp.
2. At ≥ 45 gas salvage the centre generator, rebuild it in the base, upgrade to 2.
3. Wall → Wall 4, Generator 3; salvage wall, Market, Generator 4; salvage market, Wall → Ultra
   Wall 1, Generator 5; salvage, Market → buy 30–40 minerals → Underground Market → Generator 6.
4. Then Collection Depot + miners (gold if safe), wall on the ramp, turrets (keep 4–8, upgrade
   when the Lancer shows up), walls/generator to Max, auto mines, Library, T11+, Detector,
   Wardens.
5. If discovered before Generator 6 → salvage everything and run to another base. Use Stasis
   Prison when the Lancer attacks the wall; share resources with weaker allies.
Difficulties change reaction time, efficiency and defensive judgement.

**Lancer AI** follows the zealot guide: farm structures (don't kill Shapers early unless they're
far ahead or the Lancer has gas items), scout gold bases / corners / big bases with Scan,
pick up pallets, buy DPS first (≈3× more on blades than gloves; gloves only after ~600 minerals
of blades), life when turrets hurt, armor only after the 3200 life amulet, return to heal when
low, use Cloak/Return to escape, trade minerals for gas when capped.

## 14. Implementation notes (filled in by the implementers)

<!-- protocol row layout, deviations and open questions are documented here -->

## 15. Module API (contract between sim, tests, AI and client)

`src/shared/data/survival.js` exports (old builder-level/essence exports are removed):
- `SURVIVAL` — constants: `lancerSpawn: 40`, `unlockTime: 300`, `shopRadius: 8`,
  `shopHealPct: 0.25`, `lancerStartMinerals: 40`, `passiveIncome: 1`, `marketStartPrice: 155`,
  `marketStep: 5`, `marketMinPrice: 20`, `gasBonusEvery: 40`, `gasBonusMax: 6`,
  `gasBonusAmount: 10`, `palletLife: 90`, `salvageTime: 3`, `maxMiners: 15`,
  `minersPerField: 3`, `goldLockRadius: 10`, `spiritRespawn: 60`, `spiritInvuln: 30`,
  `hunterRespawn: 20`, `formChoiceTime: 15`, `abilityPickTime: 20`, `maxItems: 6`,
  `gasExchangeRate: 64000`.
- `GENERATOR_LEVELS` — array indexed by `level - 1`:
  `{ level, gas, minerals, income, pallet, hp, dr, requires: null | { type: 'wall' | 'market', level } }`.
- `WALL_LEVELS` — `{ level, name, gas, minerals, hp, shield, dr, time }` (index `level - 1`).
- `MARKET_LEVELS` — `{ level, name, gas, hp, time }`.
- `TURRET_LEVELS` — `{ level, name, gas, minerals, damage, cooldown, range, hp, time, requires: null | { type: 'market' | 'library', level? } }`.
- `TURRET_DIRECT` — `{ 6: { requires: { type: 'market', level: 1 }, time: 20 }, 11: { requires: { type: 'library' }, time: 30 } }`.
- `MINER_TIERS` — `{ tier, name, gas, amount, interval, trainTime }` (index `tier - 1`).
- `AUTOMINE_LEVELS` — `{ level, minerals, income }`.
- `WARDEN_TIERS` — `{ tier, name, gas, minerals, dps, hp }`.
- `SURVIVAL_BUILDINGS` — static defs for `generator, wall, turret, market, depot, autoMine,
  library, detector, shop` (`size`, `hp`, `buildTime`, `cost` where fixed, `salvage: bool`).
- `SHOP_ITEMS` — object `id → { id, name, cat, minerals, gas, damage, as, hp, regen, dr, speed,
  immune, sight, scanR, scanCd }` (missing stats = 0); `SHOP_CATEGORIES` — ordered list
  `[{ id: 'weapon', name, stack: true }, …]`; `SHOP_ORDER` — item ids per category in tier order.
- `SHAPER_ABILITIES`, `LANCER_ABILITIES`, `SPIRIT_ABILITIES` — `id → { id, name, row?, range,
  cooldown, duration, description, hotkey }`.
- Helpers: `lancerStats(items, base = 'lancer' | 'hunter')` → `{ hp, regen, dr, damage, as,
  cooldown, speed, sight, immune, scanR, scanCd }`; `itemCost(id)`; `wallName(level)`;
  `cumulativeCost(table, level)` → `{ gas, minerals }`.

`src/shared/sim/survival.js` exports at least:
`SHAPER_TEAM`, `LANCER_TEAM`, `setupSurvival`, `stepSurvival`, `onKilled`,
`checkSurvivalVictory`, `survivalCommand`, `canPlaceSurvival(world, owner, type, bx, by, level)`
→ `{ ok, reason }`, `placeSurvival`, `updateSurvivalBuilding`, `upgradeInfo(world, b)` →
`{ ok, reason, gas, minerals, time, next }`, `buildCost(type, level)` → `{ gas, minerals }`,
`gameTime(world)` (seconds).

State used by tests/AI/client:
- player: `role` (`'shaper' | 'lancer'`), `form` (`'shaper' | 'lancer' | 'spirit' | 'hunter'`),
  `alive` (hero alive for shapers / lancer), `gas`, `minerals`, `items` (Lancer/Hunter),
  `heroId`, `abilities` (`[control, mobility]` or `[]`), `cd` (ability id → seconds left),
  `pendingForm` (deadline tick while choosing), `respawnAt`.
- world: `world.survival = { phase: 'pregame' | 'hunt', lancerTick, unlockTick, endTick
  (-1 = none), price, reason, winner, scans: [{ owner, team, x, y, r, until }] }`,
  `world.pickups`, `world.options.pace`.
- buildings: `type`, `level`, `built`, `progress`, `upgrading` (seconds left, 0 = idle),
  `upgradeTotal`, `salvaging` (seconds left, 0 = not salvaging), `ceaseFire`, `dr`,
  `invested { gas, minerals }`, `overchargeUntil`, `invulnUntil` (ticks), turret `aim`,
  `weaponDamage`, `weaponRange`, `weaponCooldown`.
- units: `tier` (miner/warden), `stasisUntil`, `cloakUntil`, `immuneUntil`, `invulnUntil`,
  `decayUntil` (ticks), `damage`, `strikeCooldown`, `dr`, `regen`.
