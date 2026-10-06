// Interim AI for pvzlite survival mode (Shapers vs Lancer). It only aims to keep games valid:
// Shapers build a Generator + Wall and climb the Generator levels following the requirements;
// the Lancer buys blades, attacks the nearest visible Shaper structure and heals at the Shop.
// A full AI following the PvZ2 guides replaces this later (same class name / API).
import { TICK_RATE } from '../constants.js';
import { SHOP_ITEMS, SHOP_ORDER, GENERATOR_LEVELS } from '../data/survival.js';
import { upgradeInfo, heroOf } from '../sim/survival.js';

const THINK = { easy: 30, normal: 16, hard: 10, brutal: 6 };

export class SurvivalAI {
  constructor(world, playerId) {
    this.world = world;
    this.pid = playerId;
    this.player = world.players[playerId];
    this.diff = this.player.difficulty || 'normal';
    this.think = THINK[this.diff] || 16;
    this.offset = (playerId * 7) % this.think;
    this.home = null;
    this.explore = null;
  }

  issue(cmd) {
    this.world.issue(this.pid, cmd);
  }

  get hero() {
    return heroOf(this.world, this.player);
  }

  update() {
    const w = this.world;
    const p = this.player;
    if (p.eliminated || w.over) return;
    if ((w.tick + this.offset) % this.think !== 0) return;
    if (p.pendingForm >= 0) {
      this.issue({ type: 'chooseForm', form: 'spirit' });
      return;
    }
    if (p.form === 'shaper') this.shaperThink();
    else if (p.form === 'lancer' || p.form === 'hunter') this.lancerThink();
  }

  // =================================================================== Shaper

  mine(type) {
    return this.world.buildings.filter((b) => b.owner === this.pid && b.type === type && !b.dead);
  }

  // A free spot for a size x size structure near (x, y)
  findSpot(type, x, y, level = 1, maxR = 10) {
    const w = this.world;
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    for (let r = 1; r <= maxR; r++) {
      for (let oy = -r; oy <= r; oy++) {
        for (let ox = -r; ox <= r; ox++) {
          if (Math.abs(ox) !== r && Math.abs(oy) !== r) continue;
          const bx = cx + ox;
          const by = cy + oy;
          if (w.canPlace(this.pid, type, bx, by, level).ok) return { bx, by };
        }
      }
    }
    return null;
  }

  pickHome(hero) {
    const w = this.world;
    const sp = w.map.builderSpawns;
    const shop = w.survival.shop;
    if (!sp.length) return { x: hero.x, y: hero.y };
    const far = sp.filter((s) => Math.hypot(s.x - shop.x, s.y - shop.y) > 20);
    const list = far.length ? far : sp;
    return list[(this.pid * 3 + w.rng.int(list.length)) % list.length];
  }

  build(type, hero, level = 1) {
    const at = this.home || hero;
    const spot = this.findSpot(type, at.x, at.y, level) || this.findSpot(type, hero.x, hero.y, level);
    if (!spot) return false;
    this.issue({ type: 'build', ids: [hero.id], building: type, level, bx: spot.bx, by: spot.by });
    return true;
  }

  shaperThink() {
    const w = this.world;
    const p = this.player;
    const hero = this.hero;
    if (!hero) return;
    if (!this.home) this.home = this.pickHome(hero);
    if (hero.orders.some((o) => o.type === 'build')) return;
    const gens = this.mine('generator');
    const gen = gens[0];
    if (!gen) {
      // first Generator right where we stand (free), later ones at home
      const t = w.tick / TICK_RATE;
      if (t < 30 || Math.hypot(hero.x - this.home.x, hero.y - this.home.y) < 6) this.build('generator', hero);
      else this.issue({ type: 'move', ids: [hero.id], x: this.home.x, y: this.home.y });
      return;
    }
    if (Math.hypot(hero.x - this.home.x, hero.y - this.home.y) > 6 && !hero.orders.length) {
      this.issue({ type: 'move', ids: [hero.id], x: this.home.x, y: this.home.y });
    }
    if (!gen.built || gen.upgrading > 0) return;
    const info = upgradeInfo(w, gen);
    if (info.ok) {
      this.issue({ type: 'upgrade', id: gen.id });
      return;
    }
    if (!info.next) return; // Generator Max
    const req = GENERATOR_LEVELS[info.next - 1].requires;
    if (req && info.reason.startsWith('Needs')) {
      const have = this.mine(req.type).filter((b) => !b.salvaging);
      if (!have.length) {
        this.build(req.type, hero);
        return;
      }
      const best = have.reduce((a, b) => (b.level > a.level ? b : a));
      if (best.built && !best.upgrading) {
        const ui = upgradeInfo(w, best);
        if (ui.ok) this.issue({ type: 'upgrade', id: best.id });
      }
      return;
    }
    if (info.reason === 'Not enough minerals' && this.mine('market').some((b) => b.built)) {
      if (p.gas >= w.survival.price + 20) this.issue({ type: 'trade', op: 'buy', lots: 1 });
    }
  }

  // =================================================================== Lancer / Hunter

  bestBlade(budget) {
    let best = null;
    for (const id of SHOP_ORDER.weapon) {
      const it = SHOP_ITEMS[id];
      if (it.gas > 0 || it.minerals > budget) continue;
      best = id;
    }
    return best;
  }

  lancerThink() {
    const w = this.world;
    const p = this.player;
    const hero = this.hero;
    const shop = w.survival.shop;
    const blade = this.bestBlade(p.minerals);
    const atShop = !hero || Math.hypot(hero.x - shop.x, hero.y - shop.y) <= 7;
    if (blade && atShop && (p.items.length < 6 || p.items.some((i) => SHOP_ITEMS[i].cat === 'weapon' && SHOP_ITEMS[i].minerals < SHOP_ITEMS[blade].minerals))) {
      this.issue({ type: 'buy', item: blade });
    }
    if (!hero) return;
    const hpf = hero.hp / hero.maxHp;
    if (hero.retreating) {
      if (hpf >= 0.95) hero.retreating = false;
      else {
        if (!atShop && !hero.orders.length) this.issue({ type: 'move', ids: [hero.id], x: shop.x, y: shop.y + 4 });
        return;
      }
    }
    if (hpf < 0.35) {
      hero.retreating = true;
      if (!(p.cd.return > 0)) this.issue({ type: 'ability', ability: 'return' });
      else this.issue({ type: 'move', ids: [hero.id], x: shop.x, y: shop.y + 4 });
      return;
    }
    const cur = hero.orders[0];
    if (cur && cur.type === 'attack') {
      const t = w.byId.get(cur.target);
      if (t && !t.dead) return;
    }
    // nearest visible Shaper structure (or Shaper)
    let best = null;
    let bd = Infinity;
    for (const e of [...w.buildings, ...w.units]) {
      if (e.dead || e.owner < 0 || !w.areEnemies(this.pid, e.owner)) continue;
      if (e.kind === 'unit' && e.type !== 'builder' && e.type !== 'miner') continue;
      if (!w.isVisibleTo(e, this.pid)) continue;
      const d = Math.hypot(e.x - hero.x, e.y - hero.y);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    if (best) {
      this.issue({ type: 'attack', ids: [hero.id], target: best.id });
      return;
    }
    if (p.form === 'lancer' && !(p.cd.scan > 0)) {
      const sp = w.map.builderSpawns;
      if (sp.length) {
        const s = sp[w.rng.int(sp.length)];
        this.issue({ type: 'ability', ability: 'scan', x: s.x, y: s.y });
      }
    }
    if (!hero.orders.length) {
      const groves = w.map.groves.length ? w.map.groves : w.map.builderSpawns;
      if (groves.length) {
        const g = groves[w.rng.int(groves.length)];
        this.issue({ type: 'attackMove', ids: [hero.id], x: g.x, y: g.y });
      }
    }
  }
}
