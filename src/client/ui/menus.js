// Menu screens: main menu, skirmish setup, multiplayer lobby, settings, help, pause and results.
import { listMaps, getMap } from '../../shared/maps/index.js';
import { PLAYER_COLORS, AI_DIFFICULTIES } from '../../shared/constants.js';
import { UNITS, BUILDINGS, RESEARCH } from '../../shared/data/defs.js';
import { drawMapPreview } from './minimap.js';
import { icon } from './icons.js';

const h = (html) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.0.0';

export class Menus {
  constructor(app) {
    this.app = app;
    this.root = document.createElement('div');
    this.root.style.cssText = 'position:absolute;inset:0;pointer-events:none';
    app.uiRoot.append(this.root);
    this.modalRoot = document.createElement('div');
    this.modalRoot.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:20';
    app.uiRoot.append(this.modalRoot);
  }

  clear() {
    this.root.innerHTML = '';
  }

  show(el) {
    this.clear();
    el.style.pointerEvents = 'auto';
    this.root.append(el);
    return el;
  }

  closeModal() {
    this.modalRoot.innerHTML = '';
  }

  modal(el) {
    this.closeModal();
    el.style.pointerEvents = 'auto';
    this.modalRoot.append(el);
    return el;
  }

  click() {
    this.app.audio.play('click');
  }

  // ---------------------------------------------------------------- main menu

  showMain() {
    const desktop = !!window.shardfallDesktop;
    const el = this.show(
      h(`<div class="screen">
        <div class="main-menu">
          <div class="title-logo">SHARDFALL</div>
          <div class="tagline">Crystal-age real-time strategy</div>
          <button class="btn primary" data-a="skirmish">▶&nbsp; Play vs AI</button>
          <button class="btn" data-a="multi">⚔&nbsp; Multiplayer</button>
          <button class="btn" data-a="howto">?&nbsp; How to Play</button>
          <button class="btn" data-a="settings">⚙&nbsp; Settings</button>
          ${desktop ? '<button class="btn" data-a="quit">⏻&nbsp; Quit</button>' : ''}
        </div>
        <div class="version-tag">Shardfall v${VERSION} · three.js · <a href="https://github.com/kajmeter/pvzlite" target="_blank" rel="noopener" style="color:inherit">GitHub</a></div>
      </div>`),
    );
    el.querySelector('[data-a=skirmish]').onclick = () => (this.click(), this.showSkirmish());
    el.querySelector('[data-a=multi]').onclick = () => (this.click(), this.showMultiplayer());
    el.querySelector('[data-a=howto]').onclick = () => (this.click(), this.showHowTo(() => this.showMain()));
    el.querySelector('[data-a=settings]').onclick = () => (this.click(), this.showSettings(() => this.showMain()));
    const q = el.querySelector('[data-a=quit]');
    if (q) q.onclick = () => window.shardfallDesktop.quit();
  }

  // ---------------------------------------------------------------- skirmish

  showSkirmish() {
    const maps = listMaps();
    const st = this.app.settings;
    let mapId = st.lastMap && maps.some((m) => m.id === st.lastMap) ? st.lastMap : maps[0].id;
    let slots = [];
    const makeSlots = () => {
      const m = maps.find((x) => x.id === mapId);
      const old = slots;
      slots = [];
      for (let i = 0; i < m.players; i++) {
        const prev = old[i];
        if (i === 0) slots.push(prev || { kind: 'human', name: st.playerName || 'Commander', color: st.color ?? 0, team: 1 });
        else slots.push(prev || { kind: i === 1 ? 'ai' : 'closed', difficulty: st.lastDifficulty || 'normal', color: i, team: i + 1 });
      }
    };
    makeSlots();
    const el = this.show(
      h(`<div class="screen center"><div class="dialog panel">
        <h2>Skirmish vs AI</h2>
        <div class="skirmish-grid">
          <div><h3>Map</h3><div class="map-list"></div></div>
          <div>
            <div class="map-preview"><canvas></canvas><div><div class="sel-name map-name"></div><div class="muted map-desc" style="margin-top:6px;font-size:14px;line-height:1.5"></div></div></div>
            <h3>Players</h3>
            <div class="slots"></div>
            <h3>Options</h3>
            <label class="row"><span>Game speed</span><select class="speed"><option value="0.75">Slow</option><option value="1" selected>Normal</option><option value="1.4">Fast</option></select></label>
            <label class="row"><span>Starting resources</span><select class="res"><option value="normal" selected>Standard (50 crystals, 12 Shapers)</option><option value="rich">Rich (1000 crystals)</option></select></label>
          </div>
        </div>
        <div class="actions"><button class="btn" data-a="back">Back</button><button class="btn primary" data-a="start">Start Game</button></div>
      </div></div>`),
    );
    const list = el.querySelector('.map-list');
    const renderMaps = () => {
      list.innerHTML = '';
      for (const m of maps) {
        const it = h(`<div class="map-item ${m.id === mapId ? 'selected' : ''}"><canvas></canvas><div><div class="name">${esc(m.name)}</div><div class="meta">${m.players} players · ${m.width}×${m.height}</div></div></div>`);
        drawMapPreview(it.querySelector('canvas'), getMap(m.id), 56);
        it.onclick = () => {
          this.click();
          mapId = m.id;
          makeSlots();
          renderMaps();
          renderPreview();
          renderSlots();
        };
        list.append(it);
      }
    };
    const renderPreview = () => {
      const m = maps.find((x) => x.id === mapId);
      drawMapPreview(el.querySelector('.map-preview canvas'), getMap(mapId), 220);
      el.querySelector('.map-name').textContent = m.name;
      el.querySelector('.map-desc').textContent = m.description;
    };
    const slotsEl = el.querySelector('.slots');
    const renderSlots = () => {
      slotsEl.innerHTML = '';
      slots.forEach((s, i) => {
        const colorOpts = PLAYER_COLORS.map((c, ci) => `<option value="${ci}" ${ci === s.color ? 'selected' : ''}>${c.name}</option>`).join('');
        const teamOpts = [1, 2, 3, 4].map((t) => `<option value="${t}" ${t === s.team ? 'selected' : ''}>Team ${t}</option>`).join('');
        let who;
        if (i === 0) who = `<input type="text" class="pname" value="${esc(s.name)}" maxlength="20">`;
        else {
          const opts = AI_DIFFICULTIES.map((d) => `<option value="ai:${d}" ${s.kind === 'ai' && s.difficulty === d ? 'selected' : ''}>AI — ${d[0].toUpperCase() + d.slice(1)}</option>`).join('');
          who = `<select class="kind">${opts}${i > 1 ? `<option value="closed" ${s.kind === 'closed' ? 'selected' : ''}>Closed</option>` : ''}</select>`;
        }
        const row = h(`<div class="slot"><div class="swatch" style="background:${PLAYER_COLORS[s.color].css}"></div>${who}<select class="color">${colorOpts}</select><select class="team">${teamOpts}</select><span class="muted">Start ${i + 1}</span></div>`);
        const pn = row.querySelector('.pname');
        if (pn) pn.oninput = () => (s.name = pn.value);
        const kind = row.querySelector('.kind');
        if (kind)
          kind.onchange = () => {
            if (kind.value === 'closed') s.kind = 'closed';
            else {
              s.kind = 'ai';
              s.difficulty = kind.value.split(':')[1];
            }
          };
        row.querySelector('.color').onchange = (e) => {
          s.color = Number(e.target.value);
          renderSlots();
        };
        row.querySelector('.team').onchange = (e) => (s.team = Number(e.target.value));
        slotsEl.append(row);
      });
    };
    renderMaps();
    renderPreview();
    renderSlots();
    el.querySelector('[data-a=back]').onclick = () => (this.click(), this.showMain());
    el.querySelector('[data-a=start]').onclick = () => {
      this.click();
      const active = slots.filter((s) => s.kind !== 'closed');
      if (active.length < 2) return;
      const teams = new Set(active.map((s) => s.team));
      if (teams.size < 2) {
        alert('All players are on the same team — pick at least two teams.');
        return;
      }
      st.playerName = slots[0].name || 'Commander';
      st.color = slots[0].color;
      st.lastMap = mapId;
      const ai = active.find((s) => s.kind === 'ai');
      if (ai) st.lastDifficulty = ai.difficulty;
      this.app.saveSettings();
      const rich = el.querySelector('.res').value === 'rich';
      const players = [];
      const startIndexOf = [];
      slots.forEach((s, i) => {
        if (s.kind === 'closed') return;
        startIndexOf.push(i);
        players.push({
          name: s.kind === 'human' ? s.name || 'Commander' : `AI (${s.difficulty})`,
          type: s.kind === 'human' ? 'human' : 'ai',
          difficulty: s.difficulty,
          color: s.color,
          team: s.team,
        });
      });
      this.app.startSkirmish({ mapId, players, speed: Number(el.querySelector('.speed').value), startCrystals: rich ? 1000 : undefined });
    };
  }

  // ---------------------------------------------------------------- multiplayer

  showMultiplayer(status = '') {
    const st = this.app.settings;
    const desktop = window.shardfallDesktop;
    const defaultUrl = this.app.defaultServerUrl();
    const el = this.show(
      h(`<div class="screen center"><div class="dialog panel" style="max-width:720px">
        <h2>Multiplayer</h2>
        <label class="row"><span>Your name</span><input type="text" class="pname" maxlength="20" value="${esc(st.playerName || 'Commander')}"></label>
        <label class="row"><span>Server address</span><input type="text" class="url" style="width:340px" value="${esc(st.serverUrl || defaultUrl)}"></label>
        <div class="muted" style="font-size:13px;margin:4px 0 10px">Use <b>ws://HOST:7777</b> for a dedicated or LAN server. When this page is served by a Shardfall server, its own address works automatically.</div>
        ${desktop ? '<div class="row" style="gap:10px;justify-content:flex-start"><button class="btn" data-a="host">Host LAN server on port 7777</button><span class="muted host-info"></span></div>' : ''}
        <div class="status-line">${esc(status)}</div>
        <div class="actions"><button class="btn" data-a="back">Back</button><button class="btn primary" data-a="connect">Connect</button></div>
      </div></div>`),
    );
    const statusEl = el.querySelector('.status-line');
    el.querySelector('[data-a=back]').onclick = () => (this.click(), this.showMain());
    const hostBtn = el.querySelector('[data-a=host]');
    if (hostBtn) {
      hostBtn.onclick = async () => {
        this.click();
        try {
          const info = await desktop.hostServer(7777);
          el.querySelector('.host-info').textContent = `Hosting! Friends connect to: ${info.addresses.map((a) => `ws://${a}:${info.port}`).join('  ')}`;
          el.querySelector('.url').value = `ws://localhost:${info.port}`;
        } catch (err) {
          el.querySelector('.host-info').textContent = `Could not host: ${err.message || err}`;
        }
      };
    }
    el.querySelector('[data-a=connect]').onclick = async () => {
      this.click();
      st.playerName = el.querySelector('.pname').value.trim() || 'Commander';
      st.serverUrl = el.querySelector('.url').value.trim();
      this.app.saveSettings();
      statusEl.className = 'status-line';
      statusEl.textContent = 'Connecting…';
      try {
        const net = await this.app.connect(st.serverUrl, st.playerName);
        this.showLobbyList(net);
      } catch (err) {
        statusEl.className = 'status-line error';
        statusEl.textContent = `Connection failed: ${err.message || err}`;
      }
    };
  }

  showLobbyList(net) {
    const maps = listMaps();
    const el = this.show(
      h(`<div class="screen center"><div class="dialog panel" style="max-width:760px">
        <h2>Game Lobbies</h2>
        <div class="muted">Connected to <b>${esc(net.url)}</b> as <b>${esc(net.name)}</b></div>
        <h3>Open games</h3>
        <div class="lobby-list"></div>
        <h3>Create a game</h3>
        <div class="row" style="display:flex;gap:10px;align-items:center">
          <input type="text" class="rname" maxlength="32" value="${esc(net.name)}'s game" style="flex:1">
          <select class="rmap">${maps.map((m) => `<option value="${m.id}">${esc(m.name)} (${m.players}p)</option>`).join('')}</select>
          <button class="btn primary" data-a="create">Create</button>
        </div>
        <div class="status-line"></div>
        <div class="actions"><button class="btn" data-a="back">Disconnect</button><button class="btn" data-a="refresh">Refresh</button></div>
      </div></div>`),
    );
    const listEl = el.querySelector('.lobby-list');
    const statusEl = el.querySelector('.status-line');
    const render = (rooms) => {
      listEl.innerHTML = '';
      if (!rooms.length) listEl.append(h('<div class="muted" style="padding:20px;text-align:center">No open games yet — create one!</div>'));
      for (const r of rooms) {
        const row = h(`<div class="lobby-item"><div><b>${esc(r.name)}</b><div class="muted" style="font-size:12px">${esc(r.mapName)} · ${r.players}/${r.maxPlayers} players · ${r.started ? 'in progress' : 'waiting'}</div></div><button class="btn" ${r.started || r.players >= r.maxPlayers ? 'disabled' : ''}>Join</button></div>`);
        row.querySelector('button').onclick = () => {
          this.click();
          net.joinRoom(r.id);
        };
        listEl.append(row);
      }
    };
    net.onRooms = render;
    net.onRoom = (room) => this.showRoom(net, room);
    net.onError = (msg) => {
      statusEl.className = 'status-line error';
      statusEl.textContent = msg;
    };
    net.onClose = () => this.showMultiplayer('Disconnected from server.');
    net.listRooms();
    el.querySelector('[data-a=refresh]').onclick = () => net.listRooms();
    el.querySelector('[data-a=create]').onclick = () => {
      this.click();
      net.createRoom(el.querySelector('.rname').value.trim() || 'Game', el.querySelector('.rmap').value);
    };
    el.querySelector('[data-a=back]').onclick = () => {
      net.close();
      this.showMultiplayer();
    };
  }

  showRoom(net, room) {
    const maps = listMaps();
    const isHost = room.host === net.clientId;
    const me = room.slots.find((s) => s.clientId === net.clientId);
    let el = this.root.querySelector('.room-dialog');
    if (!el) {
      el = this.show(
        h(`<div class="screen center"><div class="dialog panel room-dialog" style="max-width:820px">
          <h2 class="rtitle"></h2>
          <div class="map-preview"><canvas></canvas><div style="flex:1"><div class="sel-name map-name"></div><div class="muted map-desc" style="font-size:14px;margin-top:6px"></div>
            <div class="host-only" style="margin-top:10px"><select class="rmap">${maps.map((m) => `<option value="${m.id}">${esc(m.name)} (${m.players}p)</option>`).join('')}</select> <button class="btn" data-a="addai">Add AI</button></div></div></div>
          <h3>Players</h3><div class="slots"></div>
          <h3>Chat</h3><div class="chat-log"></div>
          <div style="display:flex;gap:8px"><input type="text" class="chatmsg" maxlength="140" placeholder="Message" style="flex:1"><button class="btn" data-a="send">Send</button></div>
          <div class="status-line"></div>
          <div class="actions"><button class="btn" data-a="leave">Leave</button><button class="btn" data-a="ready">Ready</button><button class="btn primary host-only" data-a="start">Start Game</button></div>
        </div></div>`),
      ).querySelector('.room-dialog');
      el.querySelector('[data-a=leave]').onclick = () => {
        net.leaveRoom();
        this.showLobbyList(net);
      };
      el.querySelector('[data-a=ready]').onclick = () => net.setReady(!net._ready);
      el.querySelector('[data-a=start]').onclick = () => net.startGame();
      el.querySelector('[data-a=addai]').onclick = () => net.addAI('normal');
      el.querySelector('.rmap').onchange = (e) => net.setMap(e.target.value);
      const send = () => {
        const inp = el.querySelector('.chatmsg');
        if (inp.value.trim()) net.chat(inp.value.trim());
        inp.value = '';
      };
      el.querySelector('[data-a=send]').onclick = send;
      el.querySelector('.chatmsg').onkeydown = (e) => {
        if (e.key === 'Enter') send();
      };
      net.onChat = (from, text) => {
        const log = el.querySelector('.chat-log');
        const line = document.createElement('div');
        line.innerHTML = `<b>${esc(from)}:</b> ${esc(text)}`;
        log.append(line);
        log.scrollTop = log.scrollHeight;
      };
      net.onError = (msg) => {
        const s = el.querySelector('.status-line');
        s.className = 'status-line error';
        s.textContent = msg;
      };
    }
    net._ready = !!(me && me.ready);
    el.querySelector('.rtitle').textContent = room.name;
    const map = maps.find((m) => m.id === room.mapId);
    drawMapPreview(el.querySelector('.map-preview canvas'), getMap(room.mapId), 180);
    el.querySelector('.map-name').textContent = map ? map.name : room.mapId;
    el.querySelector('.map-desc').textContent = map ? map.description : '';
    el.querySelector('.rmap').value = room.mapId;
    for (const x of el.querySelectorAll('.host-only')) x.style.display = isHost ? '' : 'none';
    el.querySelector('[data-a=ready]').textContent = net._ready ? 'Not ready' : 'Ready';
    const slotsEl = el.querySelector('.slots');
    slotsEl.innerHTML = '';
    room.slots.forEach((s, i) => {
      const mine = s.clientId === net.clientId;
      const canEdit = mine || (isHost && s.ai);
      const colorOpts = PLAYER_COLORS.map((c, ci) => `<option value="${ci}" ${ci === s.color ? 'selected' : ''}>${c.name}</option>`).join('');
      const teamOpts = [1, 2, 3, 4].map((t) => `<option value="${t}" ${t === s.team ? 'selected' : ''}>Team ${t}</option>`).join('');
      const diff = s.ai
        ? `<select class="diff" ${isHost ? '' : 'disabled'}>${AI_DIFFICULTIES.map((d) => `<option value="${d}" ${d === s.difficulty ? 'selected' : ''}>${d}</option>`).join('')}</select>`
        : `<span class="muted">${s.ready ? '✔ ready' : 'not ready'}${room.host === s.clientId ? ' · host' : ''}</span>`;
      const row = h(`<div class="slot"><div class="swatch" style="background:${PLAYER_COLORS[s.color % PLAYER_COLORS.length].css}"></div><div><b>${esc(s.name)}</b>${mine ? ' (you)' : ''}</div><select class="color" ${canEdit ? '' : 'disabled'}>${colorOpts}</select><select class="team" ${canEdit ? '' : 'disabled'}>${teamOpts}</select><div>${diff}${isHost && (s.ai || !mine) ? ' <button class="btn kick" style="padding:2px 8px">✕</button>' : ''}</div></div>`);
      row.querySelector('.color').onchange = (e) => net.setSlot(i, { color: Number(e.target.value) });
      row.querySelector('.team').onchange = (e) => net.setSlot(i, { team: Number(e.target.value) });
      const d = row.querySelector('.diff');
      if (d) d.onchange = (e) => net.setSlot(i, { difficulty: e.target.value });
      const k = row.querySelector('.kick');
      if (k) k.onclick = () => net.kick(i);
      slotsEl.append(row);
    });
  }

  // ---------------------------------------------------------------- settings

  settingsForm() {
    const st = this.app.settings;
    const el = h(`<div>
      <h3>Graphics</h3>
      <label class="row"><span>Quality</span><select class="q"><option value="low">Low (fastest)</option><option value="medium">Medium (shadows)</option><option value="high">High (shadows + bloom)</option><option value="ultra">Ultra</option></select></label>
      <label class="row"><span>Health bars</span><select class="hb"><option value="damaged">Damaged &amp; selected</option><option value="always">Always</option><option value="selected">Selected only</option></select></label>
      <label class="row"><span>Show FPS</span><input type="checkbox" class="fps"></label>
      <h3>Controls</h3>
      <label class="row"><span>Edge scrolling</span><input type="checkbox" class="edge"></label>
      <label class="row"><span>Camera speed</span><input type="range" class="cs" min="0.4" max="2.5" step="0.1" style="width:200px"></label>
      <h3>Audio</h3>
      <label class="row"><span>Master volume</span><input type="range" class="mv" min="0" max="1" step="0.05" style="width:200px"></label>
      <label class="row"><span>Effects volume</span><input type="range" class="sv" min="0" max="1" step="0.05" style="width:200px"></label>
      <label class="row"><span>Music volume</span><input type="range" class="muv" min="0" max="1" step="0.05" style="width:200px"></label>
    </div>`);
    el.querySelector('.q').value = st.quality;
    el.querySelector('.hb').value = st.healthBars;
    el.querySelector('.fps').checked = !!st.showFps;
    el.querySelector('.edge').checked = st.edgeScroll !== false;
    el.querySelector('.cs').value = st.cameraSpeed ?? 1;
    el.querySelector('.mv').value = st.masterVolume ?? 0.8;
    el.querySelector('.sv').value = st.sfxVolume ?? 0.8;
    el.querySelector('.muv').value = st.musicVolume ?? 0.4;
    const apply = () => {
      st.quality = el.querySelector('.q').value;
      st.healthBars = el.querySelector('.hb').value;
      st.showFps = el.querySelector('.fps').checked;
      st.edgeScroll = el.querySelector('.edge').checked;
      st.cameraSpeed = Number(el.querySelector('.cs').value);
      st.masterVolume = Number(el.querySelector('.mv').value);
      st.sfxVolume = Number(el.querySelector('.sv').value);
      st.musicVolume = Number(el.querySelector('.muv').value);
      this.app.applySettings();
    };
    el.querySelectorAll('select,input').forEach((i) => (i.onchange = apply));
    el.querySelectorAll('input[type=range]').forEach((i) => (i.oninput = apply));
    return el;
  }

  showSettings(back) {
    const el = this.show(h(`<div class="screen center"><div class="dialog panel" style="max-width:560px"><h2>Settings</h2><div class="form"></div><div class="actions"><button class="btn primary" data-a="back">Done</button></div></div></div>`));
    el.querySelector('.form').append(this.settingsForm());
    el.querySelector('[data-a=back]').onclick = () => (this.click(), back());
  }

  // ---------------------------------------------------------------- help

  howToHtml() {
    const u = (t) => {
      const d = UNITS[t];
      return `<tr><td style="width:36px">${icon(t).replace('<svg', '<svg width="30" height="30"')}</td><td><b>${d.name}</b> — ${d.cost.crystals} crystals, ${d.supply} supply, ${d.buildTime}s<br><span class="muted">${d.hp} hull / ${d.barrier} barrier · ${d.weapon.damage}${d.weapon.hits > 1 ? `×${d.weapon.hits}` : ''} dmg · speed ${d.speed}</span></td></tr>`;
    };
    const b = (t) => {
      const d = BUILDINGS[t];
      return `<tr><td>${icon(t).replace('<svg', '<svg width="26" height="26"')}</td><td><b>${d.name}</b> <span class="kbd">${d.hotkey}</span> — ${d.cost.crystals}${d.cost.flux ? `/${d.cost.flux}` : ''} · <span class="muted">${d.description}</span></td></tr>`;
    };
    return `<div class="howto">
      <div>
        <h3>Goal</h3>
        <p>Build an economy, raise an army of Lancers and <b>destroy every enemy structure</b>. You lose when all your structures are gone.</p>
        <h3>Economy</h3>
        <p>Shapers harvest <b style="color:var(--crystal)">crystals</b> (5 per trip) and <b style="color:var(--flux)">flux</b> from Siphons built on vents (4 per trip). Two Shapers per crystal field and three per Siphon is ideal. Conduits give +8 supply and power nearby structures. Expand by building new Citadels at other crystal fields.</p>
        <h3>Combat</h3>
        <p>Everything has a regenerating <b>barrier</b> that absorbs damage before hull. Barriers recharge after 7 s out of combat. Armor reduces each hit to hull. Lancers strike twice per swing. Research <b>Lunge Drive</b> at the Sanctum to make them faster and dash into enemies. High ground can't be seen from below — use <b>Beacon Towers</b> for vision.</p>
        <h3>Units</h3><table>${u('shaper')}${u('lancer')}</table>
      </div>
      <div>
        <h3>Controls</h3>
        <table>
          <tr><td>Left click / drag</td><td>Select / box select (Shift adds, Ctrl or double-click selects type)</td></tr>
          <tr><td>Right click</td><td>Smart command: move, attack, harvest, set rally (Shift queues)</td></tr>
          <tr><td><span class="kbd">A</span> <span class="kbd">M</span> <span class="kbd">P</span> <span class="kbd">H</span> <span class="kbd">S</span></td><td>Attack-move · Move · Patrol · Hold · Stop</td></tr>
          <tr><td><span class="kbd">B</span> then key</td><td>Shaper build menu</td></tr>
          <tr><td><span class="kbd">E</span> / <span class="kbd">Z</span></td><td>Train Shaper (Citadel) / Lancer (Portal)</td></tr>
          <tr><td><span class="kbd">Ctrl</span>+<span class="kbd">1-9</span></td><td>Set control group (Shift adds, number recalls, double tap centers)</td></tr>
          <tr><td><span class="kbd">F1</span> / <span class="kbd">F2</span></td><td>Idle Shaper / select army</td></tr>
          <tr><td><span class="kbd">Backspace</span> / <span class="kbd">Space</span></td><td>Cycle Citadels / jump to last alert</td></tr>
          <tr><td>Arrows · edges · middle drag · wheel</td><td>Camera pan & zoom</td></tr>
          <tr><td><span class="kbd">F10</span> / <span class="kbd">Esc</span></td><td>Menu / cancel</td></tr>
          <tr><td><span class="kbd">+</span> <span class="kbd">-</span></td><td>Game speed (single player)</td></tr>
          <tr><td><span class="kbd">Enter</span></td><td>Chat</td></tr>
        </table>
        <h3>Structures</h3><table>${['citadel', 'conduit', 'siphon', 'portal', 'foundry', 'archive', 'sanctum', 'aegis'].map(b).join('')}</table>
        <h3>Research</h3><p class="muted">${Object.values(RESEARCH)
          .map((r) => `<b>${r.name}</b> (${BUILDINGS[r.at].name}): ${r.description}`)
          .join('<br>')}</p>
      </div>
    </div>`;
  }

  showHowTo(back) {
    const el = this.show(h(`<div class="screen center"><div class="dialog panel"><h2>How to Play</h2>${this.howToHtml()}<div class="actions"><button class="btn primary" data-a="back">Got it</button></div></div></div>`));
    el.querySelector('[data-a=back]').onclick = () => (this.click(), back());
  }

  // ---------------------------------------------------------------- in-game menus

  showPauseMenu(game) {
    const local = game.session.isLocal;
    const el = this.modal(
      h(`<div class="overlay-center"><div class="dialog panel" style="max-width:520px">
        <h2>${local ? 'Paused' : 'Menu'}</h2>
        <div style="display:flex;flex-direction:column;gap:10px">
          <button class="btn primary" data-a="resume">Resume</button>
          <button class="btn" data-a="settings">Settings</button>
          <button class="btn" data-a="help">How to Play</button>
          ${local ? '<label class="row"><span>Game speed</span><select class="spd"><option value="0.5">×0.5</option><option value="0.75">×0.75</option><option value="1">×1</option><option value="1.25">×1.25</option><option value="1.5">×1.5</option><option value="2">×2</option><option value="3">×3</option></select></label>' : ''}
          <button class="btn danger" data-a="surrender">Surrender</button>
          <button class="btn" data-a="quit">Quit to Main Menu</button>
        </div>
      </div></div>`),
    );
    const spd = el.querySelector('.spd');
    if (spd) {
      spd.value = String(game.session.speed);
      spd.onchange = () => game.session.setSpeed(Number(spd.value));
    }
    el.querySelector('[data-a=resume]').onclick = () => game.togglePause(false);
    el.querySelector('[data-a=settings]').onclick = () => {
      const s = this.modal(h(`<div class="overlay-center"><div class="dialog panel" style="max-width:560px"><h2>Settings</h2><div class="form"></div><div class="actions"><button class="btn primary">Back</button></div></div></div>`));
      s.querySelector('.form').append(this.settingsForm());
      s.querySelector('button.primary').onclick = () => this.showPauseMenu(game);
    };
    el.querySelector('[data-a=help]').onclick = () => {
      const s = this.modal(h(`<div class="overlay-center"><div class="dialog panel"><h2>How to Play</h2>${this.howToHtml()}<div class="actions"><button class="btn primary">Back</button></div></div></div>`));
      s.querySelector('button.primary').onclick = () => this.showPauseMenu(game);
    };
    el.querySelector('[data-a=surrender]').onclick = () => {
      if (!confirm('Surrender this game?')) return;
      game.session.issue({ type: 'surrender' });
      game.togglePause(false);
    };
    el.querySelector('[data-a=quit]').onclick = () => {
      this.closeModal();
      this.app.quitToMenu();
    };
  }

  showEndScreen(game, info) {
    const rows = info.stats
      .map(
        (p) => `<tr><td><span class="swatch" style="display:inline-block;vertical-align:middle;margin-right:8px;background:#${p.colorHex.toString(16).padStart(6, '0')}"></span>${esc(p.name)}</td>
        <td>${p.crystalsMined}</td><td>${p.fluxMined}</td><td>${p.unitsMade}</td><td>${p.kills}</td><td>${p.unitsLost}</td><td>${p.structuresBuilt}</td><td>${p.structuresKilled}</td></tr>`,
      )
      .join('');
    const el = this.modal(
      h(`<div class="overlay-center"><div class="dialog panel" style="max-width:860px">
        <div class="end-banner ${info.victory ? 'victory' : 'defeat'}">${info.victory ? 'VICTORY' : 'DEFEAT'}</div>
        <div class="muted" style="text-align:center;margin-bottom:16px">Game time ${info.time}</div>
        <table class="stats-table"><tr><th>Player</th><th>Crystals</th><th>Flux</th><th>Units</th><th>Kills</th><th>Lost</th><th>Structures</th><th>Razed</th></tr>${rows}</table>
        <div class="actions"><button class="btn" data-a="watch">Keep watching</button><button class="btn primary" data-a="menu">Main Menu</button></div>
      </div></div>`),
    );
    el.querySelector('[data-a=menu]').onclick = () => {
      this.closeModal();
      this.app.quitToMenu();
    };
    el.querySelector('[data-a=watch]').onclick = () => this.closeModal();
  }
}
