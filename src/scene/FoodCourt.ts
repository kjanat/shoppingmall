import * as THREE from 'three';

/**
 * Open food court — floor 0, south of the atrium/kiosk.
 * Tables in the middle, greasy stalls around the edge.
 * Perfect hangry American destination.
 */
export class FoodCourt {
	readonly group = new THREE.Group();
	/** Plaza center */
	readonly pos = new THREE.Vector3(0, 0, 13.5);
	private materials: THREE.Material[] = [];

	constructor() {
		this.group.name = 'foodCourt';
		this.group.position.copy(this.pos);
		this.buildFloor();
		this.buildTables();
		this.buildStalls();
		this.buildSign();
		this.buildLights();
	}

	private track<T extends THREE.Material>(m: T): T {
		this.materials.push(m);
		return m;
	}

	private buildFloor(): void {
		// Checker tile plaza
		const floor = new THREE.Mesh(
			new THREE.BoxGeometry(18, 0.06, 9),
			this.track(
				new THREE.MeshStandardMaterial({
					color: 0xe8dcc8,
					roughness: 0.85,
					metalness: 0.05,
				}),
			),
		);
		floor.position.y = 0.03;
		floor.receiveShadow = true;
		this.group.add(floor);

		// Yellow caution strip border
		const strip = new THREE.Mesh(
			new THREE.BoxGeometry(18.2, 0.04, 0.18),
			this.track(new THREE.MeshBasicMaterial({ color: 0xf5c518, toneMapped: false })),
		);
		strip.position.set(0, 0.06, -4.4);
		this.group.add(strip);
		const strip2 = strip.clone();
		strip2.position.z = 4.4;
		this.group.add(strip2);
	}

	private buildTables(): void {
		const wood = this.track(
			new THREE.MeshStandardMaterial({ color: 0x6d4c41, roughness: 0.75 }),
		);
		const metal = this.track(
			new THREE.MeshStandardMaterial({ color: 0x90a4ae, metalness: 0.5, roughness: 0.4 }),
		);
		const trayMat = this.track(
			new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.5 }),
		);

		const spots: [number, number][] = [
			[-5, -1.5],
			[-2.5, 0.5],
			[0, -1.2],
			[2.5, 0.8],
			[5, -0.8],
			[-4, 2.2],
			[0, 2.0],
			[4, 2.2],
			[-1.5, -2.8],
			[1.8, -2.5],
		];

		for (const [tx, tz] of spots) {
			const g = new THREE.Group();
			g.position.set(tx, 0, tz);

			const top = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.06, 12), wood);
			top.position.y = 0.78;
			g.add(top);
			const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.75, 8), metal);
			pole.position.y = 0.38;
			g.add(pole);

			// 3 stools
			for (let i = 0; i < 3; i++) {
				const a = (i / 3) * Math.PI * 2 + 0.4;
				const stool = new THREE.Mesh(
					new THREE.CylinderGeometry(0.18, 0.16, 0.08, 10),
					wood,
				);
				stool.position.set(Math.cos(a) * 0.75, 0.48, Math.sin(a) * 0.75);
				g.add(stool);
				const leg = new THREE.Mesh(
					new THREE.CylinderGeometry(0.03, 0.03, 0.45, 6),
					metal,
				);
				leg.position.set(Math.cos(a) * 0.75, 0.22, Math.sin(a) * 0.75);
				g.add(leg);
			}

			// greasy tray + burger blob
			const tray = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.03, 0.22), trayMat);
			tray.position.set(0.1, 0.84, 0.05);
			g.add(tray);
			const burger = new THREE.Mesh(
				new THREE.CylinderGeometry(0.08, 0.09, 0.08, 10),
				this.track(new THREE.MeshStandardMaterial({ color: 0xc4783a, roughness: 0.7 })),
			);
			burger.position.set(0.1, 0.9, 0.05);
			g.add(burger);

			this.group.add(g);
		}
	}

	private buildStalls(): void {
		const stalls: {
			name: string;
			sub: string;
			color: number;
			accent: number;
			x: number;
			z: number;
			rot: number;
		}[] = [
			{
				name: 'BURGER BARN',
				sub: 'double thicc',
				color: 0xc62828,
				accent: 0xffc107,
				x: -7.5,
				z: -2.5,
				rot: Math.PI / 2,
			},
			{
				name: 'PIZZA SLICE',
				sub: 'by the kilo',
				color: 0x2e7d32,
				accent: 0xffffff,
				x: -7.5,
				z: 2.2,
				rot: Math.PI / 2,
			},
			{
				name: 'TACO HUT',
				sub: 'extra cheese',
				color: 0xef6c00,
				accent: 0xfff176,
				x: 7.5,
				z: -2.5,
				rot: -Math.PI / 2,
			},
			{
				name: 'SOFT SERVE',
				sub: 'sprinkles free',
				color: 0x6a1b9a,
				accent: 0xf8bbd0,
				x: 7.5,
				z: 2.2,
				rot: -Math.PI / 2,
			},
			{
				name: 'CHINA WOK',
				sub: 'all you can carry',
				color: 0xb71c1c,
				accent: 0xffeb3b,
				x: 0,
				z: 3.8,
				rot: Math.PI,
			},
		];

		for (const s of stalls) {
			const g = new THREE.Group();
			g.position.set(s.x, 0, s.z);
			g.rotation.y = s.rot;

			const counter = new THREE.Mesh(
				new THREE.BoxGeometry(2.8, 1.0, 1.0),
				this.track(
					new THREE.MeshStandardMaterial({
						color: s.color,
						roughness: 0.65,
						metalness: 0.1,
					}),
				),
			);
			counter.position.y = 0.55;
			g.add(counter);

			const top = new THREE.Mesh(
				new THREE.BoxGeometry(2.9, 0.08, 1.1),
				this.track(
					new THREE.MeshStandardMaterial({
						color: 0xeceff1,
						metalness: 0.4,
						roughness: 0.4,
					}),
				),
			);
			top.position.y = 1.08;
			g.add(top);

			// Back wall / menu board
			const back = new THREE.Mesh(
				new THREE.BoxGeometry(2.8, 1.6, 0.12),
				this.track(new THREE.MeshStandardMaterial({ color: 0x212121, roughness: 0.8 })),
			);
			back.position.set(0, 1.9, -0.55);
			g.add(back);

			const menu = this.makeSign(s.name, s.sub, s.color, s.accent);
			menu.position.set(0, 2.15, -0.46);
			g.add(menu);

			// Warm light
			const lamp = new THREE.PointLight(0xffcc88, 4, 6, 2);
			lamp.position.set(0, 2.4, 0.2);
			g.add(lamp);

			// Vendor blob
			const skin = this.track(
				new THREE.MeshStandardMaterial({ color: 0xe8b896, roughness: 0.85 }),
			);
			const uni = this.track(
				new THREE.MeshStandardMaterial({ color: s.accent, roughness: 0.7 }),
			);
			const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.4, 4, 6), uni);
			body.position.set(0, 1.55, -0.15);
			g.add(body);
			const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 10), skin);
			head.position.set(0, 1.95, -0.15);
			g.add(head);

			this.group.add(g);
		}
	}

	private makeSign(
		title: string,
		sub: string,
		bg: number,
		fg: number,
	): THREE.Mesh {
		const c = document.createElement('canvas');
		c.width = 320;
		c.height = 100;
		const ctx = c.getContext('2d')!;
		ctx.fillStyle = `#${bg.toString(16).padStart(6, '0')}`;
		ctx.fillRect(0, 0, 320, 100);
		ctx.fillStyle = `#${fg.toString(16).padStart(6, '0')}`;
		ctx.font = 'bold 28px system-ui,sans-serif';
		ctx.textAlign = 'center';
		ctx.fillText(title, 160, 42);
		ctx.font = '18px system-ui';
		ctx.fillText(sub, 160, 72);
		const tex = new THREE.CanvasTexture(c);
		tex.colorSpace = THREE.SRGBColorSpace;
		return new THREE.Mesh(
			new THREE.PlaneGeometry(2.4, 0.75),
			this.track(new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })),
		);
	}

	private buildSign(): void {
		const c = document.createElement('canvas');
		c.width = 512;
		c.height = 128;
		const ctx = c.getContext('2d')!;
		ctx.fillStyle = '#bf360c';
		ctx.fillRect(0, 0, 512, 128);
		ctx.fillStyle = '#ffcc02';
		ctx.fillRect(0, 100, 512, 28);
		ctx.fillStyle = '#fff';
		ctx.font = 'bold 40px system-ui,sans-serif';
		ctx.textAlign = 'center';
		ctx.fillText('FOOD COURT', 256, 50);
		ctx.font = '22px system-ui';
		ctx.fillText('hangry zone · open late · no diet zone', 256, 88);
		const tex = new THREE.CanvasTexture(c);
		tex.colorSpace = THREE.SRGBColorSpace;
		const sp = new THREE.Sprite(
			this.track(
				new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true }),
			),
		);
		sp.scale.set(5.5, 1.4, 1);
		sp.position.set(0, 3.6, 0);
		this.group.add(sp);
	}

	private buildLights(): void {
		const pl = new THREE.PointLight(0xffe0b2, 10, 18, 1.6);
		pl.position.set(0, 3.2, 0);
		this.group.add(pl);
	}
}
