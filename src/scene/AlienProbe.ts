import * as THREE from 'three';
import { levelY } from '#/data/levels';
import type { LightHandle, LightPool } from '#/render/LightPool';
import { lit } from '#/render/material';
import { lerp, midpoint } from '#/util/math';
import type { Americans } from './Americans';

/** Hoe hoog de schotel boven de vloer van zijn slachtoffers hangt. */
const HOVER_HEIGHT = 7;

/** Marge onder het dak: de koepel steekt tot ~0.9 boven het schotelmidden uit. */
const SAUCER_CEILING_CLEARANCE = 1.2;

/** De lengte waarop de kegel gebouwd is; update() schaalt hem naar vloer-tot-schotel. */
const BEAM_LENGTH = 7;

/**
 * Aliens probe the fat Americans: UFO beam + lift + abductions vibes.
 * Triggered periodically and on demand from DJ Bartek's booth.
 */
export class AlienProbe {
	readonly group = new THREE.Group();
	private materials: THREE.Material[] = [];
	private saucer: THREE.Group;
	private beam: THREE.Mesh;
	private beamMat: THREE.MeshBasicMaterial;
	private active = false;
	private t = 0;
	private duration = 0;
	private targetPos = new THREE.Vector3();
	private probeCd = 25;
	private victims: { id: number; baseY: number }[] = [];
	/** De vloer van de slachtoffers; de straal eindigt daar en niet een dek lager. */
	private floorY = 0;
	private americans: Americans | null = null;
	private glow: LightHandle;

	constructor(pool: LightPool) {
		this.group.name = 'alienProbe';
		this.saucer = this.buildSaucer();
		// Follows the saucer: it only gets its position when the probe starts, so a
		// vaste wereldpositie zou hier altijd de verkeerde zijn.
		this.glow = pool.register({
			color: 0x69f0ae,
			intensity: 0,
			distance: 18,
			decay: 2,
			follow: this.saucer,
			offset: new THREE.Vector3(0, -0.5, 0),
		});
		this.group.add(this.saucer);
		this.beamMat = this.track(
			new THREE.MeshBasicMaterial({
				color: 0x69f0ae,
				transparent: true,
				opacity: 0.2,
				side: THREE.DoubleSide,
				depthWrite: false,
			}),
		);
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
		this.saucer.position.x = lerp(this.saucer.position.x, this.targetPos.x, dt * 2);
		this.saucer.position.z = lerp(this.saucer.position.z, this.targetPos.z, dt * 2);
		this.saucer.position.y = this.hoverY() + Math.sin(this.t * 3) * 0.35;
		this.saucer.rotation.y += dt * 1.8;
		// De straal loopt van de schotel tot de vloer van de slachtoffers. Met een vast
		// midden op 3.5 stak hij boven een V1-cluster dwars door het dek en hing hij
		// zichtbaar boven V0.
		this.beam.scale.y = (this.saucer.position.y - this.floorY) / BEAM_LENGTH;
		this.beam.position.set(this.saucer.position.x, midpoint(this.floorY, this.saucer.position.y), this.saucer.position.z);
		this.beamMat.opacity = 0.15 + Math.sin(this.t * 12) * 0.1;

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
		// group.visible only hides the saucer meshes now; the light lives in the
		// pool, so this no longer changes NUM_POINT_LIGHTS.
		this.group.visible = true;
		this.glow.intensity = 12;

		// Average position of victims
		this.targetPos.set(0, 0, 0);
		this.victims = [];
		for (const c of near) {
			this.targetPos.add(c.pos);
			this.victims.push({ id: c.id, baseY: c.pos.y });
		}
		this.targetPos.multiplyScalar(1 / near.length);
		// Een gemengd cluster krijgt de laagste vloer, zodat de straal iedereen haalt.
		this.floorY = Math.min(...this.victims.map((v) => v.baseY));
		this.saucer.position.set(this.targetPos.x + 4, this.hoverY(), this.targetPos.z - 3);

		// Mood: unhappiness spike (probed!)
		this.americans.applyProbeShock(this.victims.map((v) => v.id));
	}

	/** Boven een V1-cluster raakt vloer + zweefhoogte het dak; het plafond wint dan. */
	private hoverY(): number {
		return Math.min(this.floorY + HOVER_HEIGHT, levelY('roof') - SAUCER_CEILING_CLEARANCE);
	}

	private endProbe(): void {
		this.active = false;
		this.group.visible = false;
		this.glow.intensity = 0;
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
				lit({
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
				lit({
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
		return g;
	}

	private buildBeam(): THREE.Mesh {
		const mesh = new THREE.Mesh(new THREE.ConeGeometry(1.8, BEAM_LENGTH, 24, 1, true), this.beamMat);
		mesh.rotation.x = Math.PI;
		return mesh;
	}
}
