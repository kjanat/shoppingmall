import { ShittyDiscoMusic } from '@/audio/ShittyDisco';
import { at } from '@/util/rand';
import * as THREE from 'three';

/**
 * Dance party: arcade neon comeback + disco balls + shitty funny music.
 */
export class DiscoParty {
	readonly group = new THREE.Group();
	active = false;
	private lights: THREE.PointLight[] = [];
	private balls: THREE.Mesh[] = [];
	private floorGlow: THREE.Mesh[] = [];
	private neonStrips: THREE.Mesh[] = [];
	private materials: THREE.Material[] = [];
	private t = 0;
	private music = new ShittyDiscoMusic();
	private scene: THREE.Scene | null = null;
	private savedBg: THREE.Color | null = null;
	private savedFog: THREE.Fog | THREE.FogExp2 | null = null;
	/** Mall daylight lights we dim during the party */
	private dimmed: { light: THREE.Light; intensity: number }[] = [];

	constructor() {
		this.group.name = 'disco';
		this.group.visible = false;

		const spots: [number, number, number][] = [
			[0, 5, 0],
			[-18, 4, -12],
			[18, 4, -12],
			[-18, 4, 12],
			[18, 4, 12],
			[0, 10, 0],
			[-10, 10, 8],
			[10, 10, -8],
			[0, 4, 14],
			[-22, 4, 0],
			[22, 4, 0],
			[-8, 5, 0],
			[8, 5, 0],
		];

		const colors = [0xff0088, 0x00ffcc, 0xffee00, 0x8800ff, 0x00aaff, 0xff4400];

		spots.forEach(([x, y, z], i) => {
			const col = at(colors, i);
			const light = new THREE.PointLight(col, 0, 32, 1.5);
			light.position.set(x, y, z);
			this.group.add(light);
			this.lights.push(light);

			const ball = new THREE.Mesh(
				new THREE.IcosahedronGeometry(0.4, 1),
				this.track(
					new THREE.MeshStandardMaterial({
						color: 0xeeeeee,
						metalness: 0.95,
						roughness: 0.12,
						emissive: col,
						emissiveIntensity: 0.35,
					}),
				),
			);
			ball.position.set(x, y + 0.55, z);
			this.group.add(ball);
			this.balls.push(ball);

			const glow = new THREE.Mesh(
				new THREE.CircleGeometry(2.5, 24),
				this.track(
					new THREE.MeshBasicMaterial({
						color: col,
						transparent: true,
						opacity: 0.18,
						depthWrite: false,
						side: THREE.DoubleSide,
					}),
				),
			);
			glow.rotation.x = -Math.PI / 2;
			glow.position.set(x, y > 7 ? 6.05 : 0.05, z);
			this.group.add(glow);
			this.floorGlow.push(glow);
		});

		// Arcade neon edge strips
		const edges: [number, number, number, number, number, number][] = [
			[0, 0.12, 22, 50, 0.1, 0.1],
			[0, 0.12, -22, 50, 0.1, 0.1],
			[32, 0.12, 0, 0.1, 0.1, 36],
			[-32, 0.12, 0, 0.1, 0.1, 36],
			[0, 6.12, 18, 36, 0.1, 0.1],
			[0, 6.12, -18, 36, 0.1, 0.1],
		];
		for (const [x, y, z, sx, sy, sz] of edges) {
			const mat = this.track(
				new THREE.MeshStandardMaterial({
					color: 0x00ffc8,
					emissive: 0x00ffc8,
					emissiveIntensity: 1.4,
				}),
			);
			const strip = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
			strip.position.set(x, y, z);
			this.group.add(strip);
			this.neonStrips.push(strip);
		}
	}

	bindScene(scene: THREE.Scene): void {
		this.scene = scene;
	}

	private track<T extends THREE.Material>(m: T): T {
		this.materials.push(m);
		return m;
	}

	setActive(on: boolean): void {
		this.active = on;
		this.group.visible = on;
		for (const l of this.lights) {
			// Keep disco accents moderate — dark room, neon pops
			l.intensity = on ? 4.5 : 0;
			l.distance = 22;
		}
		if (on) {
			this.music.ensure();
			this.music.start();
			if (this.scene) {
				const bg = this.scene.background;
				this.savedBg = bg instanceof THREE.Color ? bg.clone() : new THREE.Color(0xc8d4e4);
				this.savedFog = this.scene.fog;
				// Deep arcade night
				this.scene.background = new THREE.Color(0x05030c);
				this.scene.fog = new THREE.FogExp2(0x080510, 0.028);

				// Dim all non-disco mall lights (daylight wash out)
				this.dimmed = [];
				this.scene.traverse((obj) => {
					if (!(obj instanceof THREE.Light)) return;
					if (this.lights.includes(obj as THREE.PointLight)) return;
					// skip lights parented under disco group
					let p: THREE.Object3D | null = obj.parent;
					while (p) {
						if (p === this.group) return;
						p = p.parent;
					}
					this.dimmed.push({ light: obj, intensity: obj.intensity });
					if (obj instanceof THREE.AmbientLight) obj.intensity *= 0.12;
					else if (obj instanceof THREE.HemisphereLight) obj.intensity *= 0.1;
					else if (obj instanceof THREE.DirectionalLight) obj.intensity *= 0.08;
					else obj.intensity *= 0.15;
				});
			}
		} else {
			this.music.stop();
			if (this.scene && this.savedBg) {
				this.scene.background = this.savedBg;
				this.scene.fog = this.savedFog;
			}
			for (const { light, intensity } of this.dimmed) {
				light.intensity = intensity;
			}
			this.dimmed = [];
		}
	}

	toggle(): boolean {
		this.setActive(!this.active);
		return this.active;
	}

	update(dt: number): void {
		if (!this.active) return;
		this.t += dt;
		// Pulse with the boom-bam-bam-boom (~118bpm)
		const beat = Math.pow(Math.max(0, Math.sin(this.t * Math.PI * (118 / 60) * 2)), 4);
		this.lights.forEach((l, i) => {
			// Dim base + soft beat flash — not a nuclear flashbang
			l.intensity = 2.8 + beat * 3.2 + Math.sin(this.t * 2 + i) * 0.6;
			const c = new THREE.Color().setHSL((this.t * 0.18 + i * 0.11) % 1, 0.95, 0.48);
			l.color.copy(c);
			const ball = at(this.balls, i);
			ball.rotation.y += dt * (1.8 + i * 0.1);
			ball.rotation.x += dt * 0.9;
			const mat = ball.material as THREE.MeshStandardMaterial;
			mat.emissive.copy(c);
			mat.emissiveIntensity = 0.35 + beat * 0.45;
			const glow = at(this.floorGlow, i);
			(glow.material as THREE.MeshBasicMaterial).color.copy(c);
			(glow.material as THREE.MeshBasicMaterial).opacity = 0.1 + beat * 0.14;
		});
		this.neonStrips.forEach((strip, i) => {
			const m = strip.material as THREE.MeshStandardMaterial;
			const c = new THREE.Color().setHSL((this.t * 0.25 + i * 0.18) % 1, 1, 0.5);
			m.color.copy(c);
			m.emissive.copy(c);
			m.emissiveIntensity = 0.7 + beat * 0.9;
		});
	}
}
