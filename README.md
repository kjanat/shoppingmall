# MallOS — 3D Shopping Mall Wayfinding

Night-neon **Three.js** kiosk experience: cinematic route from the directory to **Kruidvat** (and every other store).

## Run

```bash
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`).

## Controls

First person, no orbit rig: yaw/pitch are the only camera state, so the view
always sits behind your eyes and never drifts toward the middle of the mall.

| Input                | Action                                               |
| -------------------- | ---------------------------------------------------- |
| **Click the view**   | Capture the mouse (Esc frees it, route stays)        |
| **W A S D** / arrows | Walk (A/D strafe, or turn — see ⚙ Besturing)         |
| **Shift**            | Sprint                                               |
| **Space**            | Jump                                                 |
| **Q / E**            | Turn — always works, mouse or not                    |
| **R / F**            | Look up / down without a mouse                       |
| Escalator / stairs   | Walkable ramps to floor 1 (⇅ on the map)             |
| **M** / Tab          | Full floor plan, per deck                            |
| **+ / −** / wheel    | Minimap zoom                                         |
| **O** / ⚙            | Besturing menu: mouse-look off, tank steering, lefty |
| **K**                | Instant Kruidvat route (cinematic auto-walk)         |
| **V**                | Guest view (ride along as a shopper)                 |
| **J**                | Provoke the atrium monkey (it throws shit)           |
| **B**                | Bewoners-dashboard — everyone live, 👁 = follow       |
| **Esc**              | Free the mouse, then cancel route                    |

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

- Vite + TypeScript
- Three.js
- GSAP (camera director)
- postprocessing (bloom, vignette, ACES, SMAA)

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
npm run build
npm run preview
```
