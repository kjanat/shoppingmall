import { plusMinus } from '#/util/rand';

const MASTER_GAIN = 0.15;
const COMPRESSOR_THRESHOLD_DB = -16;
const COMPRESSOR_RATIO = 5;
const COMPRESSOR_ATTACK_SECONDS = 0.003;
const COMPRESSOR_RELEASE_SECONDS = 0.12;

const BPM = 148;
const SECONDS_PER_MINUTE = 60;
const MILLISECONDS_PER_SECOND = 1000;
const STEP_BEAT_FRACTION = 0.25;
const PATTERN_STEPS = 16;

const PRIMARY_KICK_STEP = 0;
const SECONDARY_KICK_STEP = 8;
const PRIMARY_KICK_VOLUME = 0.8;
const SECONDARY_KICK_VOLUME = 0.6;
const FIRST_SNARE_STEP = 4;
const SECOND_SNARE_STEP = 12;
const SNARE_DURATION_SECONDS = 0.08;
const SNARE_HIGHPASS_HZ = 1600;
const SNARE_VOLUME = 0.26;
const SECOND_REVERSE_BASS_STEP = 6;
const THIRD_REVERSE_BASS_STEP = 10;
const FOURTH_REVERSE_BASS_STEP = 14;
const HI_HAT_DURATION_SECONDS = 0.025;
const HI_HAT_HIGHPASS_HZ = 7500;
const HI_HAT_VOLUME = 0.03;

const YODEL_C5_HZ = 523.25;
const YODEL_C6_HZ = 1046.5;
const YODEL_G5_HZ = 784.0;
const YODEL_G4_HZ = 392.0;
const YODEL_E5_HZ = 659.25;
const YODEL_E6_HZ = 1318.5;
const YODEL_D5_HZ = 587.33;
const YODEL_PATTERN = [
	YODEL_C5_HZ,
	0,
	YODEL_C6_HZ,
	0,
	YODEL_G5_HZ,
	0,
	YODEL_G4_HZ,
	0,
	YODEL_E5_HZ,
	0,
	YODEL_E6_HZ,
	0,
	YODEL_D5_HZ,
	YODEL_C5_HZ,
	0,
	YODEL_G5_HZ,
];
const YODEL_DURATION_SECONDS = 0.16;
const HARMONY_STEP_INTERVAL = 4;
const HARMONY_FREQUENCY_HZ = 98;
const HARMONY_DURATION_SECONDS = 0.2;
const HARMONY_VOLUME = 0.07;
const MATE_YA_STEP = 15;
const MATE_YA_CYCLE_STEPS = 32;
const MATE_YA_ACTIVE_STEPS = 16;
const SCREECH_STEP = 14;
const SCREECH_CYCLE_STEPS = 64;
const SCREECH_START_AFTER_STEP = 40;

const SILENT_GAIN = 0.0001;
const YODEL_DETUNE_RATIO = 1.003;
const YODEL_VIBRATO_HZ = 5.5;
const YODEL_VIBRATO_DEPTH = 0.012;
const YODEL_FORMANT_RATIO = 1.5;
const YODEL_FORMANT_Q = 1.2;
const YODEL_PEAK_GAIN = 0.09;
const YODEL_ATTACK_SECONDS = 0.03;
const YODEL_RELEASE_TAIL_SECONDS = 0.02;

const KICK_START_HZ = 170;
const KICK_END_HZ = 40;
const KICK_PITCH_DROP_SECONDS = 0.15;
const KICK_ATTACK_SECONDS = 0.004;
const KICK_DECAY_SECONDS = 0.26;
const KICK_STOP_SECONDS = 0.28;
const KICK_CLICK_START_HZ = 500;
const KICK_CLICK_END_HZ = 70;
const KICK_CLICK_PITCH_DROP_SECONDS = 0.03;
const KICK_CLICK_GAIN = 0.1;
const KICK_CLICK_ATTACK_SECONDS = 0.002;
const KICK_CLICK_DECAY_SECONDS = 0.04;
const KICK_CLICK_STOP_SECONDS = 0.05;

const REVERSE_BASS_START_HZ = 50;
const REVERSE_BASS_END_HZ = 85;
const REVERSE_BASS_PITCH_RISE_SECONDS = 0.1;
const REVERSE_BASS_FILTER_START_HZ = 180;
const REVERSE_BASS_FILTER_END_HZ = 1200;
const REVERSE_BASS_FILTER_RISE_SECONDS = 0.09;
const REVERSE_BASS_GAIN = 0.1;
const REVERSE_BASS_ATTACK_SECONDS = 0.04;
const REVERSE_BASS_DECAY_SECONDS = 0.12;
const REVERSE_BASS_STOP_SECONDS = 0.13;

const SCREECH_START_HZ = 500;
const SCREECH_END_HZ = 1600;
const SCREECH_PITCH_RISE_SECONDS = 0.3;
const SCREECH_GAIN = 0.04;
const SCREECH_ATTACK_SECONDS = 0.02;
const SCREECH_DECAY_SECONDS = 0.35;
const SCREECH_STOP_SECONDS = 0.36;

const NOISE_ATTACK_SECONDS = 0.002;
const NOISE_STOP_TAIL_SECONDS = 0.01;
const HARMONY_ATTACK_SECONDS = 0.01;
const HARMONY_STOP_TAIL_SECONDS = 0.02;

const MATE_YA_START_HZ = 170;
const MATE_YA_END_HZ = 130;
const MATE_YA_PITCH_DROP_SECONDS = 0.1;
const MATE_YA_GAIN = 0.05;
const MATE_YA_ATTACK_SECONDS = 0.02;
const MATE_YA_DECAY_SECONDS = 0.12;
const MATE_YA_FIRST_STOP_SECONDS = 0.13;
const MATE_YA_FLIP_START_HZ = 400;
const MATE_YA_FLIP_END_HZ = 900;
const MATE_YA_FLIP_START_SECONDS = 0.13;
const MATE_YA_FLIP_PITCH_END_SECONDS = 0.28;
const MATE_YA_FLIP_GAIN = 0.07;
const MATE_YA_FLIP_ATTACK_END_SECONDS = 0.15;
const MATE_YA_FLIP_DECAY_SECONDS = 0.32;
const MATE_YA_FLIP_STOP_SECONDS = 0.34;

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
			this.master.gain.value = MASTER_GAIN;
			this.comp = this.ctx.createDynamicsCompressor();
			this.comp.threshold.value = COMPRESSOR_THRESHOLD_DB;
			this.comp.ratio.value = COMPRESSOR_RATIO;
			this.comp.attack.value = COMPRESSOR_ATTACK_SECONDS;
			this.comp.release.value = COMPRESSOR_RELEASE_SECONDS;
			this.master.connect(this.comp);
			this.comp.connect(this.ctx.destination);
		}
		if (this.ctx.state === 'suspended') this.ctx.resume();
	}

	start(): void {
		this.ensure();
		if (!this.canStart(this.playing)) return;
		this.playing = true;
		this.step = 0;
		const interval = (SECONDS_PER_MINUTE / BPM) * MILLISECONDS_PER_SECOND * STEP_BEAT_FRACTION;
		this.timer = globalThis.window.setInterval(() => this.tick(), interval);
		this.tick();
	}

	private canStart(playing: boolean): boolean {
		return !playing && this.ctx !== null && this.master !== null;
	}

	stop(): void {
		this.playing = false;
		if (this.timer !== null) {
			clearInterval(this.timer);
			this.timer = null;
		}
	}

	/**
	 * The graph the voices play into. tick() already returns before this can
	 * be null, so it narrows once here instead of in all seven of them.
	 */
	private get graph(): { ctx: AudioContext; master: GainNode } {
		if (!(this.ctx && this.master)) throw new Error('disco voice before ensure()');
		return { ctx: this.ctx, master: this.master };
	}

	private tick(): void {
		if (!(this.ctx && this.master && this.playing)) return;
		const t = this.ctx.currentTime;
		const s = this.step % PATTERN_STEPS;
		this.step++;
		this.playPercussion(t, s);
		this.playLead(t, s);
		this.playFills(t, s);
	}

	private playPercussion(t: number, s: number): void {
		// boom-bam-bam-boom
		if (s === PRIMARY_KICK_STEP || s === SECONDARY_KICK_STEP) {
			this.hardKick(t, s === PRIMARY_KICK_STEP ? PRIMARY_KICK_VOLUME : SECONDARY_KICK_VOLUME);
		}
		if (s === FIRST_SNARE_STEP || s === SECOND_SNARE_STEP) {
			this.noiseBurst(t, SNARE_DURATION_SECONDS, SNARE_HIGHPASS_HZ, SNARE_VOLUME);
		}
		if (s === 2 || s === SECOND_REVERSE_BASS_STEP || s === THIRD_REVERSE_BASS_STEP || s === FOURTH_REVERSE_BASS_STEP) {
			this.reverseBass(t);
		}
		if (s % 2 === 0) this.noiseBurst(t, HI_HAT_DURATION_SECONDS, HI_HAT_HIGHPASS_HZ, HI_HAT_VOLUME);
	}

	private playLead(t: number, s: number): void {
		// Alpine yodel lead: big octave jumps (hi-ho-la)
		const f = YODEL_PATTERN[s] ?? 0;
		if (f > 0) {
			this.yodelNote(t, f, YODEL_DURATION_SECONDS);
		}

		// Harmony under yodel
		if (s % HARMONY_STEP_INTERVAL === 0) {
			this.harmonyBeep(t);
		}
	}

	private playFills(t: number, s: number): void {
		if (s === MATE_YA_STEP && this.step % MATE_YA_CYCLE_STEPS < MATE_YA_ACTIVE_STEPS) this.mateYa(t);
		if (s === SCREECH_STEP && this.step % SCREECH_CYCLE_STEPS > SCREECH_START_AFTER_STEP) this.screech(t);
	}

	/** Classic yodel: pure-ish tone with vibrato + formant */
	private yodelNote(t: number, freq: number, dur: number): void {
		const { ctx, master } = this.graph;
		const o = ctx.createOscillator();
		const o2 = ctx.createOscillator();
		const g = ctx.createGain();
		const f = ctx.createBiquadFilter();
		o.type = 'sine';
		o2.type = 'triangle';
		o.frequency.setValueAtTime(freq, t);
		o2.frequency.setValueAtTime(freq * YODEL_DETUNE_RATIO, t);
		// vibrato
		const lfo = ctx.createOscillator();
		const lfoG = ctx.createGain();
		lfo.frequency.value = YODEL_VIBRATO_HZ;
		lfoG.gain.value = freq * YODEL_VIBRATO_DEPTH;
		lfo.connect(lfoG);
		lfoG.connect(o.frequency);
		f.type = 'bandpass';
		f.frequency.value = freq * YODEL_FORMANT_RATIO;
		f.Q.value = YODEL_FORMANT_Q;
		g.gain.setValueAtTime(SILENT_GAIN, t);
		g.gain.exponentialRampToValueAtTime(YODEL_PEAK_GAIN, t + YODEL_ATTACK_SECONDS);
		g.gain.exponentialRampToValueAtTime(SILENT_GAIN, t + dur);
		o.connect(f);
		o2.connect(f);
		f.connect(g);
		g.connect(master);
		lfo.start(t);
		o.start(t);
		o2.start(t);
		lfo.stop(t + dur + YODEL_RELEASE_TAIL_SECONDS);
		o.stop(t + dur + YODEL_RELEASE_TAIL_SECONDS);
		o2.stop(t + dur + YODEL_RELEASE_TAIL_SECONDS);
	}

	private hardKick(t: number, vol: number): void {
		const { ctx, master } = this.graph;
		const o = ctx.createOscillator();
		const g = ctx.createGain();
		o.type = 'sine';
		o.frequency.setValueAtTime(KICK_START_HZ, t);
		o.frequency.exponentialRampToValueAtTime(KICK_END_HZ, t + KICK_PITCH_DROP_SECONDS);
		g.gain.setValueAtTime(SILENT_GAIN, t);
		g.gain.exponentialRampToValueAtTime(vol, t + KICK_ATTACK_SECONDS);
		g.gain.exponentialRampToValueAtTime(SILENT_GAIN, t + KICK_DECAY_SECONDS);
		o.connect(g);
		g.connect(master);
		o.start(t);
		o.stop(t + KICK_STOP_SECONDS);
		const c = ctx.createOscillator();
		const cg = ctx.createGain();
		c.type = 'square';
		c.frequency.setValueAtTime(KICK_CLICK_START_HZ, t);
		c.frequency.exponentialRampToValueAtTime(KICK_CLICK_END_HZ, t + KICK_CLICK_PITCH_DROP_SECONDS);
		cg.gain.setValueAtTime(SILENT_GAIN, t);
		cg.gain.exponentialRampToValueAtTime(KICK_CLICK_GAIN, t + KICK_CLICK_ATTACK_SECONDS);
		cg.gain.exponentialRampToValueAtTime(SILENT_GAIN, t + KICK_CLICK_DECAY_SECONDS);
		c.connect(cg);
		cg.connect(master);
		c.start(t);
		c.stop(t + KICK_CLICK_STOP_SECONDS);
	}

	private reverseBass(t: number): void {
		const { ctx, master } = this.graph;
		const o = ctx.createOscillator();
		const g = ctx.createGain();
		const f = ctx.createBiquadFilter();
		o.type = 'sawtooth';
		o.frequency.setValueAtTime(REVERSE_BASS_START_HZ, t);
		o.frequency.exponentialRampToValueAtTime(REVERSE_BASS_END_HZ, t + REVERSE_BASS_PITCH_RISE_SECONDS);
		f.type = 'lowpass';
		f.frequency.setValueAtTime(REVERSE_BASS_FILTER_START_HZ, t);
		f.frequency.exponentialRampToValueAtTime(REVERSE_BASS_FILTER_END_HZ, t + REVERSE_BASS_FILTER_RISE_SECONDS);
		g.gain.setValueAtTime(SILENT_GAIN, t);
		g.gain.exponentialRampToValueAtTime(REVERSE_BASS_GAIN, t + REVERSE_BASS_ATTACK_SECONDS);
		g.gain.exponentialRampToValueAtTime(SILENT_GAIN, t + REVERSE_BASS_DECAY_SECONDS);
		o.connect(f);
		f.connect(g);
		g.connect(master);
		o.start(t);
		o.stop(t + REVERSE_BASS_STOP_SECONDS);
	}

	private screech(t: number): void {
		const { ctx, master } = this.graph;
		const o = ctx.createOscillator();
		const g = ctx.createGain();
		o.type = 'square';
		o.frequency.setValueAtTime(SCREECH_START_HZ, t);
		o.frequency.exponentialRampToValueAtTime(SCREECH_END_HZ, t + SCREECH_PITCH_RISE_SECONDS);
		g.gain.setValueAtTime(SILENT_GAIN, t);
		g.gain.exponentialRampToValueAtTime(SCREECH_GAIN, t + SCREECH_ATTACK_SECONDS);
		g.gain.exponentialRampToValueAtTime(SILENT_GAIN, t + SCREECH_DECAY_SECONDS);
		o.connect(g);
		g.connect(master);
		o.start(t);
		o.stop(t + SCREECH_STOP_SECONDS);
	}

	private noiseBurst(t: number, dur: number, hp: number, vol: number): void {
		const { ctx, master } = this.graph;
		const bufferSize = Math.floor(ctx.sampleRate * dur);
		const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
		const data = buffer.getChannelData(0);
		for (let i = 0; i < bufferSize; i++) data[i] = plusMinus(1);
		const noise = ctx.createBufferSource();
		noise.buffer = buffer;
		const g = ctx.createGain();
		const f = ctx.createBiquadFilter();
		f.type = 'highpass';
		f.frequency.value = hp;
		g.gain.setValueAtTime(SILENT_GAIN, t);
		g.gain.exponentialRampToValueAtTime(vol, t + NOISE_ATTACK_SECONDS);
		g.gain.exponentialRampToValueAtTime(SILENT_GAIN, t + dur);
		noise.connect(f);
		f.connect(g);
		g.connect(master);
		noise.start(t);
		noise.stop(t + dur + NOISE_STOP_TAIL_SECONDS);
	}

	private harmonyBeep(t: number): void {
		const { ctx, master } = this.graph;
		const o = ctx.createOscillator();
		const g = ctx.createGain();
		o.type = 'sawtooth';
		o.frequency.setValueAtTime(HARMONY_FREQUENCY_HZ, t);
		g.gain.setValueAtTime(SILENT_GAIN, t);
		g.gain.exponentialRampToValueAtTime(HARMONY_VOLUME, t + HARMONY_ATTACK_SECONDS);
		g.gain.exponentialRampToValueAtTime(SILENT_GAIN, t + HARMONY_DURATION_SECONDS);
		o.connect(g);
		g.connect(master);
		o.start(t);
		o.stop(t + HARMONY_DURATION_SECONDS + HARMONY_STOP_TAIL_SECONDS);
	}

	private mateYa(t: number): void {
		const { ctx, master } = this.graph;
		const o1 = ctx.createOscillator();
		const g1 = ctx.createGain();
		o1.type = 'sawtooth';
		o1.frequency.setValueAtTime(MATE_YA_START_HZ, t);
		o1.frequency.linearRampToValueAtTime(MATE_YA_END_HZ, t + MATE_YA_PITCH_DROP_SECONDS);
		g1.gain.setValueAtTime(SILENT_GAIN, t);
		g1.gain.exponentialRampToValueAtTime(MATE_YA_GAIN, t + MATE_YA_ATTACK_SECONDS);
		g1.gain.exponentialRampToValueAtTime(SILENT_GAIN, t + MATE_YA_DECAY_SECONDS);
		o1.connect(g1);
		g1.connect(master);
		o1.start(t);
		o1.stop(t + MATE_YA_FIRST_STOP_SECONDS);
		const o2 = ctx.createOscillator();
		const g2 = ctx.createGain();
		o2.type = 'sine';
		o2.frequency.setValueAtTime(MATE_YA_FLIP_START_HZ, t + MATE_YA_FLIP_START_SECONDS);
		o2.frequency.linearRampToValueAtTime(MATE_YA_FLIP_END_HZ, t + MATE_YA_FLIP_PITCH_END_SECONDS); // yodel flip up
		g2.gain.setValueAtTime(SILENT_GAIN, t + MATE_YA_FLIP_START_SECONDS);
		g2.gain.exponentialRampToValueAtTime(MATE_YA_FLIP_GAIN, t + MATE_YA_FLIP_ATTACK_END_SECONDS);
		g2.gain.exponentialRampToValueAtTime(SILENT_GAIN, t + MATE_YA_FLIP_DECAY_SECONDS);
		o2.connect(g2);
		g2.connect(master);
		o2.start(t + MATE_YA_FLIP_START_SECONDS);
		o2.stop(t + MATE_YA_FLIP_STOP_SECONDS);
	}
}

export { ShittyDiscoMusic as ShittyDisco };
