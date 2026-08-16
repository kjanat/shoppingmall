import type { Material } from 'three';
import {
	BoxGeometry,
	CylinderGeometry,
	DoubleSide,
	Group,
	Mesh,
	MeshBasicMaterial,
	PlaneGeometry,
	RingGeometry,
	SphereGeometry,
	Sprite,
	SpriteMaterial,
	TorusGeometry,
	Vector3,
} from 'three';
import { SPACESHIP_FRAME_RAILS, SPACESHIP_FRAME_Y, SPACESHIP_SPEC } from '#/data/world';
import type { LightPool } from '#/render/LightPool';
import { lit } from '#/render/material';
import { labelCanvas, labelTexture, roundRect } from '#/util/label';
import { half } from '#/util/math';

/**
 * The ultimate mall ending: a chrome saucer hovering above the landing pad.
 * Destination = UNDER the spaceship (next to Kruidvat, because why not).
 */
export class Spaceship {
	readonly group = new Group();
	/**
	 * Stand here: the floor-1 balcony rail on the south side of the atrium void,
	 * looking north into the hole at the saucer.
	 */
	readonly underPos = new Vector3(0, 6.15, 7.4);
	private ship: Group;
	private beam: Mesh;
	private ring: Mesh;
	private materials: Material[] = [];
	private pool: LightPool;
	/** Hovers inside the atrium void — above floor 1, under the skylight */
	private baseY = SPACESHIP_SPEC.saucer.hoverY;

	constructor(pool: LightPool) {
		this.pool = pool;
		this.group.name = 'spaceship';
		// Dead centre of the mall: the saucer hangs in the void ("de weide"), so
		// nothing intersects the floor-1 slab. It used to sit at z=16 and skewer it.
		this.group.position.set(0, 0, 0);

		this.buildLandingPad();
		this.ship = this.buildShip();
		// Slightly smaller saucer — was dominating the atrium
		this.ship.scale.setScalar(SPACESHIP_SPEC.saucer.scale);
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
		const mat = this.beam.material as MeshBasicMaterial;
		mat.opacity = 0.12 + Math.sin(t * 0.9) * 0.04;
		this.ring.rotation.y = -t * 0.2;
	}

	/** Camera target: under the ship looking up at the saucer */
	getUnderStandPoint(): Vector3 {
		return this.underPos.clone();
	}

	getShipLookPoint(): Vector3 {
		return new Vector3(this.underPos.x, this.baseY + 1, this.underPos.z);
	}

	private track<T extends Material>(m: T): T {
		this.materials.push(m);
		return m;
	}

	/**
	 * No pad under the saucer any more — it hovers over the atrium hole. Instead:
	 * a lit frame around the void on floor 1 and the H mark on the ground floor.
	 */
	private buildLandingPad(): void {
		const hMat = this.track(new MeshBasicMaterial({ color: 0xf5c518, toneMapped: false }));

		// Hazard frame hugging the floor-1 void edge
		const edge = this.track(new MeshBasicMaterial({ color: 0xf5c518, toneMapped: false }));
		for (const rail of SPACESHIP_FRAME_RAILS) {
			const bar = new Mesh(new BoxGeometry(rail.size.width, SPACESHIP_SPEC.frame.height, rail.size.depth), edge);
			bar.position.set(rail.center.x, SPACESHIP_FRAME_Y, rail.center.z);
			this.group.add(bar);
		}

		// Landing H painted on the ground floor, framing the fountain
		const h1 = new Mesh(new BoxGeometry(0.35, 0.03, 3.4), hMat);
		const h2 = new Mesh(new BoxGeometry(0.35, 0.03, 3.4), hMat);
		h1.position.set(-4.2, 0.03, 0);
		h2.position.set(4.2, 0.03, 0);
		this.group.add(h1, h2);
		const h3 = new Mesh(new BoxGeometry(8.0, 0.03, 0.35), hMat);
		h3.position.set(0, 0.03, 0);
		h3.visible = false; // the statue stands here — keep the crossbar clear
		this.group.add(h3);

		// Circle stripe on the ground floor, outside the fountain kerb
		const stripe = new Mesh(
			new RingGeometry(5.2, 5.6, 48),
			this.track(
				new MeshBasicMaterial({
					color: 0xf5c518,
					side: DoubleSide,
					toneMapped: false,
				}),
			),
		);
		stripe.rotation.x = -Math.PI / 2;
		stripe.position.y = 0.04;
		this.group.add(stripe);
	}

	private buildShip(): Group {
		const s = new Group();

		const hull = this.track(
			lit({
				color: 0xc0c8d4,
				metalness: 0.85,
				roughness: 0.25,
			}),
		);
		const dark = this.track(
			lit({
				color: 0x2a3038,
				metalness: 0.7,
				roughness: 0.35,
			}),
		);
		const glow = this.track(
			lit({
				color: 0x4fc3f7,
				emissive: 0x29b6f6,
				emissiveIntensity: 0.55,
				roughness: 0.3,
			}),
		);
		const green = this.track(
			lit({
				color: 0x00a651,
				emissive: 0x00a651,
				emissiveIntensity: 0.35,
				roughness: 0.4,
			}),
		);

		// Saucer disc
		const disc = new Mesh(new SphereGeometry(SPACESHIP_SPEC.saucer.hullRadius, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.45), hull);
		disc.scale.set(1, 0.28, 1);
		disc.position.y = 0;
		disc.castShadow = true;
		s.add(disc);

		// Underside
		const under = new Mesh(new SphereGeometry(3.6, 24, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI * 0.35), dark);
		under.scale.set(1, 0.35, 1);
		under.position.y = -0.15;
		s.add(under);

		// Dome cockpit
		const dome = new Mesh(
			new SphereGeometry(1.4, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.55),
			this.track(
				lit({
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
			const bulb = new Mesh(new SphereGeometry(0.12, 6, 6), i % 3 === 0 ? green : glow);
			bulb.position.set(Math.cos(a) * 3.6, -0.05, Math.sin(a) * 3.6);
			s.add(bulb);
		}

		// Engine ring under
		const eng = new Mesh(new TorusGeometry(1.2, 0.15, 8, 24), glow);
		eng.rotation.x = Math.PI / 2;
		eng.position.y = -0.55;
		s.add(eng);

		// Antenna
		const ant = new Mesh(new CylinderGeometry(0.04, 0.04, 1.2, 6), dark);
		ant.position.y = 1.5;
		s.add(ant);
		const ball = new Mesh(new SphereGeometry(0.12, 8, 8), green);
		ball.position.y = 2.1;
		s.add(ball);

		// Soft light from ship (stable), scaled with smaller saucer. Follows the
		// saucer: it still gets scaled and lifted to its hover height after this.
		this.pool.register({
			color: 0x88ccff,
			intensity: 12,
			distance: 22,
			decay: 1.6,
			follow: s,
			offset: new Vector3(0, -0.8, 0),
		});

		// Mall rooftop attraction sticker (family-friendly)
		const { canvas, ctx } = labelCanvas(256, 128);
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
		const tex = labelTexture(canvas);
		const sticker = new Mesh(new PlaneGeometry(2.2, 1.1), this.track(new MeshBasicMaterial({ map: tex, toneMapped: false })));
		sticker.position.set(0, 0.15, 3.5);
		s.add(sticker);

		return s;
	}

	/** Tractor beam: ship → ground floor, straight down the atrium hole. */
	private buildBeam(): Mesh {
		const geo = new CylinderGeometry(0.45, 2.4, this.baseY, 24, 1, true);
		const mat = this.track(
			new MeshBasicMaterial({
				color: 0x7fd4ff,
				transparent: true,
				opacity: 0.12,
				side: DoubleSide,
				depthWrite: false,
				toneMapped: false,
			}),
		);
		const mesh = new Mesh(geo, mat);
		mesh.position.y = half(this.baseY);
		return mesh;
	}

	private buildGroundRing(): Mesh {
		const mesh = new Mesh(
			new TorusGeometry(2.6, 0.05, 8, 40),
			this.track(
				new MeshBasicMaterial({
					color: 0x4fc3f7,
					transparent: true,
					opacity: 0.65,
					toneMapped: false,
				}),
			),
		);
		mesh.rotation.x = Math.PI / 2;
		mesh.position.y = 0.08;
		return mesh;
	}

	private makeSign(): Sprite {
		const { canvas, ctx } = labelCanvas(512, 128);
		ctx.fillStyle = 'rgba(15,23,42,0.9)';
		roundRect(ctx, { x: 8, y: 16, width: 496, height: 96, radius: 16 });
		ctx.fill();
		ctx.strokeStyle = '#4fc3f7';
		ctx.lineWidth = 4;
		roundRect(ctx, { x: 8, y: 16, width: 496, height: 96, radius: 16 });
		ctx.stroke();
		ctx.fillStyle = '#fff';
		ctx.font = '700 36px system-ui,sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText('UFO · boven de weide', 256, 52);
		ctx.font = '500 20px system-ui,sans-serif';
		ctx.fillStyle = '#94a3b8';
		ctx.fillText('einde van de route', 256, 88);
		const tex = labelTexture(canvas);
		const sprite = new Sprite(this.track(new SpriteMaterial({ map: tex, transparent: true })));
		sprite.position.set(0, 12.4, 0);
		sprite.scale.set(8, 2, 1);
		return sprite;
	}
}
