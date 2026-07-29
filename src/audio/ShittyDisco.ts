/**
 * Intentionally shitty but catchy dance-floor loop.
 * Web Audio only — no external files. Tolerable for ~2 minutes, funny forever.
 */
export class ShittyDiscoMusic {
	private ctx: AudioContext | null = null;
	private master: GainNode | null = null;
	private timer: number | null = null;
	private step = 0;
	playing = false;

	ensure(): void {
		if (!this.ctx) {
			this.ctx = new AudioContext();
			this.master = this.ctx.createGain();
			this.master.gain.value = 0.14;
			this.master.connect(this.ctx.destination);
		}
		if (this.ctx.state === 'suspended') void this.ctx.resume();
	}

	start(): void {
		this.ensure();
		if (this.playing || !this.ctx || !this.master) return;
		this.playing = true;
		this.step = 0;
		const bpm = 118;
		const interval = (60 / bpm) * 1000 * 0.5; // 8th notes
		this.timer = window.setInterval(() => this.tick(), interval);
		this.tick();
	}

	stop(): void {
		this.playing = false;
		if (this.timer !== null) {
			clearInterval(this.timer);
			this.timer = null;
		}
	}

	private tick(): void {
		if (!this.ctx || !this.master || !this.playing) return;
		const t = this.ctx.currentTime;
		// 8th-note grid in a 4-beat bar: boom-bam-bam-boom
		// 0:boom  1:hat  2:bam  3:hat  4:bam  5:hat  6:boom  7:hat
		const s = this.step % 8;
		this.step++;

		// boom · bam · bam · boom
		if (s === 0 || s === 6) this.kick(t, s === 0 ? 0.7 : 0.55);
		if (s === 2 || s === 4) this.snare(t);
		this.hat(t, s % 2 === 1 ? 0.05 : 0.025);

		// Sparse shitty hook — not every hit
		const scale = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25];
		const melody = [0, -1, 4, -1, 2, -1, 0, 3]; // -1 = rest
		const n = melody[s];
		if (n >= 0) {
			this.beep(t, scale[n], 0.14, s === 0 ? 'square' : 'triangle', 0.07);
		}
		if (s === 0 || s === 6) {
			this.beep(t, 65.41, 0.2, 'sawtooth', 0.08); // fat boom bass
		}
		// occasional "mate, ya"
		if (s === 7 && this.step % 16 < 8) {
			this.mateYa(t);
		}
	}

	private kick(t: number, vol = 0.6): void {
		const ctx = this.ctx!;
		const o = ctx.createOscillator();
		const g = ctx.createGain();
		o.type = 'sine';
		o.frequency.setValueAtTime(160, t);
		o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
		g.gain.setValueAtTime(0.0001, t);
		g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
		g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
		o.connect(g);
		g.connect(this.master!);
		o.start(t);
		o.stop(t + 0.24);
	}

	/** Vocal-ish blip: mate… ya */
	private mateYa(t: number): void {
		const ctx = this.ctx!;
		// "mate"
		const o1 = ctx.createOscillator();
		const g1 = ctx.createGain();
		o1.type = 'sawtooth';
		o1.frequency.setValueAtTime(180, t);
		o1.frequency.linearRampToValueAtTime(140, t + 0.1);
		g1.gain.setValueAtTime(0.0001, t);
		g1.gain.exponentialRampToValueAtTime(0.05, t + 0.02);
		g1.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
		const f = ctx.createBiquadFilter();
		f.type = 'bandpass';
		f.frequency.value = 900;
		o1.connect(f);
		f.connect(g1);
		g1.connect(this.master!);
		o1.start(t);
		o1.stop(t + 0.13);
		// "ya"
		const o2 = ctx.createOscillator();
		const g2 = ctx.createGain();
		o2.type = 'triangle';
		o2.frequency.setValueAtTime(320, t + 0.14);
		o2.frequency.linearRampToValueAtTime(280, t + 0.28);
		g2.gain.setValueAtTime(0.0001, t + 0.14);
		g2.gain.exponentialRampToValueAtTime(0.055, t + 0.16);
		g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
		o2.connect(g2);
		g2.connect(this.master!);
		o2.start(t + 0.14);
		o2.stop(t + 0.32);
	}

	private snare(t: number): void {
		const ctx = this.ctx!;
		const bufferSize = 2 * ctx.sampleRate * 0.08;
		const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
		const data = buffer.getChannelData(0);
		for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
		const noise = ctx.createBufferSource();
		noise.buffer = buffer;
		const g = ctx.createGain();
		const f = ctx.createBiquadFilter();
		f.type = 'highpass';
		f.frequency.value = 1200;
		g.gain.setValueAtTime(0.0001, t);
		g.gain.exponentialRampToValueAtTime(0.22, t + 0.005);
		g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
		noise.connect(f);
		f.connect(g);
		g.connect(this.master!);
		noise.start(t);
		noise.stop(t + 0.12);
	}

	private hat(t: number, vol: number): void {
		const ctx = this.ctx!;
		const bufferSize = ctx.sampleRate * 0.03;
		const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
		const data = buffer.getChannelData(0);
		for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
		const noise = ctx.createBufferSource();
		noise.buffer = buffer;
		const g = ctx.createGain();
		const f = ctx.createBiquadFilter();
		f.type = 'highpass';
		f.frequency.value = 7000;
		g.gain.setValueAtTime(0.0001, t);
		g.gain.exponentialRampToValueAtTime(vol, t + 0.002);
		g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
		noise.connect(f);
		f.connect(g);
		g.connect(this.master!);
		noise.start(t);
		noise.stop(t + 0.05);
	}

	private beep(
		t: number,
		freq: number,
		dur: number,
		type: OscillatorType,
		vol = 0.09,
	): void {
		const ctx = this.ctx!;
		const o = ctx.createOscillator();
		const g = ctx.createGain();
		o.type = type;
		o.frequency.setValueAtTime(freq, t);
		// slight pitch bend = cheap synth
		o.frequency.linearRampToValueAtTime(freq * 1.02, t + dur);
		g.gain.setValueAtTime(0.0001, t);
		g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
		g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
		const f = ctx.createBiquadFilter();
		f.type = 'lowpass';
		f.frequency.value = 2200;
		o.connect(f);
		f.connect(g);
		g.connect(this.master!);
		o.start(t);
		o.stop(t + dur + 0.02);
	}
}
