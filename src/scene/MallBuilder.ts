import * as THREE from 'three';
import { ATRIUM_VOID, MALL_FOOTPRINT } from '#/data/layout';
import { level, levelY } from '#/data/levels';
import { getOwner } from '#/data/shopOwners';
import type { StoreDef } from '#/data/stores';
import { shopStores } from '#/data/stores';
import type { OpeningDef } from '#/data/world';
import { ESCALATOR, MALL_SLAB_SPECS, MALL_WALL_SPECS, SHOP_HEIGHT, SHOP_ROOM_DEPTH_FACTOR, STAIRS } from '#/data/world';
import { lit } from '#/render/material';
import { addBoxMesh, addPlaneMesh } from '#/render/meshFactory';
import { addExtrudedXZMesh } from '#/render/xzShape';
import { fitText, labelCanvas, labelTexture } from '#/util/label';
import { half, inverseLerpClamped, midpoint } from '#/util/math';
import { at } from '#/util/rand';

/** One storey, straight from the deck heights. */
const FLOOR_H = levelY('v1') - levelY('v0');

/** Laagste stand van een trede: net boven de vloer, anders z-fightt hij ermee. */
const ESC_STEP_MIN = 0.02;
/**
 * Hoogte van de gele neuslijn, hoe ver hij binnen de randen van het tredeblad
 * blijft, en hoe ver hij erboven zweeft. Die laatste alleen genoeg om uit de
 * dieptebuffer te blijven, want een centimeter zie je.
 */
const ESC_NOSE_H = 0.006;
const ESC_NOSE_INSET = 0.01;
const ESC_NOSE_LIFT = 0.0015;
/** Wereldlengte van één herhaling van de leuningtextuur. */
const ESC_RAIL_TICK = 0.32;
/** Dikte van tredeblad, stootbord en de staande panelen. */
const ESC_TREAD_T = 0.07;
const ESC_RISER_T = 0.05;
const ESC_PANEL_T = 0.05;
/** Speling tussen de zijkant van de treden en de schortplaat. */
const ESC_SKIRT_GAP = 0.03;
/** Onder- en bovenkant van het balustradeglas boven de tredelijn. */
const ESC_GLASS_LO = 0.33;
const ESC_GLASS_HI = 0.99;
/** Buisstraal van de leuning en zijn speling tot de rand van het glas. */
const ESC_RAIL_R = 0.05;
const ESC_RAIL_GAP = 0.02;
/** De balustradekop is halfrond om het midden van het glas. */
const ESC_GLASS_R = half(ESC_GLASS_HI - ESC_GLASS_LO);
const ESC_GLASS_MID = midpoint(ESC_GLASS_HI, ESC_GLASS_LO);
/**
 * De leuning draait concentrisch om die kop, op vaste speling. Daar volgen zowel
 * de omkeerstraal als de hoogte van het leuninghart uit. Kies je die twee los,
 * dan staat er rondom lucht tussen lus en glas en hangt de omkeer als een losse
 * ring naast de roltrap.
 */
const ESC_NEWEL_R = ESC_GLASS_R + ESC_RAIL_GAP + ESC_RAIL_R;
const ESC_RAIL_Y = ESC_GLASS_MID + ESC_NEWEL_R;
/** Halve breedte tot de buitenkant van de balustrade. */
const ESC_SKIRT_X = half(ESCALATOR.width) + ESC_SKIRT_GAP;
/** Z van de rand van het vloergat aan de kant van de uitstap. */
const ESC_HOLE_FAR_Z =
	ESCALATOR.opening.center.z - Math.sign(ESCALATOR.zBottom - ESCALATOR.zTop) * half(ESCALATOR.opening.size.depth);

/** Hoogte van de roltraphelling op z, vlak op beide landingen. */
function escLine(z: number): number {
	const t = inverseLerpClamped(ESCALATOR.zBottom, ESCALATOR.zTop, z);
	return FLOOR_H * t;
}

/**
 * Middellijn van de leuning in (z, y): omkeer onderaan, de klim, omkeer bovenaan.
 * De koppen zijn het verschil tussen een leuning en een losse buis.
 *
 * De omkeer draait een halve slag, van +90° naar -90°, zodat hij een straal
 * lager weer naar binnen wijst en zijn open uiteinde in het balustradeglas
 * verdwijnt in plaats van als een afgeknipte buis in de lucht te hangen.
 *
 * Dicht bemonsterd, want dit pad gaat door een spline: met alleen de hoekpunten
 * bolt een lange rechte er tussenuit.
 */
type EscRailPoint = Readonly<{ z: number; y: number }>;

function escRailPath(zLo: number, zHi: number, off: number): EscRailPoint[] {
	const r = ESC_NEWEL_R;
	const dir = Math.sign(zHi - zLo);
	const points: EscRailPoint[] = [];
	// Halve slag rond de kop; `s` bepaalt of hij naar buiten of naar binnen bolt.
	const newel = (zEnd: number, base: number, direction: number): EscRailPoint[] =>
		Array.from({ length: 13 }, (_, k) => {
			const a = -Math.PI / 2 + (k / 12) * Math.PI;
			return { z: zEnd + direction * dir * r * Math.cos(a), y: base - r + r * Math.sin(a) };
		});
	const straight = (za: number, ya: number, zb: number, yb: number, n: number) => {
		for (let k = 1; k <= n; k++) {
			points.push({ z: za + ((zb - za) * k) / n, y: ya + ((yb - ya) * k) / n });
		}
	};
	points.push(...newel(zLo, off, -1));
	straight(zLo, off, ESCALATOR.zBottom, off, 4);
	straight(ESCALATOR.zBottom, off, ESCALATOR.zTop, FLOOR_H + off, 24);
	straight(ESCALATOR.zTop, FLOOR_H + off, zHi, FLOOR_H + off, 5);
	// slice(1): de omkeer begint op hetzelfde punt waar de rechte eindigt. Laat je
	// dat dubbel staan, dan is dat segment nul lang, is de raaklijn daar
	// ongedefinieerd en klapt het frame van de buis om — een knik in de leuning.
	points.push(
		...newel(zHi, FLOOR_H + off, 1)
			.reverse()
			.slice(1),
	);
	return points;
}

/**
 * De leuning als één doorlopende buis. Losse cilinders per segment gaven op elke
 * knik een zichtbare breuk, en met een afgeplat profiel stond elke koker ook nog
 * eens anders gedraaid dan zijn buurman.
 *
 * Het pad ligt in één ZY-vlak op x = 0, zodat de aanroeper hem in x kan
 * platdrukken tot een leuningprofiel zonder de buis zelf te vervormen.
 */

function escRailTube(points: readonly EscRailPoint[], radius: number): { geo: THREE.TubeGeometry; length: number } {
	const curve = new THREE.CatmullRomCurve3(
		points.map(({ z, y }) => new THREE.Vector3(0, y, z)),
		false,
		'centripetal',
	);
	const length = curve.getLength();
	return { geo: new THREE.TubeGeometry(curve, Math.round(length / 0.1), radius, 8, false), length };
}

/** Tiny stable hash for per-staff variety */
function hashStr(s: string): number {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}

function makeTextTexture(
	lines: string[],
	{
		w = 512,
		h = 256,
		bg = '#111118',
		fg = '#ffffff',
		accent,
		fontSize = lines.length > 1 ? 52 : 64,
	}: {
		w?: number;
		h?: number;
		bg?: string;
		fg?: string;
		accent?: string;
		fontSize?: number;
	} = {},
): THREE.CanvasTexture {
	const { canvas, ctx } = labelCanvas(w, h);

	ctx.fillStyle = bg;
	ctx.fillRect(0, 0, w, h);

	// subtle grid
	ctx.strokeStyle = 'rgba(255,255,255,0.04)';
	for (let i = 0; i < w; i += 32) {
		ctx.beginPath();
		ctx.moveTo(i, 0);
		ctx.lineTo(i, h);
		ctx.stroke();
	}

	if (accent) {
		ctx.fillStyle = accent;
		ctx.fillRect(0, h - 12, w, 12);
		ctx.fillRect(0, 0, 8, h);
	}

	ctx.fillStyle = fg;
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.font = `700 ${fontSize}px Outfit, system-ui, sans-serif`;

	const totalH = lines.length * fontSize * 1.15;
	let y = half(h) - half(totalH) + half(fontSize);
	for (const line of lines) {
		ctx.fillText(line, half(w), y);
		y += fontSize * 1.15;
	}

	const tex = labelTexture(canvas);
	tex.anisotropy = 8;
	return tex;
}

export class MallBuilder {
	readonly group = new THREE.Group();
	readonly storeMeshes = new Map<string, THREE.Group>();
	private materials: THREE.Material[] = [];
	private textures: THREE.Texture[] = [];
	private escSteps: { node: THREE.Group; index: number }[] = [];
	private escRailMaps: THREE.Texture[] = [];
	private escPhase = 0;

	build(): THREE.Group {
		this.group.name = 'mall';
		this.buildStructure();
		this.buildAtrium();
		this.buildEscalator();
		this.buildStores();
		this.buildKiosk();
		this.buildRailings();
		this.buildCeilingLights();
		return this.group;
	}

	/** Laat de roltrap lopen. Zonder dit is het een trap met een kap erop. */
	update(dt: number): void {
		const stepDepth = Math.abs(ESCALATOR.zTop - ESCALATOR.zBottom) / ESCALATOR.steps;
		const pitch = Math.hypot(stepDepth, FLOOR_H / ESCALATOR.steps);
		this.escPhase = (this.escPhase + (ESCALATOR.collision.carrySpeed * dt) / pitch) % 1;
		this.placeEscalatorSteps();
		// De leuning loopt mee via de textuur-offset; modulo houdt hem na een uur
		// draaien nog steeds precies genoeg.
		for (const map of this.escRailMaps) {
			map.offset.y = (map.offset.y - (ESCALATOR.collision.carrySpeed * dt) / ESC_RAIL_TICK) % 1;
		}
	}

	/** The rest of the mall is immutable after build; only these step nodes move. */
	get dynamicRoots(): readonly THREE.Object3D[] {
		return this.escSteps.map((step) => step.node);
	}

	dispose(): void {
		this.group.traverse((obj) => {
			if (obj instanceof THREE.Mesh) {
				obj.geometry.dispose();
			}
		});
		this.materials.forEach((m) => {
			m.dispose();
		});
		this.textures.forEach((t) => {
			t.dispose();
		});
	}

	private track<T extends THREE.Material>(m: T): T {
		this.materials.push(m);
		return m;
	}

	private buildStructure(): void {
		// Warm beige mall floor (daylight American mall)
		const floorMat = this.track(
			lit({
				color: 0xd8cfc0,
				metalness: 0.05,
				roughness: 0.75,
			}),
		);

		const { canvas: tileCanvas, ctx: tctx } = labelCanvas(256, 256);
		tctx.fillStyle = '#e8e0d4';
		tctx.fillRect(0, 0, 256, 256);
		tctx.strokeStyle = '#d0c8ba';
		tctx.lineWidth = 2;
		for (let i = 0; i <= 256; i += 32) {
			tctx.beginPath();
			tctx.moveTo(i, 0);
			tctx.lineTo(i, 256);
			tctx.stroke();
			tctx.beginPath();
			tctx.moveTo(0, i);
			tctx.lineTo(256, i);
			tctx.stroke();
		}
		// center walkway
		tctx.fillStyle = 'rgba(200, 180, 140, 0.25)';
		tctx.fillRect(112, 0, 32, 256);

		const tileTex = labelTexture(tileCanvas);
		tileTex.wrapS = tileTex.wrapT = THREE.RepeatWrapping;
		tileTex.repeat.set(MALL_FOOTPRINT.width / 4, MALL_FOOTPRINT.depth / 4);
		floorMat.map = tileTex;

		// Slab dimensions and openings come from the same records used by collision,
		// validation, and map generation. Rendering must not reconstruct them.
		addExtrudedXZMesh(this.group, floorMat, { ...MALL_SLAB_SPECS.v0, receiveShadow: true });

		const floor1Mat = this.track(floorMat.clone());
		addExtrudedXZMesh(this.group, floor1Mat, { ...MALL_SLAB_SPECS.v1, receiveShadow: true });

		// Cream mall walls
		const wallMat = this.track(
			lit({
				color: 0xf0ebe3,
				metalness: 0.02,
				roughness: 0.9,
			}),
		);
		for (const wall of MALL_WALL_SPECS) {
			addBoxMesh(this.group, wallMat, {
				name: `mall-wall-${wall.id}`,
				...wall.size,
				position: wall.position,
				receiveShadow: true,
			});
		}

		// Ceiling with atrium opening
		const ceilMat = this.track(
			lit({
				color: 0xf5f0e8,
				metalness: 0.05,
				roughness: 0.85,
				side: THREE.DoubleSide,
			}),
		);
		addExtrudedXZMesh(this.group, ceilMat, MALL_SLAB_SPECS.roof);

		// Skylight — simple transparent (no transmission black-hole)
		const glassMat = this.track(
			lit({
				color: 0xa8d4ff,
				metalness: 0.1,
				roughness: 0.15,
				transparent: true,
				opacity: 0.25,
				side: THREE.DoubleSide,
			}),
		);
		const skylight = new THREE.Mesh(new THREE.PlaneGeometry(ATRIUM_VOID.width + 1, ATRIUM_VOID.depth + 1), glassMat);
		skylight.rotation.x = -Math.PI / 2;
		skylight.position.y = MALL_SLAB_SPECS.roof.topY - MALL_SLAB_SPECS.roof.thickness - 0.1;
		this.group.add(skylight);

		// Parking lot-ish ground outside
		const voidMat = this.track(lit({ color: 0x8a9099, roughness: 0.95 }));
		const voidPlane = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), voidMat);
		voidPlane.rotation.x = -Math.PI / 2;
		voidPlane.position.y = -0.5;
		this.group.add(voidPlane);
	}

	/**
	 * Marble Greek god in the middle of the fountain — the owner himself.
	 * Sits inside the atrium void, so nothing pokes through the floor-1 slab.
	 */
	private buildGodStatue(): void {
		const marble = this.track(
			lit({
				color: 0xe9e5dd,
				roughness: 0.35,
				metalness: 0.05,
			}),
		);
		const gold = this.track(
			lit({
				color: 0xd4af37,
				metalness: 0.9,
				roughness: 0.25,
			}),
		);

		const g = new THREE.Group();
		g.name = 'godStatue';
		g.position.set(0, 1.12, 0);

		// Plinth
		const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.7, 0.5, 16), marble);
		plinth.position.y = 0.25;
		plinth.castShadow = true;
		g.add(plinth);
		const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.68, 0.68, 0.08, 16), marble);
		cap.position.y = 0.54;
		g.add(cap);

		const figure = new THREE.Group();
		figure.position.y = 0.58;
		// Contrapposto — a god does not stand to attention
		figure.rotation.y = -0.35;
		g.add(figure);

		// Legs under a robe
		for (const side of [-1, 1] as const) {
			const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.11, 0.9, 10), marble);
			leg.position.set(side * 0.14, 0.45, side === 1 ? 0.06 : -0.02);
			leg.rotation.x = side === 1 ? 0.12 : -0.05;
			leg.castShadow = true;
			figure.add(leg);
		}

		// Robe / himation draped from the hip
		const robe = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.15, 14, 1, true), marble);
		robe.position.y = 0.72;
		robe.castShadow = true;
		figure.add(robe);
		const sash = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.05, 6, 14), marble);
		sash.rotation.x = Math.PI / 2 - 0.25;
		sash.position.y = 1.2;
		figure.add(sash);

		// Torso + shoulders
		const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.42, 6, 12), marble);
		torso.position.y = 1.5;
		torso.castShadow = true;
		figure.add(torso);
		const pecs = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 10), marble);
		pecs.scale.set(1.25, 0.62, 0.8);
		pecs.position.set(0, 1.66, 0.06);
		figure.add(pecs);

		// Head, beard, laurel
		const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 14), marble);
		head.position.y = 2.02;
		head.castShadow = true;
		figure.add(head);
		const nose = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 8), marble);
		nose.rotation.x = Math.PI / 2;
		nose.position.set(0, 2.02, 0.2);
		figure.add(nose);
		const beard = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), marble);
		beard.scale.set(0.9, 1.1, 0.75);
		beard.position.set(0, 1.88, 0.09);
		figure.add(beard);
		const hair = new THREE.Mesh(new THREE.SphereGeometry(0.215, 14, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), marble);
		hair.position.set(0, 2.04, -0.02);
		figure.add(hair);
		const laurel = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.022, 6, 16), gold);
		laurel.rotation.x = Math.PI / 2 - 0.12;
		laurel.position.y = 2.12;
		figure.add(laurel);

		// Right arm raised, holding a golden shopping bag. Obviously.
		const armGeo = new THREE.CapsuleGeometry(0.075, 0.4, 5, 8);
		const armUp = new THREE.Mesh(armGeo, marble);
		armUp.position.set(0.3, 1.78, 0.02);
		armUp.rotation.z = -1.15;
		figure.add(armUp);
		const forearm = new THREE.Mesh(armGeo, marble);
		forearm.position.set(0.54, 2.02, 0.02);
		forearm.rotation.z = -0.2;
		figure.add(forearm);

		const bag = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.3, 0.14), gold);
		bag.position.set(0.6, 2.32, 0.02);
		figure.add(bag);
		const handle = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.014, 5, 12, Math.PI), gold);
		handle.position.set(0.6, 2.47, 0.02);
		figure.add(handle);

		// Left arm down, palm out — benevolent landlord energy
		const armDown = new THREE.Mesh(armGeo, marble);
		armDown.position.set(-0.29, 1.5, 0.05);
		armDown.rotation.z = 0.28;
		figure.add(armDown);
		const hand = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), marble);
		hand.scale.set(1, 0.7, 1.1);
		hand.position.set(-0.36, 1.22, 0.1);
		figure.add(hand);

		// Plaque
		const plaque = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.02), gold);
		plaque.position.set(0, 0.3, 0.69);
		g.add(plaque);

		this.group.add(g);
	}

	private buildAtrium(): void {
		// Atrium planter + fake palm (classic US mall energy)
		const baseMat = this.track(
			lit({
				color: 0xb8a090,
				metalness: 0.1,
				roughness: 0.7,
			}),
		);

		const base = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.4, 0.35, 32), baseMat);
		base.position.y = 0.18;
		this.group.add(base);

		const planter = new THREE.Mesh(
			new THREE.CylinderGeometry(1.2, 1.4, 0.8, 24),
			this.track(lit({ color: 0x8b7355, roughness: 0.85 })),
		);
		planter.position.y = 0.7;
		this.group.add(planter);

		// Water instead of dirt — it is a fountain, not a plant pot
		const water = new THREE.Mesh(
			new THREE.CylinderGeometry(1.15, 1.15, 0.12, 24),
			this.track(
				lit({
					color: 0x2a7ea8,
					metalness: 0.35,
					roughness: 0.15,
					transparent: true,
					opacity: 0.85,
				}),
			),
		);
		water.position.y = 1.06;
		this.group.add(water);

		// The palm that used to grow out of the middle of the fountain is gone.
		// In its place: the owner, immortalised in marble.
		this.buildGodStatue();

		const accent = new THREE.Mesh(
			new THREE.RingGeometry(2.6, 3.0, 48),
			this.track(
				lit({
					color: 0xc4b5a0,
					side: THREE.DoubleSide,
				}),
			),
		);
		accent.rotation.x = -Math.PI / 2;
		accent.position.y = 0.02;
		this.group.add(accent);
	}

	/** Small marble pedestal figure on the fountain island */
	/**
	 * ONE escalator (east) + ONE stairs (west). Never cross. Never share a shaft.
	 * Each has a hole cut in floor-1 at the top landing.
	 */
	private buildEscalator(): void {
		this.buildEscalatorFlight();
		// West trap: bodem (-22,0,4) → top (-22,6,-14). Andere wand, kruist nooit.
		this.buildStairFlight();
	}

	/** Paneel evenwijdig aan de helling, met rechte koppen in plaats van schuine. */
	private escPanel({
		x,
		zLo,
		zHi,
		below,
		above,
		thick,
		mat,
		round = false,
	}: {
		x: number;
		zLo: number;
		zHi: number;
		below: number;
		above: number;
		thick: number;
		mat: THREE.Material;
		/** Halfronde koppen, zodat de balustrade om de leuningomkeer heen loopt. */
		round?: boolean;
	}): THREE.Mesh {
		// De twee knikken zitten op z0 en z1, waar de helling in de vlakke
		// landingen overgaat; zonder die punten snijdt het paneel de hoeken af.
		const zs = [zLo, ESCALATOR.zBottom, ESCALATOR.zTop, zHi];
		const shape = new THREE.Shape();
		const cap = (zEnd: number, outward: number, a0: number, a1: number) => {
			if (!round) return;
			const cy = escLine(zEnd) + midpoint(below, above);
			const r = half(above - below);
			for (let k = 1; k < 8; k++) {
				const a = a0 + ((a1 - a0) * k) / 8;
				shape.lineTo(zEnd + outward * r * Math.cos(a), cy + r * Math.sin(a));
			}
		};
		const out = Math.sign(zHi - zLo);
		shape.moveTo(zLo, escLine(zLo) + below);
		for (const z of zs.slice(1)) {
			shape.lineTo(z, escLine(z) + below);
		}
		cap(zHi, out, -Math.PI / 2, Math.PI / 2);
		for (const z of [...zs].reverse()) {
			shape.lineTo(z, escLine(z) + above);
		}
		// Terug naar beneden langs a = 0, niet langs a = PI: die kant passeert
		// cos = -1 en bolt de kop dus naar binnen in plaats van naar buiten.
		cap(zLo, -out, Math.PI / 2, -Math.PI / 2);
		shape.closePath();
		const geo = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false });
		geo.rotateY(-Math.PI / 2);
		geo.translate(x + half(thick), 0, 0);
		return new THREE.Mesh(geo, mat);
	}

	/**
	 * De oostelijke roltrap.
	 *
	 * Het midden van elke trede ligt exact op de helling uit Collision. Leg je ze
	 * op `(i+1)*rise`, dan zweeft de hele trap een halve stap boven de lijn die je
	 * beklimt en zak je er zichtbaar doorheen.
	 */
	private buildEscalatorFlight(): void {
		const g = new THREE.Group();
		g.name = 'escalator';

		const { x, zBottom: z0, zTop: z1, steps, width: w, apron, opening } = ESCALATOR;
		const dir = z1 < z0 ? -1 : 1;
		const stepDepth = Math.abs(z1 - z0) / steps;
		const stepRise = FLOOR_H / steps;
		// Waar de balustrade eindigt. De omkeer bolt daar nog een straal voorbij,
		// dus het paneel stopt precies zoveel eerder als de apron toestaat.
		const zLo = z0 - dir * (apron - ESC_NEWEL_R);
		const zHi = z1 + dir * (apron - ESC_NEWEL_R);

		const cleat = this.escStripeTexture(64, '#8b969d', '#5b6469', 1.6, w / 0.28);
		// De scene heeft geen environment map, dus metalness boven ~0.5 heeft niets
		// om in te spiegelen en slaat om in zwart. Geborsteld staal, geen chroom.
		const treadMat = this.track(lit({ map: cleat, metalness: 0.45, roughness: 0.5 }));
		const riserMat = this.track(lit({ map: cleat, color: 0x767f85, metalness: 0.4, roughness: 0.6 }));
		const steelMat = this.track(lit({ color: 0xc3ccd2, metalness: 0.4, roughness: 0.34 }));
		const trussMat = this.track(lit({ color: 0x39424a, metalness: 0.2, roughness: 0.78 }));
		const glassMat = this.track(
			lit({
				color: 0xbcd6e6,
				metalness: 0.1,
				roughness: 0.06,
				transparent: true,
				opacity: 0.24,
				side: THREE.DoubleSide,
			}),
		);
		const glowMat = this.track(new THREE.MeshBasicMaterial({ color: 0x8fe3ff, toneMapped: false }));
		const combMat = this.track(
			lit({
				map: this.escStripeTexture(64, '#c8a02a', '#4a3c10', 2, w / 0.09),
				metalness: 0.6,
				roughness: 0.45,
			}),
		);

		// ── vakwerk, schortplaat, glas en de lichtstrip onder de leuning ──
		// Het vakwerk hangt onder de tredebladen en steekt net buiten de balustrade
		// uit, zodat die er niet naast zweeft.
		const outerX = ESC_SKIRT_X + half(ESC_PANEL_T);
		g.add(
			this.escPanel({
				x,
				zLo,
				zHi,
				below: -(stepRise + ESC_TREAD_T + 0.4),
				above: -(ESC_TREAD_T + 0.02),
				thick: outerX * 2 + 0.02,
				mat: trussMat,
			}),
		);
		for (const side of [-1, 1] as const) {
			const shared = { x: x + side * ESC_SKIRT_X, zLo, zHi, round: true };
			g.add(this.escPanel({ ...shared, below: -0.02, above: ESC_GLASS_LO, thick: ESC_PANEL_T, mat: steelMat }));
			g.add(this.escPanel({ ...shared, below: ESC_GLASS_LO, above: ESC_GLASS_HI, thick: 0.03, mat: glassMat }));
			// De lichtstrip vult de spleet tussen glasrand en leuning, en stopt recht
			// af: een echte dekverlichting loopt niet mee de omkeer in.
			g.add(
				this.escPanel({
					...shared,
					round: false,
					below: ESC_GLASS_HI,
					above: ESC_RAIL_Y - ESC_RAIL_R,
					thick: ESC_PANEL_T + 0.005,
					mat: glowMat,
				}),
			);
		}

		// ── landingen en kamplaten ──
		// De onderste kamplaat begint precies op z0, waar de helling nog nul is:
		// daardoor komt een trede er vlak onder vandaan en klimt hij pas daarna.
		const landW = outerX * 2 + 0.2;
		const land0 = new THREE.Mesh(new THREE.BoxGeometry(landW, 0.02, apron + 0.3), steelMat);
		land0.position.set(x, ESC_STEP_MIN - 0.01, z0 - half(dir * (apron + 0.3)));
		g.add(land0);
		// Voorbij de top van de ramp loopt het gat nog door tot ESC_HOLE_FAR_Z;
		// deze plaat vult precies dat stuk, zodat je bij de uitstap niet in de
		// schacht stapt.
		const gapD = Math.abs(ESC_HOLE_FAR_Z - z1);
		const land1 = new THREE.Mesh(new THREE.BoxGeometry(opening.size.width, 0.14, gapD), steelMat);
		land1.position.set(x, FLOOR_H - 0.07, z1 + half(dir * gapD));
		g.add(land1);
		// De kamplaat begint op de knik en loopt naar buiten, dus de trede die
		// eronder ligt is precies de trede die nog vlak is.
		const combD = stepDepth + 0.05;
		for (const combPosition of [
			{ z: z0 - half(dir * combD), y: ESC_STEP_MIN },
			{ z: z1 + half(dir * combD), y: FLOOR_H },
		] as const) {
			const comb = new THREE.Mesh(new THREE.BoxGeometry(ESC_SKIRT_X * 2, 0.05, combD), combMat);
			comb.position.set(x, combPosition.y + 0.02, combPosition.z);
			g.add(comb);
		}

		// ── newel-sokkels: het donkere blok waar de onderste helft van de
		// leuningomkeer in verdwijnt. Zonder dit hangt die lus als een losse ring
		// naast de roltrap, want de schortplaat is er met 0.05 veel te dun voor ──
		const baseH = ESC_GLASS_MID + 0.02;
		const baseT = 0.16;
		const baseD = 0.85;
		const noseGeo = new THREE.CylinderGeometry(half(baseT), half(baseT), baseH, 10);
		const baseGeo = new THREE.BoxGeometry(baseT, baseH, baseD);
		for (const end of [
			{ z: zLo, outward: -dir },
			{ z: zHi, outward: dir },
		] as const) {
			const yMid = escLine(end.z) - 0.02 + half(baseH);
			const front = end.z + end.outward * ESC_GLASS_R;
			for (const side of [-1, 1] as const) {
				const sx = x + side * ESC_SKIRT_X;
				const block = new THREE.Mesh(baseGeo, trussMat);
				block.position.set(sx, yMid, front - half(end.outward * baseD));
				g.add(block);
				const nose = new THREE.Mesh(noseGeo, trussMat);
				nose.position.set(sx, yMid, front);
				g.add(nose);
			}
		}

		// ── treden: één extra onderaan, zodat er altijd één onder de kamplaat
		// vandaan komt op het moment dat de bovenste eronder verdwijnt ──
		const treadGeo = new THREE.BoxGeometry(w, ESC_TREAD_T, stepDepth);
		const riserGeo = new THREE.BoxGeometry(w, stepRise + 0.02, ESC_RISER_T);
		// Gele neuslijn op de afloopkant van elk tredeblad, zoals op elke roltrap.
		// Hij ligt er los bovenop en is aan alle kanten ingelaten: deelt hij ook maar
		// één vlak met het tredeblad, dan vechten ze om de dieptebuffer en flikkert
		// de lijn.
		const noseLineGeo = new THREE.BoxGeometry(w - 2 * ESC_NOSE_INSET, ESC_NOSE_H, 0.05);
		const noseLineMat = this.track(lit({ color: 0xe8b312, roughness: 0.55 }));
		for (let i = -1; i < steps; i++) {
			const node = new THREE.Group();
			node.position.x = x;
			const tread = new THREE.Mesh(treadGeo, treadMat);
			tread.position.y = -half(ESC_TREAD_T);
			node.add(tread);
			const noseLine = new THREE.Mesh(noseLineGeo, noseLineMat);
			noseLine.position.set(0, ESC_NOSE_LIFT + half(ESC_NOSE_H), -dir * (half(stepDepth) - ESC_NOSE_INSET - 0.025));
			node.add(noseLine);
			const riser = new THREE.Mesh(riserGeo, riserMat);
			riser.position.set(0, -ESC_TREAD_T - half(stepRise + 0.02), -dir * half(stepDepth));
			node.add(riser);
			g.add(node);
			this.escSteps.push({ node, index: i });
		}
		this.placeEscalatorSteps();

		// ── leuning: één buis van kop tot kop, geen segmentnaden ──
		const railPoints = escRailPath(zLo, zHi, ESC_RAIL_Y);
		const { geo: railGeo, length: railLen } = escRailTube(railPoints, ESC_RAIL_R);
		const railTex = this.escRailTexture(railLen / ESC_RAIL_TICK);
		const railMat = this.track(lit({ map: railTex, roughness: 0.85, metalness: 0.05 }));
		this.escRailMaps.push(railTex);
		const capGeo = new THREE.SphereGeometry(ESC_RAIL_R, 8, 6);
		for (const side of [-1, 1] as const) {
			const bar = new THREE.Mesh(railGeo, railMat);
			bar.position.x = x + side * ESC_SKIRT_X;
			// Breder dan hoog, zoals een rubber leuningband. Mag alleen in x, want
			// het hele pad ligt in het ZY-vlak.
			bar.scale.x = 1.4;
			g.add(bar);
			// De buis is open aan beide koppen; twee dopjes sluiten hem af.
			for (const end of [at(railPoints, 0), at(railPoints, -1)]) {
				const cap = new THREE.Mesh(capGeo, railMat);
				cap.position.set(bar.position.x, end.y, end.z);
				cap.scale.x = 1.4;
				g.add(cap);
			}
		}

		// ── bord boven de instap ──
		const { canvas: sc, ctx: sctx, w: sw, h: sh } = labelCanvas(512, 96);
		sctx.fillStyle = '#0d47a1';
		sctx.fillRect(0, 0, sw, sh);
		sctx.fillStyle = '#ffffff';
		fitText(
			sctx,
			`ROLTRAP ↑ ${level('v1').name.toUpperCase()}`,
			{ x: 16, y: 10, w: sw - 32, h: sh - 20 },
			{ size: 56, maxLines: 1 },
		);
		const signTex = labelTexture(sc);
		this.textures.push(signTex);
		// Portaal boven de instap: de staanders net buiten de balustrade, het bord
		// er bovenin, zodat je er onderdoor loopt en niet tegenaan.
		const gantryH = 2.6;
		const signW = ESC_SKIRT_X * 2 + 0.4;
		const sign = new THREE.Mesh(
			new THREE.PlaneGeometry(signW, (signW * sh) / sw),
			this.track(new THREE.MeshBasicMaterial({ map: signTex, toneMapped: false })),
		);
		const signZ = z0 - dir * apron;
		sign.position.set(x, gantryH - half((signW * sh) / sw) - 0.06, signZ);
		g.add(sign);
		for (const side of [-1, 1] as const) {
			const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, gantryH, 8), steelMat);
			post.position.set(x + side * (half(signW) + 0.05), half(gantryH), signZ);
			g.add(post);
		}

		this.addHoleRails(g, opening, dir, glassMat, steelMat);

		this.group.add(g);
	}

	/**
	 * Hekwerk om een gat in de vloerplaat: glas met een stalen bovenregel langs
	 * beide lange zijden, en dicht aan de kant waar de trap onder de plaat door
	 * gaat. Alleen de uitstapkant blijft open, anders sta je erop te kijken en
	 * loop je er aan de andere kant zo in.
	 */
	private addHoleRails(
		g: THREE.Group,
		opening: OpeningDef,
		direction: number,
		glassMat: THREE.Material,
		railMat: THREE.Material,
	): void {
		const GLASS_H = 0.95;
		const T = 0.03;
		const { center, size } = opening;
		// Net buiten de gatrand, anders staat het hek op lucht.
		const sideX = half(size.width) + 0.12;
		const nearZ = center.z - direction * (half(size.depth) + 0.12);
		const panel = (px: number, pz: number, pw: number, pd: number) => {
			const glass = new THREE.Mesh(new THREE.BoxGeometry(pw, GLASS_H, pd), glassMat);
			glass.position.set(px, FLOOR_H + half(GLASS_H), pz);
			g.add(glass);
			const rail = new THREE.Mesh(new THREE.BoxGeometry(pw + 0.04, 0.07, pd + 0.04), railMat);
			rail.position.set(px, FLOOR_H + GLASS_H, pz);
			g.add(rail);
		};
		for (const side of [-1, 1] as const) {
			panel(center.x + side * sideX, center.z, T, size.depth + 0.24);
		}
		panel(center.x, nearZ, sideX * 2, T);
	}

	/** Zet elke trede op de huidige fase. u = 0 is de gebouwde stand. */
	private placeEscalatorSteps(): void {
		const dir = ESCALATOR.zTop < ESCALATOR.zBottom ? -1 : 1;
		const stepDepth = Math.abs(ESCALATOR.zTop - ESCALATOR.zBottom) / ESCALATOR.steps;
		const stepRise = FLOOR_H / ESCALATOR.steps;
		for (const s of this.escSteps) {
			const k = s.index + 0.5 + this.escPhase;
			s.node.position.z = ESCALATOR.zBottom + dir * k * stepDepth;
			// Onder- en bovenaan afgekapt: dat is precies het vlakke stuk waar een
			// echte roltrap zijn treden onder de kamplaat in laat lopen.
			const y = k * stepRise;
			s.node.position.y = y < ESC_STEP_MIN ? ESC_STEP_MIN : y > FLOOR_H ? FLOOR_H : y;
		}
	}

	/**
	 * Leuningband: donker rubber met een flauwe dwarsband, zodat je hem ziet
	 * lopen. Op een buis loopt v langs de lengte, dus de band moet horizontaal.
	 */
	private escRailTexture(repeatY: number): THREE.Texture {
		const { canvas, ctx, w, h } = labelCanvas(8, 32);
		ctx.fillStyle = '#24272d';
		ctx.fillRect(0, 0, w, h);
		ctx.fillStyle = '#31353d';
		ctx.fillRect(0, 0, w, 3);
		const tex = labelTexture(canvas);
		tex.wrapS = THREE.RepeatWrapping;
		tex.wrapT = THREE.RepeatWrapping;
		tex.repeat.set(1, repeatY);
		this.textures.push(tex);
		return tex;
	}

	/** Herhaalbare streepjestextuur: ribbels op treden, tanden op de kamplaat. */
	private escStripeTexture(size: number, bg: string, fg: string, lineW: number, repeatX: number, height = 8): THREE.Texture {
		const { canvas, ctx, w, h } = labelCanvas(size, height);
		ctx.fillStyle = bg;
		ctx.fillRect(0, 0, w, h);
		ctx.fillStyle = fg;
		for (let i = 0; i < w; i += 4) {
			ctx.fillRect(i, 0, lineW, h);
		}
		const tex = labelTexture(canvas);
		tex.wrapS = THREE.RepeatWrapping;
		tex.wrapT = THREE.RepeatWrapping;
		tex.repeat.set(repeatX, 1);
		this.textures.push(tex);
		return tex;
	}

	/** Vaste trap: elke trede in zijn eigen band, geen diagonale balkensoep. */
	private buildStairFlight(): void {
		const g = new THREE.Group();
		g.name = 'stairs';
		const { x, zBottom: z0, zTop: z1, width, opening } = STAIRS;
		const run = Math.abs(z1 - z0);
		const dir = z1 < z0 ? -1 : 1;
		const steps = 14;
		const metal = this.track(
			lit({
				color: 0x6d4c41,
				metalness: 0.15,
				roughness: 0.4,
			}),
		);
		const tread = this.track(
			lit({
				color: 0xd7ccc8,
				roughness: 0.55,
			}),
		);
		const railMat = this.track(lit({ color: 0xb0bec5, metalness: 0.7, roughness: 0.3 }));

		// Bottom landing
		const land0 = new THREE.Mesh(new THREE.BoxGeometry(width + 0.6, 0.12, 1.4), metal);
		land0.position.set(x, 0.06, z0 - dir * 0.5);
		g.add(land0);

		// Top landing (sits in floor-1 hole)
		const land1 = new THREE.Mesh(new THREE.BoxGeometry(width + 0.6, 0.12, 1.5), metal);
		land1.position.set(x, FLOOR_H + 0.06, z1 + dir * 0.35);
		g.add(land1);

		// Discrete steps — each tread only occupies its own band (no cross)
		const stepDepth = run / steps;
		const stepRise = FLOOR_H / steps;
		for (let i = 0; i < steps; i++) {
			const z = z0 + dir * (i + 0.5) * stepDepth;
			const y = (i + 1) * stepRise;
			const step = new THREE.Mesh(new THREE.BoxGeometry(width, 0.12, stepDepth * 0.92), tread);
			step.position.set(x, y - 0.06, z);
			g.add(step);
			// riser
			const riser = new THREE.Mesh(new THREE.BoxGeometry(width, stepRise * 0.95, 0.06), metal);
			riser.position.set(x, y - half(stepRise), z - dir * stepDepth * 0.45);
			g.add(riser);
		}

		// Side stringers (thin vertical boards, NOT a diagonal beam that looks like a cross)
		for (const sx of [x - half(width) - 0.06, x + half(width) + 0.06]) {
			for (let i = 0; i < steps; i++) {
				const z = z0 + dir * (i + 0.5) * stepDepth;
				const y = (i + 0.5) * stepRise;
				const board = new THREE.Mesh(new THREE.BoxGeometry(0.1, stepRise + 0.08, stepDepth * 0.95), metal);
				board.position.set(sx, y, z);
				g.add(board);
			}
			// handrail as polyline of short segments (no single X-beam)
			for (let i = 0; i < steps; i++) {
				const z = z0 + dir * (i + 0.5) * stepDepth;
				const y = (i + 1) * stepRise + 0.75;
				const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.75, 6), railMat);
				post.position.set(sx, y - 0.35, z);
				g.add(post);
				if (i < steps - 1) {
					const z2 = z0 + dir * (i + 1.5) * stepDepth;
					const y2 = (i + 2) * stepRise + 0.75;
					const midZ = midpoint(z, z2);
					const midY = midpoint(y, y2);
					const segLen = Math.hypot(z2 - z, y2 - y);
					const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, segLen), railMat);
					rail.position.set(sx, midY, midZ);
					// Een draai om X stuurt lokaal +Z naar (0, -sin, cos): zonder het
					// minteken helt elk segment de verkeerde kant op en zakt de leuning
					// terwijl de trap klimt.
					rail.rotation.x = -Math.atan2(y2 - y, z2 - z);
					g.add(rail);
				}
			}
		}

		const { canvas: c, ctx, w: cw, h: ch } = labelCanvas(256, 64);
		ctx.fillStyle = '#5d4037';
		ctx.fillRect(0, 0, cw, ch);
		ctx.fillStyle = '#fff';
		fitText(ctx, `TRAP ↑ ${level('v1').name.toUpperCase()}`, { x: 10, y: 8, w: cw - 20, h: ch - 16 }, { size: 36, maxLines: 1 });
		const tex = labelTexture(c);
		this.textures.push(tex);
		const sign = new THREE.Mesh(
			new THREE.PlaneGeometry(1.9, 0.48),
			this.track(new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })),
		);
		sign.position.set(x, 1.6, z0 - dir * 0.2);
		g.add(sign);

		// Hekje langs het gat in de vloerplaat, buiten de halve gatbreedte.
		const glassMat = this.track(
			lit({
				color: 0xbcd6e6,
				metalness: 0.1,
				roughness: 0.06,
				transparent: true,
				opacity: 0.24,
				side: THREE.DoubleSide,
			}),
		);
		this.addHoleRails(g, opening, dir, glassMat, railMat);

		this.group.add(g);
	}

	private buildStores(): void {
		for (const store of shopStores()) {
			const pod = this.buildStorePod(store);
			this.storeMeshes.set(store.id, pod);
			this.group.add(pod);
		}
	}

	private buildStorePod(store: StoreDef): THREE.Group {
		const { id, x, z, level: storeLevel, rotation, width, depth, color, accent, hero, name } = store;
		const g = new THREE.Group();
		g.name = `store_${id}`;
		g.position.set(x, levelY(storeLevel), z);
		g.rotation.y = rotation;

		const bodyColor = new THREE.Color(color);
		bodyColor.offsetHSL(0, 0, 0.1);
		const wallMat = this.track(
			lit({
				color: bodyColor,
				metalness: 0.15,
				roughness: 0.65,
			}),
		);

		/**
		 * OPEN BOX shop: front fully open toward corridor.
		 * Local +Z = entrance, local -Z = back.
		 * Thin walls ONLY on back + left + right — NOTHING in the middle.
		 */
		const wallT = 0.18;
		const roomDepth = depth * SHOP_ROOM_DEPTH_FACTOR;
		const backZ = -roomDepth;

		// Floor of shop (visible mat)
		addBoxMesh(g, this.track(lit({ color: 0xe8dcc8, roughness: 0.85 })), {
			name: `${id}-floor`,
			width: width - 0.2,
			height: 0.06,
			depth: roomDepth,
			position: { x: 0, y: 0.03, z: -half(roomDepth) },
		});

		// BACK wall only (thin slab at rear)
		addBoxMesh(g, wallMat, {
			name: `${id}-back-wall`,
			width,
			height: SHOP_HEIGHT,
			depth: wallT,
			position: { x: 0, y: half(SHOP_HEIGHT), z: backZ },
			castShadow: true,
		});

		// LEFT / RIGHT walls (thin, full depth — open storefront)
		for (const sideX of [-half(width) + half(wallT), half(width) - half(wallT)]) {
			addBoxMesh(g, wallMat, {
				name: `${id}-side-wall`,
				width: wallT,
				height: SHOP_HEIGHT,
				depth: roomDepth,
				position: { x: sideX, y: half(SHOP_HEIGHT), z: -half(roomDepth) },
			});
		}

		// Thin ceiling so it reads as a room
		addBoxMesh(g, this.track(lit({ color: 0xf5f0e8, roughness: 0.9 })), {
			name: `${id}-ceiling`,
			width: width - 0.1,
			height: 0.1,
			depth: roomDepth,
			position: { x: 0, y: SHOP_HEIGHT - 0.05, z: -half(roomDepth) },
		});

		// Interior paint on back wall (facing into shop = +Z)
		addPlaneMesh(
			g,
			this.track(
				lit({
					color: new THREE.Color(accent).lerp(new THREE.Color(0xfff8f0), 0.5),
					roughness: 0.75,
					emissive: new THREE.Color(accent),
					emissiveIntensity: 0.1,
					side: THREE.DoubleSide,
				}),
			),
			{
				name: `${id}-interior`,
				width: width - 0.4,
				height: SHOP_HEIGHT - 0.6,
				position: { x: 0, y: half(SHOP_HEIGHT), z: backZ + half(wallT) + 0.02 },
			},
		);

		// Counter + 5 guys on the floor (owner + 4 staff)
		const counterW = Math.min(width * 0.78, 5.2);
		addBoxMesh(g, this.track(lit({ color: 0x5d4037, roughness: 0.7 })), {
			name: `${id}-counter`,
			width: counterW,
			height: 0.85,
			depth: 0.5,
			position: { x: 0, y: 0.42, z: -roomDepth * 0.55 },
		});

		const crew = 5;
		const span = Math.min(counterW * 0.88, 4.6);
		for (let i = 0; i < crew; i++) {
			const t = i / (crew - 1);
			const x = (t - 0.5) * span;
			const guy = this.makeShopkeeper(store, i);
			// Behind counter, facing storefront (+Z)
			guy.position.set(x, 0, -roomDepth * 0.68);
			g.add(guy);
		}

		// OPEN signs
		const { canvas: openCanvas, ctx: octx } = labelCanvas(256, 96);
		octx.fillStyle = '#15803d';
		octx.fillRect(0, 0, 256, 96);
		octx.fillStyle = '#fff';
		octx.font = 'bold 48px system-ui,sans-serif';
		octx.textAlign = 'center';
		octx.textBaseline = 'middle';
		octx.fillText('OPEN', 128, 48);
		const openTex = labelTexture(openCanvas);
		addPlaneMesh(g, this.track(new THREE.MeshBasicMaterial({ map: openTex, toneMapped: false })), {
			name: `${id}-open-sign`,
			width: 1.2,
			height: 0.45,
			position: { x: width * 0.32, y: SHOP_HEIGHT - 1.3, z: 0.08 },
		});

		// Bright interior lights so stock + keeper pop
		// GEEN PointLights per winkel meer: 19 winkels × 2 lampen = ~38 lichten,
		// en bij forward rendering rekent élk object met ál die lichten mee — dat
		// was de grootste framekiller. Een emissive plafondpaneel leest hetzelfde.
		addPlaneMesh(g, this.track(new THREE.MeshBasicMaterial({ color: 0xfff4e0, toneMapped: false })), {
			name: `${id}-light-panel`,
			width: width * 0.6,
			height: half(roomDepth),
			position: { x: 0, y: SHOP_HEIGHT - 0.15, z: -roomDepth * 0.4 },
			rotation: { x: Math.PI / 2, y: 0, z: 0 },
		});

		// Sign board — bright MeshBasic so names always readable
		const lines = name.split('\n');
		const signTex = makeTextTexture(lines, {
			bg: color,
			fg: accent,
			accent: hero ? accent : undefined,
			fontSize: hero ? 72 : 56,
			w: 512,
			h: hero ? 220 : 180,
		});
		const signH = hero ? 1.3 : 0.9;
		addPlaneMesh(g, this.track(new THREE.MeshBasicMaterial({ map: signTex, toneMapped: false })), {
			name: `${id}-sign`,
			width: width * 0.85,
			height: signH,
			position: { x: 0, y: SHOP_HEIGHT - 0.3, z: 0.12 },
		});

		// Accent strip under sign (solid color, NO emissive — flicker source)
		addBoxMesh(g, this.track(lit({ color: accent, roughness: 0.5, metalness: 0.1 })), {
			name: `${id}-accent-strip`,
			width: width * 0.9,
			height: 0.08,
			depth: 0.06,
			position: { x: 0, y: SHOP_HEIGHT - 0.95, z: 0.12 },
		});

		// Pillars
		const pillarMat = this.track(
			lit({
				color: 0xd0cbc4,
				metalness: 0.15,
				roughness: 0.6,
			}),
		);
		for (const pillarX of [-half(width) + 0.2, half(width) - 0.2]) {
			addBoxMesh(g, pillarMat, {
				name: `${id}-front-pillar`,
				width: 0.25,
				height: SHOP_HEIGHT,
				depth: 0.25,
				position: { x: pillarX, y: half(SHOP_HEIGHT), z: 0 },
			});
		}

		// Hero extras for Kruidvat (matte green cross — still the joke destination)
		if (hero) {
			const crossMat = this.track(
				lit({
					color: 0x00a651,
					roughness: 0.55,
					metalness: 0.1,
				}),
			);
			const crossPosition = { x: -half(width) + 1.2, y: SHOP_HEIGHT - 1.8, z: 0.2 };
			addBoxMesh(g, crossMat, { name: `${id}-cross-vertical`, width: 0.35, height: 1.4, depth: 0.15, position: crossPosition });
			addBoxMesh(g, crossMat, { name: `${id}-cross-horizontal`, width: 1.1, height: 0.35, depth: 0.15, position: crossPosition });
		}

		return g;
	}

	/**
	 * One of five floor staff. Index 0 = named owner (`keeper_${id}` for ShopVoice).
	 * 1–4 = extra guys with store-branded uniforms.
	 */
	private makeShopkeeper(store: StoreDef, index = 0): THREE.Group {
		const owner = getOwner(store.id);
		const isBoss = index === 0;
		const g = new THREE.Group();
		g.name = isBoss ? `keeper_${store.id}` : `staff_${store.id}_${index}`;

		// Deterministic variety from store id + index
		const seed = hashStr(`${store.id}:${index}`);
		const skins = [0xe8c4a8, 0xf5c9a8, 0xd4a574, 0xc68642, 0x8d5524, 0xffdbac];
		const hairs = [0x1a1a1a, 0x2c1810, 0xc4a35a, 0x4a3728, 0xf5f5f5, 0x3e2723];
		const staffNames = ['Jan', 'Kevin', 'Mo', 'Daan', 'Luca', 'Sam', 'Omar', 'Nick', 'Bram', 'Timo', 'Jay', 'Rico'];
		const staffTitles = ['Verkoper', 'Kassa', 'Vulploeg', 'Floor', 'Stagiair'];

		const skinCol = isBoss ? (owner?.skin ?? 0xe8c4a8) : at(skins, seed);
		const shirtCol = isBoss
			? (owner?.shirt ?? new THREE.Color(store.color).getHex())
			: // staff: store color, slightly varied brightness
				new THREE.Color(store.color).offsetHSL(0, 0, ((seed % 5) - 2) * 0.04).getHex();
		const hairCol = isBoss ? (owner?.hair ?? 0x2c1810) : at(hairs, seed * 3);

		g.userData['ownerName'] = isBoss ? (owner?.name ?? 'Verkoper') : at(staffNames, seed + index);
		g.userData['ownerLines'] = owner?.lines ?? ['Thanks!'];
		g.userData['ownerMeaning'] = isBoss ? (owner?.meaning ?? 'Houdt de winkel draaiende') : 'Werkt hier gewoon';

		const skin = this.track(lit({ color: skinCol, roughness: 0.85 }));
		const uni = this.track(
			lit({
				color: shirtCol,
				roughness: 0.8,
			}),
		);
		const hairMat = this.track(lit({ color: hairCol, roughness: 0.9 }));
		const pants = this.track(
			lit({
				color: isBoss ? 0x1a1a2e : 0x2c3e50,
				roughness: 0.85,
			}),
		);

		// Slight size variety so the crew doesn't look cloned
		const scale = isBoss ? 1 : 0.9 + (seed % 7) * 0.02;
		const bodyG = new THREE.Group();

		const legL = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.4, 3, 6), pants);
		const legR = legL.clone();
		legL.position.set(-0.1, 0.38, 0);
		legR.position.set(0.1, 0.38, 0);
		bodyG.add(legL, legR);

		const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.5, 4, 8), uni);
		body.position.y = 1.0;
		bodyG.add(body);

		// Store name tag on chest
		const badge = new THREE.Mesh(
			new THREE.BoxGeometry(0.18, 0.1, 0.02),
			this.track(
				lit({
					color: store.accent ? new THREE.Color(store.accent).getHex() : 0xffffff,
					roughness: 0.5,
				}),
			),
		);
		badge.position.set(0.12, 1.15, 0.18);
		bodyG.add(badge);

		const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 12), skin);
		head.position.y = 1.48;
		bodyG.add(head);
		const hair = new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 10), hairMat);
		hair.position.y = 1.6;
		hair.scale.set(1, 0.55, 1);
		bodyG.add(hair);

		const eyeMat = this.track(new THREE.MeshBasicMaterial({ color: 0x111111 }));
		const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.032, 8, 8), eyeMat);
		const eyeR = eyeL.clone();
		eyeL.position.set(-0.055, 1.5, 0.15);
		eyeR.position.set(0.055, 1.5, 0.15);
		bodyG.add(eyeL, eyeR);
		const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), eyeMat);
		mouth.position.set(0, 1.4, 0.15);
		mouth.scale.set(1.4, 0.45, 0.5);
		bodyG.add(mouth);

		bodyG.scale.setScalar(scale);
		g.add(bodyG);

		const name = isBoss ? (owner?.name ?? 'Verkoper') : String(g.userData['ownerName'] ?? 'Verkoper');
		const title = isBoss ? (owner?.title ?? 'Shop owner') : at(staffTitles, index);
		const meaning = isBoss ? (owner?.meaning ?? '') : `Crew #${index + 1}`;

		const { canvas: pc, ctx: pctx } = labelCanvas(320, 96);
		pctx.fillStyle = '#0f172a';
		pctx.fillRect(0, 0, 320, 96);
		pctx.fillStyle = isBoss && owner ? '#4ade80' : '#38bdf8';
		pctx.fillRect(0, 0, 6, 96);
		pctx.fillStyle = '#f8fafc';
		pctx.font = 'bold 20px system-ui,sans-serif';
		pctx.textAlign = 'center';
		pctx.fillText(name.slice(0, 20), 160, 28);
		pctx.fillStyle = '#94a3b8';
		pctx.font = '14px system-ui,sans-serif';
		pctx.fillText(title.slice(0, 24), 160, 50);
		if (meaning) {
			pctx.fillStyle = isBoss ? '#a78bfa' : '#64748b';
			pctx.font = '12px system-ui,sans-serif';
			pctx.fillText(meaning.slice(0, 36), 160, 74);
		}
		const ptex = labelTexture(pc);
		const plate = new THREE.Mesh(
			new THREE.PlaneGeometry(1.2, 0.36),
			this.track(new THREE.MeshBasicMaterial({ map: ptex, toneMapped: false })),
		);
		plate.position.set(0, 2.05 * scale, 0.12);
		g.add(plate);
		return g;
	}

	private buildKiosk(): void {
		const g = new THREE.Group();
		g.position.set(0, 0, 10);
		g.name = 'kiosk';

		const bodyMat = this.track(
			lit({
				color: 0x4a5568,
				metalness: 0.3,
				roughness: 0.5,
			}),
		);
		const screenMat = this.track(
			lit({
				color: 0x3b82f6,
				roughness: 0.4,
			}),
		);

		const base = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 1.1, 24), bodyMat);
		base.position.y = 0.55;
		g.add(base);

		const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 1.2, 12), bodyMat);
		pole.position.y = 1.6;
		g.add(pole);

		const bezel = new THREE.Mesh(new THREE.BoxGeometry(1.55, 1.1, 0.1), bodyMat);
		bezel.position.set(0, 2.4, 0.05);
		bezel.rotation.x = -0.15;
		g.add(bezel);

		const screen = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.95, 0.08), screenMat);
		screen.position.set(0, 2.4, 0.12);
		screen.rotation.x = -0.15;
		g.add(screen);

		// You are here marker (matte red, no pulse material)
		const ring = new THREE.Mesh(
			new THREE.RingGeometry(0.9, 1.15, 40),
			this.track(
				lit({
					color: 0xdc2626,
					side: THREE.DoubleSide,
					roughness: 0.6,
				}),
			),
		);
		ring.rotation.x = -Math.PI / 2;
		ring.position.y = 0.03;
		ring.name = 'youAreHere';
		g.add(ring);

		this.group.add(g);
	}

	private buildRailings(): void {
		const railMat = this.track(
			lit({
				color: 0x8899aa,
				metalness: 0.95,
				roughness: 0.15,
			}),
		);
		const glassMat = this.track(
			lit({
				color: 0xc5e0f5,
				transparent: true,
				opacity: 0.25,
				roughness: 0.1,
				side: THREE.DoubleSide,
			}),
		);

		for (const run of [
			{
				name: 'north',
				axis: 'x',
				length: ATRIUM_VOID.width,
				position: { x: 0, z: -half(ATRIUM_VOID.depth) },
			},
			{
				name: 'south',
				axis: 'x',
				length: ATRIUM_VOID.width,
				position: { x: 0, z: half(ATRIUM_VOID.depth) },
			},
			{
				name: 'west',
				axis: 'z',
				length: ATRIUM_VOID.depth,
				position: { x: -half(ATRIUM_VOID.width), z: 0 },
			},
			{
				name: 'east',
				axis: 'z',
				length: ATRIUM_VOID.depth,
				position: { x: half(ATRIUM_VOID.width), z: 0 },
			},
		] as const) {
			const alongZ = run.axis === 'z';
			addPlaneMesh(this.group, glassMat, {
				name: `atrium-glass-${run.name}`,
				width: run.length,
				height: 1.1,
				position: { ...run.position, y: FLOOR_H + 0.55 },
				rotation: { x: 0, y: alongZ ? Math.PI / 2 : 0, z: 0 },
			});
			addBoxMesh(this.group, railMat, {
				name: `atrium-rail-${run.name}`,
				width: alongZ ? 0.05 : run.length,
				height: 0.05,
				depth: alongZ ? run.length : 0.05,
				position: { ...run.position, y: FLOOR_H + 1.1 },
			});
		}
	}

	private buildCeilingLights(): void {
		// Fluorescent panels (matte, no emissive strobe)
		const bulbMat = this.track(
			lit({
				color: 0xf5f0e0,
				roughness: 0.4,
			}),
		);

		const decks = [
			{ name: 'v0', y: FLOOR_H - 0.3 },
			{ name: 'v1', y: FLOOR_H * 2 + 1.2 },
		] as const;
		for (let x = -28; x <= 28; x += 8) {
			for (let z = -16; z <= 16; z += 8) {
				if (Math.abs(x) < 10 && Math.abs(z) < 8) continue;
				for (const deck of decks) {
					addBoxMesh(this.group, bulbMat, {
						name: `ceiling-light-${deck.name}`,
						width: 1.2,
						height: 0.08,
						depth: 0.4,
						position: { x, y: deck.y, z },
					});
				}
			}
		}
	}
}
