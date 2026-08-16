/**
 * Binaural mall audio — Web Audio HRTF panners + listener head tracking.
 *
 * Each source is placed in world space; the listener follows the camera
 * position AND orientation so left/right/behind/above actually image in
 * headphones. Distance uses inverse rolloff (plus an optional quadratic
 * gain for the old mall-tuned falloff).
 *
 * Headphones recommended. Stereo speakers still get equalpower-ish imaging
 * when HRTF is unavailable / disabled.
 */

import { clamp01 } from '#/util/math';

const DEFAULT_LISTENER_HEIGHT = 1.6;
const MASTER_VOLUME = 0.9;
const SOURCE_DEFAULTS = {
	volume: 0.8,
	refDistance: 2.5,
	maxDistance: 28,
	k: 0.045,
};
const LOOP_DEFAULTS = {
	volume: 0.55,
	refDistance: 2.5,
	maxDistance: 22,
	k: 0.05,
};
const ELEMENT_DEFAULTS = {
	volume: 0.7,
	refDistance: 3.5,
	maxDistance: 55,
	k: 0.012,
};
const MIN_PANNER_MAX_DISTANCE = 40;
const PANNER_ROLLOFF = 0.35;
const OMNIDIRECTIONAL_CONE_DEGREES = 360;
const DISTANCE_TAIL_VOLUME = 0.06;
const DISTANCE_TAIL_DECAY = 0.12;
const DEFAULT_ANALYSER_FFT_SIZE = 256;
const ANALYSER_SMOOTHING = 0.65;

interface Position {
	x: number;
	y: number;
	z: number;
}

interface ListenerPose extends Position {
	x: number;
	y: number;
	z: number;
	/** Unit forward (camera look) */
	fx: number;
	fy: number;
	fz: number;
	/** Unit up */
	ux: number;
	uy: number;
	uz: number;
}

interface PlayAtOpts {
	volume?: number;
	/** meters where gain ≈ full for inverse model */
	refDistance?: number;
	maxDistance?: number;
	/** extra quadratic k in 1/(1+k*d²) on top of panner (mall feel) */
	k?: number;
	loop?: boolean;
	/** override global binaural for this source */
	binaural?: boolean;
	/** Cancel an in-flight fetch when the caller's playback slot expires. */
	signal?: AbortSignal;
}

interface AttenuationOpts {
	volume: number;
	maxDistance: number;
	k: number;
}

interface PannerOpts extends AttenuationOpts {
	refDistance: number;
	binaural: boolean;
}

interface SpatialSource {
	onEnded: (() => void) | null;
	/** Buffer length in seconds (for loop position) */
	readonly duration: number;
	readonly looping: boolean;
	getPlaybackTime: () => number;
	createAnalyser: (fftSize?: number) => AnalyserNode;
	setPanningModel: (model: PanningModelType) => void;
	setPosition: (x: number, y: number, z: number) => void;
	apply: (listener: ListenerPose) => void;
	start: () => void;
	stop: () => void;
}

interface SpatialLoop extends Position {
	/** Connect synths here */
	readonly input: GainNode;
	attachStop: (stop: () => void) => void;
	setPanningModel: (model: PanningModelType) => void;
	setPosition: (x: number, y: number, z: number) => void;
	apply: (listener: ListenerPose) => void;
	stop: () => void;
}

interface SpatialElement {
	readonly element: HTMLAudioElement;
	readonly duration: number;
	setPanningModel: (model: PanningModelType) => void;
	setPosition: (x: number, y: number, z: number) => void;
	setBaseVolume: (volume: number) => void;
	getPlaybackTime: () => number;
	createAnalyser: (fftSize?: number) => AnalyserNode;
	apply: (listener: ListenerPose) => void;
}

class SpatialAudio {
	private ctx: AudioContext | null = null;
	private master: GainNode | null = null;
	private listener: ListenerPose = {
		x: 0,
		y: DEFAULT_LISTENER_HEIGHT,
		z: 0,
		fx: 0,
		fy: 0,
		fz: -1,
		ux: 0,
		uy: 1,
		uz: 0,
	};
	private sources: SpatialSource[] = [];
	private loops: SpatialLoop[] = [];
	private readonly elements: SpatialElement[] = [];
	/** HRTF when true; equalpower stereo when false */
	binaural = true;
	/** Master wet for spatial bus */
	private readonly masterVol = MASTER_VOLUME;

	ensure(): AudioContext {
		if (!this.ctx) {
			this.ctx = new AudioContext();
			this.master = this.ctx.createGain();
			this.master.gain.value = this.masterVol;
			this.master.connect(this.ctx.destination);
			this.applyListenerToCtx();
		}
		if (this.ctx.state === 'suspended') this.ctx.resume();
		return this.ctx;
	}

	get context(): AudioContext | null {
		return this.ctx;
	}

	/** The spatial bus, which ensure() creates together with the context. */
	private get bus(): GainNode {
		if (!this.master) throw new Error('spatial bus used before ensure()');
		return this.master;
	}

	/** Toggle HRTF ↔ equalpower; live sources reconfigure */
	setBinaural(on: boolean): void {
		this.binaural = on;
		const model: PanningModelType = on ? 'HRTF' : 'equalpower';
		for (const s of this.sources) s.setPanningModel(model);
		for (const L of this.loops) L.setPanningModel(model);
		for (const e of this.elements) e.setPanningModel(model);
	}

	/**
	 * Full 6DOF listener (position + orientation).
	 * Call every frame from the camera.
	 */
	updateListener(pose: ListenerPose): void {
		this.listener = pose;
		this.applyListenerToCtx();
		for (const s of this.sources) s.apply(this.listener);
		for (const L of this.loops) L.apply(this.listener);
		for (const e of this.elements) e.apply(this.listener);
	}

	/** Backward-compatible position-only update (keeps last orientation) */
	setListener(x: number, y: number, z: number): void {
		this.updateListener({ ...this.listener, x, y, z });
	}

	private applyListenerToCtx(): void {
		if (!this.ctx) return;
		const listener = this.ctx.listener;
		const p = this.listener;
		// Modern AudioParam path
		if ('positionX' in listener) {
			const t = this.ctx.currentTime;
			listener.positionX.setValueAtTime(p.x, t);
			listener.positionY.setValueAtTime(p.y, t);
			listener.positionZ.setValueAtTime(p.z, t);
			listener.forwardX.setValueAtTime(p.fx, t);
			listener.forwardY.setValueAtTime(p.fy, t);
			listener.forwardZ.setValueAtTime(p.fz, t);
			listener.upX.setValueAtTime(p.ux, t);
			listener.upY.setValueAtTime(p.uy, t);
			listener.upZ.setValueAtTime(p.uz, t);
		} else {
			// Safari legacy
			applyLegacyListenerPose(listener, p);
		}
	}

	/** One-shot or looping buffer/URL at a world position */
	async playAt(
		urlOrBuffer: string | AudioBuffer,
		pos: { x: number; y: number; z: number },
		opts: PlayAtOpts = {},
	): Promise<SpatialSource | null> {
		const ctx = this.ensure();
		let buffer: AudioBuffer;
		if (typeof urlOrBuffer === 'string') {
			try {
				const res = await fetch(urlOrBuffer, { signal: opts.signal });
				const ab = await res.arrayBuffer();
				buffer = await ctx.decodeAudioData(ab.slice(0));
			} catch {
				return null;
			}
		} else {
			buffer = urlOrBuffer;
		}
		const binaural = opts.binaural ?? this.binaural;
		const src = createSpatialSource({
			ctx,
			master: this.bus,
			buffer,
			pos,
			opts: {
				volume: opts.volume ?? SOURCE_DEFAULTS.volume,
				refDistance: opts.refDistance ?? SOURCE_DEFAULTS.refDistance,
				maxDistance: opts.maxDistance ?? SOURCE_DEFAULTS.maxDistance,
				k: opts.k ?? SOURCE_DEFAULTS.k,
				loop: opts.loop ?? false,
				binaural,
			},
		});
		src.apply(this.listener);
		src.start();
		this.sources.push(src);
		src.onEnded = () => {
			this.sources = this.sources.filter((s) => s !== src);
		};
		return src;
	}

	/**
	 * Looping procedural tone at a world position.
	 * `factory` connects synth nodes into `dest` (pre-panner gain bus).
	 */
	startLoopAt(
		pos: { x: number; y: number; z: number },
		factory: (ctx: AudioContext, dest: AudioNode) => { stop: () => void },
		opts: {
			volume?: number;
			k?: number;
			maxDistance?: number;
			refDistance?: number;
			binaural?: boolean;
		} = {},
	): SpatialLoop {
		const ctx = this.ensure();
		const binaural = opts.binaural ?? this.binaural;
		const loop = createSpatialLoop({
			ctx,
			master: this.bus,
			pos,
			opts: {
				volume: opts.volume ?? LOOP_DEFAULTS.volume,
				k: opts.k ?? LOOP_DEFAULTS.k,
				maxDistance: opts.maxDistance ?? LOOP_DEFAULTS.maxDistance,
				refDistance: opts.refDistance ?? LOOP_DEFAULTS.refDistance,
				binaural,
			},
		});
		const handle = factory(ctx, loop.input);
		loop.attachStop(handle.stop);
		loop.apply(this.listener);
		this.loops.push(loop);
		return loop;
	}

	/**
	 * Route an HTMLAudioElement through a binaural panner (e.g. DJ booth).
	 * createMediaElementSource may only be called once per element — we cache.
	 */
	attachElementAt(
		el: HTMLAudioElement,
		pos: { x: number; y: number; z: number },
		opts: {
			volume?: number;
			k?: number;
			maxDistance?: number;
			refDistance?: number;
			binaural?: boolean;
		} = {},
	): SpatialElement {
		const ctx = this.ensure();
		const existing = this.elements.find((e) => e.element === el);
		if (existing) {
			existing.setPosition(pos.x, pos.y, pos.z);
			return existing;
		}
		const binaural = opts.binaural ?? this.binaural;
		const se = createSpatialElement({
			ctx,
			master: this.bus,
			element: el,
			pos,
			opts: {
				volume: opts.volume ?? ELEMENT_DEFAULTS.volume,
				k: opts.k ?? ELEMENT_DEFAULTS.k,
				maxDistance: opts.maxDistance ?? ELEMENT_DEFAULTS.maxDistance,
				refDistance: opts.refDistance ?? ELEMENT_DEFAULTS.refDistance,
				binaural,
			},
		});
		se.apply(this.listener);
		this.elements.push(se);
		return se;
	}

	/** Move a live source (moving NPCs, etc.) */
	// reserved for future moving panners

	stopAll(): void {
		for (const s of this.sources) s.stop();
		this.sources = [];
		for (const L of this.loops) L.stop();
		this.loops = [];
		// Don't destroy element attachments — DJ keeps playing; just leave them
	}
}

function applyLegacyListenerPose(listener: object, pose: ListenerPose): void {
	if ('setPosition' in listener && typeof listener.setPosition === 'function') {
		listener.setPosition(pose.x, pose.y, pose.z);
	}
	if ('setOrientation' in listener && typeof listener.setOrientation === 'function') {
		listener.setOrientation(pose.fx, pose.fy, pose.fz, pose.ux, pose.uy, pose.uz);
	}
}

// ── shared panner wiring ──────────────────────────────────────────

function makePanner(
	ctx: AudioContext,
	opts: PannerOpts,
): {
	panner: PannerNode;
	gain: GainNode;
	setPos: (x: number, y: number, z: number) => void;
	setPanningModel: (m: PanningModelType) => void;
} {
	const gain = ctx.createGain();
	gain.gain.value = opts.volume;
	const panner = ctx.createPanner();
	panner.panningModel = opts.binaural ? 'HRTF' : 'equalpower';
	// Direction/elevation via HRTF; distance mainly via our quadratic gain
	// (mild inverse so the panner still has a distance cue)
	panner.distanceModel = 'inverse';
	panner.refDistance = opts.refDistance;
	panner.maxDistance = Math.max(opts.maxDistance, MIN_PANNER_MAX_DISTANCE);
	panner.rolloffFactor = PANNER_ROLLOFF;
	panner.coneInnerAngle = OMNIDIRECTIONAL_CONE_DEGREES;
	panner.coneOuterAngle = OMNIDIRECTIONAL_CONE_DEGREES;
	panner.coneOuterGain = 1;
	// Orientation of the source (omni)
	if ('orientationX' in panner) {
		panner.orientationX.value = 0;
		panner.orientationY.value = 0;
		panner.orientationZ.value = -1;
	}
	gain.connect(panner);

	const setPos = (x: number, y: number, z: number) => {
		if ('positionX' in panner) {
			const t = ctx.currentTime;
			panner.positionX.setValueAtTime(x, t);
			panner.positionY.setValueAtTime(y, t);
			panner.positionZ.setValueAtTime(z, t);
		} else {
			applyLegacyPannerPosition(panner, { x, y, z });
		}
	};

	return {
		panner,
		gain,
		setPos,
		setPanningModel: (m) => {
			panner.panningModel = m;
		},
	};
}

function applyLegacyPannerPosition(panner: object, pos: Position): void {
	if ('setPosition' in panner && typeof panner.setPosition === 'function') {
		panner.setPosition(pos.x, pos.y, pos.z);
	}
}

function quadraticGain(opts: AttenuationOpts, listener: ListenerPose, pos: Position): number {
	const d = Math.hypot(listener.x - pos.x, listener.y - pos.y, listener.z - pos.z);
	if (d > opts.maxDistance) {
		// Soft tail so music doesn't hard-cut at the edge (was silent mid-mall)
		const over = d - opts.maxDistance;
		const tail = opts.volume * DISTANCE_TAIL_VOLUME * Math.exp(-over * DISTANCE_TAIL_DECAY);
		return clamp01(tail);
	}
	return clamp01(opts.volume / (1 + opts.k * d * d));
}

// ── buffer source ─────────────────────────────────────────────────

interface SpatialSourceParams {
	ctx: AudioContext;
	master: GainNode;
	buffer: AudioBuffer;
	pos: Position;
	opts: PannerOpts & { loop: boolean };
}

interface SpatialSourceState {
	ctx: AudioContext;
	node: AudioBufferSourceNode;
	chain: ReturnType<typeof makePanner>;
	pos: Position;
	opts: PannerOpts & { loop: boolean };
	duration: number;
	onEnded: (() => void) | null;
	stopped: boolean;
	startedAt: number;
}

function createSpatialSource(params: SpatialSourceParams): SpatialSource {
	const { ctx, master, buffer, opts } = params;
	const state: SpatialSourceState = {
		ctx,
		node: ctx.createBufferSource(),
		chain: makePanner(ctx, opts),
		pos: { ...params.pos },
		opts,
		duration: buffer.duration,
		onEnded: null,
		stopped: false,
		startedAt: -1,
	};
	state.node.buffer = buffer;
	state.node.loop = opts.loop;
	state.node.connect(state.chain.gain);
	state.chain.panner.connect(master);
	state.chain.setPos(state.pos.x, state.pos.y, state.pos.z);
	state.node.onended = () => {
		if (!state.stopped) state.onEnded?.();
	};
	return makeSpatialSourceHandle(state);
}

function makeSpatialSourceHandle(state: SpatialSourceState): SpatialSource {
	return {
		get onEnded() {
			return state.onEnded;
		},
		set onEnded(handler) {
			state.onEnded = handler;
		},
		duration: state.duration,
		looping: state.opts.loop,
		/**
		 * Seconds into the buffer (loops if looping). -1 if not started.
		 * Use this to lock animation to the track.
		 */
		getPlaybackTime() {
			return spatialSourcePlaybackTime(state);
		},
		/** Tap a silent analyser on this source for beat energy (bass) */
		createAnalyser(fftSize = DEFAULT_ANALYSER_FFT_SIZE) {
			// Raw pre-panner: gain → analyser (parallel) + panner
			return makeAnalyser(state.ctx, state.chain.gain, fftSize);
		},
		setPanningModel(model) {
			state.chain.setPanningModel(model);
		},
		setPosition(x, y, z) {
			state.pos.x = x;
			state.pos.y = y;
			state.pos.z = z;
			state.chain.setPos(x, y, z);
		},
		apply(listener) {
			state.chain.gain.gain.value = quadraticGain(state.opts, listener, state.pos);
			state.chain.setPos(state.pos.x, state.pos.y, state.pos.z);
		},
		start() {
			state.startedAt = state.ctx.currentTime;
			state.node.start();
		},
		stop() {
			stopSpatialSource(state);
		},
	};
}

function spatialSourcePlaybackTime(state: SpatialSourceState): number {
	if (state.startedAt < 0 || state.stopped) return -1;
	const elapsed = state.ctx.currentTime - state.startedAt;
	if (state.duration <= 0) return elapsed;
	if (state.opts.loop) {
		const time = elapsed % state.duration;
		return time < 0 ? time + state.duration : time;
	}
	return Math.min(elapsed, state.duration);
}

function stopSpatialSource(state: SpatialSourceState): void {
	state.stopped = true;
	try {
		state.node.stop();
	} catch {
		/* */
	}
	try {
		state.chain.panner.disconnect();
		state.chain.gain.disconnect();
	} catch {
		/* */
	}
}

// ── procedural loop ───────────────────────────────────────────────

interface SpatialLoopParams {
	ctx: AudioContext;
	master: GainNode;
	pos: Position;
	opts: PannerOpts;
}

function createSpatialLoop({ ctx, master, pos, opts }: SpatialLoopParams): SpatialLoop {
	const chain = makePanner(ctx, opts);
	let stopInner: (() => void) | null = null;
	let stopped = false;
	const loop: SpatialLoop = {
		x: pos.x,
		y: pos.y,
		z: pos.z,
		// input → gain (volume) is the panner's gain node
		input: chain.gain,
		attachStop(stop) {
			stopInner = stop;
		},
		setPanningModel(model) {
			chain.setPanningModel(model);
		},
		setPosition(x, y, z) {
			loop.x = x;
			loop.y = y;
			loop.z = z;
			chain.setPos(x, y, z);
		},
		apply(listener) {
			chain.gain.gain.value = quadraticGain(opts, listener, loop);
			chain.setPos(loop.x, loop.y, loop.z);
		},
		stop() {
			if (stopped) return;
			stopped = true;
			stopInner?.();
			try {
				chain.panner.disconnect();
				chain.gain.disconnect();
			} catch {
				/* */
			}
		},
	};
	chain.panner.connect(master);
	chain.setPos(pos.x, pos.y, pos.z);
	return loop;
}

// ── HTMLMediaElement (DJ) ─────────────────────────────────────────

interface SpatialElementParams {
	ctx: AudioContext;
	master: GainNode;
	element: HTMLAudioElement;
	pos: Position;
	opts: PannerOpts;
}

function createSpatialElement({ ctx, master, element, pos: initialPos, opts }: SpatialElementParams): SpatialElement {
	const pos = { ...initialPos };
	// Element must be silent at the OS path — we take the audio graph
	element.volume = 1;
	const media = ctx.createMediaElementSource(element);
	const chain = makePanner(ctx, opts);
	const state = { media, volume: opts.volume };
	state.media.connect(chain.gain);
	chain.panner.connect(master);
	chain.setPos(pos.x, pos.y, pos.z);

	return {
		element,
		get duration() {
			const duration = element.duration;
			return Number.isFinite(duration) && duration > 0 ? duration : 0;
		},
		setPanningModel(model) {
			chain.setPanningModel(model);
		},
		setPosition(x, y, z) {
			pos.x = x;
			pos.y = y;
			pos.z = z;
			chain.setPos(x, y, z);
		},
		/** Base volume (booth fader); distance applied in apply() */
		setBaseVolume(volume) {
			state.volume = clamp01(volume);
		},
		/** Seconds into the media element (for beat-sync) */
		getPlaybackTime() {
			const time = element.currentTime;
			return Number.isFinite(time) ? time : 0;
		},
		/** Frequency analyser tap (bass / kick) */
		createAnalyser(fftSize = DEFAULT_ANALYSER_FFT_SIZE) {
			return makeAnalyser(ctx, chain.gain, fftSize);
		},
		apply(listener) {
			chain.gain.gain.value = quadraticGain({ ...opts, volume: state.volume }, listener, pos);
			chain.setPos(pos.x, pos.y, pos.z);
		},
	};
}

function makeAnalyser(ctx: AudioContext, gain: GainNode, fftSize: number): AnalyserNode {
	const analyser = ctx.createAnalyser();
	analyser.fftSize = fftSize;
	analyser.smoothingTimeConstant = ANALYSER_SMOOTHING;
	gain.connect(analyser);
	return analyser;
}

/** Shared singleton for the mall */
const spatial = new SpatialAudio();

export type { ListenerPose, PlayAtOpts, SpatialElement, SpatialLoop, SpatialSource };
export { SpatialAudio, spatial };
