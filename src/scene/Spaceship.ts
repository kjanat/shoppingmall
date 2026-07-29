import * as THREE from 'three';

/**
 * The ultimate mall ending: a chrome saucer hovering above the landing pad.
 * Destination = UNDER the spaceship (next to Kruidvat, because why not).
 */
export class Spaceship {
	readonly group = new THREE.Group();
	/** Stand here — under the ship */
	readonly underPos = new THREE.Vector3(18, 6.15, -9);
	private ship: THREE.Group;
	private beam: THREE.Mesh;
	private ring: THREE.Mesh;
	private lights: THREE.PointLight[] = [];
	private materials: THREE.Material[] = [];
	private baseY = 14;

	constructor() {
		this.group.name = 'spaceship';
		this.group.position.set(this.underPos.x, 0, this.underPos.z);

		this.buildLandingPad();
		this.ship = this.buildShip();
		this.ship.position.y = this.baseY;
		this.group.add(this.ship);

		this.beam = this.buildBeam();
		this.group.add(this.beam);

		this.ring = this.buildGroundRing();
		this.group.add(this.ring);

		// Sign
		this.group.add(this.makeSign());
	}

	/** Soft hover + slow spin — smooth, not flickery */
	update(t: number): void {
		this.ship.position.y = this.baseY + Math.sin(t * 0.7) * 0.35;
		this.ship.rotation.y = t * 0.15;
		// beam breathe gently
		const mat = this.beam.material as THREE.MeshBasicMaterial;
		mat.opacity = 0.12 + Math.sin(t * 0.9) * 0.04;
		this.ring.rotation.y = -t * 0.2;
	}

	/** Camera target: under the ship looking up at the saucer */
	getUnderStandPoint(): THREE.Vector3 {
		return this.underPos.clone();
	}

	getShipLookPoint(): THREE.Vector3 {
		return new THREE.Vector3(this.underPos.x, this.baseY + 1, this.underPos.z);
	}

	private track<T extends THREE.Material>(m: T): T {
		this.materials.push(m);
		return m;
	}

	private buildLandingPad(): void {
		const pad = new THREE.Mesh(
			new THREE.CylinderGeometry(4.5, 4.8, 0.12, 32),
			this.track(
				new THREE.MeshStandardMaterial({
					color: 0x3a3f4a,
					metalness: 0.6,
					roughness: 0.4,
				}),
			),
		);
		pad.position.y = 6.06;
		pad.receiveShadow = true;
		this.group.add(pad);

		// H markings
		const hMat = this.track(
			new THREE.MeshBasicMaterial({ color: 0xf5c518, toneMapped: false }),
		);
		const h1 = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.04, 2.2), hMat);
		const h2 = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.04, 2.2), hMat);
		const h3 = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.04, 0.35), hMat);
		h1.position.set(-0.55, 6.14, 0);
		h2.position.set(0.55, 6.14, 0);
		h3.position.set(0, 6.14, 0);
		this.group.add(h1, h2, h3);

		// Circle stripe
		const stripe = new THREE.Mesh(
			new THREE.RingGeometry(3.6, 3.9, 48),
			this.track(
				new THREE.MeshBasicMaterial({
					color: 0xf5c518,
					side: THREE.DoubleSide,
					toneMapped: false,
				}),
			),
		);
		stripe.rotation.x = -Math.PI / 2;
		stripe.position.y = 6.13;
		this.group.add(stripe);
	}

	private buildShip(): THREE.Group {
		const s = new THREE.Group();

		const hull = this.track(
			new THREE.MeshStandardMaterial({
				color: 0xc0c8d4,
				metalness: 0.85,
				roughness: 0.25,
			}),
		);
		const dark = this.track(
			new THREE.MeshStandardMaterial({
				color: 0x2a3038,
				metalness: 0.7,
				roughness: 0.35,
			}),
		);
		const glow = this.track(
			new THREE.MeshStandardMaterial({
				color: 0x4fc3f7,
				emissive: 0x29b6f6,
				emissiveIntensity: 0.55,
				roughness: 0.3,
			}),
		);
		const green = this.track(
			new THREE.MeshStandardMaterial({
				color: 0x00a651,
				emissive: 0x00a651,
				emissiveIntensity: 0.35,
				roughness: 0.4,
			}),
		);

		// Saucer disc
		const disc = new THREE.Mesh(new THREE.SphereGeometry(4.2, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.45), hull);
		disc.scale.set(1, 0.28, 1);
		disc.position.y = 0;
		disc.castShadow = true;
		s.add(disc);

		// Underside
		const under = new THREE.Mesh(
			new THREE.SphereGeometry(3.6, 24, 12, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.35),
			dark,
		);
		under.scale.set(1, 0.35, 1);
		under.position.y = -0.15;
		s.add(under);

		// Dome cockpit
		const dome = new THREE.Mesh(
			new THREE.SphereGeometry(1.4, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.55),
			this.track(
				new THREE.MeshStandardMaterial({
					color: 0x88ccee,
					metalness: 0.3,
					roughness: 0.15,
					transparent: true,
					opacity: 0.75,
				}),
			),
		);
		dome.position.y = 0.55;
		s.add(dome);

		// Rim lights
		for (let i = 0; i < 12; i++) {
			const a = (i / 12) * Math.PI * 2;
			const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 6), i % 3 === 0 ? green : glow);
			bulb.position.set(Math.cos(a) * 3.6, -0.05, Math.sin(a) * 3.6);
			s.add(bulb);
		}

		// Engine ring under
		const eng = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.15, 8, 24), glow);
		eng.rotation.x = Math.PI / 2;
		eng.position.y = -0.55;
		s.add(eng);

		// Antenna
		const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.2, 6), dark);
		ant.position.y = 1.5;
		s.add(ant);
		const ball = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), green);
		ball.position.y = 2.1;
		s.add(ball);

		// Soft light from ship (stable)
		const pl = new THREE.PointLight(0x88ccff, 18, 28, 1.6);
		pl.position.set(0, -1, 0);
		s.add(pl);
		this.lights.push(pl);

		// Mall rooftop attraction sticker (family-friendly)
		const canvas = document.createElement('canvas');
		canvas.width = 256;
		canvas.height = 128;
		const ctx = canvas.getContext('2d')!;
		ctx.fillStyle = '#1e3a5f';
		ctx.fillRect(0, 0, 256, 128);
		ctx.fillStyle = '#f5c518';
		ctx.fillRect(0, 100, 256, 28);
		ctx.fillStyle = '#fff';
		ctx.font = 'bold 28px system-ui,sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText('SKY RIDE', 128, 50);
		ctx.font = 'bold 16px system-ui,sans-serif';
		ctx.fillText('mall attraction', 128, 88);
		const tex = new THREE.CanvasTexture(canvas);
		tex.colorSpace = THREE.SRGBColorSpace;
		const sticker = new THREE.Mesh(
			new THREE.PlaneGeometry(2.2, 1.1),
			this.track(new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })),
		);
		sticker.position.set(0, 0.15, 3.5);
		s.add(sticker);

		return s;
	}

	private buildBeam(): THREE.Mesh {
		const geo = new THREE.CylinderGeometry(0.6, 3.2, 12, 24, 1, true);
		const mat = this.track(
			new THREE.MeshBasicMaterial({
				color: 0x7fd4ff,
				transparent: true,
				opacity: 0.14,
				side: THREE.DoubleSide,
				depthWrite: false,
				toneMapped: false,
			}),
		);
		const mesh = new THREE.Mesh(geo, mat);
		mesh.position.y = 6 + 6;
		return mesh;
	}

	private buildGroundRing(): THREE.Mesh {
		const mesh = new THREE.Mesh(
			new THREE.TorusGeometry(2.8, 0.06, 8, 40),
			this.track(
				new THREE.MeshBasicMaterial({
					color: 0x4fc3f7,
					transparent: true,
					opacity: 0.7,
					toneMapped: false,
				}),
			),
		);
		mesh.rotation.x = Math.PI / 2;
		mesh.position.y = 6.2;
		return mesh;
	}

	private makeSign(): THREE.Sprite {
		const canvas = document.createElement('canvas');
		canvas.width = 512;
		canvas.height = 128;
		const ctx = canvas.getContext('2d')!;
		ctx.fillStyle = 'rgba(15,23,42,0.9)';
		roundRect(ctx, 8, 16, 496, 96, 16);
		ctx.fill();
		ctx.strokeStyle = '#4fc3f7';
		ctx.lineWidth = 4;
		roundRect(ctx, 8, 16, 496, 96, 16);
		ctx.stroke();
		ctx.fillStyle = '#fff';
		ctx.font = '700 36px system-ui,sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText('Kruidvat · hier beneden', 256, 52);
		ctx.font = '500 20px system-ui,sans-serif';
		ctx.fillStyle = '#94a3b8';
		ctx.fillText('einde van de route', 256, 88);
		const tex = new THREE.CanvasTexture(canvas);
		tex.colorSpace = THREE.SRGBColorSpace;
		const sprite = new THREE.Sprite(
			this.track(new THREE.SpriteMaterial({ map: tex, transparent: true })),
		);
		sprite.position.set(0, 9.5, 0);
		sprite.scale.set(8, 2, 1);
		return sprite;
	}
}

function roundRect(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	w: number,
	h: number,
	r: number,
): void {
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.arcTo(x + w, y, x + w, y + h, r);
	ctx.arcTo(x + w, y + h, x, y + h, r);
	ctx.arcTo(x, y + h, x, y, r);
	ctx.arcTo(x, y, x + w, y, r);
	ctx.closePath();
}
