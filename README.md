# MallOS — 3D Shopping Mall Wayfinding

Night-neon **Three.js** kiosk experience: cinematic route from the directory to **Kruidvat** (and every other store).

## Working on this (people and agents alike)

Two house rules that exist because breaking them cost real time:

1. **Judgement calls get feature-gated, not decided behind my back.** Anything that trades looks against speed — light
   count, material model, ambient level, resolution scaling — ships as *all* the options behind a switch, with a "try
   them and tell me which you like". Never one taste baked into the source. Runtime knobs live in `⚙ Besturing`
   (`src/render/graphicsPrefs.ts`); anything baked into shaders reloads the page when you change it, because that is
   the only moment it can be chosen. For code that should not ship at all, use Bun's build-time flags:
   `import { feature } from 'bun:bundle'` + `bun build --feature FLAG`, which drops the dead branch entirely.
2. **Edit files with an editor, not a shell heredoc.** A scripted rewrite shows no live diff, and a replacement that
   silently fails to match ships broken code — it already shipped a panel that threw on boot that way.

The full version of both, plus the type-safety and invariants rules, is in `AGENTS.md`.

## Run

```bash
bun install
bun run dev
```

Serves on `http://localhost:5174` (`PORT` overrides). Bun, not npm — there is no Vite here.

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
