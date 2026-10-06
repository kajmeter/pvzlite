// In-game HUD: resources, clock, minimap, selection panel, command card, messages.
import { ICONS, icon } from './icons.js';
import { UNITS, BUILDINGS, RESEARCH } from '../../shared/data/defs.js';
import { SURVIVAL, levelCost, HUNTER_UPGRADES, HUNTER_UPGRADE_ORDER } from '../../shared/data/survival.js';
import { TICK_RATE } from '../../shared/constants.js';
import { Minimap } from './minimap.js';

const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

function fmtTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function nameOf(e) {
  if (e.kind === 'unit') return UNITS[e.type].name;
  if (e.kind === 'building' && BUILDINGS[e.type]?.survival) return BUILDINGS[e.type].name;
  if (e.kind === 'building') return e.type === 'portal' && e.phase ? 'Phase Portal' : BUILDINGS[e.type].name;
  if (e.type === 'crystal') return e.rich ? 'Rich Crystal Field' : 'Crystal Field';
  if (e.type === 'vent') return 'Flux Vent';
  if (e.type === 'beacon') return 'Beacon Tower';
  if (e.type === 'rubble') return 'Collapsed Rubble';
  return e.type;
}

export class Hud {
  constructor(root, game) {
    this.root = root;
    this.game = game;
    this.survival = game.session.mode === 'survival';
    this.lastSig = null;
    this.lastCardSig = '';
    this.timer = 0;
    this.build();
  }

  build() {
    const r = this.root;
    r.innerHTML = '';
    // top
    const top = el('div', 'hud-top');
    const menu = el('div', 'hud-menu');
    this.menuBtn = el('button', 'btn', 'Menu <span class="kbd">F10</span>');
    this.menuBtn.onclick = () => this.game.togglePause(true);
    this.clock = el('div', 'clock', '00:00');
    menu.append(this.menuBtn, this.clock);
    const res = el('div', 'resources');
    this.crystalsEl = el('div', 'res', `${ICONS.crystals}<span>0</span>`);
    this.fluxEl = el('div', 'res', `${ICONS.flux}<span>0</span>`);
    this.supplyEl = el('div', 'res', `${ICONS.supply}<span>0/0</span>`);
    this.crystalsEl.title = 'Crystals';
    this.fluxEl.title = 'Flux';
    this.supplyEl.title = 'Supply (build Conduits for more)';
    res.append(this.crystalsEl, this.fluxEl, this.supplyEl);
    top.append(menu, res);
    if (this.survival) {
      const me = this.game.session.player();
      res.innerHTML = '';
      if (me && me.role === 'hunter') {
        this.essenceEl = el('div', 'res essence', `${ICONS.essence}<span>0</span>`);
        this.essenceEl.title = 'Essence — earned over time and by hunting. Spend it on upgrades.';
        this.killsEl = el('div', 'res', `${ICONS.hunter}<span>0</span>`);
        this.killsEl.title = 'Shapers hunted';
        res.append(this.essenceEl, this.killsEl);
      } else {
        this.crystalsEl = el('div', 'res', `${ICONS.crystals}<span>0</span>`);
        this.crystalsEl.title = 'Crystals';
        this.levelEl = el('div', 'res level', `${ICONS.level}<span>Lv 1</span>`);
        this.levelEl.title = `Your level. Reach ${SURVIVAL.maxLevel} to win!`;
        this.livesEl = el('div', 'res lives', `${ICONS.lives}<span>2</span>`);
        this.livesEl.title = 'Lives left';
        res.append(this.crystalsEl, this.levelEl, this.livesEl);
      }
      this.phaseEl = el('div', 'phase-banner');
      top.append(this.phaseEl);
      this.teamEl = el('div', 'team-panel panel');
      top.append(this.teamEl);
      this.scoreEl = el('div', 'scoreboard panel');
      this.scoreEl.style.display = 'none';
    }
    this.fpsEl = el('div', 'fps');
    this.netEl = el('div', 'net-tag');
    top.append(this.fpsEl, this.netEl);
    r.append(top);

    // bottom
    const bottom = el('div', 'hud-bottom');
    const mmWrap = el('div', 'minimap-wrap panel');
    const mm = el('canvas');
    mmWrap.append(mm);
    const idle = el('div', 'idle-btn');
    this.idleBtn = el('button', 'btn', `${ICONS.shaper.replace('<svg', '<svg width="18" height="18"')}<span>0</span>`);
    this.idleBtn.title = 'Select idle Shaper (F1)';
    this.idleBtn.onclick = () => this.game.controls.selectIdleWorker(false);
    this.armyBtn = el('button', 'btn', `${ICONS.lancer.replace('<svg', '<svg width="18" height="18"')}<span>0</span>`);
    this.armyBtn.title = 'Select army (F2)';
    this.armyBtn.onclick = () => this.game.controls.selectArmy();
    idle.append(this.idleBtn, this.armyBtn);
    mmWrap.append(idle);
    this.minimap = new Minimap(mm, this.game);

    this.sel = el('div', 'selection-panel panel');
    this.groups = el('div', 'ctrl-groups');
    this.sel.append(this.groups);
    this.selBody = el('div');
    this.selBody.style.cssText = 'display:flex;gap:14px;flex:1;min-width:0';
    this.sel.append(this.selBody);
    this.card = el('div', 'command-card panel');
    bottom.append(mmWrap, this.sel, this.card);
    r.append(bottom);

    this.tooltip = el('div', 'tooltip panel');
    r.append(this.tooltip);
    this.messages = el('div', 'messages');
    r.append(this.messages);
    this.chat = el('div', 'chat-input');
    this.chatInput = el('input');
    this.chatInput.type = 'text';
    this.chatInput.placeholder = 'Say something… (Enter to send, Esc to cancel)';
    this.chatInput.maxLength = 140;
    this.chat.append(this.chatInput);
    r.append(this.chat);
    this.pausedTag = el('div', 'paused-tag', 'PAUSED');
    this.pausedTag.style.display = 'none';
    r.append(this.pausedTag);
    this.modal = el('div');
    r.append(this.modal);
    if (this.scoreEl) r.append(this.scoreEl);
    this.bindMinimap(mm);
    this.chatInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const t = this.chatInput.value.trim();
        if (t) this.game.sendChat(t);
        this.closeChat();
      } else if (e.key === 'Escape') this.closeChat();
    });
  }

  openChat() {
    this.chat.style.display = 'block';
    this.chatInput.value = '';
    this.chatInput.focus();
  }

  closeChat() {
    this.chat.style.display = 'none';
    this.chatInput.blur();
  }

  get chatOpen() {
    return this.chat.style.display === 'block';
  }

  bindMinimap(canvas) {
    let dragging = false;
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const p = this.minimap.toMap(e);
      if (e.button === 0) {
        if (this.game.controls.minimapLeftClick(p, e)) return;
        dragging = true;
        this.game.renderer.rtsCamera.jumpTo(p.x, p.y);
      } else if (e.button === 2) {
        this.game.controls.minimapRightClick(p, e);
      }
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const p = this.minimap.toMap(e);
      this.game.renderer.rtsCamera.jumpTo(p.x, p.y);
    });
    window.addEventListener('mouseup', () => (dragging = false));
  }

  message(text, kind = 'info') {
    const m = el('div', `msg ${kind}`);
    m.textContent = text;
    this.messages.append(m);
    while (this.messages.children.length > 5) this.messages.firstChild.remove();
    setTimeout(() => m.remove(), 3300);
  }

  update(dt) {
    const g = this.game;
    const s = g.session;
    const p = s.player();
    this.minimap.update(dt);
    this.clock.textContent = fmtTime(s.time);
    if (this.survival) {
      this.updateSurvivalTop(dt);
    } else if (p) {
      this.crystalsEl.lastChild.textContent = Math.floor(p.crystals);
      this.fluxEl.lastChild.textContent = Math.floor(p.flux);
      this.supplyEl.lastChild.textContent = `${p.supplyUsed}/${p.supplyCap}`;
      this.supplyEl.classList.toggle('blocked', p.supplyUsed >= p.supplyCap && p.supplyCap < 200);
    }
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.12;
    const idle = g.controls.idleWorkers();
    this.idleBtn.lastChild.textContent = idle.length;
    this.idleBtn.style.display = idle.length ? '' : 'none';
    const army = g.controls.armyUnits();
    this.armyBtn.lastChild.textContent = army.length;
    this.updateGroups();
    this.updateSelection();
    this.updateCard();
  }

  updateSurvivalTop(dt) {
    const s = this.game.session;
    const p = s.player();
    const info = s.survivalInfo ? s.survivalInfo() : null;
    if (p) {
      if (p.role === 'hunter') {
        this.essenceEl.lastChild.textContent = Math.floor(p.essence || 0);
        this.killsEl.lastChild.textContent = (p.stats && p.stats.builderKills) || 0;
      } else {
        this.crystalsEl.lastChild.textContent = Math.floor(p.crystals || 0);
        const lvl = p.level || 1;
        this.levelEl.lastChild.textContent = lvl >= SURVIVAL.maxLevel ? `Lv ${lvl} ★` : `Lv ${lvl} · next ${levelCost(lvl)}`;
        const lives = Math.max(0, p.lives ?? 0);
        this.livesEl.lastChild.textContent = p.eliminated ? 'out' : String(lives);
      }
    }
    if (info) {
      let txt;
      if (info.phase === 'grace') txt = `<b>${p && p.role === 'hunter' ? 'Hunt begins in' : 'Hunters released in'}</b> ${fmtTime(info.releaseIn)}`;
      else txt = `<b>Survive</b> ${fmtTime(info.timeLeft)}`;
      if (p && p.respawnAt >= 0 && !p.eliminated && !p.heroId) txt += ` · <span style="color:#ff7676">respawning…</span>`;
      if (this.phaseHtml !== txt) {
        this.phaseHtml = txt;
        this.phaseEl.innerHTML = txt;
      }
      this.phaseEl.classList.toggle('grace', info.phase === 'grace');
    }
    this.teamTimer = (this.teamTimer || 0) - dt;
    if (this.teamTimer <= 0) {
      this.teamTimer = 0.4;
      this.renderTeams(this.teamEl, false);
      if (this.scoreEl.style.display !== 'none') this.renderTeams(this.scoreEl, true);
    }
  }

  renderTeams(target, full) {
    const s = this.game.session;
    const rows = s.players.map((pl) => {
      const color = `#${(pl.colorHex ?? 0xffffff).toString(16).padStart(6, '0')}`;
      const up = pl.hunterUp ? Object.values(pl.hunterUp).reduce((a, b) => a + b, 0) : 0;
      const status = pl.eliminated ? '<span class="dead">out</span>' : pl.heroId ? '' : '<span class="dead">down</span>';
      const stat = pl.role === 'hunter' ? `★${up}` : `Lv ${pl.level || 1} · ${'♥'.repeat(Math.max(0, pl.lives ?? 0))}`;
      if (!full) return `<div class="trow"><i style="background:${color}"></i>${icon(pl.role === 'hunter' ? 'hunter' : 'builder').replace('<svg', '<svg width="16" height="16"')}<span class="tname">${pl.name}</span><span class="tstat">${stat}</span>${status}</div>`;
      const ups = pl.role === 'hunter' ? HUNTER_UPGRADE_ORDER.map((id) => `${HUNTER_UPGRADES[id].name.split(' ').pop()} ${pl.hunterUp?.[id] || 0}`).join(' · ') : '';
      return `<tr><td><i style="background:${color}"></i> ${pl.name}</td><td>${pl.role === 'hunter' ? 'Hunter' : 'Shaper'}</td><td>${stat}</td><td>${pl.role === 'hunter' ? (pl.stats?.builderKills ?? 0) : (pl.stats?.hunterKills ?? 0)}</td><td>${pl.deaths ?? 0}</td><td class="muted">${ups}</td><td>${status}</td></tr>`;
    });
    target.innerHTML = full
      ? `<div class="sb-title">Scoreboard <span class="muted">(hold Tab)</span></div><table><tr><th>Player</th><th>Role</th><th>Level</th><th>Kills</th><th>Deaths</th><th>Upgrades</th><th></th></tr>${rows.join('')}</table>`
      : rows.join('');
  }

  showScoreboard(on) {
    if (!this.scoreEl) return;
    this.scoreEl.style.display = on ? 'block' : 'none';
    if (on) this.renderTeams(this.scoreEl, true);
  }

  updateGroups() {
    const g = this.game.controls.groups;
    const sig = [...g.entries()].map(([k, v]) => `${k}:${v.filter((id) => this.game.session.byId(id)).length}`).join(',');
    if (sig === this.groupSig) return;
    this.groupSig = sig;
    this.groups.innerHTML = '';
    for (let k = 1; k <= 9; k++) {
      const ids = (g.get(k) || []).filter((id) => this.game.session.byId(id));
      if (!ids.length) continue;
      const b = el('div', 'ctrl-group', `<b>${k}</b>${ids.length}`);
      b.onclick = () => this.game.controls.recallGroup(k);
      this.groups.append(b);
    }
  }

  updateSelection() {
    const g = this.game;
    const s = g.session;
    const sel = g.selectionEntities();
    const sig = sel.map((e) => `${e.id}:${e.type}:${e.built ? 1 : 0}:${e.phase ? 1 : 0}`).join(',');
    if (sig !== this.lastSig) {
      this.lastSig = sig;
      this.renderSelection(sel);
    }
    // live values
    if (sel.length === 1) this.updateSingle(sel[0]);
    else if (sel.length > 1) {
      for (const cell of this.selBody.querySelectorAll('.multi-cell')) {
        const e = s.byId(Number(cell.dataset.id));
        if (!e) continue;
        const f = (e.hp + (e.barrier || 0)) / (e.maxHp + (e.maxBarrier || 0));
        const bar = cell.querySelector('.hpb');
        bar.style.width = `${Math.max(2, f * 38)}px`;
        bar.style.background = f > 0.6 ? '#4be37f' : f > 0.3 ? '#ffd04a' : '#ff5a5a';
      }
    }
  }

  renderSelection(sel) {
    const body = this.selBody;
    body.innerHTML = '';
    if (!sel.length) {
      body.append(el('div', 'muted', '<div style="padding:40px 10px">Select units or structures. Drag to box-select, right-click to command.</div>'));
      return;
    }
    if (sel.length === 1) {
      const e = sel[0];
      const portrait = el('div', 'portrait', icon(e.type === 'portal' && e.phase ? 'portal' : e.type));
      const info = el('div', 'sel-info');
      info.append(el('div', 'sel-name', nameOf(e)));
      const owner = e.owner >= 0 ? this.game.session.players[e.owner] : null;
      info.append(el('div', 'sel-sub', owner ? `${owner.name}` : 'Neutral'));
      this.singleBars = el('div', 'bars');
      info.append(this.singleBars);
      this.singleStats = el('div', 'stats-row');
      info.append(this.singleStats);
      this.queueEl = el('div', 'queue');
      info.append(this.queueEl);
      body.append(portrait, info);
      this.queueSig = '';
      return;
    }
    const grid = el('div', 'multi-grid');
    for (const e of sel.slice(0, 48)) {
      const c = el('div', 'multi-cell', `${icon(e.type)}<div class="hpb"></div>`);
      c.dataset.id = e.id;
      c.title = nameOf(e);
      c.onclick = (ev) => this.game.controls.clickSelectionCell(e, ev);
      grid.append(c);
    }
    if (sel.length > 48) grid.append(el('div', 'muted', `+${sel.length - 48}`));
    body.append(grid);
  }

  updateSingle(e) {
    const s = this.game.session;
    if (!this.singleBars) return;
    let html = '';
    if (e.maxBarrier) html += `<div class="bar barrier"><i style="width:${(100 * e.barrier) / e.maxBarrier}%"></i><span>${Math.ceil(e.barrier)} / ${e.maxBarrier}</span></div>`;
    if (e.maxHp) html += `<div class="bar hp"><i style="width:${(100 * Math.max(0, e.hp)) / e.maxHp}%"></i><span>${Math.ceil(e.hp)} / ${e.maxHp}</span></div>`;
    if (e.maxEnergy && (e.owner === s.localPlayer || s.isAllied(e.owner))) {
      html += `<div class="bar energy"><i style="width:${(100 * e.energy) / e.maxEnergy}%"></i><span>${Math.floor(e.energy)} / ${e.maxEnergy}</span></div>`;
    }
    if (e.kind === 'resource') {
      html += `<div class="bar ${e.type === 'vent' ? 'hp' : 'barrier'}"><i style="width:${(100 * e.amount) / e.maxAmount}%"></i><span>${Math.floor(e.amount)} / ${e.maxAmount}</span></div>`;
    }
    this.singleBars.innerHTML = html;
    let stats = '';
    const p = e.owner >= 0 ? s.players[e.owner] : null;
    const up = p && p.upgrades ? p.upgrades : { weapons: 0, armor: 0, barrier: 0 };
    if (e.kind === 'unit' && (e.type === 'builder' || e.type === 'hunter')) {
      if (e.type === 'builder') {
        stats += `<span>Level <b>${p?.level ?? 1}</b></span><span>Mining <b>${e.mineYield ?? 6 + 2 * (p?.level ?? 1)}</b>/trip</span><span>Armor <b>${e.armor ?? 0}</b></span><span>Lives <b>${p?.lives ?? '?'}</b></span>`;
      } else {
        stats += `<span>Damage <b>${Math.round(e.damage ?? 12)} ×2</b></span><span>Armor <b>${e.armor ?? 1}</b></span><span>Speed <b>${(e.speedOverride ?? 3.7).toFixed(2)}</b></span><span>vs walls <b>×${(e.structureBonus ?? 1).toFixed(1)}</b></span>`;
      }
    } else if (e.kind === 'unit') {
      const d = UNITS[e.type];
      const dmg = d.weapon.damage + (up.weapons || 0) * d.weapon.upgradePerLevel;
      stats += `<span>Damage <b>${dmg}${d.weapon.hits > 1 ? ` ×${d.weapon.hits}` : ''}</b></span>`;
      stats += `<span>Armor <b>${d.armor + (up.armor || 0)}</b></span>`;
      stats += `<span>Barrier armor <b>${up.barrier || 0}</b></span>`;
      if (e.carry) stats += `<span>Carrying <b>${e.carry.kind || e.carry}</b></span>`;
      if (e.warping > 0) stats += `<span>Warping in <b>${e.warping.toFixed(1)}s</b></span>`;
    } else if (e.kind === 'building') {
      const d = BUILDINGS[e.type];
      stats += `<span>Armor <b>${d.armor}</b></span>`;
      if (!e.built) stats += `<span>Constructing <b>${Math.floor((e.progress || 0) * 100)}%</b></span>`;
      if (e.powered === false) stats += `<span style="color:#ff7676">Unpowered</span>`;
      if (e.overclock > 0) stats += `<span style="color:#ffd04a">Overclocked ${Math.ceil(e.overclock)}s</span>`;
      if (e.type === 'portal' && e.phase && e.owner === s.localPlayer) stats += `<span>Warp ${e.warpCd > 0 ? `<b>${Math.ceil(e.warpCd)}s</b>` : '<b>ready</b>'}</span>`;
      if (e.type === 'portal' && !e.phase && e.transform > 0) stats += `<span>Transforming <b>${Math.floor((e.transform / 7) * 100)}%</b></span>`;
      if (e.weaponDamage) stats += `<span>Damage <b>${Math.round(e.weaponDamage)}</b></span><span>Range <b>${e.weaponRange}</b></span>`;
      if (e.level) stats += `<span>Built at <b>Lv ${e.level}</b></span>`;
      if (e.type === 'siphon' && e.vent) stats += `<span>Flux left <b>${Math.floor(e.vent.amount ?? e.ventAmount ?? 0)}</b></span>`;
      if (e.type === 'siphon' && e.ventAmount !== undefined && !e.vent) stats += `<span>Flux left <b>${Math.floor(e.ventAmount)}</b></span>`;
    } else if (e.type === 'beacon') {
      stats += '<span>Stand next to it to gain vision of a large area.</span>';
    }
    this.singleStats.innerHTML = stats;
    // production queue
    if (e.queue && e.owner === s.localPlayer) {
      const sig = e.queue.map((q) => q.id).join(',');
      if (sig !== this.queueSig) {
        this.queueSig = sig;
        this.queueEl.innerHTML = '';
        e.queue.forEach((q, i) => {
          const qi = el('div', `queue-item${i === 0 ? ' first' : ''}`, `${icon(q.id)}${i === 0 ? '<div class="prog"></div>' : ''}`);
          qi.title = `${q.kind === 'unit' ? UNITS[q.id].name : RESEARCH[q.id].name} — click to cancel`;
          qi.onclick = () => this.game.issue({ type: 'cancel', building: e.id, index: i });
          this.queueEl.append(qi);
        });
      }
      const prog = this.queueEl.querySelector('.prog');
      if (prog && e.queue[0]) prog.style.width = `${(100 * e.queue[0].progress) / e.queue[0].time}%`;
    }
  }

  updateCard() {
    const g = this.game;
    const buttons = g.controls.currentButtons();
    const sig = buttons.map((b) => `${b.id}|${b.disabled ? 1 : 0}|${b.dim ? 1 : 0}|${b.active ? 1 : 0}|${b.cooldown ?? ''}|${b.autocast ?? ''}|${b.badge ?? ''}|${b.tooltip?.title ?? ''}`).join(',');
    if (sig === this.lastCardSig) return;
    this.lastCardSig = sig;
    const card = this.card;
    card.innerHTML = '';
    const grid = Array.from({ length: 15 }, () => null);
    for (const b of buttons) {
      const [c, r] = b.pos;
      grid[r * 5 + c] = b;
    }
    grid.forEach((b, i) => {
      const cell = el('div', b ? `cmd${b.disabled ? ' disabled' : ''}${b.dim ? ' disabled' : ''}${b.active ? ' active' : ''}` : '');
      cell.style.gridColumn = String((i % 5) + 1);
      cell.style.gridRow = String(Math.floor(i / 5) + 1);
      if (b) {
        cell.innerHTML = `${icon(b.icon)}<span class="hk">${b.label || b.hotkey}</span>${b.badge !== undefined ? `<span class="badge">${b.badge}</span>` : ''}${b.cooldown ? `<div class="cd">${b.cooldown}</div>` : ''}${b.autocast ? '<div class="auto"></div>' : ''}`;
        cell.dataset.cmd = b.id;
        cell.onmousedown = (e) => {
          e.preventDefault();
          e.stopPropagation();
          g.controls.pressButton(b, e.shiftKey);
        };
        cell.onmouseenter = () => this.showTooltip(b);
        cell.onmouseleave = () => this.hideTooltip();
      }
      card.append(cell);
    });
  }

  showTooltip(b) {
    const t = b.tooltip;
    if (!t) return;
    let cost = '';
    if (t.cost) {
      const parts = [];
      if (t.cost.crystals) parts.push(`<span style="color:var(--crystal)">◆ ${t.cost.crystals}</span>`);
      if (t.cost.flux) parts.push(`<span style="color:var(--flux)">● ${t.cost.flux}</span>`);
      if (t.cost.supply) parts.push(`<span>▲ ${t.cost.supply}</span>`);
      if (t.cost.supplyGive) parts.push(`<span>+${t.cost.supplyGive} supply</span>`);
      if (t.cost.energy) parts.push(`<span style="color:#d79bff">⚡ ${t.cost.energy}</span>`);
      if (t.cost.essence) parts.push(`<span style="color:#ff9a6a">✦ ${t.cost.essence} essence</span>`);
      if (t.cost.time) parts.push(`<span>⏱ ${t.cost.time}s</span>`);
      cost = `<div class="tt-cost">${parts.join('')}</div>`;
    }
    this.tooltip.innerHTML = `<div class="tt-title">${t.title} <span class="kbd">${b.label || b.hotkey}</span></div>${cost}<div class="muted">${(t.desc || '').replace(/\n/g, '<br>')}</div>`;
    this.tooltip.style.display = 'block';
  }

  hideTooltip() {
    this.tooltip.style.display = 'none';
  }

  setPaused(p) {
    this.pausedTag.style.display = p ? '' : 'none';
  }
}

export { fmtTime, TICK_RATE };
