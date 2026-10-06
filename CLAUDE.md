# Shardfall (pvzlite) — notes for contributors and AI assistants

Shardfall is a three.js real-time strategy game with a shared deterministic simulation
(`src/shared`), a browser/Electron client (`src/client`, `desktop/`) and a Node.js
multiplayer server (`server/`). See README.md for the full overview.

## ⚠️ Very important rule: every update ships ready-to-download binaries

- Every push must end with fresh, working binaries attached to a GitHub Release.
  The `Build & Release` workflow (`.github/workflows/release.yml`) does this automatically
  on every push: tests → Linux/Windows builds → release `v1.0.<run_number>` marked *latest*.
- After pushing, **check that the workflow succeeded** and that the latest release contains:
  `Shardfall-Setup.exe`, `Shardfall-Portable.exe`, `Shardfall-win-x64.zip`,
  `shardfall_amd64.deb`, `Shardfall-x86_64.AppImage`, `shardfall-server-linux-x64`,
  `shardfall-server-win-x64.exe`, `shardfall-web.zip`, `SHA256SUMS.txt`.
  If it failed, fix it and push again — a red release pipeline is never "done".
- These asset names are linked from README.md (`releases/latest/download/<name>`).
  Never rename them without updating every README link.

## Before pushing

```bash
npm test            # vitest: simulation, maps, server (must pass)
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
