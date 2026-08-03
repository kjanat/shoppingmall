# AGENTS.md

Mall Sim — a first-person Three.js shopping mall (Prairie Lakes / Kruidvat) served by a Bun server that also hosts a
small `/api` for the DJ booth and the voices.

## Commands

Bun, not npm. There is no Vite in this project.

| Command            | What it does                                                                       |
| ------------------ | ---------------------------------------------------------------------------------- |
| `runner install`   | installs deps for current toolchain                                                |
| `run dev`          | `bun --hot server/main.ts` on port 5174 (`PORT` overrides)                         |
| `run build`        | typecheck → world + light checks → `build.ts` → `dist/static` + `dist/mall` binary |
| `run build:static` | same, Pages target (no `/api`)                                                     |
| `run typecheck`    | `tsc --noEmit`                                                                     |
| `run lint`         | `biome check` (`bun run fmt` to fix + dprint)                                      |
| `run check`        | `check-world.ts` + `check-lights.ts` — world & light invariants, no browser needed |
| `run diagnose`     | what a frame is made of (see Performance)                                          |
| `run bench`        | frame-time benchmark with drift detection                                          |
| `run live`         | rebuild + swap the Docker container (compose, behind traefik)                      |

Flags pass through the task runner: `bun run bench --samples 8` works.

**Do not start `run dev` to test a change unless asked.** Prefer `run check`, `run typecheck`, or a targeted script.

**`README.md` is stale.** It describes Vite, `npm install`, `npm run preview` and port 5173. None of that is true. Trust
`package.json`.

## Layout

```
src/
  app/App.ts           orchestration, the frame loop, ~2200 lines
  main.ts              boot; removes #app-loading after `await app.ready`
  scene/               the mall and everything living in it (plus city/ outside)
  render/SceneBatcher  merges compatible meshes into BatchedMeshes
  render/LightPool     the only real point lights (LIGHT_POOL_SLOTS); ~85 virtual lights rent slots
  physics/Collision.ts AABB world + walkable inclines
  player/Controls.ts   first-person walking
  camera/Director.ts   cinematics only
  data/                stores, waypoint graph, levels, inventory
  post/Composer.ts     bloom, vignette, ACES, SMAA
  ui/                  kiosk chrome, minimap, floor plan, settings
server/                main.ts (serves the game + routes) and api.ts
scripts/perf/          benchmarking and diagnostics (see below)
scripts/stub-dom.ts    canvas/audio stubs shared by the headless checks
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
- **Use the Edit tool for file changes, never a shell heredoc.** A scripted rewrite does not show up as a live diff, so
  nobody sees the change while it happens. A silently non-matching replacement already shipped a panel that threw on
  boot because half of a two-part edit applied.
- **In markdown, link files instead of backticking them.** Usually the file or symbol name is the clearest label:
  [LightPool](src/render/LightPool.ts). Use prose only where it genuinely reads better. Repeating the full path as the
  label is noise. Backticks stay for code, identifiers and commands.
- **No em dashes in prose, and no "X, not Y" constructions.** Write the plain sentence.

## Feature-gate judgement calls

Anything trading looks against speed (light count, material model, ambient level, resolution scaling): build every
option behind a switch, ship it, say "I built all three, try them". Do not pick one silently and do not debate it.

- **Runtime setting** ([SettingsPanel](src/ui/SettingsPanel.ts) plus [graphicsPrefs](src/render/graphicsPrefs.ts))
  when the options need comparing live. Shader-baked options (light count, material model) reload the page on change,
  since that is when they are chosen.
- **Bun build-time flag** when the code should not ship: `import { feature } from 'bun:bundle'`, guard with
  `if (feature('FLAG'))`, build with `--feature FLAG` (or `features: [...]` in [build.ts](build.ts)). String literals
  only.
  Declare flags in a `.d.ts` (`declare module 'bun:bundle' { interface Registry { features: 'A' | 'B' } }`) so typos
  are type errors.

## World invariants

[check-world](scripts/check-world.ts) and [check-lights](scripts/check-lights.ts) run on every build (headless, with the canvas and audio stubs from
[stub-dom](scripts/stub-dom.ts)). check-world boots the collision world and the two shop builders and asserts things like: ramps line
up with the floor holes cut for them, the ladder is actually climbable step by step, swimmers are inside the waterline,
every shop has inventory. check-lights boots every light-owning feature against one `LightPool` and asserts the scene
holds exactly `LIGHT_POOL_SLOTS` real `PointLight`s — including while the disco and the alien probe toggle — and greps
`src/` so a `new PointLight` (or a named `PointLight` import) anywhere outside the pool fails the build. If you move
geometry or add a light and a check fails, the world is wrong — not the check.

## Performance

The scene is **GPU-bound, and it is almost entirely the main scene pass.**

Last authoritative measurement — **a snapshot, and only comparable against another snapshot that names its build.** It
predates the light pool / Lambert / culling / dynamic-resolution branch below, so it is the *before* picture:

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

**Do not optimise shadows or postprocessing.** They are rounding errors. In the snapshot above two things dominated —
72 point lights unrolled into every fragment (`NUM_POINT_LIGHTS` is pasted into the shader and `#pragma unroll_loop`ed;
a light contributing zero still costs, there is no branch), and ~270 draw calls with no culling. Both were attacked in
one branch, **which has not been measured yet** — the next `run diagnose --url` against a deploy of it is the missing
snapshot, and until it exists every number above is the *old* build:

1. **The fixed [light pool](src/render/LightPool.ts) shipped.** Exactly `LIGHT_POOL_SLOTS` (16) real `PointLight`s exist for the whole
   session; every feature registers a *virtual* light and animates the returned handle. `NUM_POINT_LIGHTS` can no
   longer change, so there is one program set, no mid-session relinks, and `App.warmup()` is a single compile pass.
   The 52 s time-to-playable was 105 programs linking, which this removes the cause of. Scoring (decided, do not
   re-litigate without a measurement): `intensity × dim² × priority × (1 − d/distance)`, an incumbent keeps its slot
   until beaten by 30%, slots fade at 10/s except `snap` lights (muzzle flashes, sale flashes) which write through.
   The five 32–50 m washes in [Lighting](src/scene/Lighting.ts) carry `priority: 2` so nearby 6 m shop lamps
   cannot starve the building.
2. **Every scene material is `MeshLambertMaterial` now.** Nothing used a PBR feature (no env/normal/ao maps, no
   `scene.environment` — high metalness already rendered black), and the physical lights chunk is 22 KB against
   Lambert's 1 KB, multiplied by the unrolled light loop. Specular is gone; looks that depended on metalness darkening
   encode it in the base colour instead (see the disco balls).
3. **Whole-batch frustum culling is on** (`SceneBatcher`): one sphere test per batch. `setMatrixAt` never invalidates
   the lazily-computed sphere, so when a source moves the sphere is *grown* over the mover (`growBounds`) — monotonic,
   never under-covers. `perObjectFrustumCulled` stays off; its per-instance walk is the cost the file comment
   describes. Batch count also dropped: an emissive whose quantized intensity rounds to zero no longer splits a batch
   (StockDisplay's 66 invisible product tints were 71 of the 141 batches); visible emissives keep their exact colour.
4. **Dynamic resolution shipped, default on** (`mallsim.dynres.v1`, toggle in the settings panel). Fixed steps 1 →
   0.5, driven by an EMA of the *unclamped* rAF interval; down after 0.5 s above 24 ms, up after 2 s under measured
   vsync × 1.12, 1 s cooldown. The canvas CSS (100%) upscales the smaller buffer.

Still true: no LOD, no zone/portal culling, `cullByLevel` only hides label sprites, and standing in the garage still
renders the roof when it is on-screen.

### Traps

- **`NUM_POINT_LIGHTS` is part of the program cache key.** Changing the number of *visible* lights relinks every
  material in the mall, mid-frame. The `LightPool` exists to make that impossible: never construct a raw
  `THREE.PointLight` (register a virtual light instead — `check:lights` fails the build otherwise), and never set a
  pool light `visible = false` — an invisible light is not counted by the renderer, so hiding one changes
  `NUM_POINT_LIGHTS` and triggers exactly the relink storm the pool kills. Unused slots sit at `intensity 0`.
- **The disco dims through `DaylightDimmer` + `pool.setDimFactor`, not a traverse.** A real light added outside
  [Lighting](src/scene/Lighting.ts) must be `register()`ed with the dimmer or it will blast through the party at full power (the catwalk
  spot did). The Catwalk `SpotLight` count is likewise baked into programs (`NUM_SPOT_LIGHTS`); there is exactly one
  and nothing enforces that, so do not add a second casually.
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
run diagnose:headless                # no-GPU containers (remote agent envs, CI) — see below
```

`scripts/perf/` drives a real GPU-backed Chrome over a hand-rolled CDP client (no Playwright — this repo has six
dependencies and intends to keep it that way). `probe.ts` is injected before page scripts and wraps the WebGL context.

**No-GPU containers** (remote agent environments, CI): `run diagnose:headless` / `run bench:headless` route Chrome
through [chrome-headless.sh](scripts/perf/chrome-headless.sh): headless SwiftShader, no sandbox, finds the
Playwright-managed Chromium.
The *structural* numbers are exact there (lights in shader, programs linked, shader source KB, draw calls); every
millisecond is the CPU rasterizer and is only comparable against the same rasterizer in the same container — never
against a GPU snapshot, and never worth recording in this file.

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
- **Dynamic resolution is disabled under `?perf-probe` but live in a normal browser tab.** Measuring the shipped build
  without the probe means the renderer may quietly lower its own pixel count mid-run — turn the setting off (⚙) or use
  the perf scripts, or an A-B-A will look stable while the resolution moves underneath it.

`.perf/` is gitignored and holds saved baselines plus a reused Chrome profile (its shader cache is what keeps repeat
runs from paying the ~105 s cold link).

### Known unknowns — do not re-derive these

Written down because each one cost real time and produced a confident wrong answer:

- **How much whole-batch frustum culling wins is UNKNOWN — it shipped unmeasured.** An early A/B appeared to show
  culling made things 1.7× worse; it was drift (the control re-measured 106.4 ms against its own earlier 38.8 ms — all
  four samples invalid). Headless sphere-vs-frustum modelling said 13–81% of draw calls cull depending on viewpoint,
  but the scene is ~98% fill-bound, so expect a modest win at best; the A-B-A on a stable machine is still owed.
  `perObjectFrustumCulled` (a different mechanism with a real per-frame CPU cost) remains off and untested.
- **The "RTX 4090 at 30 FPS / 30% GPU" figure is stale.** It predates the shader-stall fix and includes those stalls.
  Do not reason from it. Re-trace before treating it as the target.
- **Batches are not all mall-wide.** Pre-branch: median batch bounding radius 6.7 m; 22 of 141 exceeded 40 m and 53
  exceeded 20 m — the mall-spanning ones are the shared-material batches (floors, walls), and they are also the ones
  whose spheres now grow over every animated limb they contain. Spatial partitioning is therefore a narrower fix than
  "every batch spans the building" would suggest. The 141 itself is stale since the emissive-key change merged the
  per-product batches; re-derive before leaning on any of these numbers.
- **A thermally- or memory-constrained laptop cannot benchmark this.** Measured drift was ~23 ms per successive sample,
  and `bench` reported `+36.4% per sample ✗ DRIFTING`. Cross-run comparisons on such a machine are noise, including
  comparisons against numbers elsewhere in this file that were taken locally.

### The fixed light pool (implemented)

[LightPool](src/render/LightPool.ts). The problem was never only that 72 point lights are expensive per fragment; the *count* is
baked into the program cache key, so it could not vary at runtime without relinking every material. That fact blocked
zone culling, interior culling and any "lights off in rooms you cannot see" scheme. It no longer does: the count is
`LIGHT_POOL_SLOTS` (8) for the whole session, `check:lights` enforces it, and any future zone-culling can now hide
whole rooms without a doorway stutter.

What the plan called judgement calls, and how they were decided:

- **Scoring**: `intensity × dimFactor² × priority × max(0, 1 − d/distance)`, incumbent keeps its slot until beaten by
  30% (`HYSTERESIS`), slot intensity eases at 10/s. The dim factor appears *squared* in the rank on purpose: linear,
  the priority-2 washes at 15% still outbid the disco lights and held half the pool during the party.
- **`snap` lights** (muzzle flash, sale flash) bypass the fade — eased, a three-frame flash peaked at half value,
  a frame late.
- **`follow` mode** derives the light's world position from an `Object3D`'s `matrixWorld` each frame (elevator cabin,
  saucer, buggy, guns, per-shop groups). `pool.update(camera)` runs after `sceneBatcher.update()` because that is what
  refreshes the world matrices — that ordering is load-bearing.
- **Migration landed in one commit**, not incrementally as planned — all 85 former `PointLight`s across 16 scene files.
- **An unused slot is still not free.** The unrolled loop runs per fragment regardless of intensity. 8 is a choice,
  not a law; from the far west end only 2 slots have anything in range, so there is room to size down if the look
  tolerates it.

Expected win, still to be confirmed by a post-deploy snapshot: cutting visible point lights 71 → 6 measured
**2.0–2.6× the frame rate** (A-B-A-B, the one light finding that survived the drift), and the cold load loses the
cause of its 105-program link storm.

## Deploy

- Push to `master` → GitHub Pages via `.github/workflows/deploy.yml` (static, no `/api`).
- The live site is the compiled `dist/mall` binary in Docker; `make live` rebuilds and swaps it.
