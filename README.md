# MallOS — 3D Shopping Mall Wayfinding

Night-neon **Three.js** kiosk experience: cinematic route from the directory to **Kruidvat** (and every other store).

## House rules

1. **Feature-gate every looks-vs-speed choice.** Build all the options behind a switch and let the maintainer try them.
   Runtime knobs go in ⚙ Besturing, stored in [graphicsPrefs](src/render/graphicsPrefs.ts). Shader-baked ones
   reload the page on change. Code that should not ship at all uses `import { feature } from 'bun:bundle'` with
   `bun build --feature FLAG`.
2. **Edit files with an editor, never a shell heredoc.** No live diff otherwise.

Full rules in [AGENTS.md](AGENTS.md).

## Run

```bash
bun install
bun run dev
```

Serves on `http://localhost:5174` (`PORT` overrides).

Bun does all three jobs here: package manager, bundler and task runner. Install with `bun install`. The dev server is
`bun --hot server/main.ts`. There is no Vite and no separate build tool.

## Controls

First person, no orbit rig: yaw/pitch are the only camera state, so the view
always sits behind your eyes and never drifts toward the middle of the mall.

| Input                | Action                                                           |
| -------------------- | ---------------------------------------------------------------- |
| **Click the view**   | Capture the mouse (Esc frees it, route stays)                    |
| **W A S D** / arrows | Walk (A/D strafe, or turn — see ⚙ Besturing)                     |
| **Shift**            | Sprint                                                           |
| **Space**            | Jump                                                             |
| **Q / E**            | Turn — always works, mouse or not                                |
| **R / F**            | Look up / down without a mouse                                   |
| Escalator / stairs   | Walkable ramps to floor 1 (⇅ on the map)                         |
| **M** / Tab          | Full floor plan, per deck                                        |
| **+ / −** / wheel    | Minimap zoom                                                     |
| **O** / ⚙            | Besturing menu: steering, plus the graphics switches             |
| **I**                | Performance panel: frame times, 1% lows, what a frame is made of |
| **K**                | Instant Kruidvat route (cinematic auto-walk)                     |
| **V**                | Guest view (ride along as a shopper)                             |
| **J**                | Provoke the atrium monkey (it throws shit)                       |
| **B**                | Bewoners-dashboard — everyone live, 👁 = follow                   |
| **Esc**              | Free the mouse, then cancel route                                |

The minimap is player-centred and rotates with your heading (what you face is
up), with a north marker, the yellow route, escalators, landmarks and live
shopper blips.

## Landmarks

| Where                    | What                                                  |
| ------------------------ | ----------------------------------------------------- |
| Atrium fountain (0, 0)   | Marble Greek god, beamed by the UFO overhead          |
| Atrium void, floor 1     | The saucer hovers in the hole — nothing clips         |
| West wing, floor 0 (−28) | **Fashion Week catwalk** — models, spotlight, flashes |
| Atrium palms             | The monkey. Press **J** if you enjoy consequences     |

## Deploy

Pushing to `master` builds and publishes to GitHub Pages via
`.github/workflows/deploy.yml`. One-time setup: **Settings → Pages → Build and
deployment → Source: GitHub Actions**. The build uses a relative `base`, so it
works from `kjanat.github.io/shoppingmall/` and from a domain root alike.

## Stack

- Bun + TypeScript (bundler, server and task runner — no Vite)
- Three.js
- GSAP (camera director)
- postprocessing (vignette, ACES, SMAA)

## Architecture

```
src/
  app/App.ts           # orchestration + loop
  scene/               # mall, lights, atmosphere
  path/                # A* + neon ribbon
  player/Controls.ts   # first-person walking, ramps, control schemes
  physics/Collision.ts # AABB world + walkable inclines
  camera/Director.ts   # intro / tour / arrive (cinematics only)
  ui/KioskOverlay.ts   # NL kiosk chrome + rotating minimap + floor plan
  ui/SettingsPanel.ts  # besturing: mouse / no-mouse / left-handed
  data/                # stores + waypoint graph
  post/Composer.ts
```

## Build

```bash
bun run build      # typecheck -> world + light checks -> dist/static + dist/mall
bun run check      # world & light invariants, no browser needed
bun run diagnose   # what a frame is made of (needs a build first)
```
