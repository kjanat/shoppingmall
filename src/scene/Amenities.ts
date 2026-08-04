import * as THREE from 'three';
import { lit } from '#/render/material';
import { labelCanvas, labelTexture } from '#/util/label';

/**
 * Fountain (particles), monkey in tree, Aperol Spritz bar.
 * Architect-friendly: no floating nonsense, grounded on floor 0 atrium.
 */
export class Amenities {
	readonly group = new THREE.Group();
	private fountainDrops: THREE.Points;
	private fountainVel: Float32Array;
	private aperolDrops: THREE.Points;
	private aperolVel: Float32Array;
	private monkey: THREE.Group;
	private monkeyBase: THREE.Vector3;
	private materials: THREE.Material[] = [];

	constructor() {
		this.group.name = 'amenities';
		this.buildFountain();
		this.buildAperolBar();
		const { monkey, base } = this.buildMonkeyInTree();
		this.monkey = monkey;
		this.monkeyBase = base;
		this.group.add(monkey);

		this.fountainDrops = this.makeParticles(180, 0x88ccff, 0.08);
		this.fountainVel = this.initVel(180, 2.5, 4);
		this.group.add(this.fountainDrops);

		this.aperolDrops = this.makeParticles(60, 0xff6b35, 0.07);
		this.aperolVel = this.initVel(60, 1.2, 2.2);
		this.aperolDrops.position.set(-14, 0, 10);
		this.group.add(this.aperolDrops);
	}

	update(dt: number, t: number): void {
		this.updateParticles(this.fountainDrops, this.fountainVel, dt, 0, 1.2, 3.5);
		this.updateParticles(this.aperolDrops, this.aperolVel, dt, -14, 1.0, 2.0);
		// Monkey climbs/sways on palm
		this.monkey.position.x = this.monkeyBase.x + Math.sin(t * 1.2) * 0.15;
		this.monkey.position.y = this.monkeyBase.y + Math.sin(t * 2.5) * 0.08;
		this.monkey.position.z = this.monkeyBase.z + Math.cos(t * 1.2) * 0.1;
		this.monkey.rotation.y = Math.sin(t * 0.8) * 0.4;
	}

	private track<T extends THREE.Material>(m: T): T {
		this.materials.push(m);
		return m;
	}

	private buildFountain(): void {
		const base = new THREE.Mesh(
			new THREE.CylinderGeometry(2.4, 2.8, 0.45, 24),
			this.track(lit({ color: 0xb0bec5, metalness: 0.5, roughness: 0.4 })),
		);
		base.position.set(0, 0.22, 0);
		this.group.add(base);

		const basin = new THREE.Mesh(
			new THREE.CylinderGeometry(2.0, 2.1, 0.5, 24),
			this.track(
				lit({
					color: 0x4fc3f7,
					transparent: true,
					opacity: 0.55,
					roughness: 0.15,
				}),
			),
		);
		basin.position.set(0, 0.55, 0);
		this.group.add(basin);

		const pillar = new THREE.Mesh(
			new THREE.CylinderGeometry(0.25, 0.35, 1.4, 12),
			this.track(lit({ color: 0x90a4ae, metalness: 0.6, roughness: 0.35 })),
		);
		pillar.position.set(0, 1.2, 0);
		this.group.add(pillar);

		const bowl = new THREE.Mesh(
			new THREE.SphereGeometry(0.55, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.5),
			this.track(lit({ color: 0xcfd8dc, metalness: 0.5, roughness: 0.3 })),
		);
		bowl.position.set(0, 1.9, 0);
		this.group.add(bowl);

		// Sign
		const { canvas: c, ctx } = labelCanvas(256, 64);
		ctx.fillStyle = '#1565c0';
		ctx.fillRect(0, 0, 256, 64);
		ctx.fillStyle = '#fff';
		ctx.font = 'bold 22px system-ui';
		ctx.textAlign = 'center';
		ctx.fillText('FONTEIN', 128, 40);
		const tex = labelTexture(c);
		const sp = new THREE.Sprite(this.track(new THREE.SpriteMaterial({ map: tex, transparent: true })));
		sp.position.set(0, 3.2, 0);
		sp.scale.set(2, 0.5, 1);
		this.group.add(sp);
	}

	private buildAperolBar(): void {
		const g = new THREE.Group();
		g.position.set(-14, 0, 10);

		const counter = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.0, 1.2), this.track(lit({ color: 0x5d4037, roughness: 0.7 })));
		counter.position.y = 0.5;
		g.add(counter);

		// Aperol bottles (orange)
		for (let i = 0; i < 4; i++) {
			const bot = new THREE.Mesh(
				new THREE.CylinderGeometry(0.08, 0.1, 0.45, 8),
				this.track(lit({ color: 0xff6b35, roughness: 0.4, metalness: 0.2 })),
			);
			bot.position.set(-0.9 + i * 0.55, 1.25, 0);
			g.add(bot);
		}

		// Spritz glass
		const glass = new THREE.Mesh(
			new THREE.CylinderGeometry(0.12, 0.08, 0.35, 10),
			this.track(
				lit({
					color: 0xff8a50,
					transparent: true,
					opacity: 0.75,
					roughness: 0.1,
				}),
			),
		);
		glass.position.set(0.9, 1.25, 0.2);
		g.add(glass);

		const { canvas: c, ctx } = labelCanvas(320, 80);
		ctx.fillStyle = '#ff6b35';
		ctx.fillRect(0, 0, 320, 80);
		ctx.fillStyle = '#fff';
		ctx.font = 'bold 26px system-ui';
		ctx.textAlign = 'center';
		ctx.fillText('APEROL SPRITZ 🍊', 160, 48);
		const tex = labelTexture(c);
		const sign = new THREE.Mesh(
			new THREE.PlaneGeometry(2.4, 0.6),
			this.track(new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })),
		);
		sign.position.set(0, 2.0, 0.65);
		g.add(sign);

		this.group.add(g);
	}

	private buildMonkeyInTree(): { monkey: THREE.Group; base: THREE.Vector3 } {
		// Sit on a palm near atrium (Palms has trees around center)
		// Monkey on palm NEXT to fountain, not in the water
		const base = new THREE.Vector3(4.2, 3.5, 0);
		const m = new THREE.Group();
		m.position.copy(base);

		const fur = this.track(lit({ color: 0x6d4c41, roughness: 0.9 }));
		const face = this.track(lit({ color: 0xe0b090, roughness: 0.85 }));
		const body = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 10), fur);
		body.scale.set(1, 1.15, 0.9);
		body.position.y = 0.15;
		m.add(body);
		const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 10), face);
		head.position.set(0, 0.45, 0.08);
		m.add(head);
		// ears
		const earL = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 6), fur);
		const earR = earL.clone();
		earL.position.set(-0.16, 0.52, 0);
		earR.position.set(0.16, 0.52, 0);
		m.add(earL, earR);
		// tail
		const tail = new THREE.Mesh(new THREE.CapsuleGeometry(0.04, 0.4, 3, 6), fur);
		tail.position.set(-0.25, 0.1, -0.2);
		tail.rotation.z = 0.8;
		m.add(tail);
		// eyes
		const eyeMat = this.track(new THREE.MeshBasicMaterial({ color: 0x111111 }));
		const e1 = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 6), eyeMat);
		const e2 = e1.clone();
		e1.position.set(-0.06, 0.48, 0.26);
		e2.position.set(0.06, 0.48, 0.26);
		m.add(e1, e2);

		const { canvas: c, ctx } = labelCanvas(128, 40);
		ctx.fillStyle = 'rgba(0,0,0,0.7)';
		ctx.fillRect(0, 0, 128, 40);
		ctx.fillStyle = '#fff';
		ctx.font = 'bold 16px system-ui';
		ctx.textAlign = 'center';
		ctx.fillText('🐵 aap', 64, 26);
		const tex = labelTexture(c);
		const sp = new THREE.Sprite(this.track(new THREE.SpriteMaterial({ map: tex, transparent: true })));
		sp.scale.set(1.0, 0.32, 1);
		sp.position.y = 0.85;
		m.add(sp);

		return { monkey: m, base };
	}

	private makeParticles(count: number, color: number, size: number): THREE.Points {
		const positions = new Float32Array(count * 3);
		for (let i = 0; i < count; i++) {
			positions[i * 3] = (Math.random() - 0.5) * 0.4;
			positions[i * 3 + 1] = 1.5 + Math.random() * 1.5;
			positions[i * 3 + 2] = (Math.random() - 0.5) * 0.4;
		}
		const geo = new THREE.BufferGeometry();
		geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
		const mat = new THREE.PointsMaterial({
			color,
			size,
			transparent: true,
			opacity: 0.75,
			depthWrite: false,
		});
		return new THREE.Points(geo, mat);
	}

	private initVel(count: number, upMin: number, upMax: number): Float32Array {
		const v = new Float32Array(count * 3);
		for (let i = 0; i < count; i++) {
			v[i * 3] = (Math.random() - 0.5) * 0.4;
			v[i * 3 + 1] = upMin + Math.random() * (upMax - upMin);
			v[i * 3 + 2] = (Math.random() - 0.5) * 0.4;
		}
		return v;
	}

	private updateParticles(pts: THREE.Points, vel: Float32Array, dt: number, ox: number, resetY: number, maxY: number): void {
		const pos = pts.geometry.getAttribute('position');
		const arr = pos.array as Float32Array;
		for (let i = 0; i + 2 < arr.length; i += 3) {
			arr[i] = (arr[i] ?? 0) + (vel[i] ?? 0) * dt;
			arr[i + 1] = (arr[i + 1] ?? 0) + (vel[i + 1] ?? 0) * dt;
			arr[i + 2] = (arr[i + 2] ?? 0) + (vel[i + 2] ?? 0) * dt;
			vel[i + 1] = (vel[i + 1] ?? 0) - 6 * dt;
			if ((arr[i + 1] ?? 0) < resetY - 0.5 || (arr[i + 1] ?? 0) > maxY + 2) {
				arr[i] = (Math.random() - 0.5) * 0.35;
				arr[i + 1] = resetY;
				arr[i + 2] = (Math.random() - 0.5) * 0.35;
				vel[i] = (Math.random() - 0.5) * 0.5;
				vel[i + 1] = 1.5 + Math.random() * 2.5;
				vel[i + 2] = (Math.random() - 0.5) * 0.5;
			}
		}
		pos.needsUpdate = true;
		void ox;
	}
}
