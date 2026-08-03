/**
 * The in-page half of the perf tooling: everything that has to run inside the
 * browser, next to the WebGL context.
 *
 * This exists because every number in a perf investigation of this game turned
 * out to have a way of being quietly wrong, and each guard below is one of those
 * mistakes, made once and then written down:
 *
 * - Measuring before the game is running. `window.mallsim` appears in App's
 *   constructor, several statements *before* the frame loop starts, so waiting
 *   on it measures the shader warmup instead of the game. The only honest ready
 *   signal is `#app-loading` disappearing, because main.ts removes it after
 *   `await app.ready`.
 * - Measuring while the driver is still linking. Programs link lazily and on
 *   this scene that takes tens of seconds; a sample taken during it is measuring
 *   the compiler. Hence `settle()`, which waits for linkProgram to go quiet.
 * - Trusting a whole-frame `TIME_ELAPSED_EXT` query. That measures elapsed GPU
 *   wall time *including idle*, so it reports ~100% busy no matter what. Only
 *   the sum of per-pass queries is real GPU work.
 * - Timing only part of the frame. An earlier version capped the number of
 *   in-flight queries and silently skipped segments, reporting a third of the
 *   frame's draws as if it were all of them. `drawCoverage` now proves it.
 *
 * Installed via CDP before any page script runs, so the prototype patches catch
 * the load-time program links too. The context itself is resolved lazily: the
 * patches live on `WebGL2RenderingContext.prototype`, so they apply no matter
 * when the canvas was created.
 */

/** One render target + viewport size, e.g. the main pass or the shadow map. */
export type PassTiming = {
	pass: string;
	msPerFrame: number;
	drawsPerFrame: number;
};

export type Sample = {
	frames: number;
	/** Median wall time between frames. The number a player feels. */
	wallMsMedian: number;
	wallMsP90: number;
	/**
	 * Mean wall time. Only for comparing against `gpuMsPerFrame`, which is itself a
	 * mean: holding a median against a mean on a bimodal frame time reports GPU
	 * shares like 181%, which is how this field came to exist.
	 */
	wallMsMean: number;
	/** Sum of per-pass GPU time, averaged over frames. */
	gpuMsPerFrame: number;
	passes: PassTiming[];
	drawsPerFrame: number;
	texUploadsPerFrame: number;
	texUploadKbPerFrame: number;
	/** Fraction of draws that landed inside a timed segment. Below 1 → discard. */
	drawCoverage: number;
	/** Queries thrown away because the GPU reported a disjoint event. */
	disjointDrops: number;
	/** Programs linked during the sample. Non-zero means it was not settled. */
	linksDuringSample: number;
};

export type Environment = {
	renderer: string;
	vendor: string;
	parallelShaderCompile: boolean;
	timerQuery: boolean;
	canvas: string;
	megapixels: number;
	devicePixelRatio: number;
	/** Programs linked, and how big their source was, since page load. */
	programsLinked: number;
	shaderCount: number;
	shaderKbTotal: number;
	largestShaderKb: number;
	/**
	 * Read out of the generated shader source rather than the scene graph, so it
	 * works against a production build with no debug handle. three.js pastes the
	 * counts straight into the source as `pointLights[ 71 ]`.
	 */
	numPointLights: number;
	numDirLights: number;
	numSpotLights: number;
	/**
	 * three.js only calls these when `renderer.debug.checkShaderErrors` is on, and
	 * each one is a hard CPU-GPU sync. Non-zero in a production build is a bug.
	 */
	programInfoLogCalls: number;
	shaderInfoLogCalls: number;
};

type ProbeApi = {
	ready: (timeoutMs: number) => Promise<number>;
	settle: (quietMs: number, maxWaitMs: number) => Promise<number>;
	sample: (durationMs: number) => Promise<Sample>;
	environment: () => Environment;
};

declare global {
	// eslint-disable-next-line no-var
	var __mallProbe: ProbeApi | undefined;
}

/** The probe source, ready to hand to Page.addScriptToEvaluateOnNewDocument. */
export function probeSource(): string {
	return `(${installProbe.toString()})();`;
}

// Everything below runs in the browser. It must stay self-contained: it is
// stringified, so a reference to anything outside this function will not exist
// at the other end.
function installProbe(): void {
	type TimerExt = { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number };
	type Segment = { query: WebGLQuery; pass: string; draws: number };
	type Totals = { ms: number; draws: number };

	const counters = {
		links: 0,
		programInfoLog: 0,
		shaderInfoLog: 0,
		shaders: 0,
		shaderBytes: 0,
		largestShader: 0,
		texUploads: 0,
		texBytes: 0,
		draws: 0,
		drawsTimed: 0,
		disjointDrops: 0,
		frames: 0,
	};
	const lights = { point: 0, directional: 0, spot: 0 };
	const wall: number[] = [];
	const totals = new Map<string, Totals>();

	const proto = WebGL2RenderingContext.prototype;
	let gl: WebGL2RenderingContext | null = null;
	let timer: TimerExt | null = null;
	let active: Segment | null = null;
	const pending: Segment[] = [];
	const framebufferIds = new WeakMap<WebGLFramebuffer, number>();
	let nextFramebufferId = 1;
	let viewportW = 0;
	let viewportH = 0;
	let target = 'default';

	/** Narrow the untyped getExtension result without an assertion. */
	const readTimerExt = (value: unknown): TimerExt | null => {
		if (typeof value !== 'object' || value === null) return null;
		if (!('TIME_ELAPSED_EXT' in value) || !('GPU_DISJOINT_EXT' in value)) return null;
		const { TIME_ELAPSED_EXT, GPU_DISJOINT_EXT } = value;
		if (typeof TIME_ELAPSED_EXT !== 'number' || typeof GPU_DISJOINT_EXT !== 'number') return null;
		return { TIME_ELAPSED_EXT, GPU_DISJOINT_EXT };
	};

	const context = (): WebGL2RenderingContext | null => {
		if (gl) return gl;
		const canvas = document.querySelector('canvas');
		if (!canvas) return null;
		// getContext returns the same object for the same type, so this is the
		// context three.js is rendering with, not a second one.
		gl = canvas.getContext('webgl2');
		if (gl) timer = readTimerExt(gl.getExtension('EXT_disjoint_timer_query_webgl2'));
		return gl;
	};

	const closeSegment = (): void => {
		const ctx = context();
		if (!ctx || !timer || !active) return;
		ctx.endQuery(timer.TIME_ELAPSED_EXT);
		pending.push(active);
		active = null;
	};

	const openSegment = (): void => {
		const ctx = context();
		if (!ctx || !timer || active) return;
		const query = ctx.createQuery();
		if (!query) return;
		ctx.beginQuery(timer.TIME_ELAPSED_EXT, query);
		active = { query, pass: `${target} ${viewportW}x${viewportH}`, draws: 0 };
	};

	const collect = (): void => {
		const ctx = context();
		if (!ctx || !timer) return;
		for (let i = pending.length - 1; i >= 0; i--) {
			const seg = pending[i];
			if (!seg) continue;
			if (!ctx.getQueryParameter(seg.query, ctx.QUERY_RESULT_AVAILABLE)) continue;
			if (ctx.getParameter(timer.GPU_DISJOINT_EXT)) {
				counters.disjointDrops++;
			} else {
				const ns = ctx.getQueryParameter(seg.query, ctx.QUERY_RESULT);
				const totalsForPass = totals.get(seg.pass) ?? { ms: 0, draws: 0 };
				totalsForPass.ms += (typeof ns === 'number' ? ns : 0) / 1e6;
				totalsForPass.draws += seg.draws;
				totals.set(seg.pass, totalsForPass);
			}
			ctx.deleteQuery(seg.query);
			pending.splice(i, 1);
		}
	};

	// ── prototype patches ──────────────────────────────────────────────────

	const linkProgram = proto.linkProgram;
	proto.linkProgram = function (program: WebGLProgram): void {
		counters.links++;
		linkProgram.call(this, program);
	};

	const getProgramInfoLog = proto.getProgramInfoLog;
	proto.getProgramInfoLog = function (program: WebGLProgram): string | null {
		counters.programInfoLog++;
		return getProgramInfoLog.call(this, program);
	};

	const getShaderInfoLog = proto.getShaderInfoLog;
	proto.getShaderInfoLog = function (shader: WebGLShader): string | null {
		counters.shaderInfoLog++;
		return getShaderInfoLog.call(this, shader);
	};

	const shaderSource = proto.shaderSource;
	proto.shaderSource = function (shader: WebGLShader, source: string): void {
		counters.shaders++;
		counters.shaderBytes += source.length;
		if (source.length > counters.largestShader) counters.largestShader = source.length;
		// three.js substitutes NUM_POINT_LIGHTS into the array declaration, so the
		// generated source is the one place the real count is visible without a
		// handle on the scene.
		const point = /uniform PointLight pointLights\[\s*(\d+)\s*\]/.exec(source);
		const dir = /uniform DirectionalLight directionalLights\[\s*(\d+)\s*\]/.exec(source);
		const spot = /uniform SpotLight spotLights\[\s*(\d+)\s*\]/.exec(source);
		if (point?.[1]) lights.point = Math.max(lights.point, Number(point[1]));
		if (dir?.[1]) lights.directional = Math.max(lights.directional, Number(dir[1]));
		if (spot?.[1]) lights.spot = Math.max(lights.spot, Number(spot[1]));
		shaderSource.call(this, shader, source);
	};

	const countUpload = (source: unknown): void => {
		counters.texUploads++;
		if (ArrayBuffer.isView(source)) counters.texBytes += source.byteLength;
	};
	// Both upload entry points are overloaded — nine arguments with a pixel buffer,
	// ten with an offset, six with a DOM source — and a rest-argument wrapper is
	// not assignable to an overloaded signature. defineProperty installs the same
	// wrapper without having to weaken or assert any type.
	for (const name of ['texImage2D', 'texSubImage2D'] as const) {
		const original = proto[name];
		Object.defineProperty(proto, name, {
			configurable: true,
			writable: true,
			value: function (this: WebGL2RenderingContext, ...args: unknown[]): void {
				countUpload(args[args.length - 1]);
				Reflect.apply(original, this, args);
			},
		});
	}

	// A pass boundary is a change of render target or of viewport size. Both are
	// cheap to observe and together they separate the shadow map, the scene pass
	// and each postprocessing target.
	const viewport = proto.viewport;
	proto.viewport = function (x: number, y: number, w: number, h: number): void {
		if (w !== viewportW || h !== viewportH) {
			closeSegment();
			viewportW = w;
			viewportH = h;
			openSegment();
		}
		viewport.call(this, x, y, w, h);
	};

	const bindFramebuffer = proto.bindFramebuffer;
	proto.bindFramebuffer = function (bindTarget: number, framebuffer: WebGLFramebuffer | null): void {
		let id = 'default';
		if (framebuffer) {
			let known = framebufferIds.get(framebuffer);
			if (known === undefined) {
				known = nextFramebufferId++;
				framebufferIds.set(framebuffer, known);
			}
			id = `fbo${known}`;
		}
		if (id !== target) {
			closeSegment();
			target = id;
			openSegment();
		}
		bindFramebuffer.call(this, bindTarget, framebuffer);
	};

	const drawElements = proto.drawElements;
	const drawArrays = proto.drawArrays;
	const drawElementsInstanced = proto.drawElementsInstanced;
	const drawArraysInstanced = proto.drawArraysInstanced;
	// Opening a segment here as a fallback is what guarantees coverage: a draw
	// that arrives with no segment open would otherwise be untimed and invisible.
	const noteDraw = (): void => {
		counters.draws++;
		if (!active) openSegment();
		if (active) {
			active.draws++;
			counters.drawsTimed++;
		}
	};
	proto.drawElements = function (...args: Parameters<typeof drawElements>): void {
		noteDraw();
		drawElements.apply(this, args);
	};
	proto.drawArrays = function (...args: Parameters<typeof drawArrays>): void {
		noteDraw();
		drawArrays.apply(this, args);
	};
	proto.drawElementsInstanced = function (...args: Parameters<typeof drawElementsInstanced>): void {
		noteDraw();
		drawElementsInstanced.apply(this, args);
	};
	proto.drawArraysInstanced = function (...args: Parameters<typeof drawArraysInstanced>): void {
		noteDraw();
		drawArraysInstanced.apply(this, args);
	};

	let previous = performance.now();
	const tick = (now: number): void => {
		counters.frames++;
		wall.push(now - previous);
		previous = now;
		closeSegment();
		collect();
		requestAnimationFrame(tick);
	};
	requestAnimationFrame(tick);

	// ── the API the driver script talks to ────────────────────────────────

	const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
	const median = (values: number[]): number => {
		if (values.length === 0) return 0;
		const sorted = [...values].sort((a, b) => a - b);
		return sorted[Math.floor(sorted.length / 2)] ?? 0;
	};
	const percentile = (values: number[], p: number): number => {
		if (values.length === 0) return 0;
		const sorted = [...values].sort((a, b) => a - b);
		return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
	};
	const round = (value: number, digits = 2): number => Number(value.toFixed(digits));

	globalThis.__mallProbe = {
		/** Resolve when the game is actually running, not merely constructed. */
		ready: async (timeoutMs: number): Promise<number> => {
			const start = performance.now();
			// The first poll can land on the navigation's initial empty document,
			// before the parser has produced #app-loading at all. Polling only for
			// its absence then declares the game playable at 0 ms, and every number
			// after that measures a blank page (this happened on a slow container;
			// a fast desktop wins the race by accident). So: wait for the loading
			// screen to have existed, or for a fully loaded document without one.
			let seen = false;
			while (performance.now() - start < timeoutMs) {
				if (document.querySelector('#app-loading')) seen = true;
				else if (seen || document.readyState === 'complete') break;
				await sleep(100);
			}
			return Math.round(performance.now() - start);
		},

		/** Resolve once no program has linked for `quietMs`. */
		settle: async (quietMs: number, maxWaitMs: number): Promise<number> => {
			const start = performance.now();
			let seen = counters.links;
			let lastChange = performance.now();
			while (performance.now() - start < maxWaitMs) {
				await sleep(250);
				if (counters.links !== seen) {
					seen = counters.links;
					lastChange = performance.now();
				} else if (performance.now() - lastChange > quietMs) break;
			}
			return Math.round(performance.now() - start);
		},

		sample: async (durationMs: number): Promise<Sample> => {
			totals.clear();
			wall.length = 0;
			counters.frames = 0;
			counters.draws = 0;
			counters.drawsTimed = 0;
			counters.texUploads = 0;
			counters.texBytes = 0;
			counters.disjointDrops = 0;
			const linksBefore = counters.links;

			await sleep(durationMs);

			const frames = Math.max(1, counters.frames);
			const passes: PassTiming[] = [...totals.entries()]
				.map(([pass, t]) => ({
					pass,
					msPerFrame: round(t.ms / frames),
					drawsPerFrame: round(t.draws / frames, 1),
				}))
				.filter((p) => p.msPerFrame > 0 || p.drawsPerFrame > 0)
				.sort((a, b) => b.msPerFrame - a.msPerFrame);

			return {
				frames: counters.frames,
				wallMsMedian: round(median(wall), 1),
				wallMsP90: round(percentile(wall, 0.9), 1),
				wallMsMean: round(wall.reduce((sum, ms) => sum + ms, 0) / Math.max(wall.length, 1), 1),
				gpuMsPerFrame: round(passes.reduce((sum, p) => sum + p.msPerFrame, 0)),
				passes,
				drawsPerFrame: round(counters.draws / frames, 1),
				texUploadsPerFrame: round(counters.texUploads / frames, 1),
				texUploadKbPerFrame: round(counters.texBytes / frames / 1024, 1),
				drawCoverage: counters.draws === 0 ? 1 : round(counters.drawsTimed / counters.draws, 4),
				disjointDrops: counters.disjointDrops,
				linksDuringSample: counters.links - linksBefore,
			};
		},

		environment: (): Environment => {
			const ctx = context();
			const canvas = document.querySelector('canvas');
			const width = canvas?.width ?? 0;
			const height = canvas?.height ?? 0;
			let renderer = 'unknown';
			let vendor = 'unknown';
			if (ctx) {
				const debugInfo = ctx.getExtension('WEBGL_debug_renderer_info');
				if (debugInfo && 'UNMASKED_RENDERER_WEBGL' in debugInfo && 'UNMASKED_VENDOR_WEBGL' in debugInfo) {
					const r = ctx.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
					const v = ctx.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL);
					if (typeof r === 'string') renderer = r;
					if (typeof v === 'string') vendor = v;
				}
			}
			return {
				renderer,
				vendor,
				parallelShaderCompile: !!ctx?.getExtension('KHR_parallel_shader_compile'),
				timerQuery: timer !== null,
				canvas: `${width}x${height}`,
				megapixels: round((width * height) / 1e6),
				devicePixelRatio: window.devicePixelRatio,
				programsLinked: counters.links,
				shaderCount: counters.shaders,
				shaderKbTotal: round(counters.shaderBytes / 1024, 1),
				largestShaderKb: round(counters.largestShader / 1024, 1),
				numPointLights: lights.point,
				numDirLights: lights.directional,
				numSpotLights: lights.spot,
				programInfoLogCalls: counters.programInfoLog,
				shaderInfoLogCalls: counters.shaderInfoLog,
			};
		},
	};
}
