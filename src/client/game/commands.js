// Builds the command card (buttons, hotkeys, tooltips) for the current selection.
import { UNITS, BUILDINGS, RESEARCH, BUILD_ORDER_MENU } from '../../shared/data/defs.js';
import { OVERCLOCK_COST } from '../../shared/constants.js';
import { SURVIVAL_BUILDINGS, SURVIVAL_BUILD_MENU, HUNTER_UPGRADES, HUNTER_UPGRADE_ORDER, upgradeCost, levelCost, builderStats, SURVIVAL } from '../../shared/data/survival.js';
import { SPRINT } from '../../shared/sim/survival.js';

const BUILD_POS = {
  citadel: [0, 0],
  conduit: [1, 0],
  siphon: [2, 0],
  portal: [3, 0],
  foundry: [4, 0],
  archive: [0, 1],
  sanctum: [1, 1],
  aegis: [2, 1],
};

function costOf(def) {
  return def.cost;
}

/**
 * @param {object} ctx { session, selection: entity[], submenu, mode }
 * @returns {Array<object>} buttons
 */
export function commandCard(ctx) {
  const { session, selection, submenu, mode } = ctx;
  const me = session.localPlayer;
  const p = session.player();
  const own = selection.filter((e) => e.owner === me);
  if (!own.length || !p) return [];
  const units = own.filter((e) => e.kind === 'unit');
  const buildings = own.filter((e) => e.kind === 'building');
  const buttons = [];
  const modeIs = (k) => mode && mode.kind === k;

  if (units.length) {
    const workers = units.filter((u) => u.type === 'shaper');
    if (submenu === 'build' && workers.length) {
      for (const type of BUILD_ORDER_MENU) {
        const def = BUILDINGS[type];
        const missing = def.requires.filter((r) => !session.hasCompleted(r));
        const afford = p.crystals >= def.cost.crystals && p.flux >= def.cost.flux;
        buttons.push({
          id: `build:${type}`,
          icon: type,
          hotkey: def.hotkey,
          pos: BUILD_POS[type],
          disabled: missing.length > 0,
          dim: !afford,
          active: modeIs('build') && mode.type === type,
          action: { mode: 'build', type },
          tooltip: {
            title: def.name,
            desc: def.description + (missing.length ? `\nRequires: ${missing.map((r) => BUILDINGS[r].name).join(', ')}` : ''),
            cost: { ...costOf(def), time: def.buildTime, supplyGive: def.supply || 0 },
          },
        });
      }
      buttons.push({ id: 'back', icon: 'back', hotkey: 'Escape', label: 'Esc', pos: [4, 2], action: { submenu: null }, tooltip: { title: 'Back' } });
      return buttons;
    }
    buttons.push({ id: 'move', icon: 'move', hotkey: 'M', pos: [0, 0], active: modeIs('move'), action: { mode: 'move' }, tooltip: { title: 'Move', desc: 'Move to the target location or follow a unit.' } });
    buttons.push({ id: 'stop', icon: 'stop', hotkey: 'S', pos: [1, 0], action: { cmd: { type: 'stop' } }, tooltip: { title: 'Stop', desc: 'Stop all current orders.' } });
    buttons.push({ id: 'hold', icon: 'hold', hotkey: 'H', pos: [2, 0], action: { cmd: { type: 'hold' } }, tooltip: { title: 'Hold Position', desc: 'Stay in place and only attack enemies in range.' } });
    buttons.push({ id: 'patrol', icon: 'patrol', hotkey: 'P', pos: [3, 0], active: modeIs('patrol'), action: { mode: 'patrol' }, tooltip: { title: 'Patrol', desc: 'Patrol between the current location and the target, attacking enemies.' } });
    buttons.push({ id: 'attack', icon: 'attack', hotkey: 'A', pos: [4, 0], active: modeIs('attack'), action: { mode: 'attack' }, tooltip: { title: 'Attack', desc: 'Attack a target, or attack-move: advance and engage every enemy on the way.' } });
    if (workers.length) {
      buttons.push({ id: 'gather', icon: 'gather', hotkey: 'G', pos: [0, 1], active: modeIs('gather'), action: { mode: 'gather' }, tooltip: { title: 'Gather', desc: 'Harvest crystals or flux from a Siphon.' } });
      buttons.push({ id: 'return', icon: 'returnCargo', hotkey: 'C', pos: [1, 1], action: { cmd: { type: 'returnCargo' } }, tooltip: { title: 'Return Cargo', desc: 'Bring carried resources to the nearest Citadel.' } });
      buttons.push({ id: 'buildmenu', icon: 'build', hotkey: 'B', pos: [0, 2], action: { submenu: 'build' }, tooltip: { title: 'Build Structure', desc: 'Project a new structure.' } });
    }
    const lancers = units.filter((u) => u.type === 'lancer');
    if (lancers.length && p.upgrades.lunge) {
      const on = lancers.some((u) => !u.autocast || u.autocast.lunge !== false);
      buttons.push({
        id: 'lunge',
        icon: 'lunge',
        hotkey: 'X',
        pos: [4, 2],
        autocast: on,
        action: { cmd: { type: 'autocast', ability: 'lunge', value: !on } },
        tooltip: { title: `Lunge (${on ? 'auto' : 'manual'})`, desc: 'Lancers automatically dash at enemies within 4 range (7 s cooldown), +8 impact damage. Click to toggle autocast.' },
      });
    }
    return buttons;
  }

  // structures: use the type of the first selected building
  const lead = buildings[0];
  const same = buildings.filter((b) => b.type === lead.type);
  if (!lead.built) {
    buttons.push({ id: 'cancelBuild', icon: 'cancel', hotkey: 'Escape', label: 'Esc', pos: [4, 2], action: { cmd: { type: 'cancel', building: lead.id } }, tooltip: { title: 'Cancel Construction', desc: 'Refunds 75% of the cost.' } });
    return buttons;
  }
  const def = BUILDINGS[lead.type];
  if (lead.type === 'portal' && lead.phase) {
    const ready = same.filter((b) => b.phase && b.warpCd <= 0);
    const minCd = Math.min(...same.map((b) => b.warpCd || 0));
    const ud = UNITS.lancer;
    buttons.push({
      id: 'warp',
      icon: 'lancer',
      hotkey: 'Z',
      pos: [0, 0],
      active: modeIs('warp'),
      disabled: !ready.length,
      cooldown: ready.length ? null : Math.ceil(minCd),
      action: { mode: 'warp' },
      tooltip: { title: `Warp in Lancer (${ready.length} ready)`, desc: `${ud.description}\nWarp into any power field. 3.6 s near a Citadel or Phase Portal, 16 s elsewhere.`, cost: { ...ud.cost, supply: ud.supply, time: ud.warpCooldown } },
    });
  } else {
    let col = 0;
    for (const t of def.trains) {
      const ud = UNITS[t];
      buttons.push({
        id: `train:${t}`,
        icon: t,
        hotkey: ud.hotkey,
        pos: [col++, 0],
        dim: p.crystals < ud.cost.crystals,
        action: { cmd: { type: 'train', unit: t } },
        tooltip: { title: `Train ${ud.name}`, desc: ud.description, cost: { ...ud.cost, supply: ud.supply, time: ud.buildTime } },
      });
    }
  }
  let rcol = 0;
  for (const rid of def.research) {
    const r = RESEARCH[rid];
    const st = session.researchStatus(rid);
    const lvl = st.level || 0;
    const L = r.levels[Math.min(r.levels.length - 1, lvl)];
    const title = r.levels.length > 1 ? `${r.name} Level ${Math.min(r.levels.length, lvl + 1)}` : r.name;
    buttons.push({
      id: `research:${rid}`,
      icon: rid,
      hotkey: r.hotkey,
      pos: [rcol++, def.trains.length ? 1 : 0],
      disabled: !st.ok,
      dim: st.ok && (p.crystals < L.cost.crystals || p.flux < L.cost.flux),
      action: { cmd: { type: 'research', research: rid } },
      tooltip: { title: st.maxed ? `${r.name} (complete)` : title, desc: r.description + (!st.ok && !st.maxed ? `\n${st.reason}` : ''), cost: st.maxed ? null : { ...L.cost, time: L.time } },
    });
  }
  if (lead.type === 'citadel') {
    buttons.push({
      id: 'overclock',
      icon: 'overclock',
      hotkey: 'C',
      pos: [2, 0],
      active: modeIs('overclock'),
      dim: !same.some((b) => b.energy >= OVERCLOCK_COST),
      action: { mode: 'overclock' },
      tooltip: { title: 'Overclock', desc: 'Target structure produces and researches 50% faster for 20 seconds.', cost: { energy: OVERCLOCK_COST } },
    });
  }
  if (def.trains.length) {
    buttons.push({ id: 'rally', icon: 'rally', hotkey: 'R', pos: [4, 1], active: modeIs('rally'), action: { mode: 'rally' }, tooltip: { title: 'Set Rally Point', desc: 'New units go here. Rally on a crystal field to auto-harvest.' } });
  }
  if (lead.queue && lead.queue.length) {
    buttons.push({ id: 'cancelQueue', icon: 'cancel', hotkey: 'Escape', label: 'Esc', pos: [4, 2], action: { cmd: { type: 'cancel', building: lead.id } }, tooltip: { title: 'Cancel', desc: 'Cancel the last item in the queue (full refund).' } });
  }
  return buttons;
}

// ---------------------------------------------------------------- survival (pvzlite) command card

const UPGRADE_POS = { blades: [0, 1], armor: [1, 1], vitality: [2, 1], barrier: [0, 2], swiftness: [1, 2], sunder: [2, 2], lunge: [3, 2] };

export function survivalCard(ctx) {
  const { session, selection, mode } = ctx;
  const me = session.localPlayer;
  const p = session.player();
  if (!p) return [];
  const own = selection.filter((e) => e.owner === me);
  const modeIs = (k, t) => mode && mode.kind === k && (!t || mode.type === t);
  const buttons = [];
  const hero = own.find((e) => e.type === 'builder' || e.type === 'hunter');
  if (!hero) {
    const b = own.find((e) => e.kind === 'building');
    if (b && !b.built) buttons.push({ id: 'cancelBuild', icon: 'cancel', hotkey: 'Escape', label: 'Esc', pos: [4, 2], action: { cmd: { type: 'cancel', building: b.id } }, tooltip: { title: 'Cancel Construction', desc: 'Refunds 75% of the cost.' } });
    return buttons;
  }
  buttons.push({ id: 'move', icon: 'move', hotkey: 'M', pos: [0, 0], active: modeIs('move'), action: { mode: 'move' }, tooltip: { title: 'Move', desc: 'Move to a location.' } });
  buttons.push({ id: 'stop', icon: 'stop', hotkey: 'S', pos: [1, 0], action: { cmd: { type: 'stop' } }, tooltip: { title: 'Stop' } });
  buttons.push({ id: 'hold', icon: 'hold', hotkey: 'H', pos: [2, 0], action: { cmd: { type: 'hold' } }, tooltip: { title: 'Hold Position' } });
  if (hero.type === 'builder') {
    buttons.push({ id: 'gather', icon: 'gather', hotkey: 'G', pos: [3, 0], active: modeIs('gather'), action: { mode: 'gather' }, tooltip: { title: 'Mine', desc: 'Mine a crystal field. Crystals go straight to your bank.' } });
    const bpos = { barricade: [0, 1], turret: [1, 1], mender: [2, 1], lanceTurret: [3, 1] };
    for (const type of SURVIVAL_BUILD_MENU) {
      const sb = SURVIVAL_BUILDINGS[type];
      const locked = p.level < sb.unlock;
      buttons.push({
        id: `build:${type}`,
        icon: type,
        hotkey: sb.hotkey,
        pos: bpos[type],
        disabled: locked,
        dim: !locked && p.crystals < sb.cost,
        active: modeIs('build', type),
        action: { mode: 'build', type },
        tooltip: { title: sb.name, desc: `${sb.description}${locked ? `\nUnlocks at level ${sb.unlock}` : ''}`, cost: { crystals: sb.cost, time: sb.buildTime } },
      });
    }
    const maxed = p.level >= SURVIVAL.maxLevel;
    const cost = levelCost(p.level);
    const next = builderStats(Math.min(SURVIVAL.maxLevel, p.level + 1));
    buttons.push({
      id: 'levelUp',
      icon: 'levelUp',
      hotkey: 'U',
      pos: [0, 2],
      disabled: maxed,
      dim: !maxed && p.crystals < cost,
      action: { cmd: { type: 'levelUp' } },
      tooltip: {
        title: maxed ? 'Max level reached' : `Level Up → ${p.level + 1}`,
        desc: maxed ? 'You ascended!' : `Mining +2 per trip (${next.yield}/trip), +12 hull, +10 barrier, stronger walls and turrets. Reach level ${SURVIVAL.maxLevel} to win!`,
        cost: maxed ? null : { crystals: cost },
      },
    });
    const sprintLocked = p.level < SPRINT.unlock;
    buttons.push({
      id: 'sprint',
      icon: 'sprint',
      hotkey: 'D',
      pos: [1, 2],
      disabled: sprintLocked,
      cooldown: p.sprintCd > 0 ? Math.ceil(p.sprintCd) : null,
      action: { cmd: { type: 'sprint' } },
      tooltip: { title: 'Sprint', desc: `Run 60% faster for ${SPRINT.duration} s (${SPRINT.cooldown} s cooldown).${sprintLocked ? `\nUnlocks at level ${SPRINT.unlock}` : ''}` },
    });
  } else {
    buttons.push({ id: 'attack', icon: 'attack', hotkey: 'A', pos: [3, 0], active: modeIs('attack'), action: { mode: 'attack' }, tooltip: { title: 'Attack', desc: 'Attack a target or attack-move.' } });
    buttons.push({
      id: 'reveal',
      icon: 'reveal',
      hotkey: 'R',
      pos: [4, 0],
      cooldown: p.revealCd > 0 ? Math.ceil(p.revealCd) : null,
      action: { cmd: { type: 'reveal' } },
      tooltip: { title: 'Reveal Pulse', desc: `Reveals every Shaper for ${SURVIVAL.revealDuration} s (${SURVIVAL.revealCooldown} s cooldown).` },
    });
    for (const id of HUNTER_UPGRADE_ORDER) {
      const u = HUNTER_UPGRADES[id];
      const lvl = (p.hunterUp && p.hunterUp[id]) || 0;
      const maxed = lvl >= u.max;
      const cost = upgradeCost(id, lvl);
      buttons.push({
        id: `upgrade:${id}`,
        icon: `up_${id}`,
        hotkey: u.hotkey,
        pos: UPGRADE_POS[id],
        disabled: maxed,
        dim: !maxed && p.essence < cost,
        badge: `${lvl}`,
        action: { cmd: { type: 'upgrade', upgrade: id } },
        tooltip: { title: `${u.name} ${maxed ? '(max)' : `${lvl} → ${lvl + 1}`}`, desc: u.description, cost: maxed ? null : { essence: cost } },
      });
    }
  }
  return buttons;
}
