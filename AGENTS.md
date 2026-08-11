# AGENTS.md

Mall Sim — a first-person Three.js shopping mall (Prairie Lakes / Kruidvat) served by a Bun server that also hosts a
small `/api` for the DJ booth and the voices.

## Commands

Bun, not npm. There is no Vite in this project.

| Command            | What it does                                                                                 |
| ------------------ | -------------------------------------------------------------------------------------------- |
| `runner install`   | installs deps for current toolchain                                                          |
| `run dev`          | `bun --hot server/main.ts` on port 5174 (`PORT` overrides)                                   |
| `run build`        | typecheck → world + light checks → `build.ts` → `dist/static` + `dist/mall` binary           |
| `run build:static` | same, Pages target (no `/api`)                                                               |
| `run typecheck`    | `tsc --noEmit`                                                                               |
| `run lint`         | `biome check` (`bun run fmt` to fix + dprint)                                                |
| `run check`        | world, spatial, math, persist, light, prop, and profiler-route invariants; no browser needed |
| `run diagnose`     | what a frame is made of (see Performance)                                                    |
| `run bench`        | frame-time benchmark with drift detection                                                    |
| `run profile`      | traverse the named mall route and compare every segment                                      |
| `run live`         | rebuild + swap the Docker container (compose, behind traefik)                                |

Flags pass through the task runner: `bun run bench --samples 8` works.

**Do not start `run dev` to test a change unless asked.** Prefer `run check`, `run typecheck`, or a targeted script.

**`README.md` is stale.** It describes Vite, `npm install`, `npm run preview` and port 5173. None of that is true. Trust
`package.json`.

## Layout

```
src/
  app/App.ts             orchestration, the frame loop, ~2200 lines
  app/GamePersist.ts     the session boundary; everything read back out of it is parsed
  main.ts                boot; removes #app-loading after `await app.ready`
  scene/                 the mall and everything living in it (plus city/ outside)
  scene/SlideRide.ts     the roof slide read out of its own conveyor emitters
  scene/Motorcycles.ts   the parked and rideable bikes, from one spot list
  scene/city/Barriers.ts both booms, their gate colliders and their access policy
  render/SceneBatcher    merges compatible meshes into BatchedMeshes
  render/LightPool       the only real point lights (LIGHT_POOL_SLOTS); ~85 virtual lights rent slots
  render/sceneOwner.ts   the highest named ancestor of an object, for per-owner cull tallies
  physics/Collision.ts   AABB world + walkable inclines
  physics/VehicleGround  the ballistic vertical step both player vehicles share
  player/Controls.ts     first-person walking and crouching
  camera/Director.ts     cinematics only
  data/                  stores, waypoint graph, levels, inventory
  post/Composer.ts       bloom, vignette, ACES, SMAA
  ui/                    kiosk chrome, minimap, floor plan, settings
  util/values.ts         the one set of boundary parsers (isRecord, readNumber, …)
server/                  main.ts (serves the game + routes) and api.ts
scripts/perf/            benchmarking and diagnostics (see below)
scripts/stub-dom.ts      canvas, audio and sessionStorage stubs shared by the headless checks
```

Aliases: `#/` → `src/`, `$/` → repo root. Import with explicit `.ts` extensions.

## Conventions

- Tabs. dprint + Biome, `lineWidth` 130. Run `bun run fmt`.
- `strict`, plus `noUncheckedIndexedAccess`, `noUnusedLocals`, `noPropertyAccessFromIndexSignature`. Index signatures
  need bracket access (`process.env['PORT']`).
- **No `any`, no `!`, no `as Type`.** Parse untyped input at the boundary into typed structures instead. The parsers
  live in [values](src/util/values.ts) (`isRecord`, `readNumber`, `finiteNumber`, `in`-narrowing) and both the perf
  scripts and [GamePersist](src/app/GamePersist.ts) read through them. A version stamp on a saved session keeps old
  sessions out and says nothing about the *shape* of what is stored, so parse it anyway.
- **Never suppress a lint or type error.** No `@ts-ignore`, no `biome-ignore`. Fix the cause.
- Comments explain *why*, and often name the bug that motivated the code. Match that. Dutch and English both appear;
  follow whichever the file already uses.
- **Never duplicate a constant across two files.** `bun run check` exists because that kept happening, and it reads
  values back out of the source rather than restating them.
- **Investigate remarkable results before naming a cause.** When a measurement is surprising, contradictory, unstable,
  or otherwise remarkable, follow it up with targeted checks. Keep observations, hypotheses, and confirmed causes
  explicitly separate. If the available evidence cannot distinguish the plausible explanations, report the cause as
  unknown and state what evidence would resolve it. Never present an untested hypothesis as fact.
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
- **Bun build-time flag** when the code should not ship. Declared in [bun-features.d.ts](src/bun-features.d.ts), passed
  by [build.ts](build.ts): `bun build.ts --feature NO_PERF_HUD,FORCE_LAMBERT` (or `MALL_FEATURES=…`). Three things
  bite. `feature()` may only be the
  condition of an `if` or a ternary, never assigned or passed. An unset flag is `false` and the dev server passes none,
  so name flags for what they remove. And a static import keeps its module alive even when every reference sits in dead
  code: the perf HUD only actually left the bundle (23 KB) once its import became `import('#/ui/PerfOverlay')` inside
  the guard.

## World invariants

[check-world](scripts/check-world.ts), [check-lights](scripts/check-lights.ts), [check-props](scripts/check-props.ts), the
session-boundary tests in [persist](scripts/persist.test.ts), and the profiler-route tests run on every build (headless,
with the canvas, audio and storage stubs from
[stub-dom](scripts/stub-dom.ts)). check-world boots the collision world and the two shop builders and asserts things like: ramps line
up with the floor holes cut for them, the ladder is actually climbable step by step, swimmers are inside the waterline,
every shop has inventory. check-lights boots every light-owning feature against one `LightPool` and asserts the scene
holds exactly `LIGHT_POOL_SLOTS` real `PointLight`s, including while the disco and the alien probe toggle, and greps
`src/` so a `new PointLight` (or a named `PointLight` import) anywhere outside the pool fails the build. check-props
boots the statically placed casts (PoolPeople, TravelAgency, DJBartek) and asserts none of them stands inside a
`blocksMovement` volume it does not own; the AL ZUT figure waist-deep in the tiki-bar counter is the bug it exists for.
If you move geometry or add a light and a check fails, the world is wrong. The check is right.

`zonegraaf`, `zonecull` and `zichtlijn` guard the zone graph, the culler built on it, and the sight lines it shares
with the guards. The first asserts every zone is reachable through portals, that every entity declaring free space or
glass either joins two zones or carries `NOT_A_PORTAL_TAG`, and that a tag on something which does join two zones fails
the way an unused permit does; it also names the three cases the whole scheme rests on, the two-storey entrance glazing
reaching the street from both shop decks, the atrium running as one shaft from V0 to the skylight, and the exit ramp
opening the street onto P1 and onto nothing else, because on V0 that same coarse clearance box crosses a wall that is
shut.

`zonecull` runs the culler itself against a camera at four poses. With the building behind you no deck is visible and a
sphere in the middle of V0 is rejected; facing the doors V0 is visible and a sphere just inside them is kept; standing
deep on V0 with the entrance behind you the street is not visible, which is the arm that catches an aperture behind the
camera degenerating into the whole frustum; and whatever you look at, your own zone is never culled. It also asserts
that every world volume belonging to exactly one zone fits inside the box `seesZone` tests that zone with, so a box
drawn too tight cannot quietly freeze a deck you are standing on.

`zichtlijn` walks the sight lines. Three open-point rays: through the closed west facade, which must not get through;
through the doorway in that same facade, which must; and across the atrium at balcony height, which must, because the
barrier there is a box for walking bodies and reading it as a wall puts a wall through the middle of the building.
Three more for what an open-point ray cannot see. It marches 400 bullets at the fastest muzzle speed and the slowest
frame into the west facade, where every step ends inside the masonry and none may come out the far side; it stands an
eye inside that same wall, which must still see out; and it drops a round through the V1 slab, which must stop on the
concrete and must not stop over the atrium void. Any collider that stops sight and is also `climbable` fails on sight.

The city is walked the same way. `stad` climbs the garage spiral and now steps off each landing onto the deck beside it:
the parapet ring used to run unbroken along that seam, so the climb ended at a one-metre wall and only a jump finished
it. Each landing cuts its own doorway out of that ring ([cityPlan](src/scene/city/cityPlan.ts) `deckDoorways`), widened
to `GARAGE_PLAN.parapet.doorway` where the shared edge is shorter than a body, and guards its own frontage where no deck
or ramp run carries it.

Three controls guard the main entrance, because a portal is one set of numbers cutting the wall spec, the collision
boxes and the entity volumes at once. `ingang` walks a pedestrian in off the street at x −50 through the doors to the
atrium in 5 cm steps, and walks two more the other way through the glass beside them, which must not get through. It
then checks what the walk cannot see, against the one outdoor viewpoint the project ships
([routes](scripts/perf/routes.ts) `v0-entrance-street`): the lettering sits above the sightline over the canopy's front
lip and in front of the facade seam behind it, each flag mast stands on ground at deck height and clear of the open exit
trench, and every canopy downlight sits in a bay between two ribs rather than inside one. `daklus` closes the loop the
roof jump opens: roof edge, over the side, street level below, and back in through the entrance to the atrium.
`gevel` reads a declared `protrusion` next to the `penetration` it already read: geometry that belongs outside the
facade, such as the canopy columns on the pavement and the exit ramp and its trench reaching 9.5 m past the west wall,
says so and by how many metres, and a declaration that reaches past nothing fails the build the way an unused exemption
row does. There is no entity-level exemption left. `validateSpatialWorld` reports the mirror case as
`unused-penetration`: a volume that declares metres into another placement class and then cuts into nothing.

`hurken` walks the same entrance line twice, standing and crouched, through a beam hung at exactly the crouching
profile's headroom in a collision world of its own. Standing has to stop at the beam and crouched has to reach the
atrium, which only holds while [character](src/data/character.ts) keeps `CROUCHING_PEDESTRIAN` below
`STANDING_PEDESTRIAN`. It then reads the query the other way round: every flight and the parking exit ramp must offer
the standing headroom over their whole run, because that headroom is now a condition for walking there at all and a
route that fails it puts the player on his knees on an escalator. A port that admits walking declares the `posture` it
is walked in, and `validateSpatialWorld` measures its clearance volume against that profile and reports
`insufficient-headroom`; a crouch-only duct asks for 1.5 m and the same duct declared standing fails.

`hellinglijn` walks every flight twice, once per query. `groundHeightAt` has to answer with the incline over the whole
run, and a roof pad lying across a flight is a failure rather than a warning, because that pad closes the stairwell and
you then walk over it. `snapFloorY` is the same question a sim asks, so it gets the same walk: mid-flight the flight
carries you, and below its foot the deck does. Which flight carries a body followed from two fixed storey bands with the
name of the secret stairs written into them, and a flight carries its `connector.id`, so `'secret_stairs'` matched
nothing: under that staircase a sim hung in the air on V0, and halfway up it snapped to the roof. Both bands are gone
and the answer comes from each flight's own two ends.

`luik` and `glijbaan` cover the two things the roof gained. `luik` reads the hatch over the secret stairs out of the
schema (every `automatic-gate` volume names a mechanism on its own entity that admits pedestrians, and the leaf covers
the whole opening) and then drives it: closed the deck is floor over the hole, a pedestrian walking up at `WALK_SPEED`
gets it open inside `openingSeconds`, it shuts behind him, and a body coming up the stairs from below opens it too.
`glijbaan` requires one conveyor emitter per travel surface of the tube, each carrying exactly `tube.speed`, accepts
boarding at the platform mouth and refuses it at the ladder top, then rides the whole thing frame by frame and demands
you are released inside the waterline over a pool floor.

`slagbomen`, `voertuigen`, `motorrit` and `geulverkeer` cover the vehicles. `slagbomen` validates `BARRIER_ENTITIES`,
checks each gate box spans from the barrier's own surface to above its hinge, and drives all three traffic classes at
every boom, expecting per class the answer the boom's own policy gives. It also refuses a permit nobody can present:
an admitted class has to be one that `src/` actually announces at a boom, and for `npc-traffic` an authored route
(`ROAD_RINGS` plus `EXIT_BRANCH_ROUTE`) has to enter that boom's approach strip. The city garage boom admitted
`npc-traffic` and no sim drives there, so it read exactly like a working gate and never opened; it admits the player's
vehicle now, which is what the ticket machine beside it is for. This is the same rule as `unused-penetration` and a
stale exemption row: a declaration matching nothing is a build failure. `voertuigen` measures ramp pitch up, down and
flat for every wheelbase in `DRIVEABLE_HANDLING`, and the fall off the garage spiral's top landing against real free
fall. `motorrit` boards the motorcycle, checks the body sits a half turn off the drive heading, drives a second of W and
requires the displacement to lie on its own forward axis, and compares it against the rental car property by property.
Property by property matters: two assertions each `||`-ing three conditions printed one fixed pair of numbers, so a
`boostSpeed` regression reported `accel`, and a zero lean printed "hangs to 0.55 rad and so does not lean further than
the car (0.12 rad)", a sentence its own numbers refute. `geulverkeer` runs the real `CityTraffic` twice for 120 s, over
an empty ramp and over an occupied one.

`theater` covers the second building. It walks a pedestrian in through the travee in 5 cm steps and two more at the
sidelights beside it, which must not get through; requires the shell closed everywhere except that one bay; puts every
seat on its own row's floor and out of the aisles; requires the portal to exist with both faces so the zone graph joins
`stad` to `theatre`; and requires the auditorium's own volumes to claim `theatre` alone. The aisles are
`aisle-clearance` volumes, and `validateSpatialWorld` treats reserved floor the same way whether it is a storefront
frontage or an aisle. `park` guards the two outdoor measuring poses in the city park, and now also the lawn itself: the
grass is the park lot inset by its verge, and it used to stand beside `CITY_KAVELS.park` as four hand-typed numbers with
the same centre and a rectangle eight metres smaller, with nothing comparing the two.

`wegen` reads the ring road's two lanes out of [cityPlan](src/scene/city/cityPlan.ts) and asserts they run in opposite
directions, that each edge's lane centre lies to the right of the roadway centreline (which is what keeping right on a
ring means), that `rotY` reproduces the heading, and that the corner tiles still exist. `kaartlabels` plans the labels
of every deck with the same code the kiosk draws with and fails on a name that fits nowhere, plus one viewpoint case:
the minimap must name the entrance in full from the pavement in front of it. Both read the plan through
`deckLabelPlan` / `minimapLabelPlan`, measured with [stub-dom](scripts/stub-dom.ts)'s text metric, which is wider per
glyph than a real monospace at the sizes the map uses, so what fits there fits in the browser.

Four of check-world's controls are source greps rather than world queries, and they share one loop over `src/` and
`scripts/` with comments, strings, templates and regexes blanked out. `rekenhulpen` fails a build that divides by two,
multiplies by a loose `0.5`, calls `MathUtils`, or clamps with a nested `Math.max`/`Math.min` instead of using
[math](src/util/math.ts). `kopieen` fails a build that defines a second copy of anything [src/util](src/util) already
exports, reading those names out of the source so a helper added tomorrow guards itself from its first line; it also
catches the three shapes that carry no name once written out, the jitter `(r - 0.5) * spread`, the plusMinus
`(r * 2 - 1) * extent`, and the ease factor `Math.min(1, rate * dt)`. `zoneklokken` runs over `src/` alone and fails a
visibility question whose whole argument is a text literal, which after blanking is a call with empty parentheses:
that is a simulation clock keyed to a deck somebody typed instead of to where its actors are standing. `spiegeltekst`
fails a texture on a double-sided plane, which reads mirrored from behind; use `backToBackLabel`. It matches the two
properties wherever they are written, in one material literal or assigned afterwards (`mat.map = tex` next to a
`side: THREE.DoubleSide` in the declaration, or a later `mat.side = THREE.DoubleSide`), because the rule is about the
material and not about the shape it was written in. All four carry a table of per-site exemptions where a row that no
longer matches anything is itself a build failure.

`validateSpatialWorld` in [spatial](src/data/spatial.ts) reports fourteen problem codes, and the ones added with the
work above are worth naming. `insufficient-headroom` is the posture case above. `unmeasurable-clearance` is a flight
whose fouling cannot be solved rather than guessed: a flight running diagonally in plan, or a hole in the deck over it
that is not an axis-aligned rectangle. `detached-backing` and `unused-standoff` are the two halves of a declared
`standoff`, a shop back panel standing free of the structure behind it and a declaration that keeps no gap.
`invalid-interaction` covers a mechanism with no valid moving geometry, one whose gate volume it does not control, and
one that admits no traffic class at all. A solid measured against a flight's clearance goes through
`flightClearanceVerdict`, and a cylinder now goes through it too, as the upright box over the cylinder: it used to fall
past to a bare `true`, and a flight's bounding box is far wider than the flight, so a bollard nine metres up a staircase
read as standing in it.

## Performance

The scene is **GPU-bound, and it is almost entirely the main scene pass.**

Last authoritative measurement. **A snapshot, and only comparable against another snapshot that names its build.** It
predates the light pool / Lambert / culling / dynamic-resolution branch below, so it is the *before* picture:

|          |                                                                                                |
| -------- | ---------------------------------------------------------------------------------------------- |
| target   | `https://kruidvat.kajkowalski.nl/`                                                             |
| build    | `b54404dd0819b6256b8aae5ae7a7ffb1f741a767` ("Install hooks from bun, mark scripts executable") |
| contains | `e03b7e2` — the shader-warmup / `checkShaderErrors` / `SceneBatcher` fixes                     |
| taken    | 2026-08-03 ~15:45 WEST                                                                         |
| hardware | GTX 1650 Max-Q, 1600×900 / 1.44 Mpix, DPR 1                                                    |
| command  | `run diagnose --url https://kruidvat.kajkowalski.nl/`                                          |

The deployed build identifies itself at `/api/statusz` (`{ok, uptime, version, features}`), and `run diagnose --url` now reads it
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

**Do not optimise shadows or postprocessing.** They are rounding errors. In the snapshot above two things dominated.
72 point lights unrolled into every fragment (`NUM_POINT_LIGHTS` is pasted into the shader and `#pragma unroll_loop`ed;
a light contributing zero still costs, there is no branch), and ~270 draw calls with no culling. Both were attacked in
one branch, **which has not been measured yet**. The next `run diagnose --url` against a deploy of it is the missing
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
   `scene.environment`, so high metalness already rendered black), and the physical lights chunk is 22 KB against
   Lambert's 1 KB, multiplied by the unrolled light loop. Specular is gone; looks that depended on metalness darkening
   encode it in the base colour instead (see the disco balls).
3. **Whole-batch frustum culling is on** (`SceneBatcher`): one sphere test per batch. `setMatrixAt` never invalidates
   the lazily-computed sphere, so when a source moves the sphere is *grown* over the mover (`growBounds`): monotonic,
   never under-covers. `perObjectFrustumCulled` stays off; its per-instance walk is the cost the file comment
   describes. Batch count also dropped: an emissive whose quantized intensity rounds to zero no longer splits a batch
   (StockDisplay's 66 invisible product tints were 71 of the 141 batches); visible emissives keep their exact colour.
4. **Dynamic resolution shipped, default on** (`mallsim.dynres.v1`, toggle in the settings panel). Fixed steps 1 →
   0.5, driven by an EMA of the *unclamped* rAF interval; down after 0.5 s above 24 ms, up after 2 s under measured
   vsync × 1.12, 1 s cooldown. The canvas CSS (100%) upscales the smaller buffer.

5. **Zone and portal culling shipped** ([zones](src/data/zones.ts), [ZoneCuller](src/render/ZoneCuller.ts),
   [ZoneVisibility](src/render/ZoneVisibility.ts)). Six zones: `stad`, `p1`, `mall-v0`, `mall-v1`, `roof`, `theatre`.
   The zone geometry comes from a list of enclosures ([zones](src/data/zones.ts) `ZONE_ENCLOSURES`), each with its own
   plan, wall envelope, height band and facade-opening solver, so the theatre is a second building rather than a
   special case; `stad` means "fits inside no single building". A portal is
   any entity owning an `opening-clearance` or `connector-clearance` volume, or one tagged `GLASS_TAG`, so the graph is
   derived from the world model instead of listed a second time. A neighbouring zone is drawn only through the camera
   frustum clipped to the interface between the two zones, which is the hole in the slab or the line of the facade and
   never the whole corridor: as the whole clearance volume, the exit ramp was a 16 m tunnel and the lift a 22 m shaft,
   and from close up such a cone covers half the screen and culls nothing. Toggle it with `mallsim.zonecull.v1`, the
   settings panel, `?zonecull=0`, or `run diagnose --zone-cull off`.

   Three things it has to get right, each of which was wrong once and each of which
   [check-world](scripts/check-world.ts)'s `zonecull` control now asserts.

   - **An aperture behind the camera is not an aperture.** The screen rect comes from the twelve edges of the
     aperture box, each clipped at the near plane, never from its corners: a corner behind you has no NDC. Reading
     one corner's negative `w` as "the camera is inside the opening" and falling back to the whole camera frustum
     made every facade hand out a full cone from any outdoor heading, so nothing culled and `seesZone` answered yes
     for all five zones everywhere.
   - **A facade face is only an aperture where the shell is actually open.** `facadeOpeningWithin` in
     [world](src/data/world.ts) subtracts the perimeter wall panels, the same way `slabOpeningWithin` subtracts a
     deck. Without it the exit ramp's clearance box, one coarse prism from x −46 to −30, cut a 13 m² phantom window
     into V0 at the point where `wall_w_above_exit` stands, and the street drew half the interior through it.
   - **The band a zone occupies is `levelAt`'s band.** `zoneBand` derived its own from the deck heights and landed
     `DECK_SLACK` too high, so every slab's thickness fell outside the zone that same slab is assigned to. The
     facade aperture uses a second, deck-to-deck band on purpose: below the shell's foot there is no shell to have a
     hole in, and a 20 cm sliver of `DECK_SLACK` under it read as a window.

   Measured with `run diagnose:headless` (SwiftShader, 800×450, simulation frozen), A-B-A, on the build whose
   `dist/static` bundle hashes to `49e3ff1af167585bc5b55a66d6562bfc92ae1da83f1b2ef2497851cbc2e5b583` (working tree
   over `a3917b1a`; `build.ts` is reproducible, so that hash names the artefact these numbers came out of). Only the
   counts are comparable, never the milliseconds: this is a CPU rasterizer.

   | point                | draw calls off → on → off | triangles off → on → off    | shadow pass draws |
   | -------------------- | ------------------------- | --------------------------- | ----------------- |
   | `v0-entrance-street` | 795 → 273 → 795           | 394 853 → 242 737 → 394 841 | 19 → 7 → 19       |
   | `v0-center`          | 433 → 362 → 433           | 247 425 → 236 475 → 247 425 | 19 → 16 → 19      |
   | `roof-middle`        | 521 → 237 → 521           | 367 983 → 270 757 → 368 007 | 19 → 7 → 19       |

   From the pavement `keptThroughCone` is 168 of 895 accept calls, against 446 before the three fixes above, and
   `keptInOwnZone` is 115 either way. **The residual is cone width, not the own-zone shortcut.** `accepts` returns
   true on the viewer's own zone bit without a sphere test, and that was named as the reason the street would not
   collapse; the split above says otherwise, because the 115 did not move while the total fell by two thirds. What
   the 115 are is still unmeasured: a static batch is celled by `levelAt(y):x/32:z/32`, so a cell straddling the
   facade line carries `stad` and interior geometry at once, and nothing yet attributes them per cell.
   **What the shadow pair does and does not say.** Hiding is `layers.mask = 0` on a loose object and
   `visible = false` on a batch, and both take it out of every camera, the shadow camera included, so casters follow
   the cull by construction. The street's surviving casters are attributed per owner now:
   [ownerName](src/render/sceneOwner.ts) carries two levels (`mall/store_zara` instead of one row saying `mall`).
   On the build whose `dist/static` bundle hashes to
   `0bbe615bde36984a1a77030fecbfb71514f0e1cf9d456c45a7a7acbe899f0fc1` (working tree over `84e73c3`) the street pose
   hands the sun six store back walls (`zara`, `hm`, `mediaworld`, `nike` on V0 and `sephora`, `kruidvat` on V1, one
   caster each), the two entrance columns and the outdoor palms; `godStatue` and the twelve other store walls are
   hidden. The six sit exactly on the sight line the entrance bay opens (the V0 north row plus the two V1 north
   stores nearest the portal centre; `uniqlo`, one bay further west on V1, is hidden), so the glazing is doing
   portal work there and the survivors are legitimate. From `p1-center` four store walls survive (`gamesman`,
   `saucy`, `kruidvat`, `sephora`) and the entrance is hidden. The drawn side of that P1 pose keeps most of the V0
   population (`mallSims` 345 of 371, all 751 palm sources) because their dynamic batches span decks and a batch is
   kept whole; that is the batch-granularity residual, and per-instance culling inside such batches is the unmeasured
   lever under Known unknowns. What carries "no interior shadows
   outside" is the `zonecull` control: from the pavement with the building behind you it asserts that a sphere in
   the middle of V0 is rejected, and from the pavement facing the doors that one just inside them is kept.

6. **Simulation follows the same relation, from where its actors are.** Anything in a zone with no portal cone on
   screen ticks at `UNSEEN_TICK_SECONDS` ([ZoneLod](src/app/ZoneLod.ts)) rather than per frame, carrying its owed
   time so the thief, the guards and the city keep the same clock in fewer portions. Which zone a system is in is
   derived from its own bodies (`seesWhere`, `seesCast`) and never written down at the call site: eleven clocks each
   restated a deck, nothing compared that against where the actors stood, and Wei riding an escalator or a branch
   car parked on P1 kept being gated on a deck it had left. `zoneklokken` in [check-world](scripts/check-world.ts)
   fails a build where a visibility question's whole argument is a text literal. The city block reads
   `CITY_TRAFFIC_ZONES`, which [cityPlan](src/scene/city/cityPlan.ts) derives from the ring lanes and
   `EXIT_BRANCH_ROUTE`, so it covers `p1` as well as `stad`.

Still true: no distance LOD, and `cullByLevel` still only hides label sprites.

### Traps

- **`NUM_POINT_LIGHTS` is part of the program cache key.** Changing the number of *visible* lights relinks every
  material in the mall, mid-frame. The `LightPool` exists to make that impossible: never construct a raw
  `THREE.PointLight` (register a virtual light instead; `check:lights` fails the build otherwise), and never set a
  pool light `visible = false`. An invisible light is not counted by the renderer, so hiding one changes
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
run diagnose --point v0-entrance-street --zone-cull off   # the other half of the zone-cull A-B-A
run bench --save before
run bench --compare before
run profile --save before            # two identical laps, segment hotspots + drift
run profile --compare before         # same route against a named saved artifact
run profile --batch-mode spatial     # force one batching mode before page scripts
run diagnose:headless                # no-GPU containers (remote agent envs, CI), see below

run shots --list                     # every named viewpoint, the same names `run profile` uses
run shots v0-entrance-street roof-middle          # screenshots to .perf/shots/
run shots --pose 0,7.7,120,0,2,104 --name arena   # an ad-hoc viewpoint: x,y,z,lookX,lookY,lookZ
run shots v0-center --hud --live --width 1600 --height 900

CHROME_HEADFUL=1 run bench           # real window; the only Linux path measured without a pacing floor
MALL_PERF_ANGLE=vulkan run diagnose  # pick the ANGLE backend: vulkan, gl or d3d11
```

**Look at the build with [shots](scripts/shots.ts), never with a throwaway script.** Every visual check used to grow its
own `_verify-*.ts`, which was deleted afterwards, so the next one rebuilt the same four traps: `ready` resolves before
`#app-loading` is gone and the shot catches the loading screen; the first frame after a pose still holds the previous
one; the HUD covers half a narrow viewport; and a SwiftShader screenshot needs minutes, not Playwright's 30-second
default. `shots` holds all four. It takes the perf browser lock, so it queues behind a running `diagnose`, `bench` or
`profile` instead of fighting it.

**Backend and window mode are part of the measurement.** [playwright](scripts/perf/playwright.ts) picks Chrome's GPU
flags from three inputs. `MALL_PERF_SOFTWARE=1` takes the SwiftShader path; otherwise `MALL_PERF_ANGLE` names the
backend, defaulting to `d3d11` on Windows, `vulkan` on headless Linux and the driver's own choice headful. Headless
Linux additionally gets `--use-gl=angle --ozone-platform=headless`, which headful must never receive: ozone selects the
window system, so a headful run handed the headless backend gets no window while Playwright still omits `--headless`.
Plain headless Linux with no backend named answers with SwiftShader, and `parseEnvironment` refuses the run.

**No-GPU containers** (remote agent environments, CI): `run diagnose:headless`, `run bench:headless` and
`run profile:headless` launch Playwright-managed Chromium with headless SwiftShader and no sandbox.
The *structural* numbers are exact there (lights in shader, programs linked, shader source KB, draw calls); every
millisecond is the CPU rasterizer and is only comparable against the same rasterizer in the same container. Never
against a GPU snapshot, and never worth recording in this file.

**Read the measurement rules before trusting any number:**

- A benchmark on a thermally-constrained laptop is worthless. Four samples of *identical* configuration once walked
  38.8 → 65.5 → 87.6 → 106.4 ms, and a conclusion drawn from it was wrong. `bench` fits the trend across samples and
  prints `✗ DRIFTING` instead of a result; believe it.
- **Drift runs both ways and they need different fixes.** Five samples of identical configuration on an idle RTX 4080
  SUPER ran 48.9, 49.3, 38.7, 29.3, 23.5 ms, a run settling rather than a machine heating up. `bench` now drops the
  first two samples from the median and the fit, prints them marked, and asks for more samples when frame time is
  still falling at the end. Rising drift still means let it cool.
- Always A-B-A. A change is only real if returning to the baseline reproduces the baseline.
- `drawCoverage` below 1.0 means the probe did not time the whole frame — discard the sample.
- A whole-frame `TIME_ELAPSED_EXT` query measures elapsed GPU time *including idle*, so it reports ~100% busy no matter
  what. Per-pass queries summed together are closer, and are still not proof: a pass that waits also bills the wait.
- **Read the present pass before believing the GPU total.** Showing the frame is one fullscreen blit. Headless
  Chromium on ANGLE's Vulkan backend billed 13.42 ms of a 37.1 ms frame to that single draw, where headful GL on the
  same card and build billed 0.09 ms. `sampleWarnings` flags it (validated at 0/52 route segments headful GL, 52/52
  headless Vulkan). When it fires, the GPU total is a frame schedule and the run cannot be compared against one taken
  without it.
- **`diagnose` prints who accounts for the frame** in the GamersNexus GPU-Busy / GPU-Wait shape: GPU busy, app CPU
  busy (logic + batch), submit, and both waits, each against the frame. `submit` is separate because
  [App.ts](src/app/App.ts) blocks inside `composer.render` when the driver is behind, so GPU pressure arrives dressed
  as CPU time. `UNACCOUNTED` means neither side fills the frame and something outside the game sets its pace.
- Chrome may sit on the integrated GPU on a laptop even with `powerPreference: 'high-performance'`. `diagnose` warns.
  Windows: Settings → Display → Graphics → Chrome → High performance.
- **The probe forces dynamic resolution off** by writing its localStorage key before the page loads, so any run through
  `diagnose` or `bench` measures a fixed pixel count. Watching the framerate in a normal tab does not get that: if the
  setting is on there, the renderer lowers its own resolution mid-run and an A-B-A looks stable while the pixels move.

`.perf/` is gitignored and holds saved baselines, route artifacts and a reused Chrome profile (its shader cache is what
keeps repeat runs from paying the ~105 s cold link). Route artifacts name the build, GPU, canvas, batch mode, every
segment sample and repeated-lap drift. A profile run drives the camera through the probe-only control boundary; the
ordinary game never exposes that control.

### Known unknowns — do not re-derive these

Written down because each one cost real time and produced a confident wrong answer:

- **How much whole-batch frustum culling wins is UNKNOWN. It shipped unmeasured.** An early A/B appeared to show
  culling made things 1.7× worse; it was drift (the control re-measured 106.4 ms against its own earlier 38.8 ms, so all
  four samples invalid). Headless sphere-vs-frustum modelling said 13–81% of draw calls cull depending on viewpoint,
  but the scene is ~98% fill-bound, so expect a modest win at best; the A-B-A on a stable machine is still owed.
  `perObjectFrustumCulled` (a different mechanism with a real per-frame CPU cost) remains off and untested.
- **The "RTX 4090 at 30 FPS / 30% GPU" figure is stale.** It predates the shader-stall fix and includes those stalls.
  Do not reason from it. Re-trace before treating it as the target.
- **Batches are not all mall-wide.** Pre-branch: median batch bounding radius 6.7 m; 22 of 141 exceeded 40 m and 53
  exceeded 20 m. The mall-spanning ones are the shared-material batches (floors, walls), and they are also the ones
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
`LIGHT_POOL_SLOTS` (16) for the whole session, `check:lights` enforces it, and the zone culling above hides whole
rooms without a doorway stutter.

What the plan called judgement calls, and how they were decided:

- **Scoring**: `intensity × dimFactor² × priority × max(0, 1 − d/distance)`, incumbent keeps its slot until beaten by
  30% (`HYSTERESIS`), slot intensity eases at 10/s. The dim factor appears *squared* in the rank on purpose: linear,
  the priority-2 washes at 15% still outbid the disco lights and held half the pool during the party.
- **`snap` lights** (muzzle flash, sale flash) bypass the fade. Eased, a three-frame flash peaked at half value,
  a frame late.
- **`follow` mode** derives the light's world position from an `Object3D`'s `matrixWorld` each frame (elevator cabin,
  saucer, buggy, guns, per-shop groups). `pool.update(camera)` runs after `sceneBatcher.update()` because that is what
  refreshes the world matrices. That ordering is load-bearing.
- **Migration landed in one commit** instead of incrementally: all 85 former `PointLight`s across 16 scene files.
- **An unused slot is still not free.** The unrolled loop runs per fragment regardless of intensity. 16 is a choice,
  not a law; from the far west end only 2 slots have anything in range, so there is room to size down if the look
  tolerates it.

Expected win, still to be confirmed by a post-deploy snapshot: cutting visible point lights 71 → 6 measured
**2.0–2.6× the frame rate** (A-B-A-B, the one light finding that survived the drift), and the cold load loses the
cause of its 105-program link storm.

## Deploy

- Push to `master` → GitHub Pages via `.github/workflows/deploy.yml` (static, no `/api`).
- The live site is the compiled `dist/mall` binary in Docker; `make live` rebuilds and swaps it.
