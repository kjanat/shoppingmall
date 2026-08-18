import type { Vector3 } from 'three';
import { CON_DEALERS, CON_PLAZA, CON_STAGE, CON_TECHNO_RANGE, CON_TECHNO_SOURCE, inRect2 } from '#/data/conPlan';
import { clamp01 } from '#/util/math';

const BPM = 140;
const STEP_SEC = 60 / BPM / 4;

/**
 * Procedural techno on the audio clock (no setInterval).
 * Volume follows distance to the stage, with spill into halls and plaza.
 */
export class ConTechno {
	private ctx: AudioContext | null = null;
	private master: GainNode | null = null;
	private nextStep = 0;
	private step = 0;
	private ready = false;

	unlock(): void {
		if (this.ready) return;
		this.ready = true;
		const Ac =
			globalThis.AudioContext ?? (globalThis as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
		if (!Ac) return;
		const ctx = new Ac();
		const master = ctx.createGain();
		master.gain.value = 0;
		master.connect(ctx.destination);
		this.ctx = ctx;
		this.master = master;
		this.nextStep = ctx.currentTime + 0.05;
	}

	update(viewer: Vector3): void {
		if (!(this.ctx && this.master)) return;
		if (this.ctx.state === 'suspended') void this.ctx.resume();

		const now = this.ctx.currentTime;
		// Schedule a short horizon so tabs don't backlog.
		while (this.nextStep < now + 0.2) {
			this.scheduleStep(this.nextStep, this.step % 16);
			this.nextStep += STEP_SEC;
			this.step++;
		}

		const dist = Math.hypot(viewer.x - CON_TECHNO_SOURCE.x, viewer.z - CON_TECHNO_SOURCE.z);
		const near = clamp01(1 - dist / CON_TECHNO_RANGE);
		const zone = inRect2(CON_STAGE, viewer.x, viewer.z)
			? 1
			: inRect2(CON_DEALERS, viewer.x, viewer.z)
				? 0.75
				: inRect2(CON_PLAZA, viewer.x, viewer.z)
					? 0.55
					: 0.35;
		const target = near * near * zone * 0.35;
		const g = this.master.gain;
		g.setTargetAtTime(target, now, 0.08);
	}

	dispose(): void {
		void this.ctx?.close();
		this.ctx = null;
		this.master = null;
	}

	private scheduleStep(t0: number, step: number): void {
		if (step % 4 === 0) this.blip(t0, 55, 0.12, 'sine', 0.9, true);
		if (step % 2 === 1) this.blip(t0, 8000, 0.03, 'square', 0.08, false);
		if (step === 6 || step === 14) this.blip(t0, 180, 0.08, 'triangle', 0.25, false);
		if (step === 0 || step === 8) this.blip(t0, 90, 0.2, 'sawtooth', 0.2, false);
	}

	private blip(...[t0, freq, dur, type, gain, drop]: [number, number, number, OscillatorType, number, boolean]): void {
		if (!(this.ctx && this.master)) return;
		const osc = this.ctx.createOscillator();
		const g = this.ctx.createGain();
		osc.type = type;
		osc.frequency.setValueAtTime(freq, t0);
		if (drop) osc.frequency.exponentialRampToValueAtTime(40, t0 + dur);
		g.gain.setValueAtTime(gain, t0);
		g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
		osc.connect(g);
		g.connect(this.master);
		osc.start(t0);
		osc.stop(t0 + dur + 0.02);
	}
}
