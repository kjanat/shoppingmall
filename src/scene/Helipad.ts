import * as THREE from 'three';
import { ctx2d } from '@/util/dom';

/** Roof Y — top of mall ceiling slab (see MallBuilder ceil y) */
// Ceiling slab tops out at 13.75 (y 13.5 + 0.25 extrude) — the deck used to sit
// AT 13.4…13.575, i.e. embedded inside the slab. Deck top now lands at 13.95.
export const ROOF_Y = 13.95;

/**
 * Secret service stairs (V1 → dak) + helicopter landing pad on the roof.
 * Reachable on foot; "land" = stand on the H.
 */
export class Helipad {
	readonly group = new THREE.Group();
	readonly padCenter = new THREE.Vector3(22, ROOF_Y, 16);
	private materials: THREE.Material[] = [];

	constructor() {
		this.group.name = 'helipad';
		this.buildSecretStairs();
		this.buildRoofDeck();
		this.buildPad();
		this.buildLights();
		this.buildSigns();
	}

	private track<T extends THREE.Material>(m: T): T {
		this.materials.push(m);
		return m;
	}

	/** Hidden service stairwell on the SE service edge */
	private buildSecretStairs(): void {
		const g = new THREE.Group();
		g.name = 'secret_stairs';
		// Bottom on floor 1: (26, 6, 14) → top roof: (26, ROOF_Y, 18)
		const x = 26;
		const z0 = 14;
		const z1 = 18;
		const y0 = 6.05;
		const y1 = ROOF_Y;
		const rise = y1 - y0;
		const run = z1 - z0;
		const steps = 16;
		const metal = this.track(
			new THREE.MeshStandardMaterial({
				color: 0x455a64,
				metalness: 0.55,
				roughness: 0.45,
			}),
		);
		const tread = this.track(new THREE.MeshStandardMaterial({ color: 0x78909c, roughness: 0.55, metalness: 0.3 }));

		// Service door facade on floor 1
		const door = new THREE.Mesh(
			new THREE.BoxGeometry(1.4, 2.2, 0.12),
			this.track(new THREE.MeshStandardMaterial({ color: 0x37474f, roughness: 0.7 })),
		);
		door.position.set(x - 1.2, y0 + 1.1, z0 - 0.8);
		g.add(door);

		const c = document.createElement('canvas');
		c.width = 256;
		c.height = 96;
		const ctx = ctx2d(c);
		ctx.fillStyle = '#b71c1c';
		ctx.fillRect(0, 0, 256, 96);
		ctx.fillStyle = '#ffc107';
		ctx.font = 'bold 22px system-ui';
		ctx.textAlign = 'center';
		ctx.fillText('ALLEEN PERSONEEL', 128, 38);
		ctx.font = '16px system-ui';
		ctx.fillText('→ DAK / HELIPAD', 128, 68);
		const tex = new THREE.CanvasTexture(c);
		tex.colorSpace = THREE.SRGBColorSpace;
		const plate = new THREE.Mesh(
			new THREE.PlaneGeometry(1.5, 0.55),
			this.track(new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })),
		);
		plate.position.set(x - 1.2, y0 + 2.0, z0 - 0.72);
		g.add(plate);

		// Steps climb in +Z while rising
		const stepD = run / steps;
		const stepH = rise / steps;
		for (let i = 0; i < steps; i++) {
			const z = z0 + (i + 0.5) * stepD;
			const y = y0 + (i + 1) * stepH;
			const step = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.12, stepD * 0.9), tread);
			step.position.set(x, y - 0.06, z);
			g.add(step);
			const riser = new THREE.Mesh(new THREE.BoxGeometry(2.2, stepH * 0.95, 0.06), metal);
			riser.position.set(x, y - stepH * 0.5, z - stepD * 0.42);
			g.add(riser);
		}

		// Side rails
		const rail = this.track(new THREE.MeshStandardMaterial({ color: 0xffc107, metalness: 0.6, roughness: 0.35 }));
		for (const sx of [x - 1.2, x + 1.2]) {
			for (let i = 0; i < steps; i += 2) {
				const z = z0 + (i + 0.5) * stepD;
				const y = y0 + (i + 1) * stepH + 0.7;
				const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.7, 6), rail);
				post.position.set(sx, y - 0.35, z);
				g.add(post);
			}
		}

		// Hatch / top opening frame on roof
		const hatch = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.15, 2.4), metal);
		hatch.position.set(x, y1 + 0.08, z1 - 0.2);
		g.add(hatch);

		this.group.add(g);
	}

	private buildRoofDeck(): void {
		// Walkable roof patch SE — solid deck under helipad + approach from stairs
		// Deck starts at x=8/z=7 — the old 4..32 × 5..23 footprint overhung the
		// atrium skylight corner, so from V1 you saw roof clutter over your head.
		// Dek als shape MET een gat boven de secret stairs (26, 16.25) — de oude
		// dichte doos lag over de trapopening heen, dus boven was er geen trapgat.
		// NB: rotateX(-π/2) spiegelt shape-y → wereld −z, dus snijden op −z.
		const deckShape = new THREE.Shape();
		deckShape.moveTo(8, -23);
		deckShape.lineTo(32, -23);
		deckShape.lineTo(32, -7);
		deckShape.lineTo(8, -7);
		deckShape.lineTo(8, -23);
		const stairHole = new THREE.Path();
		stairHole.moveTo(24.5, -18.85);
		stairHole.lineTo(27.5, -18.85);
		stairHole.lineTo(27.5, -13.65);
		stairHole.lineTo(24.5, -13.65);
		stairHole.lineTo(24.5, -18.85);
		deckShape.holes.push(stairHole);
		const deckGeo = new THREE.ExtrudeGeometry(deckShape, {
			depth: 0.35,
			bevelEnabled: false,
		});
		deckGeo.rotateX(-Math.PI / 2);
		const deck = new THREE.Mesh(
			deckGeo,
			this.track(
				new THREE.MeshStandardMaterial({
					color: 0x3a3f48,
					metalness: 0.25,
					roughness: 0.75,
				}),
			),
		);
		deck.position.y = ROOF_Y - 0.35;
		deck.receiveShadow = true;
		this.group.add(deck);

		// Low safety wall on outer edges (not over stairs hatch)
		const wallM = this.track(new THREE.MeshStandardMaterial({ color: 0x546e7a, metalness: 0.4, roughness: 0.5 }));
		const wall = (w: number, d: number, x: number, z: number) => {
			const m = new THREE.Mesh(new THREE.BoxGeometry(w, 1.1, d), wallM);
			m.position.set(x, ROOF_Y + 0.5, z);
			this.group.add(m);
		};
		wall(24, 0.2, 20, 22.8);
		wall(0.2, 16, 31.8, 15);
		wall(0.2, 16, 8.2, 15);
	}

	private buildPad(): void {
		const pad = new THREE.Mesh(
			new THREE.CylinderGeometry(5.5, 5.8, 0.12, 40),
			this.track(
				new THREE.MeshStandardMaterial({
					color: 0x1a1a1a,
					metalness: 0.35,
					roughness: 0.55,
				}),
			),
		);
		pad.position.copy(this.padCenter);
		pad.position.y = ROOF_Y + 0.05;
		pad.receiveShadow = true;
		this.group.add(pad);

		// Yellow ring
		const ring = new THREE.Mesh(
			new THREE.RingGeometry(4.6, 5.1, 48),
			this.track(
				new THREE.MeshBasicMaterial({
					color: 0xf5c518,
					side: THREE.DoubleSide,
					toneMapped: false,
				}),
			),
		);
		ring.rotation.x = -Math.PI / 2;
		ring.position.set(this.padCenter.x, ROOF_Y + 0.12, this.padCenter.z);
		this.group.add(ring);

		// Big H
		const hMat = this.track(new THREE.MeshBasicMaterial({ color: 0xf5c518, toneMapped: false }));
		const h1 = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.06, 3.2), hMat);
		const h2 = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.06, 3.2), hMat);
		const h3 = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.06, 0.45), hMat);
		h1.position.set(this.padCenter.x - 1.0, ROOF_Y + 0.14, this.padCenter.z);
		h2.position.set(this.padCenter.x + 1.0, ROOF_Y + 0.14, this.padCenter.z);
		h3.position.set(this.padCenter.x, ROOF_Y + 0.14, this.padCenter.z);
		this.group.add(h1, h2, h3);

		// Windsock pole
		const pole = new THREE.Mesh(
			new THREE.CylinderGeometry(0.05, 0.05, 3.2, 8),
			this.track(new THREE.MeshStandardMaterial({ color: 0x90a4ae, metalness: 0.7 })),
		);
		pole.position.set(this.padCenter.x + 6.5, ROOF_Y + 1.6, this.padCenter.z + 4);
		this.group.add(pole);
		const sock = new THREE.Mesh(
			new THREE.ConeGeometry(0.35, 1.4, 8, 1, true),
			this.track(
				new THREE.MeshStandardMaterial({
					color: 0xff5722,
					side: THREE.DoubleSide,
					roughness: 0.8,
				}),
			),
		);
		sock.rotation.z = Math.PI / 2;
		sock.position.set(this.padCenter.x + 7.2, ROOF_Y + 3.0, this.padCenter.z + 4);
		this.group.add(sock);
	}

	private buildLights(): void {
		// Perimeter landing lights
		const lit = this.track(new THREE.MeshBasicMaterial({ color: 0x00e676, toneMapped: false }));
		for (let i = 0; i < 8; i++) {
			const a = (i / 8) * Math.PI * 2;
			const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), lit);
			bulb.position.set(this.padCenter.x + Math.cos(a) * 5.3, ROOF_Y + 0.2, this.padCenter.z + Math.sin(a) * 5.3);
			this.group.add(bulb);
		}
		const pl = new THREE.PointLight(0xfff4e0, 14, 30, 1.8);
		pl.position.set(this.padCenter.x, ROOF_Y + 4, this.padCenter.z);
		this.group.add(pl);
	}

	private buildSigns(): void {
		const c = document.createElement('canvas');
		c.width = 512;
		c.height = 128;
		const ctx = ctx2d(c);
		ctx.fillStyle = 'rgba(15,23,42,0.92)';
		ctx.fillRect(0, 0, 512, 128);
		ctx.strokeStyle = '#f5c518';
		ctx.lineWidth = 6;
		ctx.strokeRect(6, 6, 500, 116);
		ctx.fillStyle = '#f5c518';
		ctx.font = 'bold 36px system-ui,sans-serif';
		ctx.textAlign = 'center';
		ctx.fillText('HELIPAD · PRAIRIE LAKES', 256, 55);
		ctx.fillStyle = '#e2e8f0';
		ctx.font = '20px system-ui';
		ctx.fillText('Land soft · via geheime trap', 256, 95);
		const tex = new THREE.CanvasTexture(c);
		tex.colorSpace = THREE.SRGBColorSpace;
		// depthTest AAN: met false prikte het bord door de plafondplaat en hing
		// het als spook-signage boven verdieping 1
		const sp = new THREE.Sprite(this.track(new THREE.SpriteMaterial({ map: tex, transparent: true })));
		sp.scale.set(6, 1.5, 1);
		sp.position.set(this.padCenter.x, ROOF_Y + 3.2, this.padCenter.z);
		this.group.add(sp);

		// Point south toward glass elevator + green call pedestals
		const c2 = document.createElement('canvas');
		c2.width = 512;
		c2.height = 160;
		const ctx2 = ctx2d(c2);
		ctx2.fillStyle = '#1b5e20';
		ctx2.fillRect(0, 0, 512, 160);
		ctx2.strokeStyle = '#00e676';
		ctx2.lineWidth = 10;
		ctx2.strokeRect(6, 6, 500, 148);
		ctx2.fillStyle = '#fff';
		ctx2.font = 'bold 40px system-ui,sans-serif';
		ctx2.textAlign = 'center';
		ctx2.fillText('←  GLAZEN LIFT', 256, 60);
		ctx2.font = 'bold 28px system-ui,sans-serif';
		ctx2.fillStyle = '#ffc107';
		ctx2.fillText('gele streep · groene knop · E', 256, 115);
		const tex2 = new THREE.CanvasTexture(c2);
		tex2.colorSpace = THREE.SRGBColorSpace;
		const liftSign = new THREE.Mesh(
			new THREE.PlaneGeometry(5.5, 1.7),
			this.track(
				new THREE.MeshBasicMaterial({
					map: tex2,
					side: THREE.DoubleSide,
					toneMapped: false,
				}),
			),
		);
		// South edge of helipad deck → follow yellow path to green call knobs
		liftSign.position.set(18, ROOF_Y + 2.2, 8.5);
		this.group.add(liftSign);
	}
}
