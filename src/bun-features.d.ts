/**
 * The build-time feature flags this project understands.
 *
 * Declaring them here turns `feature('TYPFOUT')` into a type error instead of a
 * silent `false`, which is the whole risk with a flag that only ever removes
 * code: nothing looks broken, the code is simply gone.
 *
 * Both are phrased as removals because an unset flag is `false` and the dev
 * server passes no flags at all. The full build is what you get by default, and
 * a stripped build has to ask for it. See build.ts for the command line.
 *
 * `NO_PERF_HUD` drops the performance panel: the fps chip, everything behind I,
 * the ring buffer it fills every frame whether or not the panel is open, and
 * the per-frame reads of `renderer.info` that feed it. Its CSS lives in
 * style.css and stays; only the code goes. Measured at ~23 KB of bundle.
 *
 * `FORCE_LAMBERT` settles the Glans choice at build time on Lambert, so the PBR
 * branch of `lit()` never ships and neither does the settings row offering it.
 * For a target that will never want specular highlights, where carrying both
 * shading models plus a switch is dead weight.
 */
declare module 'bun:bundle' {
	interface Registry {
		features: 'NO_PERF_HUD' | 'FORCE_LAMBERT';
	}
}
