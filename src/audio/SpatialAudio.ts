/**
 * Quadratic distance attenuation for mall ambience & voices.
 * gain = clamp( ref / (1 + k * d²) , 0, 1 )  — close = loud, far = quiet.
 */
export class SpatialAudio {
	private ctx: AudioContext | null = null;
	private master: GainNode | null = null;
	private listener = { x: 0, y: 1.6, z: 0 };
	private sources: SpatialSource[] = [];

	ensure(): AudioContext {
		if (!this.ctx) {
			this.ctx = new AudioContext();
			this.master = this.ctx.createGain();
			this.master.gain.value = 0.9;
			this.master.connect(this.ctx.destination);
		}
		if (this.ctx.state === 'suspended') void this.ctx.resume();
		return this.ctx;
	}

	setListener(x: number, y: number, z: number): void {
		this.listener.x = x;
		this.listener.y = y;
		this.listener.z = z;
		for (const s of this.sources) s.applyGain(this.listener);
	}

	/** One-shot buffer or URL at a world position */
	async playAt(
		urlOrBuffer: string | AudioBuffer,
		pos: { x: number; y: number; z: number },
		opts: {
			volume?: number;
			/** meters where gain ≈ ref */
			refDistance?: number;
			maxDistance?: number;
			/** quadratic strength k in 1/(1+k*d²) */
			k?: number;
			loop?: boolean;
		} = {},
	): Promise<SpatialSource | null> {
		const ctx = this.ensure();
		let buffer: AudioBuffer;
		if (typeof urlOrBuffer === 'string') {
			try {
				const res = await fetch(urlOrBuffer);
				const ab = await res.arrayBuffer();
				buffer = await ctx.decodeAudioData(ab.slice(0));
			} catch {
				return null;
			}
		} else {
			buffer = urlOrBuffer;
		}
		const src = new SpatialSource(ctx, this.master!, buffer, pos, {
			volume: opts.volume ?? 0.8,
			refDistance: opts.refDistance ?? 2.5,
			maxDistance: opts.maxDistance ?? 28,
			k: opts.k ?? 0.045,
			loop: opts.loop ?? false,
		});
		src.applyGain(this.listener);
		src.start();
		this.sources.push(src);
		src.onEnded = () => {
			this.sources = this.sources.filter((s) => s !== src);
		};
		return src;
	}

	/** Looping procedural tone (e.g. prayer call loop) */
	startLoopAt(
		pos: { x: number; y: number; z: number },
		factory: (ctx: AudioContext, dest: AudioNode) => { stop: () => void },
		opts: { volume?: number; k?: number; maxDistance?: number } = {},
	): SpatialLoop {
		const ctx = this.ensure();
		const gain = ctx.createGain();
		gain.connect(this.master!);
		const handle = factory(ctx, gain);
		const loop: SpatialLoop = {
			x: pos.x,
			y: pos.y,
			z: pos.z,
			gain,
			volume: opts.volume ?? 0.55,
			k: opts.k ?? 0.05,
			maxDistance: opts.maxDistance ?? 22,
			stop: () => {
				handle.stop();
				try {
					gain.disconnect();
				} catch {
					/* */
				}
			},
			apply: (L) => {
				const d = Math.hypot(L.x - pos.x, L.y - pos.y, L.z - pos.z);
				if (d > (opts.maxDistance ?? 22)) {
					gain.gain.value = 0;
					return;
				}
				// quadratic falloff
				const g = (opts.volume ?? 0.55) / (1 + (opts.k ?? 0.05) * d * d);
				gain.gain.value = Math.max(0, Math.min(1, g));
			},
		};
		loop.apply(this.listener);
		this.loops.push(loop);
		return loop;
	}

	private loops: SpatialLoop[] = [];

	updateListener(x: number, y: number, z: number): void {
		this.setListener(x, y, z);
		for (const L of this.loops) L.apply(this.listener);
	}

	stopAll(): void {
		for (const s of this.sources) s.stop();
		this.sources = [];
		for (const L of this.loops) L.stop();
		this.loops = [];
	}
}

export type SpatialLoop = {
	x: number;
	y: number;
	z: number;
	gain: GainNode;
	volume: number;
	k: number;
	maxDistance: number;
	stop: () => void;
	apply: (L: { x: number; y: number; z: number }) => void;
};

class SpatialSource {
	onEnded: (() => void) | null = null;
	private node: AudioBufferSourceNode;
	private gain: GainNode;
	private pos: { x: number; y: number; z: number };
	private volume: number;
	private k: number;
	private maxDistance: number;
	private stopped = false;

	constructor(
		ctx: AudioContext,
		master: GainNode,
		buffer: AudioBuffer,
		pos: { x: number; y: number; z: number },
		opts: {
			volume: number;
			refDistance: number;
			maxDistance: number;
			k: number;
			loop: boolean;
		},
	) {
		this.pos = pos;
		this.volume = opts.volume;
		this.k = opts.k;
		this.maxDistance = opts.maxDistance;
		this.node = ctx.createBufferSource();
		this.node.buffer = buffer;
		this.node.loop = opts.loop;
		this.gain = ctx.createGain();
		this.node.connect(this.gain);
		this.gain.connect(master);
		this.node.onended = () => {
			if (!this.stopped) this.onEnded?.();
		};
	}

	applyGain(L: { x: number; y: number; z: number }): void {
		const d = Math.hypot(L.x - this.pos.x, L.y - this.pos.y, L.z - this.pos.z);
		if (d > this.maxDistance) {
			this.gain.gain.value = 0;
			return;
		}
		// Quadratic: louder nearby, soft far away
		const g = this.volume / (1 + this.k * d * d);
		this.gain.gain.value = Math.max(0, Math.min(1, g));
	}

	start(): void {
		this.node.start();
	}

	stop(): void {
		this.stopped = true;
		try {
			this.node.stop();
		} catch {
			/* */
		}
	}
}

/** Shared singleton for the mall */
export const spatial = new SpatialAudio();
