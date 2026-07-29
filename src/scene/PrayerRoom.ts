import * as THREE from 'three';
import { spatial } from '../audio/SpatialAudio';

/**
 * Quiet gebedsruimte — soft loop with distance falloff (quadratic).
 * Respectful, small room near west stairs (not a joke room).
 */
export class PrayerRoom {
	readonly group = new THREE.Group();
	readonly pos = new THREE.Vector3(-28, 0, 8);
	private materials: THREE.Material[] = [];
	private audioStarted = false;
	private stopAudio: (() => void) | null = null;

	constructor() {
		this.group.name = 'prayerRoom';
		this.group.position.copy(this.pos);
		this.build();
	}

	/** Call after user gesture so AudioContext unlocks */
	ensureAudio(): void {
		if (this.audioStarted) return;
		this.audioStarted = true;
		// Soft synthetic adhan-like phrase loop (not a full religious recording)
		const handle = spatial.startLoopAt(
			{ x: this.pos.x, y: 1.4, z: this.pos.z },
			(ctx, dest) => {
				let alive = true;
				let timer: number | null = null;
				const phrase = () => {
					if (!alive) return;
					// "Allahu Akbar" as pitched vowels — simple, spatial, not mockery
					const notes = [220, 247, 277, 330, 277, 247, 220];
					const durs = [0.28, 0.28, 0.32, 0.45, 0.3, 0.28, 0.5];
					let t = ctx.currentTime + 0.02;
					for (let i = 0; i < notes.length; i++) {
						const o = ctx.createOscillator();
						const g = ctx.createGain();
						const f = ctx.createBiquadFilter();
						o.type = 'sine';
						o.frequency.setValueAtTime(notes[i], t);
						f.type = 'lowpass';
						f.frequency.value = 900;
						g.gain.setValueAtTime(0.0001, t);
						g.gain.exponentialRampToValueAtTime(0.12, t + 0.04);
						g.gain.exponentialRampToValueAtTime(0.0001, t + durs[i]);
						o.connect(f);
						f.connect(g);
						g.connect(dest);
						o.start(t);
						o.stop(t + durs[i] + 0.02);
						t += durs[i] * 0.92;
					}
					// pause between phrases
					timer = window.setTimeout(phrase, 5200 + Math.random() * 1800);
				};
				phrase();
				return {
					stop: () => {
						alive = false;
						if (timer !== null) clearTimeout(timer);
					},
				};
			},
			{ volume: 0.42, k: 0.06, maxDistance: 20 },
		);
		this.stopAudio = () => handle.stop();
	}

	update(_dt: number, listener: THREE.Vector3): void {
		// spatial listener is updated globally; room just exists
		void listener;
	}

	dispose(): void {
		this.stopAudio?.();
	}

	private track<T extends THREE.Material>(m: T): T {
		this.materials.push(m);
		return m;
	}

	private build(): void {
		// Small quiet room shell
		const wall = this.track(
			new THREE.MeshStandardMaterial({ color: 0xe8e4d9, roughness: 0.9 }),
		);
		const floor = new THREE.Mesh(
			new THREE.BoxGeometry(5.5, 0.08, 4.2),
			this.track(new THREE.MeshStandardMaterial({ color: 0xc4a574, roughness: 0.85 })),
		);
		floor.position.y = 0.04;
		this.group.add(floor);

		// three walls (open to mall corridor on +X toward center)
		const back = new THREE.Mesh(new THREE.BoxGeometry(5.5, 3.2, 0.15), wall);
		back.position.set(0, 1.6, -2.0);
		this.group.add(back);
		const left = new THREE.Mesh(new THREE.BoxGeometry(0.15, 3.2, 4.2), wall);
		left.position.set(-2.7, 1.6, 0);
		this.group.add(left);
		const right = new THREE.Mesh(new THREE.BoxGeometry(0.15, 3.2, 4.2), wall);
		right.position.set(2.7, 1.6, 0);
		this.group.add(right);

		// green carpet strip
		const carpet = new THREE.Mesh(
			new THREE.BoxGeometry(4.2, 0.03, 2.8),
			this.track(new THREE.MeshStandardMaterial({ color: 0x1b5e20, roughness: 0.95 })),
		);
		carpet.position.set(0, 0.1, -0.2);
		this.group.add(carpet);

		// prayer mats
		for (let i = 0; i < 3; i++) {
			const mat = new THREE.Mesh(
				new THREE.BoxGeometry(0.9, 0.02, 1.4),
				this.track(new THREE.MeshStandardMaterial({ color: 0x2e7d32, roughness: 0.9 })),
			);
			mat.position.set(-1.2 + i * 1.2, 0.12, -0.3);
			this.group.add(mat);
		}

		// soft lamp
		const lamp = new THREE.PointLight(0xffe0b2, 6, 8, 2);
		lamp.position.set(0, 2.6, 0);
		this.group.add(lamp);

		// sign
		const c = document.createElement('canvas');
		c.width = 320;
		c.height = 96;
		const ctx = c.getContext('2d')!;
		ctx.fillStyle = '#1b5e20';
		ctx.fillRect(0, 0, 320, 96);
		ctx.fillStyle = '#fff';
		ctx.font = 'bold 26px system-ui,sans-serif';
		ctx.textAlign = 'center';
		ctx.fillText('GEBEDSRUIMTE', 160, 40);
		ctx.font = '16px system-ui';
		ctx.fillText('stilte · respect', 160, 70);
		const tex = new THREE.CanvasTexture(c);
		tex.colorSpace = THREE.SRGBColorSpace;
		const sign = new THREE.Mesh(
			new THREE.PlaneGeometry(2.2, 0.65),
			this.track(new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })),
		);
		sign.position.set(0, 2.8, 2.15);
		this.group.add(sign);
	}
}
