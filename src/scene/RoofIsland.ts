import * as THREE from 'three';
import { levelY } from '#/data/levels';
import { type LitMaterial, lit } from '#/render/material';
import { distanceToSegment2 } from '#/util/geometry2';
import { fitText, labelCanvas, labelTexture } from '#/util/label';
import { midpoint, span } from '#/util/math';
import { at } from '#/util/rand';

const DECK_Y = levelY('roof');

/** Waterspiegel-centrum in wereldcoördinaten. PoolPeople zet er zwemmers op. */
export const POOL_CENTER = { x: -20, z: 2 } as const;
const POOL_ROT = 0.3;
/** Breedte van de tegelrand rond het water. */
const RIM_W = 0.55;

/** Nierboon — twee lobben, één taille. Anatomisch niet correct, wel gezellig. */
function kidneyShape(): THREE.Shape {
	const sh = new THREE.Shape();
	sh.moveTo(-6.5, -0.4);
	sh.bezierCurveTo(-6.9, 1.8, -4.8, 3.6, -2.6, 3.6);
	sh.bezierCurveTo(-0.8, 3.6, 0.4, 2.8, 2.2, 3.0);
	sh.bezierCurveTo(4.2, 3.2, 6.2, 2.2, 6.4, 0.4);
	sh.bezierCurveTo(6.6, -1.6, 4.6, -2.8, 2.8, -2.4);
	sh.bezierCurveTo(1.4, -2.0, 1.0, -0.6, -0.6, -0.8);
	sh.bezierCurveTo(-2.2, -1.0, -2.4, -2.6, -4.2, -2.6);
	sh.bezierCurveTo(-6.0, -2.6, -6.3, -1.6, -6.5, -0.4);
	return sh;
}

/**
 * De waterlijn, één keer bemonsterd. Water, bodem, rand én de zwemmers lezen
 * allemaal deze punten, dus ze kunnen niet meer uit elkaar lopen. Eerder was
 * de rand `kidney(1.15)`: dat schaalt om de vorm-oorsprong, en die ligt niet
 * in het bad, dus de rand schoof mee in plaats van gelijkmatig te verbreden.
 */
const POOL_OUTLINE: THREE.Vector2[] = kidneyShape().getPoints(96);

/** Oppervlak van een gesloten polygoon, teken weggelaten. */
function polyArea(pts: readonly THREE.Vector2[]): number {
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
function offsetOutward(pts: readonly THREE.Vector2[], d: number): THREE.Vector2[] {
	const shift = (sign: number) =>
		pts.map((_, i) => {
			const prev = at(pts, i - 1);
			const next = at(pts, i + 1);
			const tx = next.x - prev.x;
			const ty = next.y - prev.y;
			const len = Math.hypot(tx, ty) || 1;
			const p = at(pts, i);
			return new THREE.Vector2(p.x + (sign * ty * d) / len, p.y - (sign * tx * d) / len);
		});
	const outward = shift(1);
	return polyArea(outward) > polyArea(pts) ? outward : shift(-1);
}

/** Dezelfde waterlijn, maar in wereld-XZ. */
export const POOL_POLYGON: ReadonlyArray<readonly [number, number]> = POOL_OUTLINE.map((p) => {
	// De vlakken staan plat via rotation.x = -PI/2, dus vorm-y wordt wereld-min-z.
	const lx = p.x;
	const lz = -p.y;
	const c = Math.cos(POOL_ROT);
	const s = Math.sin(POOL_ROT);
	return [POOL_CENTER.x + lx * c + lz * s, POOL_CENTER.z - lx * s + lz * c] as const;
});

/** Ligt (x, z) in het water? Ray casting op de echte waterlijn. */
export function inPool(x: number, z: number): boolean {
	let inside = false;
	for (let i = 0, j = POOL_POLYGON.length - 1; i < POOL_POLYGON.length; j = i++) {
		const a = at(POOL_POLYGON, i);
		const b = at(POOL_POLYGON, j);
		if (a[1] > z !== b[1] > z && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) {
			inside = !inside;
		}
	}
	return inside;
}

/** Waterspiegel in wereld-y: het watervlak uit buildPool ligt precies hier. */
export const POOL_WATER_Y = DECK_Y + 0.1;
/**
 * Bodem van het diepe: 1.15 onder de waterlijn zet je borst op het water.
 * PoolPeople hangt zijn zwemmers met dezelfde 1.15 op, maar rekent vanaf een
 * eigen WATER_Y (13.75), dus die drijven 0.30 lager dan waar jij staat.
 */
export const POOL_FLOOR_Y = POOL_WATER_Y - 1.15;
/** Breedte van de aflopende instap: binnen deze band waad je naar het diepe. */
const POOL_SHALLOW_W = 1.8;

function polygonBounds(): { minX: number; maxX: number; minZ: number; maxZ: number } {
	let minX = Infinity;
	let maxX = -Infinity;
	let minZ = Infinity;
	let maxZ = -Infinity;
	for (const [x, z] of POOL_POLYGON) {
		minX = Math.min(minX, x);
		maxX = Math.max(maxX, x);
		minZ = Math.min(minZ, z);
		maxZ = Math.max(maxZ, z);
	}
	return { minX, maxX, minZ, maxZ };
}

/** Doos om de waterlijn, zodat alles wat er niet in staat de raycast overslaat. */
const POOL_BOUNDS = polygonBounds();

/** Kortste afstand tot de waterlijn: hoe verder naar binnen, hoe dieper. */
export function rimDistance(x: number, z: number): number {
	let best = Infinity;
	for (let i = 0; i < POOL_POLYGON.length; i++) {
		const a = at(POOL_POLYGON, i);
		const b = at(POOL_POLYGON, i + 1);
		const d = distanceToSegment2(x, z, a[0], a[1], b[0], b[1]);
		if (d < best) best = d;
	}
	return best;
}

/**
 * Loophoogte in het bad, of `null` als je er niet in staat.
 *
 * Aan de waterlijn is dat nog gewoon dekhoogte en daarna zakt de bodem in
 * POOL_SHALLOW_W meter naar POOL_FLOOR_Y: je waadt erin in plaats van dat je
 * van een richel valt. De bak zit alleen hier en niet in de meshes, want onder
 * 13.9 begint de dakplaat van de mall: een echt uitgesneden kuil zou door dat
 * beton snijden en de onderlijven van de zwemmers bloot leggen. In first person
 * zie je alleen je camera zakken, en die klopt wel.
 */
export function poolFloorY(x: number, z: number): number | null {
	if (x < POOL_BOUNDS.minX || x > POOL_BOUNDS.maxX) return null;
	if (z < POOL_BOUNDS.minZ || z > POOL_BOUNDS.maxZ) return null;
	if (!inPool(x, z)) return null;
	const raw = rimDistance(x, z) / POOL_SHALLOW_W;
	const t = raw > 1 ? 1 : raw;
	// Smoothstep: vlakke bodem in het diepe, zachte knik bij de rand
	return DECK_Y - (DECK_Y - POOL_FLOOR_Y) * t * t * (3 - 2 * t);
}

/**
 * Tropisch dakeiland op het westelijke mall-dak. Zwembad in nierboonvorm,
 * buisglijbaan vanaf een 4 m toren, tiki-bar, palmen, ligstoelen, parasols
 * en — cruciaal voor de glijbaan-doorstroom — flessen GLIJMIDDEL en BABY OIL.
 * De veiligheidsrailing is er omdat de verzekeraar het dak heeft gezien.
 */
export class RoofIsland {
	readonly group = new THREE.Group();

	/** Loopbaar dek voor de integrator */
	readonly roofPad = { minX: -32, maxX: -6, minZ: -20, maxZ: 20, y: DECK_Y };
	/** Landmark voor de kaart/wayfinder */
	readonly landmark = { x: -19, z: 0, label: '🏝 ROOF ISLAND' };
	/** De glijbaan-baan — App laat de speler hier overheen glijden (E bovenaan). */
	slideCurve!: THREE.CatmullRomCurve3;

	private materials: THREE.Material[] = [];
	private geoms: THREE.BufferGeometry[] = [];
	private textures: THREE.Texture[] = [];
	private instanced: THREE.InstancedMesh[] = [];

	// Animatie-referenties (geen allocaties in update)
	private waterMat!: LitMaterial;
	private water!: THREE.Mesh;
	private waterBaseY = 0;
	private poolBall!: THREE.Mesh;
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

	private track<T extends THREE.Material>(m: T): T {
		this.materials.push(m);
		return m;
	}

	private geo<T extends THREE.BufferGeometry>(g: T): T {
		this.geoms.push(g);
		return g;
	}

	private label(draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, w = 256, h = 128): THREE.CanvasTexture {
		const { canvas: c, ctx } = labelCanvas(w, h);
		draw(ctx, w, h);
		const tex = labelTexture(c);
		this.textures.push(tex);
		return tex;
	}

	/** Zandkleurige dekplaat: x -32..-6, z -20..20, top op DECK_Y */
	private buildDeck(): void {
		const deck = new THREE.Mesh(
			this.geo(new THREE.BoxGeometry(26, 0.35, 40)),
			this.track(lit({ color: 0xe6cf9c, roughness: 0.95 })),
		);
		deck.position.set(-19, DECK_Y - 0.175, 0);
		deck.receiveShadow = true;
		this.group.add(deck);
	}

	/** Nierboon — twee lobben, één taille. Anatomisch niet correct, wel gezellig. */
	private buildPoolShapes(): { inner: THREE.Shape; outer: THREE.Shape } {
		const inner = new THREE.Shape(POOL_OUTLINE.map((p) => p.clone()));
		const outer = new THREE.Shape(offsetOutward(POOL_OUTLINE, RIM_W));
		outer.holes.push(new THREE.Path(POOL_OUTLINE.map((p) => p.clone())));
		return { inner, outer };
	}

	private buildPool(): void {
		const pool = new THREE.Group();
		pool.name = 'pool';
		pool.position.set(POOL_CENTER.x, DECK_Y, POOL_CENTER.z);
		// Uit de constante: POOL_POLYGON rekent met dezelfde draai, en zodra die
		// twee uit elkaar lopen klopt inPool niet meer met wat je ziet.
		pool.rotation.y = POOL_ROT;

		const { inner, outer } = this.buildPoolShapes();

		// Tegelrand — licht verhoogd, zodat niemand 'per ongeluk' erin rijdt
		const rim = new THREE.Mesh(
			this.geo(new THREE.ExtrudeGeometry(outer, { depth: 0.12, bevelEnabled: false })),
			this.track(lit({ color: 0xf5f5f0, roughness: 0.6 })),
		);
		rim.rotation.x = -Math.PI / 2;
		rim.position.y = 0.005;
		pool.add(rim);

		// Donkere bodem onder het transparante water: dieptesuggestie voor bijna niks.
		// Blijft vlak op dekhoogte: hij dekt de dakplaat van de mall en de benen van
		// de zwemmers af. De loopbare bak zit in poolFloorY.
		const bottom = new THREE.Mesh(
			this.geo(new THREE.ShapeGeometry(inner)),
			this.track(lit({ color: 0x01579b, roughness: 0.85 })),
		);
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
		this.water = new THREE.Mesh(this.geo(new THREE.ShapeGeometry(inner)), this.waterMat);
		this.water.rotation.x = -Math.PI / 2;
		// Uit de constante, zodat de waterlijn van de fysica nooit van de mesh loskomt
		this.waterBaseY = POOL_WATER_Y - DECK_Y;
		this.water.position.y = this.waterBaseY;
		pool.add(this.water);

		this.group.add(pool);
	}

	/** Buisglijbaan: 4 m toren, krul, plons. De flessen staan klaar bij buildProps. */
	private buildSlide(): void {
		const g = new THREE.Group();
		g.name = 'slide';
		const steel = this.track(lit({ color: 0x90a4ae, metalness: 0.6, roughness: 0.4 }));

		// Torenpoten + platform op DECK_Y + 4
		const legGeo = this.geo(new THREE.CylinderGeometry(0.09, 0.09, 4, 8));
		for (const [dx, dz] of [
			[-0.8, -0.8],
			[0.8, -0.8],
			[-0.8, 0.8],
			[0.8, 0.8],
		] as const) {
			const leg = new THREE.Mesh(legGeo, steel);
			leg.position.set(-28.5 + dx, DECK_Y + 2, -10 + dz);
			g.add(leg);
		}
		const platform = new THREE.Mesh(
			this.geo(new THREE.BoxGeometry(1.9, 0.15, 1.9)),
			this.track(lit({ color: 0x455a64, roughness: 0.7 })),
		);
		platform.position.set(-28.5, DECK_Y + 4, -10);
		g.add(platform);

		// Platform-railing: drie zijden dicht, de vierde is de glijbaan zelf
		const railGeo = this.geo(new THREE.BoxGeometry(1.9, 0.06, 0.06));
		for (const [rx, rz, ry] of [
			[-28.5, -10.9, 0],
			[-28.5, -9.1, 0],
			[-29.4, -10, Math.PI / 2],
		] as const) {
			const rail = new THREE.Mesh(railGeo, steel);
			rail.position.set(rx, DECK_Y + 4.7, rz);
			rail.rotation.y = ry;
			g.add(rail);
			const railLow = new THREE.Mesh(railGeo, steel);
			railLow.position.set(rx, DECK_Y + 4.35, rz);
			railLow.rotation.y = ry;
			g.add(railLow);
		}

		// Ladder aan de zuidkant
		const rungGeo = this.geo(new THREE.BoxGeometry(0.5, 0.05, 0.05));
		for (let i = 0; i < 8; i++) {
			const rung = new THREE.Mesh(rungGeo, steel);
			rung.position.set(-28.5, DECK_Y + 0.5 + i * 0.48, -10.98);
			g.add(rung);
		}
		const ladderRailGeo = this.geo(new THREE.CylinderGeometry(0.035, 0.035, 4.3, 6));
		for (const dx of [-0.27, 0.27]) {
			const lr = new THREE.Mesh(ladderRailGeo, steel);
			lr.position.set(-28.5 + dx, DECK_Y + 2.2, -10.98);
			g.add(lr);
		}

		// De buis: CatmullRom-krul van platform naar het diepe
		const curve = new THREE.CatmullRomCurve3([
			new THREE.Vector3(-27.7, DECK_Y + 3.8, -10),
			new THREE.Vector3(-26.2, DECK_Y + 3.1, -8.6),
			new THREE.Vector3(-24.4, DECK_Y + 2.4, -7.8),
			new THREE.Vector3(-22.8, DECK_Y + 1.7, -6.0),
			new THREE.Vector3(-22.6, DECK_Y + 1.0, -3.6),
			new THREE.Vector3(-22.3, DECK_Y + 0.2, 0.9),
		]);
		this.slideCurve = curve;
		const tube = new THREE.Mesh(
			this.geo(new THREE.TubeGeometry(curve, 48, 0.5, 10, false)),
			this.track(lit({ color: 0xffca28, roughness: 0.35, side: THREE.DoubleSide })),
		);
		g.add(tube);

		// Steunen onder de buis, anders keurt zelfs déze mall het af
		const supGeoCache = new Map<number, THREE.CylinderGeometry>();
		for (const ct of [0.3, 0.55, 0.8]) {
			const p = curve.getPoint(ct);
			const h = Math.max(0.4, p.y - 0.55 - DECK_Y);
			const key = Math.round(h * 10);
			let sg = supGeoCache.get(key);
			if (!sg) {
				sg = this.geo(new THREE.CylinderGeometry(0.07, 0.07, h, 6));
				supGeoCache.set(key, sg);
			}
			const sup = new THREE.Mesh(sg, steel);
			sup.position.set(p.x, DECK_Y + h / 2, p.z);
			g.add(sup);
		}

		this.group.add(g);
	}

	private buildTikiBar(): void {
		const g = new THREE.Group();
		g.name = 'tiki_bar';
		const cx = -12.3;
		const cz = 14.5;

		const bamboo = this.track(lit({ color: 0x9a7b4f, roughness: 0.9 }));
		const poleGeo = this.geo(new THREE.CylinderGeometry(0.08, 0.08, 3.2, 7));
		for (const [dx, dz] of [
			[-1.4, -1.4],
			[1.4, -1.4],
			[-1.4, 1.4],
			[1.4, 1.4],
		] as const) {
			const pole = new THREE.Mesh(poleGeo, bamboo);
			pole.position.set(cx + dx, DECK_Y + 1.6, cz + dz);
			g.add(pole);
		}

		// Bar zelf: één plank, oneindige dorst
		const counter = new THREE.Mesh(
			this.geo(new THREE.BoxGeometry(1.0, 1.1, 3.2)),
			this.track(lit({ color: 0x6d4c41, roughness: 0.8 })),
		);
		counter.position.set(cx - 0.6, DECK_Y + 0.55, cz);
		g.add(counter);

		// Rieten kegeldakje
		const thatch = new THREE.Mesh(
			this.geo(new THREE.ConeGeometry(2.7, 1.8, 9)),
			this.track(lit({ color: 0xb8935a, roughness: 1 })),
		);
		thatch.position.set(cx, DECK_Y + 4.0, cz);
		g.add(thatch);

		// Krukken (instanced — drie krukken is ook een rij)
		const stoolGeo = this.geo(new THREE.CylinderGeometry(0.24, 0.2, 0.68, 8));
		const stoolMat = this.track(lit({ color: 0x8d6e63, roughness: 0.85 }));
		const stools = new THREE.InstancedMesh(stoolGeo, stoolMat, 3);
		const d = new THREE.Object3D();
		[13.2, 14.5, 15.8].forEach((z, i) => {
			d.position.set(cx - 1.7, DECK_Y + 0.34, z);
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
				ctx.fillText('TIKI BAR', w / 2, 56);
				ctx.font = '22px system-ui';
				fitText(ctx, 'cocktails op dakprijzen', { x: 16, y: 74, w: w - 32, h: 40 }, { size: 30, maxLines: 1 });
			},
			384,
			128,
		);
		const sign = new THREE.Mesh(
			this.geo(new THREE.PlaneGeometry(2.4, 0.8)),
			this.track(new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, side: THREE.DoubleSide })),
		);
		sign.position.set(cx - 1.55, DECK_Y + 2.6, cz);
		sign.rotation.y = -Math.PI / 2;
		g.add(sign);

		this.group.add(g);
	}

	/** 8 palmen, alles instanced: stammen, bladeren, kokosnoten. */
	private buildPalms(): void {
		const spots: [number, number, number][] = [
			// x, z, schaal
			[-30.2, -17.5, 1.1],
			[-8.5, -17, 0.95],
			[-30, 16.5, 1.05],
			[-8.6, 17.5, 1.0],
			[-30.5, -6, 0.9],
			[-9, 7, 1.15],
			[-15, -15, 1.0],
			[-25.5, 13, 0.85],
		];
		const d = new THREE.Object3D();

		// Stammen (origin aan de voet)
		const trunkGeo = this.geo(new THREE.CylinderGeometry(0.09, 0.17, 3.4, 7));
		trunkGeo.translate(0, 1.7, 0);
		const trunkMat = this.track(lit({ color: 0x8b6914, roughness: 0.9 }));
		const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length);
		spots.forEach(([x, z, s], i) => {
			d.position.set(x, DECK_Y, z);
			d.rotation.set(0, i * 1.3, 0);
			d.scale.setScalar(s);
			d.updateMatrix();
			trunks.setMatrixAt(i, d.matrix);
		});
		this.instanced.push(trunks);
		this.group.add(trunks);

		// Bladeren: 9 per palm, één InstancedMesh, groentint via instanceColor
		const frondGeo = this.geo(new THREE.PlaneGeometry(0.42, 2.1));
		frondGeo.translate(0, 1.05, 0);
		const frondMat = this.track(lit({ color: 0xffffff, roughness: 0.85, side: THREE.DoubleSide }));
		const perPalm = 9;
		const fronds = new THREE.InstancedMesh(frondGeo, frondMat, spots.length * perPalm);
		const greens = [0x1b7a3d, 0x2d8a4e, 0x3d9b55, 0x228b22];
		const col = new THREE.Color();
		spots.forEach(([x, z, s], i) => {
			for (let j = 0; j < perPalm; j++) {
				const a = (j / perPalm) * Math.PI * 2 + i * 0.7;
				d.position.set(x, DECK_Y + 3.4 * s, z);
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
		const cocoGeo = this.geo(new THREE.SphereGeometry(0.11, 6, 6));
		const cocoMat = this.track(lit({ color: 0x5c4033, roughness: 0.9 }));
		const cocos = new THREE.InstancedMesh(cocoGeo, cocoMat, spots.length * 2);
		spots.forEach(([x, z, s], i) => {
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

	private loungerSpots(): [number, number, number][] {
		// x, z, yaw — zes op een rij aan de oostkant, twee losse bij het bad
		const rows: [number, number, number][] = [];
		for (let i = 0; i < 6; i++) rows.push([-10.6, -13.2 + i * 2.4, -Math.PI / 2]);
		rows.push([-18, -5.5, 0.15]);
		rows.push([-15.5, -5.0, -0.1]);
		return rows;
	}

	private buildLoungers(): void {
		const spots = this.loungerSpots();
		const d = new THREE.Object3D();
		const plastic = this.track(lit({ color: 0xf1f8f4, roughness: 0.7 }));

		const baseGeo = this.geo(new THREE.BoxGeometry(0.7, 0.16, 1.8));
		const bases = new THREE.InstancedMesh(baseGeo, plastic, spots.length);
		spots.forEach(([x, z, yaw], i) => {
			d.position.set(x, DECK_Y + 0.18, z);
			d.rotation.set(0, yaw, 0);
			d.updateMatrix();
			bases.setMatrixAt(i, d.matrix);
		});
		this.instanced.push(bases);
		this.group.add(bases);

		// Rugleuning: aan het hoofdeinde, schuin omhoog (siësta-stand)
		const backGeo = this.geo(new THREE.BoxGeometry(0.7, 0.06, 0.8));
		const backs = new THREE.InstancedMesh(backGeo, plastic, spots.length);
		spots.forEach(([x, z, yaw], i) => {
			d.position.set(x - 0.75 * Math.sin(yaw), DECK_Y + 0.42, z - 0.75 * Math.cos(yaw));
			d.rotation.set(0, 0, 0);
			d.rotation.order = 'YXZ';
			d.rotation.y = yaw;
			d.rotation.x = -0.65;
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
		const d = new THREE.Object3D();

		const poleGeo = this.geo(new THREE.CylinderGeometry(0.04, 0.04, 2.6, 6));
		poleGeo.translate(0, 1.3, 0);
		const poleMat = this.track(lit({ color: 0xcfd8dc, metalness: 0.5, roughness: 0.5 }));
		const poles = new THREE.InstancedMesh(poleGeo, poleMat, spots.length);

		const canopyGeo = this.geo(new THREE.ConeGeometry(1.5, 0.7, 8));
		const canopyMat = this.track(lit({ color: 0xffffff, roughness: 0.8, side: THREE.DoubleSide }));
		const canopies = new THREE.InstancedMesh(canopyGeo, canopyMat, spots.length);
		const colors = [0xff5252, 0x40c4ff, 0xffd740, 0xff4081];
		const col = new THREE.Color();
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
		const loungers = this.loungerSpots();
		const onLoungers = [0, 2, 4, 6, 7];
		const onDeck: [number, number, number][] = [
			[-17, -8, 0.4],
			[-21.5, 8.6, -0.7],
			[-12.6, 3, 1.2],
		];
		const geoT = this.geo(new THREE.PlaneGeometry(0.62, 1.5));
		geoT.rotateX(-Math.PI / 2);
		const mat = this.track(lit({ color: 0xffffff, roughness: 0.95, side: THREE.DoubleSide }));
		const towels = new THREE.InstancedMesh(geoT, mat, onLoungers.length + onDeck.length);
		const colors = [0xef5350, 0x26c6da, 0xffee58, 0xab47bc, 0x66bb6a, 0xff7043, 0x5c6bc0, 0xec407a];
		const d = new THREE.Object3D();
		const col = new THREE.Color();
		let idx = 0;
		for (const li of onLoungers) {
			const [x, z, yaw] = at(loungers, li);
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
		const bottleGeo = this.geo(new THREE.CylinderGeometry(0.14, 0.14, 0.45, 10));
		const capGeo = this.geo(new THREE.CylinderGeometry(0.06, 0.06, 0.09, 8));
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

		const bottle = (mat: THREE.Material, x: number, y: number, z: number, tipped: boolean): void => {
			const b = new THREE.Mesh(bottleGeo, mat);
			b.position.set(x, y, z);
			if (tipped) {
				b.rotation.z = Math.PI / 2;
				b.position.y = y - 0.08;
			}
			this.group.add(b);
			if (!tipped) {
				const cap = new THREE.Mesh(capGeo, capMat);
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
		const ballGeo = this.geo(new THREE.SphereGeometry(0.35, 12, 10));
		const ballMat = this.track(lit({ map: ballTex, roughness: 0.6 }));

		// Eén dobbert in het bad (geanimeerd), twee liggen te wachten op wind
		this.poolBall = new THREE.Mesh(ballGeo, ballMat);
		this.poolBallBaseY = DECK_Y + 0.28;
		this.poolBall.position.set(-19, this.poolBallBaseY, 0.5);
		this.group.add(this.poolBall);

		for (const [x, z, s] of [
			[-26.5, -13, 1],
			[-10.2, 10.5, 0.8],
		] as const) {
			const ball = new THREE.Mesh(ballGeo, ballMat);
			ball.position.set(x, DECK_Y + 0.35 * s, z);
			ball.scale.setScalar(s);
			ball.rotation.y = x * 2.3;
			this.group.add(ball);
		}
	}

	/** Railing rondom, met een opening aan de oostkant (z -2.5..2.5) als entree. */
	private buildRailing(): void {
		const { minX, maxX, minZ, maxZ } = this.roofPad;
		const metal = this.track(lit({ color: 0xeceff1, metalness: 0.55, roughness: 0.4 }));

		// Paaltjes instanced langs de omtrek
		const positions: [number, number][] = [];
		for (let z = minZ; z <= maxZ; z += 2) positions.push([minX, z]);
		for (let x = minX + 2; x <= maxX; x += 2) {
			positions.push([x, minZ]);
			positions.push([x, maxZ]);
		}
		for (let z = minZ + 2; z < maxZ; z += 2) {
			if (z > -2.5 && z < 2.5) continue; // entree
			positions.push([maxX, z]);
		}
		const postGeo = this.geo(new THREE.CylinderGeometry(0.035, 0.035, 1.05, 6));
		postGeo.translate(0, 0.525, 0);
		const posts = new THREE.InstancedMesh(postGeo, metal, positions.length);
		const d = new THREE.Object3D();
		positions.forEach(([x, z], i) => {
			d.position.set(x, DECK_Y, z);
			d.rotation.set(0, 0, 0);
			d.updateMatrix();
			posts.setMatrixAt(i, d.matrix);
		});
		this.instanced.push(posts);
		this.group.add(posts);

		// Bovenregel: vijf balken (oostkant in twee stukken vanwege de entree)
		const railY = DECK_Y + 1.05;
		const bar = (w: number, dep: number, x: number, z: number): void => {
			const m = new THREE.Mesh(this.geo(new THREE.BoxGeometry(w, 0.07, dep)), metal);
			m.position.set(x, railY, z);
			this.group.add(m);
		};
		bar(0.07, span(minZ, maxZ), minX, 0);
		bar(span(minX, maxX), 0.07, midpoint(minX, maxX), minZ);
		bar(span(minX, maxX), 0.07, midpoint(minX, maxX), maxZ);
		bar(0.07, span(minZ, -2.5), maxX, midpoint(minZ, -2.5));
		bar(0.07, span(2.5, maxZ), maxX, midpoint(2.5, maxZ));
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
				ctx.fillText('🏝 ROOF ISLAND', w / 2, 55);
				ctx.fillStyle = '#e2e8f0';
				ctx.font = '20px system-ui';
				ctx.fillText('zwembad · tiki bar · glijmiddel gratis', w / 2, 95);
			},
			512,
			128,
		);
		// depthTest AAN — zie de spook-signage-les van het helipad
		const sp = new THREE.Sprite(this.track(new THREE.SpriteMaterial({ map: tex, transparent: true })));
		sp.scale.set(7, 1.75, 1);
		sp.position.set(-19, DECK_Y + 6.5, 0);
		this.group.add(sp);
	}
}
