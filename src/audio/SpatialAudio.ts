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

export type ListenerPose = {
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
};

export type PlayAtOpts = {
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
};

export class SpatialAudio {
	private ctx: AudioContext | null = null;
	private master: GainNode | null = null;
	private listener: ListenerPose = {
		x: 0,
		y: 1.6,
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
	private elements: SpatialElement[] = [];
	/** HRTF when true; equalpower stereo when false */
	binaural = true;
	/** Master wet for spatial bus */
	private masterVol = 0.9;

	ensure(): AudioContext {
		if (!this.ctx) {
			this.ctx = new AudioContext();
			this.master = this.ctx.createGain();
			this.master.gain.value = this.masterVol;
			this.master.connect(this.ctx.destination);
			this.applyListenerToCtx();
		}
		if (this.ctx.state === 'suspended') void this.ctx.resume();
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
		const L = this.ctx.listener;
		const p = this.listener;
		// Modern AudioParam path
		if ('positionX' in L) {
			const al = L as AudioListener & {
				positionX: AudioParam;
				positionY: AudioParam;
				positionZ: AudioParam;
				forwardX: AudioParam;
				forwardY: AudioParam;
				forwardZ: AudioParam;
				upX: AudioParam;
				upY: AudioParam;
				upZ: AudioParam;
			};
			const t = this.ctx.currentTime;
			al.positionX.setValueAtTime(p.x, t);
			al.positionY.setValueAtTime(p.y, t);
			al.positionZ.setValueAtTime(p.z, t);
			al.forwardX.setValueAtTime(p.fx, t);
			al.forwardY.setValueAtTime(p.fy, t);
			al.forwardZ.setValueAtTime(p.fz, t);
			al.upX.setValueAtTime(p.ux, t);
			al.upY.setValueAtTime(p.uy, t);
			al.upZ.setValueAtTime(p.uz, t);
		} else {
			// Safari legacy
			const legacy = L as AudioListener & {
				setPosition?: (x: number, y: number, z: number) => void;
				setOrientation?: (fx: number, fy: number, fz: number, ux: number, uy: number, uz: number) => void;
			};
			legacy.setPosition?.(p.x, p.y, p.z);
			legacy.setOrientation?.(p.fx, p.fy, p.fz, p.ux, p.uy, p.uz);
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
		const src = new SpatialSource(ctx, this.bus, buffer, pos, {
			volume: opts.volume ?? 0.8,
			refDistance: opts.refDistance ?? 2.5,
			maxDistance: opts.maxDistance ?? 28,
			k: opts.k ?? 0.045,
			loop: opts.loop ?? false,
			binaural,
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
		const loop = new SpatialLoop(ctx, this.bus, pos, {
			volume: opts.volume ?? 0.55,
			k: opts.k ?? 0.05,
			maxDistance: opts.maxDistance ?? 22,
			refDistance: opts.refDistance ?? 2.5,
			binaural,
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
		const se = new SpatialElement(ctx, this.bus, el, pos, {
			volume: opts.volume ?? 0.7,
			k: opts.k ?? 0.012,
			maxDistance: opts.maxDistance ?? 55,
			refDistance: opts.refDistance ?? 3.5,
			binaural,
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

// ── shared panner wiring ──────────────────────────────────────────

type PannerOpts = {
	volume: number;
	refDistance: number;
	maxDistance: number;
	k: number;
	binaural: boolean;
};

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
	panner.maxDistance = Math.max(opts.maxDistance, 40);
	panner.rolloffFactor = 0.35;
	panner.coneInnerAngle = 360;
	panner.coneOuterAngle = 360;
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
			(panner as PannerNode & { setPosition?: (x: number, y: number, z: number) => void }).setPosition?.(x, y, z);
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

function quadraticGain(
	volume: number,
	k: number,
	maxDistance: number,
	L: ListenerPose,
	pos: { x: number; y: number; z: number },
): number {
	const d = Math.hypot(L.x - pos.x, L.y - pos.y, L.z - pos.z);
	if (d > maxDistance) {
		// Soft tail so music doesn't hard-cut at the edge (was silent mid-mall)
		const over = d - maxDistance;
		const tail = volume * 0.06 * Math.exp(-over * 0.12);
		return Math.max(0, Math.min(1, tail));
	}
	return Math.max(0, Math.min(1, volume / (1 + k * d * d)));
}

// ── buffer source ─────────────────────────────────────────────────

export class SpatialSource {
	onEnded: (() => void) | null = null;
	private node: AudioBufferSourceNode;
	private gain: GainNode;
	private panner: PannerNode;
	private setPos: (x: number, y: number, z: number) => void;
	private setModel: (m: PanningModelType) => void;
	private pos: { x: number; y: number; z: number };
	private volume: number;
	private k: number;
	private maxDistance: number;
	private stopped = false;
	private ctx: AudioContext;
	/** ctx.currentTime when start() was called */
	private startedAt = -1;
	/** Buffer length in seconds (for loop position) */
	readonly duration: number;
	readonly looping: boolean;

	constructor(
		ctx: AudioContext,
		master: GainNode,
		buffer: AudioBuffer,
		pos: { x: number; y: number; z: number },
		opts: PannerOpts & { loop: boolean },
	) {
		this.ctx = ctx;
		this.duration = buffer.duration;
		this.looping = opts.loop;
		this.pos = { ...pos };
		this.volume = opts.volume;
		this.k = opts.k;
		this.maxDistance = opts.maxDistance;
		this.node = ctx.createBufferSource();
		this.node.buffer = buffer;
		this.node.loop = opts.loop;
		const chain = makePanner(ctx, opts);
		this.gain = chain.gain;
		this.panner = chain.panner;
		this.setPos = chain.setPos;
		this.setModel = chain.setPanningModel;
		this.node.connect(this.gain);
		this.panner.connect(master);
		this.setPos(pos.x, pos.y, pos.z);
		this.node.onended = () => {
			if (!this.stopped) this.onEnded?.();
		};
	}

	/**
	 * Seconds into the buffer (loops if looping). -1 if not started.
	 * Use this to lock animation to the track.
	 */
	getPlaybackTime(): number {
		if (this.startedAt < 0 || this.stopped) return -1;
		const elapsed = this.ctx.currentTime - this.startedAt;
		if (this.duration <= 0) return elapsed;
		if (this.looping) {
			const t = elapsed % this.duration;
			return t < 0 ? t + this.duration : t;
		}
		return Math.min(elapsed, this.duration);
	}

	/** Tap a silent analyser on this source for beat energy (bass) */
	createAnalyser(fftSize = 256): AnalyserNode {
		const a = this.ctx.createAnalyser();
		a.fftSize = fftSize;
		a.smoothingTimeConstant = 0.65;
		// Tap after gain so volume/distance already applied — or pre-panner for raw?
		// Raw pre-panner: gain → analyser (parallel) + panner
		this.gain.connect(a);
		return a;
	}

	setPanningModel(m: PanningModelType): void {
		this.setModel(m);
	}

	setPosition(x: number, y: number, z: number): void {
		this.pos.x = x;
		this.pos.y = y;
		this.pos.z = z;
		this.setPos(x, y, z);
	}

	apply(L: ListenerPose): void {
		this.gain.gain.value = quadraticGain(this.volume, this.k, this.maxDistance, L, this.pos);
		this.setPos(this.pos.x, this.pos.y, this.pos.z);
	}

	start(): void {
		this.startedAt = this.ctx.currentTime;
		this.node.start();
	}

	stop(): void {
		this.stopped = true;
		try {
			this.node.stop();
		} catch {
			/* */
		}
		try {
			this.panner.disconnect();
			this.gain.disconnect();
		} catch {
			/* */
		}
	}
}

// ── procedural loop ───────────────────────────────────────────────

export class SpatialLoop {
	x: number;
	y: number;
	z: number;
	/** Connect synths here */
	readonly input: GainNode;
	private gain: GainNode;
	private panner: PannerNode;
	private setPos: (x: number, y: number, z: number) => void;
	private setModel: (m: PanningModelType) => void;
	private volume: number;
	private k: number;
	private maxDistance: number;
	private stopInner: (() => void) | null = null;
	private stopped = false;

	constructor(ctx: AudioContext, master: GainNode, pos: { x: number; y: number; z: number }, opts: PannerOpts) {
		this.x = pos.x;
		this.y = pos.y;
		this.z = pos.z;
		this.volume = opts.volume;
		this.k = opts.k;
		this.maxDistance = opts.maxDistance;
		const chain = makePanner(ctx, opts);
		this.gain = chain.gain;
		this.panner = chain.panner;
		this.setPos = chain.setPos;
		this.setModel = chain.setPanningModel;
		// input → gain (volume) is the panner's gain node
		this.input = this.gain;
		this.panner.connect(master);
		this.setPos(pos.x, pos.y, pos.z);
	}

	attachStop(fn: () => void): void {
		this.stopInner = fn;
	}

	setPanningModel(m: PanningModelType): void {
		this.setModel(m);
	}

	setPosition(x: number, y: number, z: number): void {
		this.x = x;
		this.y = y;
		this.z = z;
		this.setPos(x, y, z);
	}

	apply(L: ListenerPose): void {
		this.gain.gain.value = quadraticGain(this.volume, this.k, this.maxDistance, L, { x: this.x, y: this.y, z: this.z });
		this.setPos(this.x, this.y, this.z);
	}

	stop(): void {
		if (this.stopped) return;
		this.stopped = true;
		this.stopInner?.();
		try {
			this.panner.disconnect();
			this.gain.disconnect();
		} catch {
			/* */
		}
	}
}

// ── HTMLMediaElement (DJ) ─────────────────────────────────────────

export class SpatialElement {
	readonly element: HTMLAudioElement;
	private media: MediaElementAudioSourceNode;
	private gain: GainNode;
	private panner: PannerNode;
	private setPos: (x: number, y: number, z: number) => void;
	private setModel: (m: PanningModelType) => void;
	private pos: { x: number; y: number; z: number };
	private volume: number;
	private k: number;
	private maxDistance: number;
	/** When true, HTMLAudioElement.volume is forced to 1 and we own level */
	private owned = true;
	private ctx: AudioContext;

	constructor(
		ctx: AudioContext,
		master: GainNode,
		el: HTMLAudioElement,
		pos: { x: number; y: number; z: number },
		opts: PannerOpts,
	) {
		this.ctx = ctx;
		this.element = el;
		this.pos = { ...pos };
		this.volume = opts.volume;
		this.k = opts.k;
		this.maxDistance = opts.maxDistance;
		// Element must be silent at the OS path — we take the audio graph
		el.volume = 1;
		this.media = ctx.createMediaElementSource(el);
		const chain = makePanner(ctx, opts);
		this.gain = chain.gain;
		this.panner = chain.panner;
		this.setPos = chain.setPos;
		this.setModel = chain.setPanningModel;
		this.media.connect(this.gain);
		this.panner.connect(master);
		this.setPos(pos.x, pos.y, pos.z);
	}

	setPanningModel(m: PanningModelType): void {
		this.setModel(m);
	}

	setPosition(x: number, y: number, z: number): void {
		this.pos.x = x;
		this.pos.y = y;
		this.pos.z = z;
		this.setPos(x, y, z);
	}

	/** Base volume (booth fader); distance applied in apply() */
	setBaseVolume(v: number): void {
		this.volume = Math.max(0, Math.min(1, v));
	}

	/** Seconds into the media element (for beat-sync) */
	getPlaybackTime(): number {
		const t = this.element.currentTime;
		return Number.isFinite(t) ? t : 0;
	}

	get duration(): number {
		const d = this.element.duration;
		return Number.isFinite(d) && d > 0 ? d : 0;
	}

	/** Frequency analyser tap (bass / kick) */
	createAnalyser(fftSize = 256): AnalyserNode {
		const a = this.ctx.createAnalyser();
		a.fftSize = fftSize;
		a.smoothingTimeConstant = 0.65;
		this.gain.connect(a);
		return a;
	}

	apply(L: ListenerPose): void {
		if (!this.owned) return;
		this.gain.gain.value = quadraticGain(this.volume, this.k, this.maxDistance, L, this.pos);
		this.setPos(this.pos.x, this.pos.y, this.pos.z);
	}
}

/** Shared singleton for the mall */
export const spatial = new SpatialAudio();
