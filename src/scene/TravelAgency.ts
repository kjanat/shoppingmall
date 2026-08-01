import * as THREE from 'three';
import { labelCanvas, labelTexture } from '@/util/label';
import { tagLevelCulled } from '@/util/visibility';

/**
 * Shady travel desk next to Beard-man's Cave (juwelen lair).
 * Sells "private island" packages to Little Saint James — dark mall satire,
 * cancelled/elite-meme vibes, no graphic crime content.
 */
export class TravelAgency {
	readonly group = new THREE.Group();
	/** World center — east of the gold cave mouth */
	/** West wall, between toilets and beard cave */
	readonly pos = new THREE.Vector3(-30, 0, 18);
	private materials: THREE.Material[] = [];
	private bob: THREE.Object3D[] = [];
	private t = 0;
	private agentRoot!: THREE.Group;

	constructor() {
		this.group.name = 'travelAgency';
		this.group.position.copy(this.pos);
		this.buildShell();
		this.buildDesk();
		this.buildAgent();
		this.buildPosters();
		this.buildProps();
		this.buildSigns();
		this.buildPalm();
	}

	getColliders(): { minX: number; maxX: number; minZ: number; maxZ: number; label: string }[] {
		const cx = this.pos.x;
		const cz = this.pos.z;
		return [
			// back (west, toward cave)
			{ minX: cx - 2.1, maxX: cx - 1.85, minZ: cz - 1.8, maxZ: cz + 1.8, label: 'travel_back' },
			{ minX: cx - 2.0, maxX: cx + 1.5, minZ: cz - 2.0, maxZ: cz - 1.75, label: 'travel_n' },
			{ minX: cx - 2.0, maxX: cx + 1.5, minZ: cz + 1.75, maxZ: cz + 2.0, label: 'travel_s' },
		];
	}

	update(dt: number): void {
		this.t += dt;
		// Agent slight sway
		if (this.agentRoot) {
			this.agentRoot.position.y = Math.sin(this.t * 1.4) * 0.02;
			this.agentRoot.rotation.y = Math.sin(this.t * 0.5) * 0.08 + Math.PI / 2;
		}
		this.bob.forEach((o, i) => {
			const phase = o.userData['phase'] ?? i;
			const baseY = o.userData['baseY'] ?? 0;
			o.rotation.z = Math.sin(this.t * 1.8 + phase) * 0.06;
			o.position.y = baseY + Math.sin(this.t * 2.2 + phase) * 0.03;
		});
	}

	private track<T extends THREE.Material>(m: T): T {
		this.materials.push(m);
		return m;
	}

	private buildShell(): void {
		const wall = this.track(new THREE.MeshStandardMaterial({ color: 0x0d3b4c, roughness: 0.85 }));
		const trim = this.track(
			new THREE.MeshStandardMaterial({
				color: 0xffd54f,
				metalness: 0.45,
				roughness: 0.4,
			}),
		);
		const floor = this.track(new THREE.MeshStandardMaterial({ color: 0xe0f2f1, roughness: 0.7 }));

		const slab = new THREE.Mesh(new THREE.BoxGeometry(4.0, 0.1, 3.8), floor);
		slab.position.set(0, 0.05, 0);
		this.group.add(slab);

		// Three-sided booth open to +X (mall)
		const back = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.6, 3.8), wall);
		back.position.set(-1.9, 1.3, 0);
		this.group.add(back);
		const n = new THREE.Mesh(new THREE.BoxGeometry(3.6, 2.6, 0.16), wall);
		n.position.set(-0.1, 1.3, -1.85);
		this.group.add(n);
		const s = n.clone();
		s.position.z = 1.85;
		this.group.add(s);

		// Gold trim fascia
		const fascia = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.35, 3.9), trim);
		fascia.position.set(1.55, 2.45, 0);
		this.group.add(fascia);

		// Soft tropical light
		const pl = new THREE.PointLight(0xffecb3, 1.4, 7, 2);
		pl.position.set(0.2, 2.1, 0);
		this.group.add(pl);
	}

	private buildDesk(): void {
		const wood = this.track(new THREE.MeshStandardMaterial({ color: 0x5d4037, roughness: 0.8 }));
		const top = this.track(
			new THREE.MeshStandardMaterial({
				color: 0xffecb3,
				roughness: 0.45,
				metalness: 0.1,
			}),
		);
		const desk = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 0.7), wood);
		desk.position.set(0.55, 0.45, 0);
		this.group.add(desk);
		const deskTop = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.08, 0.78), top);
		deskTop.position.set(0.55, 0.94, 0);
		this.group.add(deskTop);

		// Computer
		const mon = new THREE.Mesh(
			new THREE.BoxGeometry(0.45, 0.32, 0.04),
			this.track(new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.5 })),
		);
		mon.position.set(0.3, 1.25, -0.1);
		mon.rotation.y = 0.3;
		this.group.add(mon);
		const screen = new THREE.Mesh(
			new THREE.PlaneGeometry(0.4, 0.26),
			this.track(new THREE.MeshBasicMaterial({ color: 0x00bcd4, toneMapped: false })),
		);
		screen.position.set(0.3, 1.25, -0.07);
		screen.rotation.y = 0.3;
		this.group.add(screen);

		// Brochure stack
		for (let i = 0; i < 4; i++) {
			const b = new THREE.Mesh(
				new THREE.BoxGeometry(0.22, 0.02, 0.28),
				this.track(
					new THREE.MeshStandardMaterial({
						color: [0xff7043, 0x29b6f6, 0xffee58, 0x66bb6a][i],
						roughness: 0.7,
					}),
				),
			);
			b.position.set(1.0, 1.0 + i * 0.025, 0.15);
			b.rotation.y = (i - 1.5) * 0.08;
			this.group.add(b);
		}
	}

	/** Shady travel agent — shades, Hawaiian shirt, clipboard */
	private buildAgent(): void {
		const g = new THREE.Group();
		g.position.set(-0.15, 0, -0.15);
		g.rotation.y = Math.PI / 2;

		const skin = this.track(new THREE.MeshStandardMaterial({ color: 0xc68642, roughness: 0.85 }));
		const shirt = this.track(new THREE.MeshStandardMaterial({ color: 0xff6f00, roughness: 0.7 }));
		const pants = this.track(new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.8 }));
		const hairM = this.track(new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 }));

		const legL = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.45, 3, 6), pants);
		const legR = legL.clone();
		legL.position.set(-0.11, 0.4, 0);
		legR.position.set(0.11, 0.4, 0);
		g.add(legL, legR);

		const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.55, 4, 8), shirt);
		body.position.y = 1.05;
		g.add(body);

		// Flower pattern dots
		for (let i = 0; i < 6; i++) {
			const dot = new THREE.Mesh(
				new THREE.SphereGeometry(0.04, 6, 6),
				this.track(new THREE.MeshStandardMaterial({ color: 0xe91e63, roughness: 0.6 })),
			);
			dot.position.set(((i % 3) - 1) * 0.12, 0.95 + Math.floor(i / 3) * 0.2, 0.22);
			g.add(dot);
		}

		const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 12), skin);
		head.position.y = 1.65;
		g.add(head);
		const hair = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), hairM);
		hair.position.set(0, 1.72, -0.02);
		g.add(hair);

		// Sunglasses
		const shades = new THREE.Mesh(
			new THREE.BoxGeometry(0.22, 0.06, 0.04),
			this.track(
				new THREE.MeshStandardMaterial({
					color: 0x111111,
					metalness: 0.7,
					roughness: 0.25,
				}),
			),
		);
		shades.position.set(0, 1.68, 0.15);
		g.add(shades);

		// Clipboard
		const clip = new THREE.Mesh(
			new THREE.BoxGeometry(0.18, 0.24, 0.02),
			this.track(new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.6 })),
		);
		clip.position.set(0.28, 1.2, 0.2);
		clip.rotation.z = -0.3;
		g.add(clip);

		const name = this.makeSprite('RICKY · Island Agent', '#00695c', 220, 40);
		name.position.set(0, 2.05, 0);
		name.scale.set(1.3, 0.28, 1);
		g.add(name);
		tagLevelCulled(name);

		this.agentRoot = g;
		this.group.add(g);
	}

	private buildPosters(): void {
		// Big destination poster — private island silhouette
		const island = this.makeIslandPoster();
		const p1 = new THREE.Mesh(
			new THREE.PlaneGeometry(1.5, 1.1),
			this.track(new THREE.MeshBasicMaterial({ map: island, toneMapped: false })),
		);
		p1.position.set(-1.78, 1.55, 0);
		p1.rotation.y = Math.PI / 2;
		this.group.add(p1);

		// Side posters
		const p2 = new THREE.Mesh(
			new THREE.PlaneGeometry(1.1, 0.75),
			this.track(
				new THREE.MeshBasicMaterial({
					map: this.makeTextPoster(['EPSTEIN ISLAND', 'VIP CHARTER', '⚠ FLIGHTS SUSPENDED', 'since 2019'], '#004d40', '#ffeb3b'),
					toneMapped: false,
				}),
			),
		);
		p2.position.set(-0.3, 1.7, -1.74);
		this.group.add(p2);

		const p3 = new THREE.Mesh(
			new THREE.PlaneGeometry(1.1, 0.75),
			this.track(
				new THREE.MeshBasicMaterial({
					map: this.makeTextPoster(
						['LITTLE ST. JAMES', 'PRIVATE · ELITE', 'guest list: ████', 'NDA included'],
						'#1a237e',
						'#ffffff',
					),
					toneMapped: false,
				}),
			),
		);
		p3.position.set(-0.3, 1.7, 1.74);
		p3.rotation.y = Math.PI;
		this.group.add(p3);
	}

	private makeIslandPoster(): THREE.CanvasTexture {
		const { canvas: c, ctx } = labelCanvas(512, 384);
		// Sky
		const sky = ctx.createLinearGradient(0, 0, 0, 280);
		sky.addColorStop(0, '#0277bd');
		sky.addColorStop(1, '#81d4fa');
		ctx.fillStyle = sky;
		ctx.fillRect(0, 0, 512, 384);
		// Ocean
		ctx.fillStyle = '#00695c';
		ctx.fillRect(0, 240, 512, 144);
		ctx.fillStyle = '#00897b';
		ctx.fillRect(0, 250, 512, 40);
		// Island mound
		ctx.fillStyle = '#2e7d32';
		ctx.beginPath();
		ctx.ellipse(260, 250, 120, 45, 0, 0, Math.PI * 2);
		ctx.fill();
		ctx.fillStyle = '#c2b280';
		ctx.beginPath();
		ctx.ellipse(260, 265, 130, 30, 0, 0, Math.PI * 2);
		ctx.fill();
		// Palm
		ctx.strokeStyle = '#5d4037';
		ctx.lineWidth = 8;
		ctx.beginPath();
		ctx.moveTo(300, 250);
		ctx.quadraticCurveTo(320, 200, 310, 160);
		ctx.stroke();
		ctx.fillStyle = '#43a047';
		for (let i = 0; i < 5; i++) {
			const a = -1.2 + i * 0.5;
			ctx.beginPath();
			ctx.ellipse(310 + Math.cos(a) * 40, 155 + Math.sin(a) * 10, 35, 10, a, 0, Math.PI * 2);
			ctx.fill();
		}
		// Temple-ish blob (generic private island house)
		ctx.fillStyle = '#eceff1';
		ctx.fillRect(220, 210, 50, 40);
		ctx.fillStyle = '#b71c1c';
		ctx.beginPath();
		ctx.moveTo(215, 210);
		ctx.lineTo(245, 185);
		ctx.lineTo(275, 210);
		ctx.closePath();
		ctx.fill();
		// Title bar
		ctx.fillStyle = 'rgba(0,0,0,0.65)';
		ctx.fillRect(0, 0, 512, 70);
		ctx.fillStyle = '#ffd54f';
		ctx.font = 'bold 32px system-ui';
		ctx.textAlign = 'center';
		ctx.fillText('EPSTEIN ISLAND', 256, 32);
		ctx.font = 'bold 18px system-ui';
		ctx.fillStyle = '#fff';
		ctx.fillText('Little Saint James · private charter only', 256, 56);
		// Big red stamp
		ctx.save();
		ctx.translate(380, 300);
		ctx.rotate(-0.35);
		ctx.strokeStyle = '#c62828';
		ctx.lineWidth = 6;
		ctx.strokeRect(-70, -22, 140, 44);
		ctx.fillStyle = '#c62828';
		ctx.font = 'bold 20px system-ui';
		ctx.fillText('CANCELLED', 0, 8);
		ctx.restore();

		const tex = labelTexture(c);
		return tex;
	}

	private makeTextPoster(lines: string[], bg: string, fg: string): THREE.CanvasTexture {
		const { canvas: c, ctx } = labelCanvas(384, 256);
		ctx.fillStyle = bg;
		ctx.fillRect(0, 0, 384, 256);
		ctx.strokeStyle = fg;
		ctx.lineWidth = 8;
		ctx.strokeRect(10, 10, 364, 236);
		ctx.fillStyle = fg;
		ctx.textAlign = 'center';
		lines.forEach((line, i) => {
			ctx.font = i === 0 ? 'bold 28px system-ui' : 'bold 22px system-ui';
			ctx.fillText(line, 192, 55 + i * 48);
		});
		const tex = labelTexture(c);
		return tex;
	}

	private buildProps(): void {
		// Suitcase
		const caseM = this.track(new THREE.MeshStandardMaterial({ color: 0x37474f, roughness: 0.6, metalness: 0.2 }));
		const bag = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.55, 0.22), caseM);
		bag.position.set(1.2, 0.3, 1.1);
		this.group.add(bag);
		const handle = new THREE.Mesh(
			new THREE.TorusGeometry(0.1, 0.02, 6, 12, Math.PI),
			this.track(new THREE.MeshStandardMaterial({ color: 0xffd54f, metalness: 0.6, roughness: 0.3 })),
		);
		handle.position.set(1.2, 0.6, 1.1);
		handle.rotation.x = Math.PI;
		this.group.add(handle);

		// Globe
		const globe = new THREE.Mesh(
			new THREE.SphereGeometry(0.18, 16, 12),
			this.track(
				new THREE.MeshStandardMaterial({
					color: 0x1565c0,
					roughness: 0.5,
					metalness: 0.2,
				}),
			),
		);
		globe.position.set(1.05, 1.2, -0.2);
		this.group.add(globe);
		globe.userData['phase'] = 1.2;
		globe.userData['baseY'] = 1.2;
		this.bob.push(globe);
		// Continents blobs
		for (let i = 0; i < 5; i++) {
			const land = new THREE.Mesh(
				new THREE.SphereGeometry(0.06, 6, 6),
				this.track(new THREE.MeshStandardMaterial({ color: 0x2e7d32, roughness: 0.9 })),
			);
			const a = (i / 5) * Math.PI * 2;
			land.position.set(1.05 + Math.cos(a) * 0.14, 1.2 + Math.sin(a * 1.3) * 0.1, -0.2 + Math.sin(a) * 0.14);
			this.group.add(land);
		}

		// Tiny plane model on desk
		const plane = new THREE.Group();
		const fus = new THREE.Mesh(
			new THREE.CapsuleGeometry(0.04, 0.28, 4, 6),
			this.track(
				new THREE.MeshStandardMaterial({
					color: 0xffffff,
					metalness: 0.4,
					roughness: 0.4,
				}),
			),
		);
		fus.rotation.z = Math.PI / 2;
		plane.add(fus);
		const wing = new THREE.Mesh(
			new THREE.BoxGeometry(0.35, 0.02, 0.1),
			this.track(new THREE.MeshStandardMaterial({ color: 0xb0bec5, metalness: 0.5 })),
		);
		plane.add(wing);
		plane.position.set(0.85, 1.05, -0.25);
		plane.rotation.y = -0.5;
		this.group.add(plane);
		plane.userData['phase'] = 0.4;
		plane.userData['baseY'] = 1.05;
		this.bob.push(plane);

		// "No cameras" bin
		const bin = new THREE.Mesh(
			new THREE.CylinderGeometry(0.18, 0.15, 0.4, 10),
			this.track(new THREE.MeshStandardMaterial({ color: 0x212121, roughness: 0.7 })),
		);
		bin.position.set(1.3, 0.22, -1.2);
		this.group.add(bin);
		const cam = new THREE.Mesh(
			new THREE.BoxGeometry(0.14, 0.1, 0.08),
			this.track(new THREE.MeshStandardMaterial({ color: 0x424242, metalness: 0.4 })),
		);
		cam.position.set(1.3, 0.48, -1.2);
		this.group.add(cam);
	}

	private buildPalm(): void {
		const trunkM = this.track(new THREE.MeshStandardMaterial({ color: 0x6d4c41, roughness: 0.9 }));
		const leafM = this.track(new THREE.MeshStandardMaterial({ color: 0x2e7d32, roughness: 0.85 }));
		const pot = new THREE.Mesh(
			new THREE.CylinderGeometry(0.22, 0.18, 0.35, 10),
			this.track(new THREE.MeshStandardMaterial({ color: 0xbf360c, roughness: 0.7 })),
		);
		pot.position.set(1.35, 0.18, 0.9);
		this.group.add(pot);
		const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 1.1, 6), trunkM);
		trunk.position.set(1.35, 0.9, 0.9);
		trunk.rotation.z = 0.08;
		this.group.add(trunk);
		for (let i = 0; i < 6; i++) {
			const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.04, 0.12), leafM);
			const a = (i / 6) * Math.PI * 2;
			leaf.position.set(1.35 + Math.cos(a) * 0.15, 1.45, 0.9 + Math.sin(a) * 0.15);
			leaf.rotation.y = a;
			leaf.rotation.z = 0.4;
			this.group.add(leaf);
			leaf.userData['phase'] = i;
			leaf.userData['baseY'] = 1.45;
			this.bob.push(leaf);
		}
	}

	private buildSigns(): void {
		// Main fascia sign
		const main = this.makeSprite('🌴 ISLAND HOP TRAVEL  ·  Epstein Island charters', '#004d40', 512, 64);
		main.position.set(1.7, 2.55, 0);
		main.scale.set(3.2, 0.45, 1);
		this.group.add(main);
		tagLevelCulled(main);

		const sub = this.makeSprite('vlakbij de juwelen-cave  ·  cash only  ·  NDA at desk', '#b71c1c', 420, 48);
		sub.position.set(1.7, 2.2, 0);
		sub.scale.set(2.6, 0.32, 1);
		this.group.add(sub);
		tagLevelCulled(sub);

		// Floor A-board
		const board = new THREE.Mesh(
			new THREE.BoxGeometry(0.7, 0.9, 0.08),
			this.track(
				new THREE.MeshBasicMaterial({
					map: this.makeTextPoster(['BOOK NOW', 'EPSTEIN', 'ISLAND', '⚠ void ticket'], '#ffeb3b', '#b71c1c'),
					toneMapped: false,
				}),
			),
		);
		board.position.set(1.7, 0.5, 1.4);
		board.rotation.y = -0.4;
		this.group.add(board);
	}

	private makeSprite(text: string, bg: string, w: number, h: number): THREE.Sprite {
		const { canvas: c, ctx } = labelCanvas(w, h);
		ctx.fillStyle = bg;
		ctx.fillRect(0, 0, w, h);
		ctx.fillStyle = '#fff';
		ctx.font = `bold ${Math.floor(h * 0.42)}px system-ui`;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(text, w / 2, h / 2);
		const tex = labelTexture(c);
		return new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true }));
	}
}
