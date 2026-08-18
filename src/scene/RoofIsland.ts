import type { BufferGeometry, CanvasTexture, Material, Texture } from 'three';
import {
	BoxGeometry,
	Color,
	ConeGeometry,
	CylinderGeometry,
	DoubleSide,
	ExtrudeGeometry,
	Group,
	InstancedMesh,
	Mesh,
	MeshBasicMaterial,
	Object3D,
	Path,
	PlaneGeometry,
	Shape,
	ShapeGeometry,
	SphereGeometry,
	Sprite,
	SpriteMaterial,
	TubeGeometry,
	Vector2,
} from 'three';
import { levelY } from '#/data/levels';
import {
	inPool,
	POOL_CENTER,
	POOL_FLOOR_Y,
	POOL_OUTLINE,
	POOL_POLYGON,
	POOL_ROT,
	POOL_WATER_Y,
	poolFloorY,
	rimDistance,
} from '#/data/pool';
import {
	ROOF_ISLAND_DECK_THICKNESS,
	ROOF_ISLAND_PAD,
	ROOF_LOUNGER_SPEC,
	ROOF_LOUNGER_SPOTS,
	ROOF_PALM_SPEC,
	ROOF_PALM_SPOTS,
	ROOF_RAILING_SPEC,
	SLIDE_PLATFORM,
	SLIDE_TOWER_SPEC,
	TIKI_BAR_SPEC,
} from '#/data/world';
import type { LitMaterial } from '#/render/material';
import { lit } from '#/render/material';
import { SlideRide } from '#/scene/SlideRide';
import { backToBackLabel, fitText, labelCanvas, labelTexture } from '#/util/label';
import { half, midpoint, span } from '#/util/math';
import { at } from '#/util/rand';

const DECK_Y = levelY('roof');

import { SLIDE_LADDER_CLIMB, SLIDE_PLATFORM_TOP_Y } from '#/data/world';
// Het zwembadmodel woont nu in de datalaag; hier alleen doorgegeven voor bestaande lezers.

/** Breedte van de tegelrand rond het water. */
const RIM_W = 0.55;

/** Oppervlak van een gesloten polygoon, teken weggelaten. */
function polyArea(pts: readonly Vector2[]): number {
	let sum = 0;
	for (let i = 0; i < pts.length; i++) {
		const a = at(pts, i);
		const b = at(pts, i + 1);
		sum += a.x * b.y - b.x * a.y;
	}
	return Math.abs(sum) / 2;
}

/**
 * Duwt elk punt naar buiten langs zijn eigen normaal: een rand van gelijke
 * breedte.
 *
 * Welke kant "buiten" is hangt af van de winding, en die klapt om zodra dezelfde
 * omtrek gespiegeld wordt opgebouwd. Daar niet naar gokken: beide kanten
 * uitrekenen en de grootste nemen. Zat het fout, dan werd het gat groter dan de
 * omtrek en trianguleerde de rand tot een dichte plaat dwars over het water.
 */
function offsetOutward(pts: readonly Vector2[], d: number): Vector2[] {
	const shift = (sign: number) =>
		pts.map((_, i) => {
			const prev = at(pts, i - 1);
			const next = at(pts, i + 1);
			const tx = next.x - prev.x;
			const ty = next.y - prev.y;
			const len = Math.hypot(tx, ty) || 1;
			const p = at(pts, i);
			return new Vector2(p.x + (sign * ty * d) / len, p.y - (sign * tx * d) / len);
		});
	const outward = shift(1);
	return polyArea(outward) > polyArea(pts) ? outward : shift(-1);
}

/**
 * Tropisch dakeiland op het westelijke mall-dak. Zwembad in nierboonvorm,
 * buisglijbaan vanaf een 4 m toren, tiki-bar, palmen, ligstoelen, parasols
 * en — cruciaal voor de glijbaan-doorstroom — flessen GLIJMIDDEL en BABY OIL.
 * De veiligheidsrailing is er omdat de verzekeraar het dak heeft gezien.
 */
class RoofIsland {
	readonly group = new Group();

	/** Loopbaar dek voor de integrator */
	readonly roofPad = { ...ROOF_ISLAND_PAD, y: DECK_Y };
	/** Landmark voor de kaart/wayfinder */
	readonly landmark = { x: -19, z: 0, label: '🏝 ROOF ISLAND' };
	/** De rit door de buis: de bocht die hier getekend wordt is dezelfde die je meeneemt. */
	readonly ride = new SlideRide();

	private materials: Material[] = [];
	private geoms: BufferGeometry[] = [];
	private textures: Texture[] = [];
	private instanced: InstancedMesh[] = [];

	// Animatie-referenties (geen allocaties in update)
	private waterMat!: LitMaterial;
	private water!: Mesh;
	private waterBaseY = 0;
	private poolBall!: Mesh;
	private poolBallBaseY = 0;

	constructor() {
		this.group.name = 'roof_island';
		this.buildDeck();
		this.buildPool();
		this.buildSlide();
		this.buildTikiBar();
		this.buildPalms();
		this.buildLoungers();
		this.buildParasols();
		this.buildTowels();
		this.buildProps();
		this.buildRailing();
		this.buildSign();
	}

	update(dt: number, t: number): void {
		// Water: trage opacity-puls + minimale deining. Meer golf hoeft niet,
		// het is een dakzwembad, geen Noordzee.
		this.waterMat.opacity = 0.78 + Math.sin(t * 1.1) * 0.05;
		this.water.position.y = this.waterBaseY + Math.sin(t * 0.9) * 0.015;
		// Strandbal dobbert mee en draait loom rond
		this.poolBall.position.y = this.poolBallBaseY + Math.sin(t * 1.3 + 1.7) * 0.05;
		this.poolBall.rotation.y += dt * 0.4;
		this.poolBall.rotation.z = Math.sin(t * 0.7) * 0.15;
	}

	dispose(): void {
		for (const im of this.instanced) im.dispose();
		for (const g of this.geoms) g.dispose();
		for (const m of this.materials) m.dispose();
		for (const tx of this.textures) tx.dispose();
		this.group.clear();
	}

	private track<T extends Material>(m: T): T {
		this.materials.push(m);
		return m;
	}

	private geo<T extends BufferGeometry>(g: T): T {
		this.geoms.push(g);
		return g;
	}

	private label(draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, w = 256, h = 128): CanvasTexture {
		const { canvas: c, ctx } = labelCanvas(w, h);
		draw(ctx, w, h);
		const tex = labelTexture(c);
		this.textures.push(tex);
		return tex;
	}

	/** Zandlaag óp de dakplaat. Met zijn top op DECK_Y lag hij in het dak en flikkerde hij over 26×40 m. */
	private buildDeck(): void {
		const { minX, maxX, minZ, maxZ } = ROOF_ISLAND_PAD;
		const deck = new Mesh(
			this.geo(new BoxGeometry(span(minX, maxX), ROOF_ISLAND_DECK_THICKNESS, span(minZ, maxZ))),
			this.track(lit({ color: 0xe6cf9c, roughness: 0.95 })),
		);
		deck.position.set(midpoint(minX, maxX), DECK_Y + half(ROOF_ISLAND_DECK_THICKNESS), midpoint(minZ, maxZ));
		deck.receiveShadow = true;
		this.group.add(deck);
	}

	/** Nierboon — twee lobben, één taille. Anatomisch niet correct, wel gezellig. */
	private buildPoolShapes(): { inner: Shape; outer: Shape } {
		const inner = new Shape(POOL_OUTLINE.map((p) => p.clone()));
		const outer = new Shape(offsetOutward(POOL_OUTLINE, RIM_W));
		outer.holes.push(new Path(POOL_OUTLINE.map((p) => p.clone())));
		return { inner, outer };
	}

	private buildPool(): void {
		const pool = new Group();
		pool.name = 'pool';
		pool.position.set(POOL_CENTER.x, DECK_Y, POOL_CENTER.z);
		// Uit de constante: POOL_POLYGON rekent met dezelfde draai, en zodra die
		// twee uit elkaar lopen klopt inPool niet meer met wat je ziet.
		pool.rotation.y = POOL_ROT;

		const { inner, outer } = this.buildPoolShapes();

		// Tegelrand — licht verhoogd, zodat niemand 'per ongeluk' erin rijdt
		const rim = new Mesh(
			this.geo(new ExtrudeGeometry(outer, { depth: 0.12, bevelEnabled: false })),
			this.track(lit({ color: 0xf5f5f0, roughness: 0.6 })),
		);
		rim.rotation.x = -Math.PI / 2;
		rim.position.y = 0.005;
		pool.add(rim);

		// Donkere bodem onder het transparante water: dieptesuggestie voor bijna niks.
		// Blijft vlak op dekhoogte: hij dekt de dakplaat van de mall en de benen van
		// de zwemmers af. De loopbare bak zit in poolFloorY.
		const bottom = new Mesh(this.geo(new ShapeGeometry(inner)), this.track(lit({ color: 0x01579b, roughness: 0.85 })));
		bottom.rotation.x = -Math.PI / 2;
		bottom.position.y = 0.02;
		pool.add(bottom);

		// Waterspiegel — opacity pulseert in update()
		this.waterMat = this.track(
			lit({
				color: 0x29b6f6,
				roughness: 0.15,
				metalness: 0.1,
				transparent: true,
				opacity: 0.8,
			}),
		);
		this.water = new Mesh(this.geo(new ShapeGeometry(inner)), this.waterMat);
		this.water.rotation.x = -Math.PI / 2;
		// Uit de constante, zodat de waterlijn van de fysica nooit van de mesh loskomt
		this.waterBaseY = POOL_WATER_Y - DECK_Y;
		this.water.position.y = this.waterBaseY;
		pool.add(this.water);

		this.group.add(pool);
	}

	/** Buisglijbaan: 4 m toren, krul, plons. De flessen staan klaar bij buildProps. */
	private buildSlide(): void {
		const g = new Group();
		g.name = 'slide';
		const steel = this.track(lit({ color: 0x90a4ae, metalness: 0.6, roughness: 0.4 }));
		const { center, size, thickness, standHeight } = SLIDE_PLATFORM;
		const railInset = 0.05;

		// Torenpoten + platform
		const { leg: legSpec, ladder, tube: tubeSpec } = SLIDE_TOWER_SPEC;
		const legGeo = this.geo(new CylinderGeometry(legSpec.radius, legSpec.radius, standHeight, 8));
		for (const [sx, sz] of [
			[-1, -1],
			[1, -1],
			[-1, 1],
			[1, 1],
		] as const) {
			const leg = new Mesh(legGeo, steel);
			leg.position.set(center.x + sx * legSpec.offset, DECK_Y + half(standHeight), center.z + sz * legSpec.offset);
			g.add(leg);
		}
		const platform = new Mesh(
			this.geo(new BoxGeometry(size, thickness, size)),
			this.track(lit({ color: 0x455a64, roughness: 0.7 })),
		);
		platform.position.set(center.x, DECK_Y + standHeight, center.z);
		g.add(platform);

		// Platform-railing: drie zijden dicht, de vierde is de glijbaan zelf
		const railEdge = half(size) - railInset;
		const railGeo = this.geo(new BoxGeometry(size, 0.06, 0.06));
		for (const [rx, rz, ry] of [
			[center.x, center.z - railEdge, 0],
			[center.x, center.z + railEdge, 0],
			[center.x - railEdge, center.z, Math.PI / 2],
		] as const) {
			const rail = new Mesh(railGeo, steel);
			rail.position.set(rx, DECK_Y + standHeight + 0.7, rz);
			rail.rotation.y = ry;
			g.add(rail);
			const railLow = new Mesh(railGeo, steel);
			railLow.position.set(rx, DECK_Y + standHeight + 0.35, rz);
			railLow.rotation.y = ry;
			g.add(railLow);
		}

		// Ladder aan de zuidkant
		const ladderZ = center.z - half(size) - 0.03;
		const rungGeo = this.geo(new BoxGeometry(0.5, ladder.rungThickness, ladder.rungThickness));
		for (let i = 0; i < ladder.rungs; i++) {
			const rung = new Mesh(rungGeo, steel);
			rung.position.set(center.x, DECK_Y + 0.5 + i * 0.48, ladderZ);
			g.add(rung);
		}
		const ladderRailGeo = this.geo(new CylinderGeometry(0.035, 0.035, standHeight + 0.3, 6));
		for (const dx of [-0.27, 0.27]) {
			const lr = new Mesh(ladderRailGeo, steel);
			lr.position.set(center.x + dx, DECK_Y + 2.2, ladderZ);
			g.add(lr);
		}

		// De buis: CatmullRom-krul van platform naar het diepe
		const curve = this.ride.curve;
		const tube = new Mesh(
			this.geo(new TubeGeometry(curve, 48, tubeSpec.radius, 10, false)),
			this.track(lit({ color: 0xffca28, roughness: 0.35, side: DoubleSide })),
		);
		g.add(tube);

		// Steunen onder de buis, anders keurt zelfs déze mall het af
		const supGeoCache = new Map<number, CylinderGeometry>();
		for (const ct of [0.3, 0.55, 0.8]) {
			const p = curve.getPoint(ct);
			const h = Math.max(0.4, p.y - 0.55 - DECK_Y);
			const key = Math.round(h * 10);
			let sg = supGeoCache.get(key);
			if (!sg) {
				sg = this.geo(new CylinderGeometry(0.07, 0.07, h, 6));
				supGeoCache.set(key, sg);
			}
			const sup = new Mesh(sg, steel);
			sup.position.set(p.x, DECK_Y + half(h), p.z);
			g.add(sup);
		}

		this.group.add(g);
	}

	private buildTikiBar(): void {
		const g = new Group();
		g.name = 'tiki_bar';
		const { center, post, counter: counterSpec, thatch: thatchSpec, stool, sign: signSpec } = TIKI_BAR_SPEC;
		const cx = center.x;
		const cz = center.z;

		const bamboo = this.track(lit({ color: 0x9a7b4f, roughness: 0.9 }));
		const poleGeo = this.geo(new CylinderGeometry(post.radius, post.radius, post.height, 7));
		for (const [sx, sz] of [
			[-1, -1],
			[1, -1],
			[-1, 1],
			[1, 1],
		] as const) {
			const pole = new Mesh(poleGeo, bamboo);
			pole.position.set(cx + sx * post.offset, DECK_Y + post.centerY, cz + sz * post.offset);
			g.add(pole);
		}

		// Bar zelf: één plank, oneindige dorst
		const counter = new Mesh(
			this.geo(new BoxGeometry(counterSpec.width, counterSpec.height, counterSpec.depth)),
			this.track(lit({ color: 0x6d4c41, roughness: 0.8 })),
		);
		counter.position.set(cx + counterSpec.offsetX, DECK_Y + half(counterSpec.height), cz);
		g.add(counter);

		// Rieten kegeldakje
		const thatch = new Mesh(
			this.geo(new ConeGeometry(thatchSpec.radius, thatchSpec.height, 9)),
			this.track(lit({ color: 0xb8935a, roughness: 1 })),
		);
		thatch.position.set(cx, DECK_Y + thatchSpec.centerY, cz);
		g.add(thatch);

		// Krukken (instanced — drie krukken is ook een rij)
		const stoolGeo = this.geo(new CylinderGeometry(stool.topRadius, stool.bottomRadius, stool.height, 8));
		const stoolMat = this.track(lit({ color: 0x8d6e63, roughness: 0.85 }));
		const stools = new InstancedMesh(stoolGeo, stoolMat, stool.z.length);
		const d = new Object3D();
		stool.z.forEach((z, i) => {
			d.position.set(cx + stool.offsetX, DECK_Y + stool.centerY, z);
			d.rotation.set(0, 0, 0);
			d.updateMatrix();
			stools.setMatrixAt(i, d.matrix);
		});
		this.instanced.push(stools);
		g.add(stools);

		// Bordje, want zonder bordje is het gewoon een natte plank
		const tex = this.label(
			(ctx, w, h) => {
				ctx.fillStyle = '#4e342e';
				ctx.fillRect(0, 0, w, h);
				ctx.strokeStyle = '#ffb300';
				ctx.lineWidth = 6;
				ctx.strokeRect(4, 4, w - 8, h - 8);
				ctx.fillStyle = '#ffe082';
				ctx.font = 'bold 44px system-ui,sans-serif';
				ctx.textAlign = 'center';
				ctx.fillText('TIKI BAR', half(w), 56);
				ctx.font = '22px system-ui';
				fitText(ctx, 'cocktails op dakprijzen', { x: 16, y: 74, w: w - 32, h: 40 }, { size: 30, maxLines: 1 });
			},
			384,
			128,
		);
		const sign = backToBackLabel(
			this.geo(new PlaneGeometry(signSpec.width, signSpec.height)),
			this.track(new MeshBasicMaterial({ map: tex, toneMapped: false })),
		);
		sign.position.set(cx + signSpec.offsetX, DECK_Y + signSpec.centerY, cz);
		sign.rotation.y = -Math.PI / 2;
		g.add(sign);

		this.group.add(g);
	}

	/** 8 palmen, alles instanced: stammen, bladeren, kokosnoten. */
	private buildPalms(): void {
		const spots = ROOF_PALM_SPOTS;
		const { trunk } = ROOF_PALM_SPEC;
		const d = new Object3D();

		// Stammen (origin aan de voet)
		const trunkGeo = this.geo(new CylinderGeometry(trunk.topRadius, trunk.bottomRadius, trunk.height, 7));
		trunkGeo.translate(0, half(trunk.height), 0);
		const trunkMat = this.track(lit({ color: 0x8b6914, roughness: 0.9 }));
		const trunks = new InstancedMesh(trunkGeo, trunkMat, spots.length);
		spots.forEach(({ x, z, scale: s }, i) => {
			d.position.set(x, DECK_Y, z);
			d.rotation.set(0, i * 1.3, 0);
			d.scale.setScalar(s);
			d.updateMatrix();
			trunks.setMatrixAt(i, d.matrix);
		});
		this.instanced.push(trunks);
		this.group.add(trunks);

		// Bladeren: 9 per palm, één InstancedMesh, groentint via instanceColor
		const frondGeo = this.geo(new PlaneGeometry(0.42, 2.1));
		frondGeo.translate(0, 1.05, 0);
		const frondMat = this.track(lit({ color: 0xffffff, roughness: 0.85, side: DoubleSide }));
		const perPalm = 9;
		const fronds = new InstancedMesh(frondGeo, frondMat, spots.length * perPalm);
		const greens = [0x1b7a3d, 0x2d8a4e, 0x3d9b55, 0x228b22];
		const col = new Color();
		spots.forEach(({ x, z, scale: s }, i) => {
			for (let j = 0; j < perPalm; j++) {
				const a = (j / perPalm) * Math.PI * 2 + i * 0.7;
				d.position.set(x, DECK_Y + trunk.height * s, z);
				d.rotation.set(0, 0, 0);
				d.rotation.order = 'YXZ';
				d.rotation.y = a;
				d.rotation.x = -0.95 - (j % 3) * 0.1;
				d.scale.setScalar(s);
				d.updateMatrix();
				const idx = i * perPalm + j;
				fronds.setMatrixAt(idx, d.matrix);
				fronds.setColorAt(idx, col.setHex(at(greens, i + j)));
			}
		});
		this.instanced.push(fronds);
		this.group.add(fronds);

		// Kokosnoten: 2 per palm — genoeg voor de suggestie van gevaar
		const cocoGeo = this.geo(new SphereGeometry(0.11, 6, 6));
		const cocoMat = this.track(lit({ color: 0x5c4033, roughness: 0.9 }));
		const cocos = new InstancedMesh(cocoGeo, cocoMat, spots.length * 2);
		spots.forEach(({ x, z, scale: s }, i) => {
			for (let j = 0; j < 2; j++) {
				const a = i * 2.1 + j * Math.PI;
				d.position.set(x + Math.cos(a) * 0.18, DECK_Y + 3.3 * s, z + Math.sin(a) * 0.18);
				d.rotation.set(0, 0, 0);
				d.scale.setScalar(s);
				d.updateMatrix();
				cocos.setMatrixAt(i * 2 + j, d.matrix);
			}
		});
		this.instanced.push(cocos);
		this.group.add(cocos);
	}

	private buildLoungers(): void {
		const spots = ROOF_LOUNGER_SPOTS;
		const { seat, back } = ROOF_LOUNGER_SPEC;
		const d = new Object3D();
		const plastic = this.track(lit({ color: 0xf1f8f4, roughness: 0.7 }));

		const baseGeo = this.geo(new BoxGeometry(seat.width, seat.thickness, seat.depth));
		const bases = new InstancedMesh(baseGeo, plastic, spots.length);
		spots.forEach(({ x, z, yaw }, i) => {
			d.position.set(x, DECK_Y + seat.centerY, z);
			d.rotation.set(0, yaw, 0);
			d.updateMatrix();
			bases.setMatrixAt(i, d.matrix);
		});
		this.instanced.push(bases);
		this.group.add(bases);

		// Rugleuning: aan het hoofdeinde, schuin omhoog (siësta-stand)
		const backGeo = this.geo(new BoxGeometry(back.width, back.thickness, back.depth));
		const backs = new InstancedMesh(backGeo, plastic, spots.length);
		spots.forEach(({ x, z, yaw }, i) => {
			d.position.set(x - back.offset * Math.sin(yaw), DECK_Y + back.centerY, z - back.offset * Math.cos(yaw));
			d.rotation.set(0, 0, 0);
			d.rotation.order = 'YXZ';
			d.rotation.y = yaw;
			d.rotation.x = back.tilt;
			d.updateMatrix();
			backs.setMatrixAt(i, d.matrix);
		});
		this.instanced.push(backs);
		this.group.add(backs);
	}

	private buildParasols(): void {
		const spots: [number, number][] = [
			[-11.5, -12],
			[-11.5, -7.2],
			[-17, -6.8],
			[-24, 9.5],
		];
		const d = new Object3D();

		const poleGeo = this.geo(new CylinderGeometry(0.04, 0.04, 2.6, 6));
		poleGeo.translate(0, 1.3, 0);
		const poleMat = this.track(lit({ color: 0xcfd8dc, metalness: 0.5, roughness: 0.5 }));
		const poles = new InstancedMesh(poleGeo, poleMat, spots.length);

		const canopyGeo = this.geo(new ConeGeometry(1.5, 0.7, 8));
		const canopyMat = this.track(lit({ color: 0xffffff, roughness: 0.8, side: DoubleSide }));
		const canopies = new InstancedMesh(canopyGeo, canopyMat, spots.length);
		const colors = [0xff5252, 0x40c4ff, 0xffd740, 0xff4081];
		const col = new Color();
		spots.forEach(([x, z], i) => {
			d.position.set(x, DECK_Y, z);
			d.rotation.set(0, i * 0.8, 0);
			d.updateMatrix();
			poles.setMatrixAt(i, d.matrix);
			d.position.set(x, DECK_Y + 2.6, z);
			d.updateMatrix();
			canopies.setMatrixAt(i, d.matrix);
			canopies.setColorAt(i, col.setHex(at(colors, i)));
		});
		this.instanced.push(poles, canopies);
		this.group.add(poles, canopies);
	}

	private buildTowels(): void {
		// Handdoeken: 5 op de ligstoelen, 3 op het dek (territorium gemarkeerd)
		const loungers = ROOF_LOUNGER_SPOTS;
		const onLoungers = [0, 2, 4, 6, 7];
		const onDeck: [number, number, number][] = [
			[-17, -8, 0.4],
			[-21.5, 8.6, -0.7],
			[-12.6, 3, 1.2],
		];
		const geoT = this.geo(new PlaneGeometry(0.62, 1.5));
		geoT.rotateX(-Math.PI / 2);
		const mat = this.track(lit({ color: 0xffffff, roughness: 0.95, side: DoubleSide }));
		const towels = new InstancedMesh(geoT, mat, onLoungers.length + onDeck.length);
		const colors = [0xef5350, 0x26c6da, 0xffee58, 0xab47bc, 0x66bb6a, 0xff7043, 0x5c6bc0, 0xec407a];
		const d = new Object3D();
		const col = new Color();
		let idx = 0;
		for (const li of onLoungers) {
			const { x, z, yaw } = at(loungers, li);
			d.position.set(x, DECK_Y + 0.3, z);
			d.rotation.set(0, yaw, 0);
			d.updateMatrix();
			towels.setMatrixAt(idx, d.matrix);
			towels.setColorAt(idx, col.setHex(at(colors, idx)));
			idx++;
		}
		for (const [x, z, yaw] of onDeck) {
			d.position.set(x, DECK_Y + 0.02, z);
			d.rotation.set(0, yaw, 0);
			d.updateMatrix();
			towels.setMatrixAt(idx, d.matrix);
			towels.setColorAt(idx, col.setHex(at(colors, idx)));
			idx++;
		}
		this.instanced.push(towels);
		this.group.add(towels);
	}

	/** Flessen GLIJMIDDEL & BABY OIL bij de glijbaan, plus strandballen. */
	private buildProps(): void {
		const bottleGeo = this.geo(new CylinderGeometry(0.14, 0.14, 0.45, 10));
		const capGeo = this.geo(new CylinderGeometry(0.06, 0.06, 0.09, 8));
		const capMat = this.track(lit({ color: 0xd32f2f, roughness: 0.5 }));

		const glijTex = this.label((ctx, w, h) => {
			ctx.fillStyle = '#ffffff';
			ctx.fillRect(0, 0, w, h);
			ctx.fillStyle = '#d32f2f';
			ctx.fillRect(0, 0, w, 34);
			ctx.fillStyle = '#ffffff';
			ctx.font = 'bold 24px system-ui,sans-serif';
			ctx.textAlign = 'center';
			// Twee keer, zodat het label rondom leesbaar blijft
			ctx.fillText('GLIJMIDDEL', w * 0.25, 25);
			ctx.fillText('GLIJMIDDEL', w * 0.75, 25);
			ctx.fillStyle = '#263238';
			ctx.font = '16px system-ui';
			ctx.fillText('industriële sterkte', w * 0.25, 75);
			ctx.fillText('industriële sterkte', w * 0.75, 75);
			ctx.font = '13px system-ui';
			ctx.fillText('niet voor consumptie', w * 0.25, 105);
			ctx.fillText('niet voor consumptie', w * 0.75, 105);
		});
		const glijMat = this.track(lit({ map: glijTex, roughness: 0.4 }));

		const babyTex = this.label((ctx, w, h) => {
			ctx.fillStyle = '#fce4ec';
			ctx.fillRect(0, 0, w, h);
			ctx.fillStyle = '#ec407a';
			ctx.font = 'bold 26px system-ui,sans-serif';
			ctx.textAlign = 'center';
			ctx.fillText('BABY OIL', w * 0.25, 45);
			ctx.fillText('BABY OIL', w * 0.75, 45);
			ctx.fillStyle = '#880e4f';
			ctx.font = '15px system-ui';
			ctx.fillText('glijbaan-approved', w * 0.25, 85);
			ctx.fillText('glijbaan-approved', w * 0.75, 85);
		});
		const babyMat = this.track(lit({ map: babyTex, roughness: 0.4 }));

		const bottle = (...args: [Material, number, number, number, boolean]): void => {
			const [mat, x, y, z, tipped] = args;
			const b = new Mesh(bottleGeo, mat);
			b.position.set(x, y, z);
			if (tipped) {
				b.rotation.z = Math.PI / 2;
				b.position.y = y - 0.08;
			}
			this.group.add(b);
			if (!tipped) {
				const cap = new Mesh(capGeo, capMat);
				cap.position.set(x, y + 0.27, z);
				this.group.add(cap);
			}
		};
		// Eén boven op het platform (de startprocedure), rest bij ladder en bad
		bottle(glijMat, -28.2, DECK_Y + 4.3, -9.6, false);
		bottle(babyMat, -29.6, DECK_Y + 0.3, -11.8, false);
		bottle(glijMat, -24.5, DECK_Y + 0.3, -2.8, true);

		// Strandballen: klassiek gestreept
		const ballTex = this.label((ctx, w, h) => {
			const stripes = ['#e53935', '#ffffff', '#1e88e5', '#ffffff', '#fdd835', '#ffffff'];
			const sw = w / stripes.length;
			stripes.forEach((c, i) => {
				ctx.fillStyle = c;
				ctx.fillRect(i * sw, 0, sw + 1, h);
			});
		});
		const ballGeo = this.geo(new SphereGeometry(0.35, 12, 10));
		const ballMat = this.track(lit({ map: ballTex, roughness: 0.6 }));

		// Eén dobbert in het bad (geanimeerd), twee liggen te wachten op wind
		this.poolBall = new Mesh(ballGeo, ballMat);
		this.poolBallBaseY = DECK_Y + 0.28;
		this.poolBall.position.set(-19, this.poolBallBaseY, 0.5);
		this.group.add(this.poolBall);

		for (const [x, z, s] of [
			[-26.5, -13, 1],
			[-10.2, 10.5, 0.8],
		] as const) {
			const ball = new Mesh(ballGeo, ballMat);
			ball.position.set(x, DECK_Y + 0.35 * s, z);
			ball.scale.setScalar(s);
			ball.rotation.y = x * 2.3;
			this.group.add(ball);
		}
	}

	/** Railing rondom, met een opening aan de oostkant als entree. */
	private buildRailing(): void {
		const { minX, maxX, minZ, maxZ } = this.roofPad;
		const { height, barThickness, postRadius, postSpacing, entranceHalfDepth } = ROOF_RAILING_SPEC;
		const metal = this.track(lit({ color: 0xeceff1, metalness: 0.55, roughness: 0.4 }));

		// Paaltjes instanced langs de omtrek
		const positions: [number, number][] = [];
		for (let z = minZ; z <= maxZ; z += postSpacing) positions.push([minX, z]);
		for (let x = minX + postSpacing; x <= maxX; x += postSpacing) {
			positions.push([x, minZ]);
			positions.push([x, maxZ]);
		}
		for (let z = minZ + postSpacing; z < maxZ; z += postSpacing) {
			if (z > -entranceHalfDepth && z < entranceHalfDepth) continue; // entree
			positions.push([maxX, z]);
		}
		const postGeo = this.geo(new CylinderGeometry(postRadius, postRadius, height, 6));
		postGeo.translate(0, half(height), 0);
		const posts = new InstancedMesh(postGeo, metal, positions.length);
		const d = new Object3D();
		positions.forEach(([x, z], i) => {
			d.position.set(x, DECK_Y, z);
			d.rotation.set(0, 0, 0);
			d.updateMatrix();
			posts.setMatrixAt(i, d.matrix);
		});
		this.instanced.push(posts);
		this.group.add(posts);

		// Bovenregel: vijf balken (oostkant in twee stukken vanwege de entree)
		const railY = DECK_Y + height;
		const bar = (w: number, dep: number, x: number, z: number): void => {
			const m = new Mesh(this.geo(new BoxGeometry(w, barThickness, dep)), metal);
			m.position.set(x, railY, z);
			this.group.add(m);
		};
		bar(barThickness, span(minZ, maxZ), minX, midpoint(minZ, maxZ));
		bar(span(minX, maxX), barThickness, midpoint(minX, maxX), minZ);
		bar(span(minX, maxX), barThickness, midpoint(minX, maxX), maxZ);
		bar(barThickness, span(minZ, -entranceHalfDepth), maxX, midpoint(minZ, -entranceHalfDepth));
		bar(barThickness, span(entranceHalfDepth, maxZ), maxX, midpoint(entranceHalfDepth, maxZ));
	}

	private buildSign(): void {
		const tex = this.label(
			(ctx, w, h) => {
				ctx.fillStyle = 'rgba(15,23,42,0.92)';
				ctx.fillRect(0, 0, w, h);
				ctx.strokeStyle = '#26c6da';
				ctx.lineWidth = 6;
				ctx.strokeRect(6, 6, w - 12, h - 12);
				ctx.fillStyle = '#26c6da';
				ctx.font = 'bold 40px system-ui,sans-serif';
				ctx.textAlign = 'center';
				ctx.fillText('🏝 ROOF ISLAND', half(w), 55);
				ctx.fillStyle = '#e2e8f0';
				ctx.font = '20px system-ui';
				ctx.fillText('zwembad · tiki bar · glijmiddel gratis', half(w), 95);
			},
			512,
			128,
		);
		// depthTest AAN — zie de spook-signage-les van het helipad
		const sp = new Sprite(this.track(new SpriteMaterial({ map: tex, transparent: true })));
		sp.scale.set(7, 1.75, 1);
		sp.position.set(-19, DECK_Y + 6.5, 0);
		this.group.add(sp);
	}
}

export {
	RoofIsland,
	ROOF_ISLAND_PAD,
	SLIDE_LADDER_CLIMB,
	SLIDE_PLATFORM,
	SLIDE_PLATFORM_TOP_Y,
	inPool,
	POOL_CENTER,
	POOL_FLOOR_Y,
	POOL_POLYGON,
	POOL_WATER_Y,
	poolFloorY,
	rimDistance,
};
