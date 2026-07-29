# MallOS — 3D Shopping Mall Wayfinding

Night-neon **Three.js** kiosk experience: cinematic route from the directory to **Kruidvat** (and every other store).

## Run

```bash
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`).

## Controls

| Input               | Action                             |
| ------------------- | ---------------------------------- |
| **Naar Kruidvat**   | Hero CTA — full tour via escalator |
| Store list / search | Select shop, preview neon path     |
| **Start route**     | Camera fly-through                 |
| Drag / scroll       | Orbit & zoom (idle / arrived)      |
| **K**               | Instant Kruidvat route             |
| **Esc**             | Cancel route, back to idle         |

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
  camera/Director.ts   # idle / tour / arrive
  ui/KioskOverlay.ts   # NL kiosk chrome
  data/                # stores + waypoint graph
  post/Composer.ts
```

## Build

```bash
npm run build
npm run preview
```
