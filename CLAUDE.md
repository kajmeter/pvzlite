# pvzlite — notes for contributors and AI assistants

pvzlite (Shapers vs Lancer) is a three.js remake of the StarCraft II arcade mode *Probes vs
Zealot 2* with original characters: Shapers (probes) build a Generator for gas, wall in, trade at
the Market, build turrets, miners and auto mines; one Lancer (zealot) feeds on structure damage
and buys blades/armor/life at the central Shop. The rules are specified in
`docs/design/pvz-mode.md` (keep it in sync with the code). A full classic RTS mode is included.
Shared deterministic simulation (`src/shared`, survival rules in `src/shared/sim/survival.js` +
`src/shared/data/survival.js`), browser/Electron client (`src/client`, `desktop/`) and a Node.js
multiplayer server (`server/`). See README.md.

## ⚠️ Very important rule: every update ships ready-to-download binaries

- Every push must end with fresh, working binaries attached to a GitHub Release.
  The `Build & Release` workflow (`.github/workflows/release.yml`) does this automatically
  on every push: tests → Linux/Windows builds → release `v1.0.<run_number>` marked *latest*.
- After pushing, **check that the workflow succeeded** and that the latest release contains:
  `pvzlite-Setup.exe`, `pvzlite-Portable.exe`, `pvzlite-win-x64.zip`,
  `pvzlite_amd64.deb`, `pvzlite-x86_64.AppImage`, `pvzlite-server-linux-x64`,
  `pvzlite-server-win-x64.exe`, `pvzlite-web.zip`, `SHA256SUMS.txt`.
  If it failed, fix it and push again — a red release pipeline is never "done".
- These asset names are linked from README.md (`releases/latest/download/<name>`).
  Never rename them without updating every README link.

## Always push

Commit and push every finished, verified change to the working branch right away — don't wait
to be asked. Never push a broken state (see the checks below), because every push publishes a
release.

## Before pushing

```bash
npm test            # vitest: simulation, survival, maps, server (must pass)
npm run build       # web client → dist/
npm run test:e2e    # playwright end-to-end (uses dist/ via the game server)
```
When visuals or UI change, regenerate the README screenshots: `npm run screenshots`.

## Conventions

- Plain modern JavaScript (ES modules), no TypeScript. Match the surrounding style.
- Game rules live only in `src/shared` so single player and multiplayer behave identically;
  keep the simulation deterministic (use `world.rng`, never `Math.random`, in `src/shared`).
- All game content (names, models, maps, icons, sounds) must stay original —
  do not copy assets, names or designs from commercial games.
- The client must work from any sub-path and from `file://`-like origins (Vite `base: './'`).
