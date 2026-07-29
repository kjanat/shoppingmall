import * as THREE from 'three';
import type { Americans } from './Americans';

/**
 * Aliens probe the fat Americans: UFO beam + lift + abductions vibes.
 * Triggered periodically and on demand from DJ Bartek's booth.
 */
export class AlienProbe {
	readonly group = new THREE.Group();
	private materials: THREE.Material[] = [];
	private saucer: THREE.Group;
	private beam: THREE.Mesh;
	private active = false;
	private t = 0;
	private duration = 0;
	private targetPos = new THREE.Vector3();
	private probeCd = 25;
	private victims: { id: number; baseY: number }[] = [];
	private americans: Americans | null = null;

	constructor() {
		this.group.name = 'alienProbe';
		this.saucer = this.buildSaucer();
		this.group.add(this.saucer);
		this.beam = this.buildBeam();
		this.group.add(this.beam);
		this.group.visible = false;
	}

	bind(americans: Americans): void {
		this.americans = americans;
	}

	/** Force a probe wave now (e.g. from DJ booth button) */
	trigger(): void {
		this.startProbe();
	}

	update(dt: number): void {
		this.probeCd -= dt;
		if (!this.active && this.probeCd <= 0) {
			this.startProbe();
			this.probeCd = 40 + Math.random() * 50;
		}
		if (!this.active) return;

		this.t += dt;
		const u = Math.min(1, this.t / this.duration);
		// Hover over target cluster
		this.saucer.position.x = THREE.MathUtils.lerp(
			this.saucer.position.x,
			this.targetPos.x,
			dt * 2,
		);
		this.saucer.position.z = THREE.MathUtils.lerp(
			this.saucer.position.z,
			this.targetPos.z,
			dt * 2,
		);
		this.saucer.position.y = 7 + Math.sin(this.t * 3) * 0.35;
		this.saucer.rotation.y += dt * 1.8;
		this.beam.position.set(this.saucer.position.x, 3.5, this.saucer.position.z);
		const mat = this.beam.material as THREE.MeshBasicMaterial;
		mat.opacity = 0.15 + Math.sin(this.t * 12) * 0.1;

		// Lift victims slightly (probe)
		if (this.americans && this.victims.length) {
			const lift = Math.sin(Math.min(1, u) * Math.PI) * 1.4;
			for (const v of this.victims) {
				this.americans.nudgeSimHeight?.(v.id, v.baseY + lift);
			}
		}

		if (this.t >= this.duration) {
			this.endProbe();
		}
	}

	private startProbe(): void {
		if (!this.americans) return;
		const near = this.americans.getProbeCandidates(8);
		if (!near.length) return;
		this.active = true;
		this.t = 0;
		this.duration = 6 + Math.random() * 4;
		this.group.visible = true;

		// Average position of victims
		this.targetPos.set(0, 0, 0);
		this.victims = [];
		for (const c of near) {
			this.targetPos.add(c.pos);
			this.victims.push({ id: c.id, baseY: c.pos.y });
		}
		this.targetPos.multiplyScalar(1 / near.length);
		this.saucer.position.set(this.targetPos.x + 4, 9, this.targetPos.z - 3);

		// Mood: unhappiness spike (probed!)
		this.americans.applyProbeShock(this.victims.map((v) => v.id));
	}

	private endProbe(): void {
		this.active = false;
		this.group.visible = false;
		if (this.americans) {
			for (const v of this.victims) {
				this.americans.nudgeSimHeight?.(v.id, v.baseY);
			}
		}
		this.victims = [];
	}

	private track<T extends THREE.Material>(m: T): T {
		this.materials.push(m);
		return m;
	}

	private buildSaucer(): THREE.Group {
		const g = new THREE.Group();
		const disc = new THREE.Mesh(
			new THREE.SphereGeometry(1.4, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.55),
			this.track(
				new THREE.MeshStandardMaterial({
					color: 0xb0bec5,
					metalness: 0.85,
					roughness: 0.25,
					emissive: 0x224422,
					emissiveIntensity: 0.3,
				}),
			),
		);
		disc.scale.set(1, 0.35, 1);
		g.add(disc);
		const dome = new THREE.Mesh(
			new THREE.SphereGeometry(0.55, 16, 12),
			this.track(
				new THREE.MeshStandardMaterial({
					color: 0x69f0ae,
					transparent: true,
					opacity: 0.75,
					emissive: 0x00e676,
					emissiveIntensity: 0.6,
				}),
			),
		);
		dome.position.y = 0.35;
		g.add(dome);
		const light = new THREE.PointLight(0x69f0ae, 12, 18, 2);
		light.position.y = -0.5;
		g.add(light);
		return g;
	}

	private buildBeam(): THREE.Mesh {
		const mesh = new THREE.Mesh(
			new THREE.ConeGeometry(1.8, 7, 24, 1, true),
			this.track(
				new THREE.MeshBasicMaterial({
					color: 0x69f0ae,
					transparent: true,
					opacity: 0.2,
					side: THREE.DoubleSide,
					depthWrite: false,
				}),
			),
		);
		mesh.rotation.x = Math.PI;
		return mesh;
	}
}
