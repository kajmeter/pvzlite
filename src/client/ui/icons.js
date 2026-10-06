// Original inline SVG icons for the HUD (units, structures, commands, resources).
const wrap = (body, vb = '0 0 64 64') =>
  `<svg viewBox="${vb}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${body}</svg>`;

const C = {
  blue: '#5fd2ff',
  blueDark: '#1d5fa8',
  white: '#eaf7ff',
  steel: '#9fb0c8',
  gold: '#ffd36b',
  green: '#63f59b',
  red: '#ff6464',
  purple: '#c387ff',
};

export const ICONS = {
  crystals: wrap(
    `<path d="M32 4 50 22 32 60 14 22Z" fill="${C.blue}"/><path d="M32 4 40 22 32 60 24 22Z" fill="${C.white}" opacity=".7"/><path d="M14 22h36" stroke="#0b2a4a" stroke-width="2"/>`,
  ),
  flux: wrap(
    `<path d="M20 10h24l-4 10v26a8 8 0 0 1-16 0V20Z" fill="#1f6a46"/><path d="M24 30h16v16a8 8 0 0 1-16 0Z" fill="${C.green}"/><circle cx="30" cy="38" r="3" fill="#eafff2"/><rect x="18" y="6" width="28" height="6" rx="2" fill="${C.steel}"/>`,
  ),
  supply: wrap(
    `<path d="M32 4 44 18 32 34 20 18Z" fill="${C.blue}"/><rect x="22" y="36" width="20" height="6" fill="${C.steel}"/><rect x="18" y="44" width="28" height="14" rx="2" fill="#56627c"/>`,
  ),
  shaper: wrap(
    `<ellipse cx="32" cy="30" rx="22" ry="6" fill="none" stroke="${C.steel}" stroke-width="3"/><path d="M14 30a18 14 0 0 1 36 0Z" fill="#d9c58f"/><path d="M32 18 38 30 32 42 26 30Z" fill="${C.blue}"/><path d="M24 36l-6 16M32 38v18M40 36l6 16" stroke="${C.steel}" stroke-width="3" stroke-linecap="round"/><rect x="44" y="24" width="8" height="4" fill="${C.blue}"/>`,
  ),
  lancer: wrap(
    `<path d="M8 58 54 8" stroke="${C.steel}" stroke-width="3"/><path d="M46 4c10 4 14 14 10 22-2-8-8-14-16-16Z" fill="${C.white}"/><path d="M12 50c-6 0-8-6-6-10 2 4 6 6 10 6Z" fill="${C.white}" opacity=".8"/><path d="M26 18h12l4 18-4 6H26l-4-6Z" fill="#c3cbda"/><path d="M27 10h10v8H27Z" fill="#8f9bb0"/><rect x="28" y="13" width="8" height="2" fill="${C.blue}"/><path d="M20 20a8 6 0 0 1 8-4v8ZM44 20a8 6 0 0 0-8-4v8Z" fill="${C.blue}"/><path d="M27 42h4v16h-4ZM33 42h4v16h-4Z" fill="#3a4252"/>`,
  ),
  citadel: wrap(
    `<path d="M6 54h52l-6-8H12Z" fill="#4c5466"/><path d="M12 46h40l-4-6H16Z" fill="#7a8296"/><path d="M32 4 40 22 32 40 24 22Z" fill="${C.blue}"/><path d="M32 10 35 22 32 34 29 22Z" fill="${C.white}"/><path d="M14 46 22 18M50 46 42 18" stroke="#7a8296" stroke-width="5"/><ellipse cx="32" cy="22" rx="16" ry="4" fill="none" stroke="${C.steel}" stroke-width="2"/>`,
  ),
  conduit: wrap(
    `<rect x="14" y="48" width="36" height="8" fill="#4c5466"/><path d="M20 48 24 34M44 48 40 34" stroke="${C.blue}" stroke-width="4"/><path d="M32 6 42 22 32 40 22 22Z" fill="${C.blue}"/><path d="M32 12 35 22 32 32 29 22Z" fill="${C.white}"/><ellipse cx="32" cy="23" rx="14" ry="4" fill="none" stroke="${C.blue}" stroke-width="1.5"/>`,
  ),
  siphon: wrap(
    `<rect x="8" y="42" width="48" height="12" rx="3" fill="#7d8798"/><path d="M14 42a18 16 0 0 1 36 0Z" fill="#9ba6b9"/><rect x="12" y="38" width="40" height="4" fill="${C.green}"/><rect x="28" y="16" width="8" height="10" fill="${C.green}"/><path d="M10 20c4-6 8-6 10 0M46 18c4-6 8-6 10 0" stroke="${C.green}" stroke-width="2" fill="none" opacity=".7"/>`,
  ),
  portal: wrap(
    `<rect x="6" y="52" width="52" height="6" fill="#4c5466"/><circle cx="32" cy="30" r="20" fill="none" stroke="#c9d3e6" stroke-width="6"/><circle cx="32" cy="30" r="15" fill="${C.blue}" opacity=".75"/><path d="M32 18c8 4 8 20 0 24-8-4-8-20 0-24Z" fill="${C.white}" opacity=".6"/><rect x="10" y="30" width="6" height="22" fill="#7a8296"/><rect x="48" y="30" width="6" height="22" fill="#7a8296"/>`,
  ),
  foundry: wrap(
    `<rect x="8" y="30" width="48" height="24" fill="#7a8296"/><path d="M6 30 32 12 58 30Z" fill="#8d96a8"/><rect x="12" y="8" width="8" height="20" fill="#5f6779"/><rect x="11" y="4" width="10" height="5" fill="#ff9a3c"/><rect x="22" y="40" width="20" height="8" fill="#ff9a3c"/><path d="M38 20l10-4 2 6-10 4Z" fill="${C.steel}"/>`,
  ),
  archive: wrap(
    `<rect x="18" y="22" width="28" height="32" fill="#7a8296"/><path d="M16 24a16 14 0 0 1 32 0Z" fill="#a9b3c6"/><rect x="16" y="34" width="32" height="4" fill="${C.blue}"/><rect x="6" y="28" width="5" height="10" fill="${C.blue}"/><rect x="53" y="28" width="5" height="10" fill="${C.blue}"/><path d="M32 2 36 10 32 18 28 10Z" fill="${C.blue}"/>`,
  ),
  sanctum: wrap(
    `<rect x="6" y="50" width="52" height="8" fill="#4c5466"/><rect x="12" y="42" width="40" height="8" fill="#7a8296"/><rect x="20" y="36" width="24" height="6" fill="#7a8296"/><path d="M18 8h28L32 30Z" fill="${C.blue}"/><path d="M26 8h12L32 20Z" fill="${C.white}" opacity=".7"/>`,
  ),
  aegis: wrap(
    `<rect x="12" y="50" width="40" height="6" fill="#4c5466"/><path d="M14 36h36l-6 14H20Z" fill="#7a8296"/><circle cx="32" cy="22" r="11" fill="#8fdcff"/><circle cx="29" cy="19" r="4" fill="#fff" opacity=".8"/><path d="M18 22a14 14 0 0 1 28 0" fill="none" stroke="#8fdcff" stroke-width="2" opacity=".5"/>`,
  ),
  move: wrap(`<path d="M10 32h36M34 18l14 14-14 14" stroke="${C.green}" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`),
  stop: wrap(`<path d="M22 6h20l16 16v20L42 58H22L6 42V22Z" fill="${C.red}"/><rect x="18" y="28" width="28" height="8" fill="#fff"/>`),
  hold: wrap(`<path d="M32 6 54 14v18c0 14-10 22-22 26C20 54 10 46 10 32V14Z" fill="${C.blue}"/><path d="M32 14 46 19v13c0 9-6 15-14 18Z" fill="${C.white}" opacity=".5"/>`),
  attack: wrap(
    `<path d="M10 54 44 20M44 20l8-12-12 8" stroke="${C.red}" stroke-width="6" fill="none" stroke-linecap="round"/><path d="M14 40l10 10" stroke="${C.steel}" stroke-width="6"/>`,
  ),
  patrol: wrap(`<path d="M14 24a18 18 0 0 1 32-6M50 40a18 18 0 0 1-32 6" stroke="${C.gold}" stroke-width="5" fill="none"/><path d="M46 8v12H34M18 56V44h12" stroke="${C.gold}" stroke-width="5" fill="none"/>`),
  gather: wrap(`<path d="M32 6 46 22 32 50 18 22Z" fill="${C.blue}"/><path d="M8 56h48" stroke="${C.steel}" stroke-width="4"/><path d="M20 40l-8 10M44 40l8 10" stroke="${C.steel}" stroke-width="4"/>`),
  returnCargo: wrap(`<path d="M32 4 42 16 32 32 22 16Z" fill="${C.blue}"/><path d="M12 44h40l-6 14H18Z" fill="#7a8296"/><path d="M32 34v8M26 38l6 6 6-6" stroke="${C.green}" stroke-width="4" fill="none"/>`),
  build: wrap(`<rect x="10" y="30" width="44" height="26" fill="#7a8296"/><path d="M8 30 32 12 56 30Z" fill="${C.blue}"/><path d="M40 6l14 14-6 6-14-14Z" fill="${C.gold}"/>`),
  back: wrap(`<path d="M42 10 18 32l24 22" stroke="${C.white}" stroke-width="7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`),
  cancel: wrap(`<circle cx="32" cy="32" r="24" fill="${C.red}"/><path d="M20 20l24 24M44 20 20 44" stroke="#fff" stroke-width="6"/>`),
  rally: wrap(`<path d="M18 6v52" stroke="${C.steel}" stroke-width="5"/><path d="M20 8h30l-8 10 8 10H20Z" fill="${C.green}"/>`),
  overclock: wrap(
    `<circle cx="32" cy="34" r="22" fill="none" stroke="${C.gold}" stroke-width="5"/><path d="M32 34V18M32 34l10 8" stroke="${C.gold}" stroke-width="5" stroke-linecap="round"/><path d="M26 4h12" stroke="${C.gold}" stroke-width="5"/><path d="M52 10l6 6" stroke="${C.gold}" stroke-width="5"/>`,
  ),
  warp: wrap(
    `<ellipse cx="32" cy="50" rx="22" ry="7" fill="none" stroke="${C.blue}" stroke-width="3"/><path d="M14 50V16M50 50V16" stroke="${C.blue}" stroke-width="2" opacity=".5"/><path d="M32 12 40 30 32 48 24 30Z" fill="${C.white}"/>`,
  ),
  phaseTransit: wrap(`<circle cx="32" cy="32" r="22" fill="none" stroke="${C.purple}" stroke-width="6" stroke-dasharray="14 8"/><circle cx="32" cy="32" r="12" fill="${C.blue}"/><path d="M28 24l10 8-10 8Z" fill="#fff"/>`),
  lunge: wrap(`<path d="M8 44h20M4 34h22M10 24h18" stroke="${C.blue}" stroke-width="4" stroke-linecap="round"/><path d="M30 18l26 14-26 14 6-14Z" fill="${C.white}"/>`),
  weapons: wrap(`<path d="M12 52 46 18" stroke="${C.steel}" stroke-width="5"/><path d="M40 8c10 2 16 10 16 18-4-6-10-10-18-12Z" fill="${C.blue}"/><path d="M8 40l16 16" stroke="${C.gold}" stroke-width="5"/>`),
  armor: wrap(`<path d="M32 6 52 14v16c0 14-10 24-20 28-10-4-20-14-20-28V14Z" fill="#c3cbda"/><path d="M32 14 44 19v11c0 9-6 16-12 19Z" fill="${C.steel}"/>`),
  barrier: wrap(`<circle cx="32" cy="32" r="24" fill="${C.blue}" opacity=".35"/><path d="M32 10l18 10v20L32 52 14 40V20Z" fill="none" stroke="${C.blue}" stroke-width="4"/><path d="M32 22l8 5v10l-8 5-8-5V27Z" fill="${C.white}"/>`),
  autocast: wrap(`<circle cx="32" cy="32" r="20" fill="none" stroke="${C.gold}" stroke-width="4" stroke-dasharray="6 6"/>`),
};

export function icon(name) {
  return ICONS[name] || ICONS.build;
}
