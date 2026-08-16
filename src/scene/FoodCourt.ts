import type { Material } from 'three';
import {
	BoxGeometry,
	CapsuleGeometry,
	CylinderGeometry,
	Group,
	Mesh,
	MeshBasicMaterial,
	PlaneGeometry,
	SphereGeometry,
	Sprite,
	SpriteMaterial,
	Vector3,
} from 'three';
import { levelY } from '#/data/levels';
import { FOOD_COURT_SPEC } from '#/data/world';
import type { LightPool } from '#/render/LightPool';
import { lit } from '#/render/material';
import { labelCanvas, labelTexture } from '#/util/label';
import { half } from '#/util/math';

/**
 * Open food court — floor 1, south balcony over the atrium.
 * Tables in the middle, greasy stalls around the edge.
 * Perfect hangry American destination.
 */
export class FoodCourt {
	readonly group = new Group();
	/** V1 south balcony strip — between atrium void and south store wall */
	readonly pos = new Vector3(FOOD_COURT_SPEC.center.x, levelY('v1'), FOOD_COURT_SPEC.center.z);
	private materials: Material[] = [];
	private pool: LightPool;

	constructor(pool: LightPool) {
		this.pool = pool;
		this.group.name = 'foodCourt';
		this.group.position.copy(this.pos);
		this.buildFloor();
		this.buildTables();
		this.buildStalls();
		this.buildSign();
		this.buildLights();
	}

	private track<T extends Material>(m: T): T {
		this.materials.push(m);
		return m;
	}

	private buildFloor(): void {
		// Checker tile plaza
		// Compact balcony plaza (must not eat south store footprints at z=18)
		const { plaza, stripe } = FOOD_COURT_SPEC;
		const floor = new Mesh(
			new BoxGeometry(plaza.width, plaza.thickness, plaza.depth),
			this.track(
				lit({
					color: 0xe8dcc8,
					roughness: 0.85,
					metalness: 0.05,
				}),
			),
		);
		floor.position.y = half(plaza.thickness);
		floor.receiveShadow = true;
		this.group.add(floor);

		// Yellow caution strip border
		const strip = new Mesh(
			new BoxGeometry(stripe.width, stripe.thickness, stripe.depth),
			this.track(new MeshBasicMaterial({ color: 0xf5c518, toneMapped: false })),
		);
		strip.position.set(0, stripe.centerY, -stripe.offsetZ);
		this.group.add(strip);
		const strip2 = strip.clone();
		strip2.position.z = stripe.offsetZ;
		this.group.add(strip2);
	}

	private buildTables(): void {
		const wood = this.track(lit({ color: 0x6d4c41, roughness: 0.75 }));
		const metal = this.track(lit({ color: 0x90a4ae, metalness: 0.5, roughness: 0.4 }));
		const trayMat = this.track(lit({ color: 0xf5f5f5, roughness: 0.5 }));

		const spots: [number, number][] = [
			[-4, -0.8],
			[-1.5, 0.4],
			[1.5, -0.5],
			[4, 0.6],
			[-3, 1.2],
			[0, 1.0],
			[3, 1.2],
		];

		for (const [tx, tz] of spots) {
			const g = new Group();
			g.position.set(tx, 0, tz);

			const top = new Mesh(new CylinderGeometry(0.55, 0.55, 0.06, 12), wood);
			top.position.y = 0.78;
			g.add(top);
			const pole = new Mesh(new CylinderGeometry(0.05, 0.07, 0.75, 8), metal);
			pole.position.y = 0.38;
			g.add(pole);

			// 3 stools
			for (let i = 0; i < 3; i++) {
				const a = (i / 3) * Math.PI * 2 + 0.4;
				const stool = new Mesh(new CylinderGeometry(0.18, 0.16, 0.08, 10), wood);
				stool.position.set(Math.cos(a) * 0.75, 0.48, Math.sin(a) * 0.75);
				g.add(stool);
				const leg = new Mesh(new CylinderGeometry(0.03, 0.03, 0.45, 6), metal);
				leg.position.set(Math.cos(a) * 0.75, 0.22, Math.sin(a) * 0.75);
				g.add(leg);
			}

			// greasy tray + burger blob
			const tray = new Mesh(new BoxGeometry(0.28, 0.03, 0.22), trayMat);
			tray.position.set(0.1, 0.84, 0.05);
			g.add(tray);
			const burger = new Mesh(new CylinderGeometry(0.08, 0.09, 0.08, 10), this.track(lit({ color: 0xc4783a, roughness: 0.7 })));
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
				x: -5.8,
				z: -1.6,
				rot: Math.PI / 2,
			},
			{
				name: 'PIZZA SLICE',
				sub: 'by the kilo',
				color: 0x2e7d32,
				accent: 0xffffff,
				x: -5.8,
				z: 1.4,
				rot: Math.PI / 2,
			},
			{
				name: 'TACO HUT',
				sub: 'extra cheese',
				color: 0xef6c00,
				accent: 0xfff176,
				x: 5.8,
				z: -1.6,
				rot: -Math.PI / 2,
			},
			{
				name: 'SOFT SERVE',
				sub: 'sprinkles free',
				color: 0x6a1b9a,
				accent: 0xf8bbd0,
				x: 5.8,
				z: 1.4,
				rot: -Math.PI / 2,
			},
			{
				name: 'CHINA WOK',
				sub: 'all you can carry',
				color: 0xb71c1c,
				accent: 0xffeb3b,
				x: 0,
				z: 2.0,
				rot: Math.PI,
			},
		];

		for (const s of stalls) {
			const g = new Group();
			g.position.set(s.x, 0, s.z);
			g.rotation.y = s.rot;

			const counter = new Mesh(
				new BoxGeometry(2.8, 1.0, 1.0),
				this.track(
					lit({
						color: s.color,
						roughness: 0.65,
						metalness: 0.1,
					}),
				),
			);
			counter.position.y = 0.55;
			g.add(counter);

			const top = new Mesh(
				new BoxGeometry(2.9, 0.08, 1.1),
				this.track(
					lit({
						color: 0xeceff1,
						metalness: 0.4,
						roughness: 0.4,
					}),
				),
			);
			top.position.y = 1.08;
			g.add(top);

			// Back wall / menu board
			const back = new Mesh(new BoxGeometry(2.8, 1.6, 0.12), this.track(lit({ color: 0x212121, roughness: 0.8 })));
			back.position.set(0, 1.9, -0.55);
			g.add(back);

			// Staanders: de achterwand begint op 1.1 m — zonder poten leek het
			// vanaf de noordkant een rij zwevende planken
			const postMat = this.track(lit({ color: 0x37474f, metalness: 0.6, roughness: 0.4 }));
			for (const sx of [-1.32, 1.32]) {
				const post = new Mesh(new CylinderGeometry(0.05, 0.05, 2.7, 8), postMat);
				post.position.set(sx, 1.35, -0.55);
				g.add(post);
			}

			const menu = this.makeSign(s.name, s.sub, s.color, s.accent);
			menu.position.set(0, 2.15, -0.46);
			g.add(menu);

			// Warm light, volgt de kraam: die wordt hieronder nog geplaatst en gedraaid.
			this.pool.register({
				color: 0xffcc88,
				intensity: 4,
				distance: 6,
				decay: 2,
				follow: g,
				offset: new Vector3(0, 2.4, 0.2),
			});

			// Vendor blob
			const skin = this.track(lit({ color: 0xe8b896, roughness: 0.85 }));
			const uni = this.track(lit({ color: s.accent, roughness: 0.7 }));
			const body = new Mesh(new CapsuleGeometry(0.16, 0.4, 4, 6), uni);
			body.position.set(0, 1.55, -0.15);
			g.add(body);
			const head = new Mesh(new SphereGeometry(0.14, 10, 10), skin);
			head.position.set(0, 1.95, -0.15);
			g.add(head);

			this.group.add(g);
		}
	}

	private makeSign(title: string, sub: string, bg: number, fg: number): Mesh {
		const { canvas: c, ctx } = labelCanvas(320, 100);
		ctx.fillStyle = `#${bg.toString(16).padStart(6, '0')}`;
		ctx.fillRect(0, 0, 320, 100);
		ctx.fillStyle = `#${fg.toString(16).padStart(6, '0')}`;
		ctx.font = 'bold 28px system-ui,sans-serif';
		ctx.textAlign = 'center';
		ctx.fillText(title, 160, 42);
		ctx.font = '18px system-ui';
		ctx.fillText(sub, 160, 72);
		const tex = labelTexture(c);
		return new Mesh(new PlaneGeometry(2.4, 0.75), this.track(new MeshBasicMaterial({ map: tex, toneMapped: false })));
	}

	private buildSign(): void {
		const { canvas: c, ctx } = labelCanvas(512, 128);
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
		const tex = labelTexture(c);
		const sp = new Sprite(this.track(new SpriteMaterial({ map: tex, transparent: true, depthTest: true })));
		sp.scale.set(5.5, 1.4, 1);
		sp.position.set(0, 3.6, 0);
		this.group.add(sp);
	}

	private buildLights(): void {
		this.pool.register({
			color: 0xffe0b2,
			intensity: 10,
			distance: 18,
			decay: 1.6,
			follow: this.group,
			offset: new Vector3(0, 3.2, 0),
		});
	}
}
