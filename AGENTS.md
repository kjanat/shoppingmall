# AGENTS.md

Mall Sim — a first-person Three.js shopping mall (Prairie Lakes / Kruidvat) served by a Bun server that also hosts a
small `/api` for the DJ booth and the voices.

## Commands

Bun, not npm. There is no Vite in this project.

| Command            | What it does                                                              |
| ------------------ | ------------------------------------------------------------------------- |
| `runner install`   | installs deps for current toolchain                                       |
| `run dev`          | `bun --hot server/main.ts` on port 5174 (`PORT` overrides)                |
| `run build`        | typecheck → world check → `build.ts` → `dist/static` + `dist/mall` binary |
| `run build:static` | same, Pages target (no `/api`)                                            |
| `run typecheck`    | `tsc --noEmit`                                                            |
| `run lint`         | `biome check` (`bun run fmt` to fix + dprint)                             |
| `run check`        | `scripts/check-world.ts` — world invariants, no browser needed            |
| `run diagnose`     | what a frame is made of (see Performance)                                 |
| `run bench`        | frame-time benchmark with drift detection                                 |
| `run live`         | rebuild + swap the Docker container (compose, behind traefik)             |

Flags pass through the task runner: `bun run bench --samples 8` works.

**Do not start `run dev` to test a change unless asked.** Prefer `run check`, `run typecheck`, or a targeted script.

**`README.md` is stale.** It describes Vite, `npm install`, `npm run preview` and port 5173. None of that is true. Trust
`package.json`.

## Layout

```
src/
  app/App.ts           orchestration, the frame loop, ~2000 lines
  main.ts              boot; removes #app-loading after `await app.ready`
  scene/               37 files — the mall and everything living in it
  render/SceneBatcher  merges compatible meshes into BatchedMeshes
  physics/Collision.ts AABB world + walkable inclines
  player/Controls.ts   first-person walking
  camera/Director.ts   cinematics only
  data/                stores, waypoint graph, levels, inventory
  post/Composer.ts     bloom, vignette, ACES, SMAA
  ui/                  kiosk chrome, minimap, floor plan, settings
server/                main.ts (serves the game + routes) and api.ts
scripts/perf/          benchmarking and diagnostics (see below)
```

Aliases: `@/` → `src/`, `$/` → repo root. Import with explicit `.ts` extensions.

## Conventions

- Tabs. dprint + Biome, `lineWidth` 130. Run `bun run fmt`.
- `strict`, plus `noUncheckedIndexedAccess`, `noUnusedLocals`, `noPropertyAccessFromIndexSignature`. Index signatures
  need bracket access (`process.env['PORT']`).
- **No `any`, no `!`, no `as Type`.** Parse untyped input at the boundary into typed structures instead — see
  `scripts/perf/cdp.ts` for the pattern (`isRecord`, `readNumber`, `in`-narrowing).
- **Never suppress a lint or type error.** No `@ts-ignore`, no `biome-ignore`. Fix the cause.
- Comments explain *why*, and often name the bug that motivated the code. Match that. Dutch and English both appear;
  follow whichever the file already uses.
- **Never duplicate a constant across two files.** `bun run check` exists because that kept happening, and it reads
  values back out of the source rather than restating them.

## World invariants

`scripts/check-world.ts` runs on every build. It boots the collision world and the two shop builders headlessly (with a
canvas stub) and asserts things like: ramps line up with the floor holes cut for them, the ladder is actually climbable
step by step, swimmers are inside the waterline, every shop has inventory. If you move geometry and it fails, the world
is wrong — not the check.

## Performance

The scene is **GPU-bound, and it is almost entirely the main scene pass.**

Authoritative measurement — **a snapshot, and only comparable against another snapshot that names its build:**

|          |                                                                                                |
| -------- | ---------------------------------------------------------------------------------------------- |
| target   | `https://kruidvat.kajkowalski.nl/`                                                             |
| build    | `b54404dd0819b6256b8aae5ae7a7ffb1f741a767` ("Install hooks from bun, mark scripts executable") |
| contains | `e03b7e2` — the shader-warmup / `checkShaderErrors` / `SceneBatcher` fixes                     |
| taken    | 2026-08-03 ~15:45 WEST                                                                         |
| hardware | GTX 1650 Max-Q, 1600×900 / 1.44 Mpix, DPR 1                                                    |
| command  | `run diagnose --url https://kruidvat.kajkowalski.nl/`                                          |

The deployed build identifies itself at `/api/healthz` (`{ok, uptime, version}`), and `run diagnose --url` now reads it
and prints the commit automatically. **Never record a perf number without the build it came from** — an unattributed
snapshot cannot be compared against anything later, which is the only thing a snapshot is for.

```
time to playable   52.2 s (+7.5 s to settle)
wall time          62.1 ms median, 78.4 mean, 91 p90   → 16.1 fps
GPU time           63.97 ms  (82% of the frame)
draw calls         269
texture uploads    51.8/frame, 392.6 KB
programs linked    105
shader source      7842 KB total, largest 125.7 KB
lights in shader   72 point, 2 directional, 1 spot
```

| Pass                 | GPU ms/frame | share |
| -------------------- | ------------ | ----- |
| main scene @1600×900 | 62.57        | 97.8% |
| all postprocessing   | ~1.20        | 1.9%  |
| shadow map @1024²    | 0.20         | 0.3%  |

**The shader-compile stall is fixed and verified in production.** `getProgramInfoLog` / `getShaderInfoLog` are called
**zero** times on the deployed build (`diagnose` warns whenever they are non-zero, and it stays silent). Those calls were
~66% of all CPU time in the original traces. Do not re-investigate this.

**`time to playable` is 52 s, and that is arguably worse than the framerate.** It is not the network — it is 105 programs
of up to 125.7 KB linking, which is downstream of the light count. Anything that reduces lights shortens load *and*
frame time together.

**Do not optimise shadows or postprocessing.** They are rounding errors. Two things dominate:

1. **72 point lights.** three.js pastes `NUM_POINT_LIGHTS` into the shader and `#pragma unroll_loop`s over it, so every
   fragment evaluates all 72. That is why the largest fragment shader is 125.7 KB and why cold load takes ~105 s (105
   programs to link). A light contributing zero still costs — there is no branch.
2. **~270 draw calls with no culling at all.** `SceneBatcher` sets `frustumCulled = false` and
   `perObjectFrustumCulled = false` on all 141 batches; `cullByLevel` only hides label sprites. There is no LOD, no zone
   or portal culling, and no dynamic resolution. Standing in the garage still renders the roof.

### Traps

- **`NUM_POINT_LIGHTS` is part of the program cache key.** Changing the number of *visible* lights relinks every
  material in the mall, mid-frame. `Disco` (13 lights) and `AlienProbe` (1, on a 40–90 s timer) both do this by toggling
  group visibility. `App.warmup()` pre-compiles the probe variant so its first appearance is a cache hit. Any future
  zone-culling needs a fixed light count first, or every doorway will stutter.
- **`renderer.debug.checkShaderErrors` is on in dev and off in production** (`App.ts`, gated on `import.meta.hot`). Each
  call is a blocking CPU↔GPU sync and they were once ~66% of all CPU time. **Never benchmark the dev server** — it
  measures a configuration nobody ships.
- Shaders link lazily on first *render*, not on material creation. `App.start()` calls `compileAsync` behind the loading
  screen; `main.ts` holds `#app-loading` until `await app.ready`.
- `window.mallsim` is set in App's constructor **before** the frame loop starts, and is tree-shaken out of production.
  It is not a ready signal — `#app-loading` disappearing is.

### Tooling

```bash
run build          # required first: the scripts serve dist/static
run diagnose       # GPU, shaders, light counts, per-pass GPU time
run diagnose --sweep                 # + solves `fixed ms + ms/Mpix` with an A-B-A control
run diagnose --url https://kruidvat.kajkowalski.nl/   # measure the deployed build
run bench --save before
run bench --compare before
```

`scripts/perf/` drives a real GPU-backed Chrome over a hand-rolled CDP client (no Playwright — this repo has six
dependencies and intends to keep it that way). `probe.ts` is injected before page scripts and wraps the WebGL context.

**Read the measurement rules before trusting any number:**

- A benchmark on a thermally-constrained laptop is worthless. Four samples of *identical* configuration once walked
  38.8 → 65.5 → 87.6 → 106.4 ms, and a conclusion drawn from it was wrong. `bench` fits the trend across samples and
  prints `✗ DRIFTING` instead of a result; believe it.
- Always A-B-A. A change is only real if returning to the baseline reproduces the baseline.
- `drawCoverage` below 1.0 means the probe did not time the whole frame — discard the sample.
- A whole-frame `TIME_ELAPSED_EXT` query measures elapsed GPU time *including idle*, so it reports ~100% busy no matter
  what. Only per-pass queries summed together are real GPU work.
- Chrome may sit on the integrated GPU on a laptop even with `powerPreference: 'high-performance'`. `diagnose` warns.
  Windows: Settings → Display → Graphics → Chrome → High performance.

`.perf/` is gitignored and holds saved baselines plus a reused Chrome profile (its shader cache is what keeps repeat
runs from paying the ~105 s cold link).

### Known unknowns — do not re-derive these

Written down because each one cost real time and produced a confident wrong answer:

- **Whether frustum culling helps is UNKNOWN.** An A/B of `perObjectFrustumCulled` and `frustumCulled` appeared to show
  culling made things 1.7× worse. It was drift: the control — the *original* config, re-measured — came back 106.4 ms
  against its own earlier 38.8 ms. All four samples were invalid. The question is still open and needs a stable machine.
- **The "RTX 4090 at 30 FPS / 30% GPU" figure is stale.** It predates the shader-stall fix and includes those stalls.
  Do not reason from it. Re-trace before treating it as the target.
- **Batches are not all mall-wide.** Median batch bounding radius is 6.7 m; 22 of 141 exceed 40 m and 53 exceed 20 m. The
  mall-spanning ones are the shared-material batches (floors, walls). Spatial partitioning is therefore a narrower fix
  than "every batch spans the building" would suggest.
- **A thermally- or memory-constrained laptop cannot benchmark this.** Measured drift was ~23 ms per successive sample,
  and `bench` reported `+36.4% per sample ✗ DRIFTING`. Cross-run comparisons on such a machine are noise, including
  comparisons against numbers elsewhere in this file that were taken locally.

### Planned: fixed light pool

The intended fix for both dominant costs. Not implemented.

The problem is not only that 72 point lights are expensive per fragment; it is that the *count* is baked into the
program cache key, so it can never be varied at runtime without relinking every material. That single fact blocks zone
culling, interior culling and any "lights off in rooms you cannot see" scheme.

The shape:

- A `LightPool` owns a **fixed** number of real `THREE.PointLight`s (start at 8), added to the scene once and never
  hidden. `NUM_POINT_LIGHTS` becomes constant for the whole session → one program set, no relinks, ever.
- Features stop creating lights. They register a *virtual* light — a description (position, colour, intensity, distance,
  decay) that is not a scene light — and get back a mutable handle they animate as they do now.
- Each frame the pool scores the virtual lights against the camera and copies the best N into the real slots.
- **An unused slot is not free.** The unrolled loop runs `getPointLightInfo` + `RE_Direct` per fragment regardless of
  intensity; `light.visible` gates the contribution, not the maths. Size the pool as small as the look tolerates.
- The scoring function is the real design decision (nearest? brightest contribution? on the player's deck? hysteresis so
  a light does not flicker between slots?) and is a judgement call about how the mall should look.
- Migrate incrementally: land the pool with zero registrations (no behaviour change), then convert one scene file at a
  time. Each conversion is independently shippable and drops the count.
- Once done, `Disco` and `AlienProbe` stop toggling group visibility and just move handle intensities — which makes
  `App.warmup()`'s probe-variant pre-compile unnecessary, and it can be deleted.

Expected win: cutting visible point lights 71 → 6 measured **2.0–2.6× the frame rate**, reproduced in both directions
across several independent runs (the one light finding that survived the drift, because it was A-B-A-B).

## Deploy

- Push to `master` → GitHub Pages via `.github/workflows/deploy.yml` (static, no `/api`).
- The live site is the compiled `dist/mall` binary in Docker; `make live` rebuilds and swaps it.
