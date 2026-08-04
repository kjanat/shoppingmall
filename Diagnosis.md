The diagnosis is complete. I did not reopen the mall because the saved trace and source map answered the remaining questions.

## Confirmed bottlenecks

| Measurement                                           |                                              Result |
| ----------------------------------------------------- | --------------------------------------------------: |
| Direct center-view sample                             |                         41.55 ms mean, about 24 FPS |
| Animation callback                                    |                       24.05 ms median, 33.39 ms p90 |
| Callbacks exceeding 16.7 ms                           |                                               72.4% |
| Normal CPU cost after excluding program stalls        |                                 about 19.5 ms/frame |
| [SceneBatcher.update](src/render/SceneBatcher.ts:268) |                                 about 7.15 ms/frame |
| Stable in-app GPU measurement                         |                                         about 28 ms |
| Scene                                                 | 267 draws, 390k triangles, 51 batches, 14/16 lights |

There are three independent problems.

1. Program first-use freezes

Three.js spends 2.31 seconds inside `getProgramParameter(ACTIVE_UNIFORMS)` across four bursts:

- 217.5 ms
- 972.7 ms
- 149.3 ms
- 973.2 ms

These caused several 100 to 173 ms frames and two roughly one-second freezes.

The current [warmup](src/app/App.ts:823) runs `compileAsync()`, which links shaders but leaves Three.js’ uniform cache uninitialized. Hidden renderables are also skipped. Their first visible render performs the blocking uniform introspection.

The direct fix is:

- Compile hidden renderables while the loading screen remains visible.
- After `compileAsync()`, call `getUniforms()` on every entry in `renderer.info.programs`.
- Keep the loading screen until this completes.

`WebGLProgram.getUniforms()` is present in the installed Three.js types, so this requires no unsafe casts.

2. The batcher consumes about 7.15 ms every frame

Within [SceneBatcher.update](src/render/SceneBatcher.ts:268):

- 28.5% is `updateMatrixWorld`
- 17.6% is matrix composition
- 12.1% is matrix comparison
- 11.5% is local matrix updating
- 8.2% is matrix multiplication

The original hierarchy remains in the scene, and `scene.updateMatrixWorld(true)` forces thousands of static objects through transform processing every frame.

Static and moving sources need separate handling. Static sources can have their transforms frozen or be detached after their batch matrices are established. Only moving, visibility-changing, or colour-changing sources need continuous synchronization.

Eliminating this tax would lower the ordinary CPU cost from roughly 19.5 ms toward 12.4 ms per frame.

3. Global batching creates view-dependent overdraw

The batching key has no floor, zone, spatial cell, or static/dynamic partition. Opaque batches use:

```ts
batched.perObjectFrustumCulled = false;
batched.sortObjects = false;
```

Three.js consequently preserves insertion order and emits every visible instance whenever the whole batch intersects the frustum. Large shared-material batches cross substantial portions of the mall. Geometry behind walls can therefore be shaded before the occluding wall reaches the depth buffer.

With 16 point lights evaluated per fragment, this makes the crowded center dramatically more expensive than a blank wall. The modest triangle count combined with approximately 28 ms of GPU work strongly supports fragment shading and overdraw as the steady-state GPU bottleneck.

The architectural correction is:

1. Partition batches by floor and spatial cell.
2. Separate static and moving objects.
3. Keep transparent objects in dedicated local batches.
4. Test front-to-back opaque sorting after batches become local enough for sorting to be affordable.
5. Cull entire zones and their simulations when they cannot contribute to the current view.

The existing performance scripts still cannot validate these changes reliably because they miss `WEBGL_multi_draw`, accept zero-frame samples, overlap the app’s GPU timer, and can hang while closing Chrome. Those four defects should be repaired before running the required A-B-A comparison on the RTX 4080 Super.

The actual drawing-buffer dimensions and WebGL renderer on the main PC remain the two machine-specific facts worth collecting. The site-level causes themselves are now established.
