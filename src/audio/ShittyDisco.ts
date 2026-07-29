/**
 * Hardcore mall set + alpine JODEL energy.
 * boom-bam-bam-boom, then yodel leaps: hi-ho-la-hi-ho
 */
export class ShittyDiscoMusic {
	private ctx: AudioContext | null = null;
	private master: GainNode | null = null;
	private comp: DynamicsCompressorNode | null = null;
	private timer: number | null = null;
	private step = 0;
	playing = false;

	ensure(): void {
		if (!this.ctx) {
			this.ctx = new AudioContext();
			this.master = this.ctx.createGain();
			this.master.gain.value = 0.15;
			this.comp = this.ctx.createDynamicsCompressor();
			this.comp.threshold.value = -16;
			this.comp.ratio.value = 5;
			this.comp.attack.value = 0.003;
			this.comp.release.value = 0.12;
			this.master.connect(this.comp);
			this.comp.connect(this.ctx.destination);
		}
		if (this.ctx.state === 'suspended') void this.ctx.resume();
	}

	start(): void {
		this.ensure();
		if (this.playing || !this.ctx || !this.master) return;
		this.playing = true;
		this.step = 0;
		const bpm = 148;
		const interval = (60 / bpm) * 1000 * 0.25;
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
		const s = this.step % 16;
		this.step++;

		// boom-bam-bam-boom
		if (s === 0 || s === 8) this.hardKick(t, s === 0 ? 0.8 : 0.6);
		if (s === 4 || s === 12) this.noiseBurst(t, 0.08, 1600, 0.26);
		if (s === 2 || s === 6 || s === 10 || s === 14) this.reverseBass(t);
		if (s % 2 === 0) this.noiseBurst(t, 0.025, 7500, 0.03);

		// Alpine yodel lead: big octave jumps (hi-ho-la)
		// Pattern over 16 steps — yodel every other bar section
		const yodel = [
			523.25,
			0,
			1046.5,
			0, // C5 rest C6 rest
			784.0,
			0,
			392.0,
			0, // G5 rest G4 rest
			659.25,
			0,
			1318.5,
			0, // E5 rest E6
			587.33,
			523.25,
			0,
			784.0,
		];
		const f = yodel[s];
		if (f > 0) {
			this.yodelNote(t, f, 0.16);
		}

		// Harmony under yodel
		if (s % 4 === 0) {
			this.beep(t, 98, 0.2, 'sawtooth', 0.07);
		}

		if (s === 15 && this.step % 32 < 16) this.mateYa(t);
		if (s === 14 && this.step % 64 > 40) this.screech(t);
	}

	/** Classic yodel: pure-ish tone with vibrato + formant */
	private yodelNote(t: number, freq: number, dur: number): void {
		const ctx = this.ctx!;
		const o = ctx.createOscillator();
		const o2 = ctx.createOscillator();
		const g = ctx.createGain();
		const f = ctx.createBiquadFilter();
		o.type = 'sine';
		o2.type = 'triangle';
		o.frequency.setValueAtTime(freq, t);
		o2.frequency.setValueAtTime(freq * 1.003, t);
		// vibrato
		const lfo = ctx.createOscillator();
		const lfoG = ctx.createGain();
		lfo.frequency.value = 5.5;
		lfoG.gain.value = freq * 0.012;
		lfo.connect(lfoG);
		lfoG.connect(o.frequency);
		f.type = 'bandpass';
		f.frequency.value = freq * 1.5;
		f.Q.value = 1.2;
		g.gain.setValueAtTime(0.0001, t);
		g.gain.exponentialRampToValueAtTime(0.09, t + 0.03);
		g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
		o.connect(f);
		o2.connect(f);
		f.connect(g);
		g.connect(this.master!);
		lfo.start(t);
		o.start(t);
		o2.start(t);
		lfo.stop(t + dur + 0.02);
		o.stop(t + dur + 0.02);
		o2.stop(t + dur + 0.02);
	}

	private hardKick(t: number, vol: number): void {
		const ctx = this.ctx!;
		const o = ctx.createOscillator();
		const g = ctx.createGain();
		o.type = 'sine';
		o.frequency.setValueAtTime(170, t);
		o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
		g.gain.setValueAtTime(0.0001, t);
		g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
		g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
		o.connect(g);
		g.connect(this.master!);
		o.start(t);
		o.stop(t + 0.28);
		const c = ctx.createOscillator();
		const cg = ctx.createGain();
		c.type = 'square';
		c.frequency.setValueAtTime(500, t);
		c.frequency.exponentialRampToValueAtTime(70, t + 0.03);
		cg.gain.setValueAtTime(0.0001, t);
		cg.gain.exponentialRampToValueAtTime(0.1, t + 0.002);
		cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
		c.connect(cg);
		cg.connect(this.master!);
		c.start(t);
		c.stop(t + 0.05);
	}

	private reverseBass(t: number): void {
		const ctx = this.ctx!;
		const o = ctx.createOscillator();
		const g = ctx.createGain();
		const f = ctx.createBiquadFilter();
		o.type = 'sawtooth';
		o.frequency.setValueAtTime(50, t);
		o.frequency.exponentialRampToValueAtTime(85, t + 0.1);
		f.type = 'lowpass';
		f.frequency.setValueAtTime(180, t);
		f.frequency.exponentialRampToValueAtTime(1200, t + 0.09);
		g.gain.setValueAtTime(0.0001, t);
		g.gain.exponentialRampToValueAtTime(0.1, t + 0.04);
		g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
		o.connect(f);
		f.connect(g);
		g.connect(this.master!);
		o.start(t);
		o.stop(t + 0.13);
	}

	private screech(t: number): void {
		const ctx = this.ctx!;
		const o = ctx.createOscillator();
		const g = ctx.createGain();
		o.type = 'square';
		o.frequency.setValueAtTime(500, t);
		o.frequency.exponentialRampToValueAtTime(1600, t + 0.3);
		g.gain.setValueAtTime(0.0001, t);
		g.gain.exponentialRampToValueAtTime(0.04, t + 0.02);
		g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
		o.connect(g);
		g.connect(this.master!);
		o.start(t);
		o.stop(t + 0.36);
	}

	private noiseBurst(t: number, dur: number, hp: number, vol: number): void {
		const ctx = this.ctx!;
		const bufferSize = Math.floor(ctx.sampleRate * dur);
		const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
		const data = buffer.getChannelData(0);
		for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
		const noise = ctx.createBufferSource();
		noise.buffer = buffer;
		const g = ctx.createGain();
		const f = ctx.createBiquadFilter();
		f.type = 'highpass';
		f.frequency.value = hp;
		g.gain.setValueAtTime(0.0001, t);
		g.gain.exponentialRampToValueAtTime(vol, t + 0.002);
		g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
		noise.connect(f);
		f.connect(g);
		g.connect(this.master!);
		noise.start(t);
		noise.stop(t + dur + 0.01);
	}

	private beep(
		t: number,
		freq: number,
		dur: number,
		type: OscillatorType,
		vol: number,
	): void {
		const ctx = this.ctx!;
		const o = ctx.createOscillator();
		const g = ctx.createGain();
		o.type = type;
		o.frequency.setValueAtTime(freq, t);
		g.gain.setValueAtTime(0.0001, t);
		g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
		g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
		o.connect(g);
		g.connect(this.master!);
		o.start(t);
		o.stop(t + dur + 0.02);
	}

	private mateYa(t: number): void {
		const ctx = this.ctx!;
		const o1 = ctx.createOscillator();
		const g1 = ctx.createGain();
		o1.type = 'sawtooth';
		o1.frequency.setValueAtTime(170, t);
		o1.frequency.linearRampToValueAtTime(130, t + 0.1);
		g1.gain.setValueAtTime(0.0001, t);
		g1.gain.exponentialRampToValueAtTime(0.05, t + 0.02);
		g1.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
		o1.connect(g1);
		g1.connect(this.master!);
		o1.start(t);
		o1.stop(t + 0.13);
		const o2 = ctx.createOscillator();
		const g2 = ctx.createGain();
		o2.type = 'sine';
		o2.frequency.setValueAtTime(400, t + 0.13);
		o2.frequency.linearRampToValueAtTime(900, t + 0.28); // yodel flip up
		g2.gain.setValueAtTime(0.0001, t + 0.13);
		g2.gain.exponentialRampToValueAtTime(0.07, t + 0.15);
		g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
		o2.connect(g2);
		g2.connect(this.master!);
		o2.start(t + 0.13);
		o2.stop(t + 0.34);
	}
}
