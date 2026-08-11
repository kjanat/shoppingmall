import * as THREE from 'three';
import { lit } from '#/render/material';
import {
	EXIT_APRON,
	EXIT_APRON_TOP_Y,
	LANE_X,
	LANE_Z,
	ROAD_CROSSINGS,
	ROAD_DASH,
	ROAD_DASH_TILE,
	ROAD_INNER_X,
	ROAD_INNER_Z,
	ROAD_PLAN,
	roadDashPatches,
	ZEBRA_PLAN,
} from '#/scene/city/cityPlan';
import { labelCanvas, labelTexture } from '#/util/label';
import { half, midpoint, span } from '#/util/math';
import { at } from '#/util/rand';

/**
 * Rechthoekige ringweg om de mall. Vier rechte stroken asfalt met vier
 * hoektegels ertussen, vier zebrapaden, vier stoplichten die niemand
 * gehoorzaamt omdat de sims binnen winkelen.
 *
 * Binnenrand op |x|=48 / |z|=34, wegbreedte 7 → buitenrand |x|=55 / |z|=41.
 * Alles ruim binnen de wereldgrens (|x|≤95, |z|≤75) en ruim buiten de mall.
 *
 * De hoeken zijn een eigen tegel omdat de middenstreep daar een kwartslag
 * meedraait. De oost-west stroken liepen er eerst dwars overheen, en dan kijkt
 * wie de bocht neemt tegen strepen die haaks op zijn rijbaan liggen.
 */
const ROAD_W = ROAD_PLAN.width;
const HALF_W = half(ROAD_W);
const ROAD_Y = 0.03; // net boven de maaiveldplaat, anders z-fight bingo
const DASH_Y = 0.05; // de losse middenstreep, net boven het asfalt en onder de zebra
const ZEBRA_Y = 0.06;
/** Hoever de inrit over het asfalt van de ringweg heen loopt. */
const APRON_OVERLAP = 0.15;
/** Dik genoeg om onder de bestrating ernaast door te lopen. */
const APRON_THICKNESS = 0.2;

/** De onderbroken middenstreep in meters, uit het wegenplan. Streep plus gat is één tegel. */
const DASH_LEN = ROAD_DASH.length;
const DASH_GAP = ROAD_DASH.gap;
const TILE_LEN = ROAD_DASH_TILE; // 8 m
/** Oost-west stroken lopen tot aan de hoektegels: x van -48 tot 48. */
const EW_LEN = 2 * ROAD_INNER_X;
/** Noord-zuid stroken idem: z van -34 tot 34. */
const NS_LEN = 2 * ROAD_INNER_Z;

// ── verf, in texels ────────────────────────────────────────
// De dwarsmaat geldt voor beide tegels, dus kantlijn en middenstreep zijn op de
// rechte stukken en in de bocht even dik en zitten op dezelfde afstand van de
// rand. Alleen de langsmaat van de strooktegel is grover: die wordt herhaald.
const ROAD_PX = 128;
const TILE_PX = 256;
const M_TO_ROAD_PX = ROAD_PX / ROAD_W;
/** Kantlijn: hoever van de rand af, en hoe dik. */
const EDGE_INSET_PX = 5;
const EDGE_PX = 3;
/** Streepdikte in texels, uit de metermaat van het wegenplan: één bron voor bocht en recht stuk. */
const DASH_PX = ROAD_DASH.width * M_TO_ROAD_PX;
const SPECKLE_PX = 2;
/** Vlekjes per strooktegel; asfalt zonder textuur is gewoon een sombere plane. */
const SPECKLES_PER_TILE = 220;
const SPECKLE_DENSITY = SPECKLES_PER_TILE / (TILE_PX * ROAD_PX);
const SPECKLE_MIN = 30;
const SPECKLE_RANGE = 26;
const ASPHALT = '#26282c';
const PAINT_EDGE = '#8f939a';
const PAINT_DASH = '#d9d4c2';

/**
 * Fasemachine. 'ns' en 'ew' duren elk 9 s (waarvan de laatste 2 s oranje —
 * lightPhase blijft dan gewoon 'ns'/'ew' melden, het verkeer rijdt immers nog),
 * met tussen elke wissel 2 s 'all-red' zodat niemand theoretisch botst.
 * Cyclus: ns 9 s → all-red 2 s → ew 9 s → all-red 2 s = 22 s.
 */
export type LightPhase = 'ns' | 'ew' | 'all-red';

const GREEN_T = 7;
const AMBER_T = 2;
const ALLRED_T = 2;
const CYCLE = 2 * (GREEN_T + AMBER_T + ALLRED_T); // 22 s

/** Segmentgrenzen binnen de cyclus, voorgekauwd zodat update() alleen vergelijkt. */
const SEG_ENDS = [
	GREEN_T, // 0: ns groen
	GREEN_T + AMBER_T, // 1: ns oranje
	GREEN_T + AMBER_T + ALLRED_T, // 2: alles rood
	CYCLE - AMBER_T - ALLRED_T, // 3: ew groen
	CYCLE - ALLRED_T, // 4: ew oranje
	CYCLE, // 5: alles rood
];

type LampState = 'red' | 'amber' | 'green';

type Head = {
	dir: 'ns' | 'ew';
	red: THREE.Mesh;
	amber: THREE.Mesh;
	green: THREE.Mesh;
};

export class CityRoads {
	readonly group = new THREE.Group();

	private materials: THREE.Material[] = [];
	private geometries: THREE.BufferGeometry[] = [];
	private textures: THREE.Texture[] = [];
	private heads: Head[] = [];
	private zebras!: THREE.InstancedMesh;
	private dashes!: THREE.InstancedMesh;

	// Lampmaterialen — gedeeld over alle koppen, we wisselen alleen referenties
	private redOn!: THREE.Material;
	private amberOn!: THREE.Material;
	private greenOn!: THREE.Material;
	private redOff!: THREE.Material;
	private amberOff!: THREE.Material;
	private greenOff!: THREE.Material;

	private clock = 0;
	private seg = -1; // -1 forceert de eerste applyLamps in update

	constructor() {
		this.group.name = 'city_roads';
		this.buildLampMaterials();
		this.buildStrips();
		this.buildDashes();
		this.buildZebras();
		this.buildApron();
		this.buildTrafficLights();
	}

	/**
	 * Welke richting nu groen/oranje heeft. 'all-red' is de 2 s waarin
	 * beide richtingen naar een rood bolletje staren.
	 */
	get lightPhase(): LightPhase {
		if (this.seg <= 1) return 'ns';
		if (this.seg === 3 || this.seg === 4) return 'ew';
		return 'all-red';
	}

	update(dt: number, _t: number): void {
		this.clock = (this.clock + dt) % CYCLE;
		let seg = 0;
		while (seg < 5 && this.clock >= at(SEG_ENDS, seg)) seg++;
		if (seg !== this.seg) {
			this.seg = seg;
			this.applyLamps();
		}
	}

	dispose(): void {
		this.zebras.dispose();
		this.dashes.dispose();
		for (const m of this.materials) m.dispose();
		for (const g of this.geometries) g.dispose();
		for (const t of this.textures) t.dispose();
	}

	// ── asfalt ─────────────────────────────────────────────

	/** Donkergrijs asfalt met vlekjes, in ontwerp-eenheden. Beide tegels beginnen hier. */
	private paveAsphalt(ctx: CanvasRenderingContext2D, w: number, h: number): void {
		ctx.fillStyle = ASPHALT;
		ctx.fillRect(0, 0, w, h);
		const speckles = Math.round(w * h * SPECKLE_DENSITY);
		for (let i = 0; i < speckles; i++) {
			const shade = SPECKLE_MIN + Math.floor(Math.random() * SPECKLE_RANGE);
			ctx.fillStyle = `rgb(${shade},${shade + 2},${shade + 4})`;
			ctx.fillRect(Math.random() * w, Math.random() * h, SPECKLE_PX, SPECKLE_PX);
		}
	}

	/**
	 * Asfalt-tegel voor een recht stuk: alleen doorgetrokken kantlijnen. De
	 * middenstreep zit niet meer in de tegel maar staat als losse rechthoekjes uit
	 * `roadDashPatches`, zodat de zebrapaden er als gaten uit gesneden zijn; een
	 * doorlopende texture-dash tekende een ononderbroken plus over de oversteek.
	 */
	private makeAsphaltTexture(len: number): THREE.Texture {
		const { canvas: c, ctx } = labelCanvas(TILE_PX, ROAD_PX);
		this.paveAsphalt(ctx, TILE_PX, ROAD_PX);
		ctx.fillStyle = PAINT_EDGE;
		ctx.fillRect(0, EDGE_INSET_PX, TILE_PX, EDGE_PX);
		ctx.fillRect(0, ROAD_PX - EDGE_INSET_PX - EDGE_PX, TILE_PX, EDGE_PX);
		const tex = labelTexture(c);
		tex.wrapS = THREE.RepeatWrapping;
		tex.repeat.set(Math.max(1, Math.round(len / TILE_LEN)), 1);
		this.textures.push(tex);
		return tex;
	}

	/**
	 * Hoektegel. De rijbaan draait hier een kwartslag, dus de middenstreep loopt
	 * als kwartcirkel van de ene strook naar de andere, de binnenste kantlijn
	 * knikt in de binnenbocht en de buitenste in de buitenbocht.
	 *
	 * Getekend als de (+x,+z)-hoek: canvas linksboven is de binnenbocht, want
	 * kolom 0 is de kleinste x en rij 0 de kleinste z. De andere drie hoeken zijn
	 * dezelfde tegel, gedraaid.
	 */
	private makeCornerTexture(): THREE.Texture {
		const { canvas: c, ctx } = labelCanvas(ROAD_PX, ROAD_PX);
		this.paveAsphalt(ctx, ROAD_PX, ROAD_PX);

		const near = EDGE_INSET_PX;
		const far = ROAD_PX - EDGE_INSET_PX - EDGE_PX;
		ctx.fillStyle = PAINT_EDGE;
		ctx.fillRect(0, near, near + EDGE_PX, EDGE_PX);
		ctx.fillRect(near, 0, EDGE_PX, near + EDGE_PX);
		ctx.fillRect(0, far, far + EDGE_PX, EDGE_PX);
		ctx.fillRect(far, 0, EDGE_PX, far + EDGE_PX);

		// De middenstreep blijft even ver van beide randen: een kwartcirkel om de
		// binnenbocht met de halve wegbreedte als straal.
		const r = HALF_W * M_TO_ROAD_PX;
		const arc = r * (Math.PI / 2);
		const period = TILE_LEN * M_TO_ROAD_PX;
		// De bocht is korter dan een tegel, dus het ritme wordt naar het
		// dichtstbijzijnde hele aantal gerekt in plaats van halverwege afgekapt.
		const tiles = Math.max(1, Math.round(arc / period));
		const scale = arc / (tiles * period);
		const gap = DASH_GAP * M_TO_ROAD_PX * scale;
		ctx.strokeStyle = PAINT_DASH;
		ctx.lineWidth = DASH_PX;
		ctx.setLineDash([DASH_LEN * M_TO_ROAD_PX * scale, gap]);
		// Begint met een half gat, net als het uiteinde van de strook ervoor.
		ctx.lineDashOffset = -half(gap);
		ctx.beginPath();
		ctx.arc(0, 0, r, 0, Math.PI / 2);
		ctx.stroke();
		ctx.setLineDash([]);

		const tex = labelTexture(c);
		this.textures.push(tex);
		return tex;
	}

	private buildStrips(): void {
		// Twee textures uit dezelfde tegel-logica: de stroken verschillen in
		// lengte en repeat is een texture-eigenschap, dus delen gaat niet.
		const ewMat = this.track(lit({ map: this.makeAsphaltTexture(EW_LEN), roughness: 0.95 }));
		const nsMat = this.track(lit({ map: this.makeAsphaltTexture(NS_LEN), roughness: 0.95 }));
		const cornerMat = this.track(lit({ map: this.makeCornerTexture(), roughness: 0.95 }));

		const ewGeo = new THREE.PlaneGeometry(EW_LEN, ROAD_W);
		ewGeo.rotateX(-Math.PI / 2);
		this.geometries.push(ewGeo);
		const nsGeo = new THREE.PlaneGeometry(NS_LEN, ROAD_W);
		nsGeo.rotateX(-Math.PI / 2);
		this.geometries.push(nsGeo);
		const cornerGeo = new THREE.PlaneGeometry(ROAD_W, ROAD_W);
		cornerGeo.rotateX(-Math.PI / 2);
		this.geometries.push(cornerGeo);

		// Oost-west stroken (rijrichting langs x), tussen de hoeken in
		for (const sz of [-1, 1] as const) {
			const strip = new THREE.Mesh(ewGeo, ewMat);
			strip.position.set(0, ROAD_Y, sz * LANE_Z);
			strip.receiveShadow = true;
			this.group.add(strip);
		}
		// Noord-zuid stroken (rijrichting langs z), ook tussen de hoeken in
		for (const sx of [-1, 1] as const) {
			const strip = new THREE.Mesh(nsGeo, nsMat);
			strip.rotation.y = Math.PI / 2;
			strip.position.set(sx * LANE_X, ROAD_Y, 0);
			strip.receiveShadow = true;
			this.group.add(strip);
		}
		// De vier hoeken. De tegel ís de (+,+)-hoek; deze draai zet zijn
		// binnenbocht naar de mall toe, welke hoek het ook wordt.
		for (const sx of [-1, 1] as const) {
			for (const sz of [-1, 1] as const) {
				const tile = new THREE.Mesh(cornerGeo, cornerMat);
				tile.position.set(sx * LANE_X, ROAD_Y, sz * LANE_Z);
				tile.rotation.y = Math.atan2(sx - sz, sx + sz);
				tile.receiveShadow = true;
				this.group.add(tile);
			}
		}
	}

	// ── middenstreep ───────────────────────────────────────

	/**
	 * De losse strepen van de middenstreep uit `roadDashPatches`, één InstancedMesh voor
	 * alle strepen: een eenheidsvlak dat per streep op zijn eigen rechthoek geschaald
	 * wordt. Ze zijn er als aparte rechthoekjes uit gesneden waar een zebrapad de rijbaan
	 * kruist; in de texture liep de streep er nog dwars doorheen.
	 */
	private buildDashes(): void {
		const patches = roadDashPatches();
		const geo = new THREE.PlaneGeometry(1, 1);
		geo.rotateX(-Math.PI / 2);
		this.geometries.push(geo);
		const mat = this.track(lit({ color: PAINT_DASH, roughness: 0.9 }));
		this.dashes = new THREE.InstancedMesh(geo, mat, patches.length);
		const dummy = new THREE.Object3D();
		patches.forEach((patch, index) => {
			dummy.position.set(midpoint(patch.minX, patch.maxX), DASH_Y, midpoint(patch.minZ, patch.maxZ));
			dummy.scale.set(span(patch.minX, patch.maxX), 1, span(patch.minZ, patch.maxZ));
			dummy.updateMatrix();
			this.dashes.setMatrixAt(index, dummy.matrix);
		});
		this.dashes.instanceMatrix.needsUpdate = true;
		this.group.add(this.dashes);
	}

	// ── zebrapaden ─────────────────────────────────────────

	/**
	 * De oversteekplaatsen uit de stadsplattegrond, één InstancedMesh voor alle balken.
	 * Waar ze liggen staat daar en niet hier: de westelijke hoort op de as van de
	 * hoofdingang, en die as is niet van de weg.
	 */
	private buildZebras(): void {
		const { bars, pitch, barWidth, sideInset } = ZEBRA_PLAN;
		const barGeo = new THREE.PlaneGeometry(barWidth, ROAD_W - sideInset * 2);
		barGeo.rotateX(-Math.PI / 2);
		this.geometries.push(barGeo);
		const barMat = this.track(lit({ color: 0xd8d8d8, roughness: 0.9 }));

		this.zebras = new THREE.InstancedMesh(barGeo, barMat, bars * ROAD_CROSSINGS.length);
		const dummy = new THREE.Object3D();
		let idx = 0;
		// Balk-lange-as staat haaks op de rijrichting: bestuurder ziet een ladder.
		for (const crossing of ROAD_CROSSINGS) {
			const langsZ = crossing.rotY === 0;
			for (let i = 0; i < bars; i++) {
				const off = (i - half(bars - 1)) * pitch;
				dummy.position.set(crossing.x + (langsZ ? off : 0), ZEBRA_Y, crossing.z + (langsZ ? 0 : off));
				dummy.rotation.set(0, crossing.rotY, 0);
				dummy.updateMatrix();
				this.zebras.setMatrixAt(idx++, dummy.matrix);
			}
		}
		this.zebras.instanceMatrix.needsUpdate = true;
		this.group.add(this.zebras);
	}

	// ── inrit naar de parkeergarage ────────────────────────

	/**
	 * De inrit tussen de stoeprand en de mond van de uitritgeul. Zonder dit stuk
	 * hield het asfalt bij de stoeprand op en begon de helling twee meter verderop,
	 * met bestrating ertussen: een naad dwars door de enige route naar P1.
	 *
	 * Een doos en geen vlak, want hij ligt op de hoogte van het straateind van de
	 * helling en dus iets boven de rijbaan die hij raakt. Hij loopt een stukje over
	 * het asfalt heen, zodat er geen streepje plein tussen de twee door piept.
	 */
	private buildApron(): void {
		const { canvas: c, ctx } = labelCanvas(ROAD_PX, ROAD_PX);
		this.paveAsphalt(ctx, ROAD_PX, ROAD_PX);
		const tex = labelTexture(c);
		this.textures.push(tex);
		const minX = EXIT_APRON.minX - APRON_OVERLAP;
		const geo = new THREE.BoxGeometry(span(minX, EXIT_APRON.maxX), APRON_THICKNESS, span(EXIT_APRON.minZ, EXIT_APRON.maxZ));
		this.geometries.push(geo);
		const apron = new THREE.Mesh(geo, this.track(lit({ map: tex, roughness: 0.95 })));
		apron.position.set(
			midpoint(minX, EXIT_APRON.maxX),
			EXIT_APRON_TOP_Y - half(APRON_THICKNESS),
			midpoint(EXIT_APRON.minZ, EXIT_APRON.maxZ),
		);
		apron.receiveShadow = true;
		this.group.add(apron);
	}

	// ── stoplichten ────────────────────────────────────────

	private buildLampMaterials(): void {
		// Aan = MeshBasic zonder tone mapping (fel, gratis licht). Uit = dof
		// getint glas, zodat je nog ziet welk bolletje wat zou kunnen.
		this.redOn = this.track(new THREE.MeshBasicMaterial({ color: 0xff2418, toneMapped: false }));
		this.amberOn = this.track(new THREE.MeshBasicMaterial({ color: 0xffb300, toneMapped: false }));
		this.greenOn = this.track(new THREE.MeshBasicMaterial({ color: 0x22e05a, toneMapped: false }));
		this.redOff = this.track(lit({ color: 0x3a1210, roughness: 0.4 }));
		this.amberOff = this.track(lit({ color: 0x3a2c0c, roughness: 0.4 }));
		this.greenOff = this.track(lit({ color: 0x0f2f18, roughness: 0.4 }));
	}

	/**
	 * Vier palen op de binnenhoeken. Elke paal bedient één richting:
	 * de (+,+)- en (−,−)-hoek zijn voor noord-zuid, de andere twee oost-west.
	 * Twee koppen per paal zou realistischer zijn; de gemeente had budget voor één.
	 */
	private buildTrafficLights(): void {
		const poleMat = this.track(lit({ color: 0x37404a, metalness: 0.6, roughness: 0.45 }));
		const housingMat = this.track(lit({ color: 0x14171a, roughness: 0.7 }));
		const poleGeo = new THREE.CylinderGeometry(0.09, 0.11, 4.2, 8);
		this.geometries.push(poleGeo);
		const housingGeo = new THREE.BoxGeometry(0.5, 1.35, 0.3);
		this.geometries.push(housingGeo);
		const bulbGeo = new THREE.SphereGeometry(0.14, 10, 8);
		this.geometries.push(bulbGeo);

		for (const sx of [-1, 1] as const) {
			for (const sz of [-1, 1] as const) {
				const post = new THREE.Group();
				// Binnenhoek van de weg, op de denkbeeldige stoep
				post.position.set(sx * (ROAD_INNER_X - 1.4), 0, sz * (ROAD_INNER_Z - 1.4));

				const pole = new THREE.Mesh(poleGeo, poleMat);
				pole.position.y = 2.1;
				post.add(pole);

				const head = new THREE.Group();
				head.position.y = 4.4;
				// Kop kijkt diagonaal de kruising op — cosmetisch, geen CBR-examen
				head.rotation.y = Math.atan2(sx, sz);
				post.add(head);

				const housing = new THREE.Mesh(housingGeo, housingMat);
				head.add(housing);

				const dir: 'ns' | 'ew' = sx * sz > 0 ? 'ns' : 'ew';
				const bulb = (y: number, off: THREE.Material): THREE.Mesh => {
					const b = new THREE.Mesh(bulbGeo, off);
					b.position.set(0, y, 0.14);
					head.add(b);
					return b;
				};
				this.heads.push({
					dir,
					red: bulb(0.42, this.redOff),
					amber: bulb(0, this.amberOff),
					green: bulb(-0.42, this.greenOff),
				});

				this.group.add(post);
			}
		}
	}

	/** Zet per richting de juiste lampen aan — alleen bij een segmentwissel. */
	private applyLamps(): void {
		const ns: LampState = this.seg === 0 ? 'green' : this.seg === 1 ? 'amber' : 'red';
		const ew: LampState = this.seg === 3 ? 'green' : this.seg === 4 ? 'amber' : 'red';
		for (const h of this.heads) {
			const s = h.dir === 'ns' ? ns : ew;
			h.red.material = s === 'red' ? this.redOn : this.redOff;
			h.amber.material = s === 'amber' ? this.amberOn : this.amberOff;
			h.green.material = s === 'green' ? this.greenOn : this.greenOff;
		}
	}

	private track<T extends THREE.Material>(m: T): T {
		this.materials.push(m);
		return m;
	}
}
