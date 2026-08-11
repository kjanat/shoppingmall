import * as THREE from 'three';
import type { Bounds3 } from '#/data/spatial';
import { geometryBounds } from '#/data/spatial';
import {
	BACKSTAGE_CEILING_Y,
	BACKSTAGE_CORRIDOR,
	BACKSTAGE_FLOOR_Y,
	BACKSTAGE_INTERIOR,
	BACKSTAGE_LANDING,
	backstageLandingTreadY,
	backstageLandingTreadZ,
	mechanismTriggerBounds,
	THEATRE_AISLES,
	THEATRE_ARTIST_PORTAL,
	THEATRE_BACKSTAGE_DOORS_ENTITY,
	THEATRE_BACKSTAGE_ENTITY,
	THEATRE_BACKSTAGE_FIXTURES_ENTITY,
	THEATRE_ENTRANCE_ENTITY,
	THEATRE_FLOOR_Y,
	THEATRE_HALL_ENTITY,
	THEATRE_INTERIOR,
	THEATRE_PLAN,
	THEATRE_PORTAL,
	THEATRE_SHELL_ENTITY,
	THEATRE_STAGE_TOP_Y,
	theatreRowBank,
	theatreRowDeck,
	theatreRowY,
	theatreSeatBanks,
	theatreSeatXs,
	theatreTreadY,
	theatreTreadZ,
} from '#/data/world';
import type { LightHandle, LightPool } from '#/render/LightPool';
import { lit } from '#/render/material';
import { labelCanvas, labelTexture } from '#/util/label';
import { ease, easeFactor, half, lerp, midpoint, span } from '#/util/math';
import { at, jitterWith, mulberry32, pickWith } from '#/util/rand';

/**
 * PRAIRIE THEATRE — monumentaal cultuurpaleis op het NO-blok.
 *
 * Zuilen, brede trap, marquee met 40 chase-lampjes en een rood tapijt tot de
 * stoep. Vanavond: De Baard-Dief. Uitverkocht, uiteraard — de hele stad heeft
 * kaartjes en niemand komt, want niemand woont hier (zie CityBuildings).
 *
 * Het blok was massief en de deuren waren erop geschilderd. Nu staat er een zaal
 * achter: foyer met kassa, vijf aflopende rijen, een toneel met een doek erachter
 * en een handvol bezoekers die al zitten. De maten komen allemaal uit
 * `THEATRE_PLAN`, want de collision, de zonegraaf en de wereldcontrole lezen
 * diezelfde zaal.
 *
 * Buiten geen lampen, alleen emissive/basic. Binnen wél, want een zaal zonder
 * licht is een doos: de gangpadlampjes en de toneelwas zijn virtuele lichten uit
 * de pool en nooit een eigen PointLight.
 */

/** Seconde per chase-stap. Om de tik wisselt ook de kleur — dat heet dramaturgie. */
const CHASE_TICK = 0.32;
const BULB_COUNT = 40;

/** Zaad van de zaal: welke stoelen bezet zijn en hoe de bezoekers erin hangen. */
const HOUSE_SEED = 0x7a1e;

/** Hoeveel bezoekers er zitten. Uitverkocht is een affiche, geen publiek. */
const AUDIENCE_COUNT = 9;

/** Eén gangpadlampje per rij per gangpad, laag bij de vloer zoals het hoort. */
const AISLE_LAMP = { height: 0.35, radius: 0.09, intensity: 2.4, distance: 6, decay: 2 } as const;

/** De toneelwas: één licht boven het toneel dat met de voorstelling meeademt. */
const STAGE_WASH = { height: 5.5, intensity: 26, distance: 26, decay: 2, priority: 2 } as const;

/** Ademhaling van de was, in seconden per hele slag, en hoe diep hij zakt. */
const STAGE_BREATH = { period: 9, depth: 0.22 } as const;

/** Kroonlijst rondom de schil, en de attiek die de toneeltoren suggereert. */
const CORNICE = { reach: 0.75, height: 0.9 } as const;
const ATTIC = { width: 12, depth: 9, height: 2.4 } as const;

/** Wat het kozijn boven de travee voor het glas uitsteekt, en hoe hoog het is. */
const JAMB = { reach: 0.1, head: 0.35 } as const;

/** Hoe ver een plat vlak boven de plaat eronder ligt; twee centimeter flikkert niet. */
const CARPET_LIFT = 0.02;
/** En hoe ver een verticaal vlak voor de wand erachter hangt. */
const SURFACE_LIFT = 0.01;

const COUNTER_TRIM = 0.04;
const COUNTER_SIGN_HEIGHT = 0.5;
const COUNTER_SIGN_Y = 0.75;

/** Affiches in de foyer, naast de travee. */
const POSTER = { width: 1.4, height: 2.1, centerY: 2.4, offset: 1.4 } as const;

/** Jassen van het publiek. Een zaal in het donker is geen catwalk. */
const AUDIENCE_COLORS = [0x2c3550, 0x4a2431, 0x1f3a30, 0x513a1c, 0x33303a] as const;

/** Hoeveel een bezoeker scheef in zijn stoel hangt, en hoe traag hij ademt. */
const SITTER_YAW_SPREAD = 0.3;
const SITTER_BREATH = { min: 0.7, max: 1.3 } as const;

/** Zithouding: hoe diep het lijf op de zitting zakt en hoe ver de knieën uitsteken. */
const SITTER = {
	hipY: 0.44,
	torso: { width: 0.42, depth: 0.26, height: 0.6 },
	head: { radius: 0.115 },
	thigh: { width: 0.15, height: 0.14, length: 0.42 },
	shin: { width: 0.13, length: 0.44 },
	arm: { width: 0.1, length: 0.5 },
	/** Hoe ver de romp per ademhaling naar voren en terug kantelt. */
	lean: 0.035,
} as const;

type Sitter = Readonly<{ body: THREE.Object3D; phase: number; rate: number }>;

const TAU = Math.PI * 2;

/** Hoe snel de bladen op de aanwezigheidszone reageren. De openingstijd van het mechanisme. */
const DOOR_RATE = 1 / THEATRE_PLAN.doors.seconds;

/** Precies de doos die het mechanisme als trigger aanwijst; geen tweede zone ernaast. */
const DOOR_TRIGGER = mechanismTriggerBounds(THEATRE_ENTRANCE_ENTITY, 'theatre-doors');

function inBounds(box: Bounds3, point: THREE.Vector3): boolean {
	return (
		point.x >= box.minX &&
		point.x <= box.maxX &&
		point.y >= box.minY &&
		point.y <= box.maxY &&
		point.z >= box.minZ &&
		point.z <= box.maxZ
	);
}

export class CityTheatre {
	readonly group = new THREE.Group();

	/**
	 * De bezoekers, apart bijgehouden.
	 *
	 * `check-props` loopt de directe kinderen van een groep na tegen elk volume dat
	 * lichamen tegenhoudt, en de tekenaar zet zijn eigen wanden en dekken als kinderen
	 * in dezelfde groep. Alleen het publiek is een cast, dus alleen het publiek hoort
	 * die vraag te krijgen.
	 */
	readonly audience = new THREE.Group();

	/**
	 * De backstage-cast: de aankleedsters aan de kaptafels. Apart bijgehouden om
	 * dezelfde reden als het publiek — `check-props` vraagt of ze in een doos staan
	 * die ze niet bezitten, en de wanden en meubels van de backstage horen die vraag
	 * niet te krijgen.
	 */
	readonly backstage = new THREE.Group();

	/**
	 * De twee plekken waar dit systeem staat: de marquee aan de straat en de zaal
	 * erachter. Ze liggen in verschillende zones, en de LOD-klok leidt daar zijn
	 * tempo uit af in plaats van er één zone bij op te schrijven.
	 */
	readonly marquee = new THREE.Vector3(THEATRE_PORTAL.centerX, THEATRE_FLOOR_Y, THEATRE_PORTAL.outerZ);
	readonly house = new THREE.Vector3(
		midpoint(THEATRE_INTERIOR.minX, THEATRE_INTERIOR.maxX),
		THEATRE_FLOOR_Y,
		midpoint(THEATRE_INTERIOR.minZ, THEATRE_INTERIOR.maxZ),
	);

	private readonly materials: THREE.Material[] = [];
	private readonly geometries: THREE.BufferGeometry[] = [];
	private readonly textures: THREE.Texture[] = [];
	private readonly instanced: THREE.InstancedMesh[] = [];

	/** Eenheidsvormen — alles wat doosvormig of plat is, is hier een schaal van. */
	private readonly unitBox: THREE.BoxGeometry;
	private readonly unitPlane: THREE.PlaneGeometry;
	private readonly dummy = new THREE.Object3D();

	// Chase-administratie: twee lit-kleuren (wisselen om de tik), één dim-kleur.
	private readonly bulbs: THREE.InstancedMesh;
	private readonly litA = new THREE.Color(0xffc94d);
	private readonly litB = new THREE.Color(0xff4632);
	private readonly dim = new THREE.Color(0x201206);
	private lastStep = -1;

	// Het naambord ademt zachtjes mee met de tik. Subtiel. Broadway-subtiel.
	private readonly titleMat: THREE.MeshBasicMaterial;
	private titleLevel = 1;

	/** De twee schuifbladen van de travee, en hoever ze openstaan. */
	private readonly leaves: { mesh: THREE.Mesh; closedX: number; travel: number }[] = [];
	private doorOpen = 0;

	/** De backstage-schuifdeuren, elk aan het eigen mechanisme uit het wereldmodel. */
	private readonly backstageDoors: {
		trigger: Bounds3;
		rate: number;
		travel: THREE.Vector3;
		open: number;
		leaves: { mesh: THREE.Mesh; closed: THREE.Vector3 }[];
	}[] = [];

	private readonly stageWash: LightHandle;
	private readonly sitters: Sitter[] = [];
	private readonly head: THREE.SphereGeometry;

	constructor(pool: LightPool) {
		this.group.name = 'city_theatre';

		this.unitBox = new THREE.BoxGeometry(1, 1, 1);
		this.unitPlane = new THREE.PlaneGeometry(1, 1);
		this.head = new THREE.SphereGeometry(SITTER.head.radius, 8, 6);
		this.geometries.push(this.unitBox, this.unitPlane, this.head);

		this.buildBlok();
		this.buildZuilen();
		this.bulbs = this.buildMarquee();
		this.titleMat = this.buildBorden();
		this.buildTapijt();
		this.buildFoyer();
		this.buildZaal();
		this.buildStoelen();
		this.stageWash = this.buildZaallicht(pool);
		this.buildPubliek();
		this.buildBackstage(pool);
		this.applyChase(0);
	}

	update(dt: number, t: number, viewer: THREE.Vector3): void {
		const step = Math.floor(t / CHASE_TICK);
		if (step !== this.lastStep) {
			this.lastStep = step;
			this.applyChase(step);
		}
		// Naambord dimt licht mee op de offbeat; ease op dt zodat een framedrop
		// op de Pi geen stroboscoop van maakt.
		const target = step % 2 === 0 ? 1 : 0.82;
		this.titleLevel += (target - this.titleLevel) * easeFactor(6, dt);
		this.titleMat.color.setScalar(this.titleLevel);

		// De travee gaat open op dezelfde doos die het mechanisme in het wereldmodel
		// als trigger aanwijst. Een tweede zone hier zou een deur zijn die opengaat op
		// een andere plek dan het model zegt.
		const wanted = inBounds(DOOR_TRIGGER, viewer) ? 1 : 0;
		this.doorOpen = ease(this.doorOpen, wanted, DOOR_RATE, dt);
		for (const leaf of this.leaves) leaf.mesh.position.x = leaf.closedX + leaf.travel * this.doorOpen;

		for (const door of this.backstageDoors) {
			const open = inBounds(door.trigger, viewer) ? 1 : 0;
			door.open = ease(door.open, open, door.rate, dt);
			for (const leaf of door.leaves) leaf.mesh.position.copy(leaf.closed).addScaledVector(door.travel, door.open);
		}

		// De was ademt; de zaal is dan nooit helemaal stil, ook als er niets speelt.
		const breath = half(1 + Math.cos((t / STAGE_BREATH.period) * TAU));
		this.stageWash.intensity = lerp(STAGE_WASH.intensity * (1 - STAGE_BREATH.depth), STAGE_WASH.intensity, breath);
		for (const sitter of this.sitters) {
			sitter.body.rotation.x = SITTER.lean * Math.sin(t * sitter.rate + sitter.phase);
		}
	}

	dispose(): void {
		for (const m of this.instanced) m.dispose();
		for (const m of this.materials) m.dispose();
		for (const g of this.geometries) g.dispose();
		for (const tx of this.textures) tx.dispose();
		this.group.clear();
	}

	/** Lopend patroon: elke derde bol aan, kleur wisselt per tik. Geen allocatie. */
	private applyChase(step: number): void {
		const lit = step % 2 === 0 ? this.litA : this.litB;
		for (let i = 0; i < BULB_COUNT; i++) {
			this.bulbs.setColorAt(i, (i + step) % 3 === 0 ? lit : this.dim);
		}
		if (this.bulbs.instanceColor) this.bulbs.instanceColor.needsUpdate = true;
	}

	private box(mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number): THREE.Mesh {
		const m = new THREE.Mesh(this.unitBox, mat);
		m.scale.set(w, h, d);
		m.position.set(x, y, z);
		this.group.add(m);
		return m;
	}

	/** Dezelfde doos, maar opgegeven zoals het wereldmodel hem opschrijft. */
	private boxOf(mat: THREE.Material, b: Bounds3): THREE.Mesh {
		return this.box(
			mat,
			span(b.minX, b.maxX),
			span(b.minY, b.maxY),
			span(b.minZ, b.maxZ),
			midpoint(b.minX, b.maxX),
			midpoint(b.minY, b.maxY),
			midpoint(b.minZ, b.maxZ),
		);
	}

	private makeTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
		const { canvas: c, ctx } = labelCanvas(w, h);
		draw(ctx);
		const tex = labelTexture(c);
		tex.anisotropy = 4;
		this.textures.push(tex);
		return tex;
	}

	/** Hoofdmassa: kalksteen blok + kroonlijst + attiek + podium + brede trap. */
	private buildBlok(): void {
		const steen = lit({ color: 0xcfc5ad, roughness: 0.9, metalness: 0.02 });
		const donker = lit({ color: 0x3c3833, roughness: 0.95 });
		const deur = lit({ color: 0x2a211b, roughness: 0.7, metalness: 0.15 });
		this.materials.push(steen, donker, deur);

		// De schil en het dak komen uit het wereldmodel: de wand die je ziet is de wand
		// waar je tegenaan loopt, en het gat in de zuidgevel is het gat waar de
		// zonegraaf zijn portaal in vindt.
		const zaal = THEATRE_PLAN.hall;
		const zaalH = THEATRE_PLAN.hallHeight;
		for (const volume of THEATRE_SHELL_ENTITY.volumes) {
			this.boxOf(steen, geometryBounds(volume.geometry)).receiveShadow = true;
		}
		// Kroonlijst rondom, en een attiek over de toneeltoren.
		this.boxOf(steen, {
			minX: zaal.minX - CORNICE.reach,
			maxX: zaal.maxX + CORNICE.reach,
			minZ: zaal.minZ - CORNICE.reach,
			maxZ: zaal.maxZ + CORNICE.reach,
			minY: zaalH,
			maxY: zaalH + CORNICE.height,
		});
		this.boxOf(steen, {
			minX: midpoint(zaal.minX, zaal.maxX) - half(ATTIC.width),
			maxX: midpoint(zaal.minX, zaal.maxX) + half(ATTIC.width),
			minZ: THEATRE_INTERIOR.minZ,
			maxZ: THEATRE_INTERIOR.minZ + ATTIC.depth,
			minY: zaalH + CORNICE.height,
			maxY: zaalH + CORNICE.height + ATTIC.height,
		});

		// Podium (het buiten-soort) met brede trap naar de stoep.
		const dek = THEATRE_PLAN.podium;
		const dekY = THEATRE_PLAN.podiumY;
		const podium = this.box(
			donker,
			span(dek.minX, dek.maxX),
			dekY,
			span(dek.minZ, dek.maxZ),
			midpoint(dek.minX, dek.maxX),
			half(dekY),
			midpoint(dek.minZ, dek.maxZ),
		);
		podium.receiveShadow = true;
		const trap = THEATRE_PLAN.stair;
		for (let i = 0; i < trap.treads; i++) {
			const top = theatreTreadY(i);
			const { minZ, maxZ } = theatreTreadZ(i);
			const tree = this.box(
				donker,
				span(trap.minX, trap.maxX),
				top,
				span(minZ, maxZ),
				midpoint(trap.minX, trap.maxX),
				half(top),
				midpoint(minZ, maxZ),
			);
			tree.receiveShadow = true;
		}

		this.buildTravee(deur);
	}

	/**
	 * De travee: twee vaste zijlichten en een schuifpaar ertussen.
	 *
	 * Er stonden drie dubbele deuren op de gevel geschilderd, en daarachter zat het
	 * massieve blok. Dit is dezelfde vorm als de hoofdingang van de mall, en om
	 * dezelfde reden: het glas is wat stad en zaal op elkaar laat uitkijken terwijl
	 * de bladen dicht staan.
	 */
	private buildTravee(kozijn: THREE.Material): void {
		const glas = lit({ color: 0x1b2a2e, roughness: 0.15, metalness: 0.6, transparent: true, opacity: 0.42 });
		this.materials.push(glas);
		const { doors } = THEATRE_PLAN;
		const glasZ = THEATRE_PORTAL.glassZ;
		const paneel = (minX: number, maxX: number, top: number): THREE.Mesh =>
			this.boxOf(glas, {
				minX,
				maxX,
				minZ: glasZ - half(doors.thickness),
				maxZ: glasZ + half(doors.thickness),
				minY: THEATRE_FLOOR_Y,
				maxY: THEATRE_FLOOR_Y + top,
			});
		paneel(THEATRE_PORTAL.minX, THEATRE_PORTAL.doorMinX, doors.headY);
		paneel(THEATRE_PORTAL.doorMaxX, THEATRE_PORTAL.maxX, doors.headY);
		// Kozijn onder de latei, zodat de travee een rand heeft en niet in de steen zweeft.
		this.boxOf(kozijn, {
			minX: THEATRE_PORTAL.minX,
			maxX: THEATRE_PORTAL.maxX,
			minZ: glasZ - half(doors.thickness) - JAMB.reach,
			maxZ: glasZ + half(doors.thickness) + JAMB.reach,
			minY: THEATRE_FLOOR_Y + doors.headY,
			maxY: THEATRE_FLOOR_Y + doors.headY + JAMB.head,
		});
		for (const sign of [-1, 1] as const) {
			const closedX =
				sign < 0
					? midpoint(THEATRE_PORTAL.doorMinX, THEATRE_PORTAL.centerX)
					: midpoint(THEATRE_PORTAL.centerX, THEATRE_PORTAL.doorMaxX);
			const mesh = paneel(
				sign < 0 ? THEATRE_PORTAL.doorMinX : THEATRE_PORTAL.centerX,
				sign < 0 ? THEATRE_PORTAL.centerX : THEATRE_PORTAL.doorMaxX,
				doors.leafHeight,
			);
			this.leaves.push({ mesh, closedX, travel: sign * THEATRE_PORTAL.doorTravel });
		}
	}

	/** Acht zuilen + basementen + kapitelen (instanced) en het hoofdgestel. */
	private buildZuilen(): void {
		const steen = lit({ color: 0xd8cfba, roughness: 0.85, metalness: 0.02 });
		this.materials.push(steen);

		const rij = THEATRE_PLAN.columns;
		const zuilGeo = new THREE.CylinderGeometry(0.55, rij.radius, span(rij.bottomY, rij.topY), 10);
		this.geometries.push(zuilGeo);
		const zuilen = new THREE.InstancedMesh(zuilGeo, steen, rij.count);
		zuilen.name = 'theatre_zuilen';
		const blokjes = new THREE.InstancedMesh(this.unitBox, steen, rij.count * 2);
		blokjes.name = 'theatre_kapitelen';

		for (let i = 0; i < rij.count; i++) {
			const x = rij.x0 + i * rij.pitch;
			this.dummy.rotation.set(0, 0, 0);
			this.dummy.position.set(x, midpoint(rij.bottomY, rij.topY), rij.z);
			this.dummy.scale.set(1, 1, 1);
			this.dummy.updateMatrix();
			zuilen.setMatrixAt(i, this.dummy.matrix);
			// Basement op het podium, kapiteel onder het hoofdgestel.
			this.dummy.position.set(x, 1.72, rij.z);
			this.dummy.scale.set(1.5, 0.45, 1.5);
			this.dummy.updateMatrix();
			blokjes.setMatrixAt(i * 2, this.dummy.matrix);
			this.dummy.position.set(x, 9.8, rij.z);
			this.dummy.scale.set(1.5, 0.4, 1.5);
			this.dummy.updateMatrix();
			blokjes.setMatrixAt(i * 2 + 1, this.dummy.matrix);
		}
		zuilen.computeBoundingSphere();
		blokjes.computeBoundingSphere();
		this.instanced.push(zuilen, blokjes);
		this.group.add(zuilen, blokjes);

		this.box(steen, 24.5, 1.2, 2.0, 72, 10.6, -50.6); // architraaf
		this.box(steen, 26, 0.6, 4.2, 72, 11.5, -50.4); // porticodak
	}

	/** Marquee-luifel boven de trap: slab, gloed-onderkant, ophangstangen en 40 bollen. */
	private buildMarquee(): THREE.InstancedMesh {
		const bordeaux = lit({ color: 0x531523, roughness: 0.6, metalness: 0.2 });
		const gloed = new THREE.MeshBasicMaterial({ color: 0xffdf9e, toneMapped: false });
		const staal = lit({ color: 0x6b7078, roughness: 0.4, metalness: 0.7 });
		this.materials.push(bordeaux, gloed, staal);

		// Slab: x 63..81, y 6.2..7.8, z -49.1..-44.5 — hangt boven trap én tapijt.
		this.box(bordeaux, 18, 1.6, 4.6, 72, 7.0, -46.8);

		// Onderkant "verlicht" met één basic-vlak: alle bollen samen, nul lampen.
		const onder = new THREE.Mesh(this.unitPlane, gloed);
		onder.scale.set(17.2, 4.2, 1);
		onder.rotation.x = Math.PI / 2;
		onder.position.set(72, 6.18, -46.8);
		this.group.add(onder);

		// Twee ophangstangen naar de gevel — de suggestie van constructie.
		const stangGeo = new THREE.CylinderGeometry(0.07, 0.07, 3.9, 6);
		this.geometries.push(stangGeo);
		for (const sx of [64.5, 79.5]) {
			const stang = new THREE.Mesh(stangGeo, staal);
			stang.position.set(sx, 9.1, -50.55);
			stang.rotation.x = Math.atan2(-2.9, 2.6);
			this.group.add(stang);
		}

		// 40 bollen langs de vrije rand (links + front + rechts), bovenop de slab.
		const bolGeo = new THREE.SphereGeometry(0.15, 8, 6);
		this.geometries.push(bolGeo);
		const bolMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
		this.materials.push(bolMat);
		const bulbs = new THREE.InstancedMesh(bolGeo, bolMat, BULB_COUNT);
		bulbs.name = 'theatre_chase';
		const spacing = (4.6 + 18 + 4.6) / BULB_COUNT;
		this.dummy.rotation.set(0, 0, 0);
		this.dummy.scale.set(1, 1, 1);
		for (let i = 0; i < BULB_COUNT; i++) {
			const d = (i + 0.5) * spacing;
			if (d < 4.6) {
				this.dummy.position.set(62.85, 7.75, -49.1 + d);
			} else if (d < 22.6) {
				this.dummy.position.set(63 + (d - 4.6), 7.75, -44.35);
			} else {
				this.dummy.position.set(81.15, 7.75, -44.5 - (d - 22.6));
			}
			this.dummy.updateMatrix();
			bulbs.setMatrixAt(i, this.dummy.matrix);
		}
		bulbs.computeBoundingSphere();
		this.instanced.push(bulbs);
		this.group.add(bulbs);
		return bulbs;
	}

	/** Canvas-borden: naambord op de marquee, letterbak vooraan, twee posters. */
	private buildBorden(): THREE.MeshBasicMaterial {
		const bordeaux = lit({ color: 0x531523, roughness: 0.6, metalness: 0.2 });
		const goudLijst = lit({ color: 0x8a6d2f, roughness: 0.45, metalness: 0.7 });
		this.materials.push(bordeaux, goudLijst);

		// Groot naambord bovenop de marquee — vanaf de straat én de drone leesbaar.
		this.box(bordeaux, 15, 3.0, 0.35, 72, 9.3, -46.2);
		const titelTex = this.makeTexture(1024, 192, (ctx) => {
			ctx.fillStyle = '#141233';
			ctx.fillRect(0, 0, 1024, 192);
			ctx.strokeStyle = '#f5c518';
			ctx.lineWidth = 5;
			ctx.strokeRect(10, 10, 1004, 172);
			ctx.lineWidth = 2;
			ctx.strokeRect(24, 24, 976, 144);
			ctx.fillStyle = '#f5c518';
			ctx.textAlign = 'center';
			ctx.font = 'bold 92px system-ui,sans-serif';
			ctx.fillText('PRAIRIE THEATRE', 512, 128);
			ctx.font = '48px system-ui,sans-serif';
			ctx.fillText('✶', 62, 116);
			ctx.fillText('✶', 962, 116);
		});
		const titleMat = new THREE.MeshBasicMaterial({ map: titelTex, toneMapped: false });
		this.materials.push(titleMat);
		const titel = new THREE.Mesh(this.unitPlane, titleMat);
		titel.scale.set(14.4, 2.6, 1);
		titel.position.set(72, 9.3, -46.0);
		this.group.add(titel);

		// Letterbak op de marquee-voorkant. De losse letters zijn zoek; canvas dan maar.
		const bakTex = this.makeTexture(1408, 128, (ctx) => {
			ctx.fillStyle = '#f2ecdc';
			ctx.fillRect(0, 0, 1408, 128);
			ctx.fillStyle = '#1a1a1a';
			ctx.fillRect(0, 0, 1408, 6);
			ctx.fillRect(0, 122, 1408, 6);
			ctx.textAlign = 'center';
			ctx.font = 'bold 54px system-ui,sans-serif';
			ctx.fillText('VANAVOND: DE BAARD-DIEF', 704, 58);
			ctx.fillStyle = '#b3122e';
			ctx.font = 'bold 42px system-ui,sans-serif';
			ctx.fillText('— UITVERKOCHT —', 704, 110);
		});
		const bakMat = new THREE.MeshBasicMaterial({ map: bakTex, toneMapped: false });
		this.materials.push(bakMat);
		const bak = new THREE.Mesh(this.unitPlane, bakMat);
		bak.scale.set(15.4, 1.4, 1);
		bak.position.set(72, 7.0, -44.44);
		this.group.add(bak);

		// Twee filmposters in gouden lijsten, tussen de buitenste zuilen.
		const posterA = this.makeTexture(256, 384, (ctx) => {
			const bg = ctx.createLinearGradient(0, 0, 0, 384);
			bg.addColorStop(0, '#101c22');
			bg.addColorStop(1, '#1d3a45');
			ctx.fillStyle = bg;
			ctx.fillRect(0, 0, 256, 384);
			// De roltrap zelf: treden, gestaag omlaag, net als de recensies.
			ctx.fillStyle = '#9fb2bd';
			for (let i = 0; i < 7; i++) {
				ctx.fillRect(28 + i * 26, 150 + i * 22, 26, 8);
			}
			ctx.fillStyle = '#e8eef2';
			ctx.textAlign = 'center';
			ctx.font = 'bold 44px system-ui,sans-serif';
			ctx.fillText('ROLTRAP II', 128, 64);
			ctx.font = 'bold 26px system-ui,sans-serif';
			ctx.fillText('DE AFDALING', 128, 100);
			ctx.font = 'italic 20px system-ui,sans-serif';
			ctx.fillText('"Nu nóg langzamer."', 128, 336);
			ctx.fillStyle = '#f5c518';
			ctx.font = '16px system-ui,sans-serif';
			ctx.fillText('BINNENKORT', 128, 366);
		});
		const posterB = this.makeTexture(256, 384, (ctx) => {
			ctx.fillStyle = '#23262b';
			ctx.fillRect(0, 0, 256, 384);
			// Lege parkeervakken. Allemaal. Dat is de clou.
			ctx.strokeStyle = '#cfd4da';
			ctx.lineWidth = 3;
			for (let i = 0; i < 5; i++) {
				ctx.strokeRect(24 + i * 44, 170, 36, 90);
			}
			ctx.fillStyle = '#e8eef2';
			ctx.textAlign = 'center';
			ctx.font = 'bold 30px system-ui,sans-serif';
			ctx.fillText('DE PARKEERPLAATS', 128, 70);
			ctx.font = 'italic 19px system-ui,sans-serif';
			ctx.fillText('"Drie uur. Geen plek."', 128, 320);
			ctx.fillStyle = '#f5c518';
			ctx.font = '18px system-ui,sans-serif';
			ctx.fillText('★★☆☆☆ — Prairie Bode', 128, 354);
		});
		const posters: [THREE.CanvasTexture, number][] = [
			[posterA, 63],
			[posterB, 81],
		];
		for (const [tex, x] of posters) {
			this.box(goudLijst, 2.0, 2.8, 0.12, x, 4.0, -51.94);
			const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
			this.materials.push(mat);
			const vlak = new THREE.Mesh(this.unitPlane, mat);
			vlak.scale.set(1.7, 2.55, 1);
			vlak.position.set(x, 4.0, -51.86);
			this.group.add(vlak);
		}

		return titleMat;
	}

	/** Rood tapijt: van de deuren, het podium af, de trap af, tot de stoep. */
	private buildTapijt(): void {
		const rood = lit({ color: 0x9c0f2e, roughness: 1.0 });
		const goud = lit({ color: 0xc9a227, roughness: 0.3, metalness: 0.85 });
		const koord = lit({ color: 0x7a1230, roughness: 0.8 });
		this.materials.push(rood, goud, koord);

		const loper = (w: number, d: number, x: number, y: number, z: number, plat: boolean) => {
			const m = new THREE.Mesh(this.unitPlane, rood);
			m.scale.set(w, d, 1);
			if (plat) m.rotation.x = -Math.PI / 2;
			m.position.set(x, y, z);
			m.receiveShadow = plat;
			this.group.add(m);
		};
		// Podiumdeel + stootborden + treden + stoepdeel. Elf vlakken, één materiaal.
		loper(3.2, 4.9, 72, 1.512, -49.45, true);
		loper(3.2, 0.3, 72, 1.35, -46.995, false);
		for (let i = 0; i < 4; i++) {
			const top = 1.2 - 0.3 * i;
			loper(3.2, 0.62, 72, top + 0.012, -46.7 + 0.6 * i, true);
			loper(3.2, 0.3, 72, top - 0.15, -46.395 + 0.6 * i, false);
		}
		loper(3.2, 0.5, 72, 0.02, -44.35, true);

		// Vier gouden paaltjes met koord — de rij is denkbeeldig, het koord niet.
		const paalGeo = new THREE.CylinderGeometry(0.06, 0.07, 0.85, 8);
		const knopGeo = new THREE.SphereGeometry(0.1, 8, 6);
		const koordGeo = new THREE.CylinderGeometry(0.035, 0.035, 1.9, 6);
		this.geometries.push(paalGeo, knopGeo, koordGeo);
		for (const px of [69.9, 74.1]) {
			for (const pz of [-48.3, -50.2]) {
				const paal = new THREE.Mesh(paalGeo, goud);
				paal.position.set(px, 1.925, pz);
				const knop = new THREE.Mesh(knopGeo, goud);
				knop.position.set(px, 2.4, pz);
				this.group.add(paal, knop);
			}
			const lijn = new THREE.Mesh(koordGeo, koord);
			lijn.rotation.x = Math.PI / 2;
			lijn.position.set(px, 2.28, -49.25);
			this.group.add(lijn);
		}
	}

	/** Foyer: vloerkleed, de wand naar de zaal met zijn twee doorgangen, kassa en affiches. */
	private buildFoyer(): void {
		const pleister = lit({ color: 0x6d3a3f, roughness: 0.95 });
		const tapijt = lit({ color: 0x5c1226, roughness: 1 });
		const mahonie = lit({ color: 0x3b2118, roughness: 0.5, metalness: 0.1 });
		const messing = lit({ color: 0xc9a227, roughness: 0.3, metalness: 0.85 });
		this.materials.push(pleister, tapijt, mahonie, messing);

		for (const volume of THEATRE_HALL_ENTITY.volumes) {
			if (!volume.id.startsWith('foyer-')) continue;
			if (volume.role === 'walkable') continue;
			this.boxOf(pleister, geometryBounds(volume.geometry)).receiveShadow = true;
		}

		const vloer = new THREE.Mesh(this.unitPlane, tapijt);
		vloer.scale.set(span(THEATRE_INTERIOR.minX, THEATRE_INTERIOR.maxX), THEATRE_PLAN.foyer.depth, 1);
		vloer.rotation.x = -Math.PI / 2;
		vloer.position.set(
			midpoint(THEATRE_INTERIOR.minX, THEATRE_INTERIOR.maxX),
			THEATRE_FLOOR_Y + CARPET_LIFT,
			THEATRE_INTERIOR.maxZ - half(THEATRE_PLAN.foyer.depth),
		);
		vloer.receiveShadow = true;
		this.group.add(vloer);

		// De kassa, op de plek die het wereldmodel ervoor vrijhoudt.
		const { kassa } = THEATRE_PLAN.foyer;
		const balieMinX = THEATRE_INTERIOR.minX + kassa.inset;
		const balieMinZ = THEATRE_INTERIOR.maxZ - THEATRE_PLAN.foyer.depth + kassa.inset;
		const balie = {
			minX: balieMinX,
			maxX: balieMinX + kassa.width,
			minZ: balieMinZ,
			maxZ: balieMinZ + kassa.depth,
			minY: THEATRE_FLOOR_Y,
			maxY: THEATRE_FLOOR_Y + kassa.height,
		};
		this.boxOf(mahonie, balie).castShadow = true;
		this.boxOf(messing, { ...balie, minY: balie.maxY, maxY: balie.maxY + COUNTER_TRIM });

		const kassaTex = this.makeTexture(512, 128, (ctx) => {
			ctx.fillStyle = '#140b12';
			ctx.fillRect(0, 0, 512, 128);
			ctx.fillStyle = '#f5c518';
			ctx.textAlign = 'center';
			ctx.font = 'bold 62px system-ui,sans-serif';
			ctx.fillText('KASSA', 256, 62);
			ctx.font = '30px system-ui,sans-serif';
			ctx.fillText('UITVERKOCHT — TOCH LEEG', 256, 104);
		});
		const bord = new THREE.Mesh(this.unitPlane, this.basic(kassaTex));
		bord.scale.set(kassa.width, COUNTER_SIGN_HEIGHT, 1);
		bord.position.set(midpoint(balie.minX, balie.maxX), THEATRE_FLOOR_Y + COUNTER_SIGN_Y, balie.maxZ + SURFACE_LIFT);
		this.group.add(bord);

		// Affiches op de foyerwand, aan weerszijden van de travee.
		for (const [index, x] of [THEATRE_PORTAL.minX - POSTER.offset, THEATRE_PORTAL.maxX + POSTER.offset].entries()) {
			const tex = this.makeTexture(256, 384, (ctx) => {
				ctx.fillStyle = index === 0 ? '#1d1030' : '#101f18';
				ctx.fillRect(0, 0, 256, 384);
				ctx.strokeStyle = '#f5c518';
				ctx.lineWidth = 4;
				ctx.strokeRect(10, 10, 236, 364);
				ctx.fillStyle = '#f2ecdc';
				ctx.textAlign = 'center';
				ctx.font = 'bold 34px system-ui,sans-serif';
				ctx.fillText(index === 0 ? 'DE BAARD-DIEF' : 'MATINEE', 128, 70);
				ctx.font = 'italic 19px system-ui,sans-serif';
				ctx.fillText(index === 0 ? '"Hij neemt alles mee."' : '"Elke woensdag, niemand."', 128, 330);
			});
			const vlak = new THREE.Mesh(this.unitPlane, this.basic(tex));
			vlak.scale.set(POSTER.width, POSTER.height, 1);
			vlak.rotation.y = Math.PI;
			vlak.position.set(x, THEATRE_FLOOR_Y + POSTER.centerY, THEATRE_INTERIOR.maxZ - SURFACE_LIFT);
			this.group.add(vlak);
		}
	}

	/** Zaal: de aflopende dekken, het toneel en het doek erachter. */
	private buildZaal(): void {
		const dekMat = lit({ color: 0x2a1f24, roughness: 0.95 });
		const loper = lit({ color: 0x7a1230, roughness: 1 });
		const planken = lit({ color: 0x53381f, roughness: 0.7 });
		const plafond = lit({ color: 0x241a1f, roughness: 1 });
		this.materials.push(dekMat, loper, planken, plafond);

		for (const volume of THEATRE_HALL_ENTITY.volumes) {
			if (volume.role !== 'walkable' || !volume.id.startsWith('house-deck-')) continue;
			this.boxOf(dekMat, geometryBounds(volume.geometry)).receiveShadow = true;
		}
		// De gangpaden krijgen hun eigen loper, precies op de stroken die het model
		// vrijhoudt: wie het gangpad verzet, verzet de loper mee.
		for (const aisle of THEATRE_AISLES) {
			for (let row = 0; row < THEATRE_PLAN.seating.rows; row++) {
				const deck = theatreRowDeck(row);
				const strip = new THREE.Mesh(this.unitPlane, loper);
				strip.scale.set(span(aisle.minX, aisle.maxX), span(deck.minZ, deck.maxZ), 1);
				strip.rotation.x = -Math.PI / 2;
				strip.position.set(midpoint(aisle.minX, aisle.maxX), theatreRowY(row) + CARPET_LIFT, midpoint(deck.minZ, deck.maxZ));
				this.group.add(strip);
			}
		}

		for (const volume of THEATRE_HALL_ENTITY.volumes) {
			if (volume.id === 'stage') this.boxOf(planken, geometryBounds(volume.geometry)).receiveShadow = true;
			if (volume.id === 'stage-set') this.buildDoek(geometryBounds(volume.geometry));
		}

		// Plafond, zodat je vanuit de zaal niet tegen de onderkant van de dakplaat kijkt.
		const onder = new THREE.Mesh(this.unitPlane, plafond);
		onder.scale.set(span(THEATRE_INTERIOR.minX, THEATRE_INTERIOR.maxX), span(THEATRE_INTERIOR.minZ, THEATRE_INTERIOR.maxZ), 1);
		onder.rotation.x = Math.PI / 2;
		onder.position.set(
			midpoint(THEATRE_INTERIOR.minX, THEATRE_INTERIOR.maxX),
			THEATRE_PLAN.hallHeight - THEATRE_PLAN.roofThickness - SURFACE_LIFT,
			midpoint(THEATRE_INTERIOR.minZ, THEATRE_INTERIOR.maxZ),
		);
		this.group.add(onder);
	}

	/** Het doek: geschilderde prairie, met de mall er als silhouet in. */
	private buildDoek(box: Bounds3): void {
		const frame = lit({ color: 0x1a1216, roughness: 0.9 });
		this.materials.push(frame);
		this.boxOf(frame, box);
		const tex = this.makeTexture(1024, 384, (ctx) => {
			const lucht = ctx.createLinearGradient(0, 0, 0, 384);
			lucht.addColorStop(0, '#2a1c46');
			lucht.addColorStop(1, '#c2603a');
			ctx.fillStyle = lucht;
			ctx.fillRect(0, 0, 1024, 384);
			ctx.fillStyle = '#1b1220';
			ctx.fillRect(0, 300, 1024, 84);
			// De mall aan de horizon, want dat is het enige gebouw dat iemand hier kent.
			ctx.fillRect(360, 232, 300, 70);
			ctx.fillRect(430, 206, 160, 28);
			ctx.fillStyle = '#f5c518';
			for (let i = 0; i < 9; i++) ctx.fillRect(380 + i * 32, 256, 14, 20);
			ctx.textAlign = 'center';
			ctx.font = 'bold 30px system-ui,sans-serif';
			ctx.fillText('DE BAARD-DIEF', 512, 122);
		});
		const doek = new THREE.Mesh(this.unitPlane, this.basic(tex));
		doek.scale.set(span(box.minX, box.maxX), span(box.minY, box.maxY), 1);
		doek.position.set(midpoint(box.minX, box.maxX), midpoint(box.minY, box.maxY), box.maxZ + SURFACE_LIFT);
		this.group.add(doek);
	}

	/**
	 * De stoelen, stoel voor stoel op de harten die het wereldmodel uitrekent.
	 *
	 * Twee InstancedMeshes voor de hele zaal: zitting en rug. De vakken komen uit
	 * `theatreSeatBanks`, en die zijn door de gangpaden uit de rij gesneden, dus er
	 * kan er geen één in een gangpad belanden zonder dat het model dat zegt.
	 */
	private buildStoelen(): void {
		const bekleding = lit({ color: 0x7d1230, roughness: 0.95 });
		this.materials.push(bekleding);
		const banks = theatreSeatBanks();
		const seats = banks.flatMap((bank) => theatreSeatXs(bank).map((x) => ({ x, row: bank.row })));
		const zit = new THREE.InstancedMesh(this.unitBox, bekleding, seats.length);
		zit.name = 'theatre_zittingen';
		const rug = new THREE.InstancedMesh(this.unitBox, bekleding, seats.length);
		rug.name = 'theatre_ruggen';
		const { seat, seating } = THEATRE_PLAN;
		seats.forEach((place, index) => {
			const floor = theatreRowY(place.row);
			const strook = theatreRowBank(place.row);
			const middenZ = midpoint(strook.minZ, strook.maxZ);
			this.dummy.rotation.set(0, 0, 0);
			this.dummy.position.set(place.x, floor + seat.seatY, middenZ);
			this.dummy.scale.set(seat.width, seat.thickness, seating.bankDepth - seat.thickness);
			this.dummy.updateMatrix();
			zit.setMatrixAt(index, this.dummy.matrix);
			this.dummy.position.set(place.x, floor + midpoint(seat.seatY, seat.backHeight), strook.maxZ - half(seat.thickness));
			this.dummy.scale.set(seat.width, span(seat.seatY, seat.backHeight), seat.thickness);
			this.dummy.updateMatrix();
			rug.setMatrixAt(index, this.dummy.matrix);
		});
		zit.computeBoundingSphere();
		rug.computeBoundingSphere();
		this.instanced.push(zit, rug);
		this.group.add(zit, rug);
	}

	/**
	 * Zaallicht: één lampje per gangpad per rij, en één was boven het toneel.
	 *
	 * Allemaal virtuele lichten uit de pool. Een eigen PointLight hier zou
	 * `NUM_POINT_LIGHTS` verzetten en elk materiaal in het gebouw opnieuw laten
	 * linken; `check:lights` greept er dan ook op.
	 */
	private buildZaallicht(pool: LightPool): LightHandle {
		const gloed = new THREE.MeshBasicMaterial({ color: 0xffcf8a, toneMapped: false });
		this.materials.push(gloed);
		const bolGeo = new THREE.SphereGeometry(AISLE_LAMP.radius, 8, 6);
		this.geometries.push(bolGeo);
		for (const aisle of THEATRE_AISLES) {
			for (let row = 0; row < THEATRE_PLAN.seating.rows; row++) {
				const deck = theatreRowDeck(row);
				const y = theatreRowY(row) + AISLE_LAMP.height;
				for (const x of [aisle.minX, aisle.maxX]) {
					const bol = new THREE.Mesh(bolGeo, gloed);
					bol.position.set(x, y, midpoint(deck.minZ, deck.maxZ));
					this.group.add(bol);
					pool.register({
						position: bol.position.clone(),
						color: 0xffb765,
						intensity: AISLE_LAMP.intensity,
						distance: AISLE_LAMP.distance,
						decay: AISLE_LAMP.decay,
					});
				}
			}
		}
		return pool.register({
			position: new THREE.Vector3(
				midpoint(THEATRE_INTERIOR.minX, THEATRE_INTERIOR.maxX),
				THEATRE_STAGE_TOP_Y + STAGE_WASH.height,
				midpoint(THEATRE_INTERIOR.minZ, THEATRE_INTERIOR.minZ + THEATRE_PLAN.stage.depth),
			),
			color: 0xfff0cf,
			intensity: STAGE_WASH.intensity,
			distance: STAGE_WASH.distance,
			decay: STAGE_WASH.decay,
			priority: STAGE_WASH.priority,
		});
	}

	/**
	 * Het publiek: negen bezoekers die al zitten.
	 *
	 * Ze staan op stoelen die het wereldmodel uitdeelt, dus ze zitten per definitie
	 * niet in een gangpad. Bewegen doen ze alleen met hun romp: wie in het donker
	 * naar een toneel kijkt loopt nergens heen.
	 */
	private buildPubliek(): void {
		this.audience.name = 'theatre_publiek';
		this.group.add(this.audience);
		const rand = mulberry32(HOUSE_SEED);
		const huid = lit({ color: 0xc99a76, roughness: 0.85 });
		this.materials.push(huid);
		const jassen = AUDIENCE_COLORS.map((color) => {
			const mat = lit({ color, roughness: 0.9 });
			this.materials.push(mat);
			return mat;
		});
		const plekken = theatreSeatBanks().flatMap((bank) => theatreSeatXs(bank).map((x) => ({ x, row: bank.row })));
		const gekozen = new Set<number>();
		for (let n = 0; n < AUDIENCE_COUNT && gekozen.size < plekken.length; n++) {
			let index = Math.floor(rand() * plekken.length);
			while (gekozen.has(index)) index = (index + 1) % plekken.length;
			gekozen.add(index);
			const plek = at(plekken, index);
			const strook = theatreRowBank(plek.row);
			this.audience.add(
				this.buildBezoeker(plek.x, theatreRowY(plek.row), midpoint(strook.minZ, strook.maxZ), pickWith(jassen, rand), huid, rand),
			);
		}
	}

	/**
	 * Eén zittend lijf, uit dozen: dijen vooruit, schenen omlaag, romp rechtop en
	 * een bol erbovenop. De maten hangen aan de zitting, dus wie de stoel verzet
	 * verplaatst het lijf mee in plaats van het erdoorheen te laten zakken.
	 */
	private buildBezoeker(
		x: number,
		floor: number,
		z: number,
		jas: THREE.Material,
		huid: THREE.Material,
		rand: () => number,
	): THREE.Group {
		const root = new THREE.Group();
		root.position.set(x, floor, z);
		root.rotation.y = jitterWith(SITTER_YAW_SPREAD, rand);
		// Het heupscharnier: hieronder zit het onderstel dat stil blijft, erboven de
		// romp die ademt.
		const hips = new THREE.Group();
		hips.position.y = SITTER.hipY;
		root.add(hips);
		const body = new THREE.Group();
		hips.add(body);

		const doos = (
			mat: THREE.Material,
			w: number,
			h: number,
			d: number,
			px: number,
			py: number,
			pz: number,
			parent: THREE.Object3D,
		) => {
			const m = new THREE.Mesh(this.unitBox, mat);
			m.scale.set(w, h, d);
			m.position.set(px, py, pz);
			m.castShadow = true;
			parent.add(m);
			return m;
		};

		const { torso, head, thigh, shin, arm } = SITTER;
		doos(jas, torso.width, torso.height, torso.depth, 0, half(torso.height), 0, body);
		const bol = new THREE.Mesh(this.head, huid);
		bol.position.set(0, torso.height + head.radius, 0);
		body.add(bol);
		for (const side of [-1, 1] as const) {
			const hipX = side * half(torso.width - thigh.width);
			// Naar het toneel toe is −z, dus de dijen steken die kant op en de schenen
			// vallen aan het eind ervan omlaag.
			doos(jas, thigh.width, thigh.height, thigh.length, hipX, 0, -half(thigh.length), hips);
			doos(jas, shin.width, shin.length, shin.width, hipX, -half(shin.length), -thigh.length, hips);
			doos(
				jas,
				arm.width,
				arm.width,
				arm.length,
				side * half(torso.width + arm.width),
				half(torso.height),
				-half(arm.length),
				body,
			);
		}
		this.sitters.push({ body, phase: rand() * TAU, rate: lerp(SITTER_BREATH.min, SITTER_BREATH.max, rand()) });
		return root;
	}

	/**
	 * De backstage achter het toneel: vloer, wanden en plafond uit de entiteiten, de
	 * twee deuren, de kaptafels met spiegels en stoelen, het rekwisietenrek, het
	 * achterbordes met zijn trap, en een paar gangplafondlampen uit de pool.
	 *
	 * Alles leest uit dezelfde volumes die de collision en de wereldcontrole lezen,
	 * dus wie een wand verzet verzet de mesh mee. De spiegels zijn enkelzijdige
	 * vlakken: een textuur op een dubbelzijdig vlak leest van achteren gespiegeld.
	 */
	private buildBackstage(pool: LightPool): void {
		const steen = lit({ color: 0x8a8378, roughness: 0.95 });
		const vloerMat = lit({ color: 0x3a352f, roughness: 0.92 });
		const plafondMat = lit({ color: 0x2a2622, roughness: 1 });
		const hout = lit({ color: 0x4a3524, roughness: 0.6, metalness: 0.05 });
		const staal = lit({ color: 0x6b7078, roughness: 0.4, metalness: 0.7 });
		const stof = lit({ color: 0x4a5a52, roughness: 0.95 });
		const deurMat = lit({ color: 0x2a211b, roughness: 0.7, metalness: 0.15 });
		const glasMat = lit({ color: 0x1b2a2e, roughness: 0.15, metalness: 0.6, transparent: true, opacity: 0.42 });
		this.materials.push(steen, vloerMat, plafondMat, hout, staal, stof, deurMat, glasMat);

		const midX = midpoint(BACKSTAGE_INTERIOR.minX, BACKSTAGE_INTERIOR.maxX);
		const midZ = midpoint(BACKSTAGE_INTERIOR.minZ, BACKSTAGE_INTERIOR.maxZ);
		const breedte = span(BACKSTAGE_INTERIOR.minX, BACKSTAGE_INTERIOR.maxX);
		const diepte = span(BACKSTAGE_INTERIOR.minZ, BACKSTAGE_INTERIOR.maxZ);

		const vloer = new THREE.Mesh(this.unitPlane, vloerMat);
		vloer.scale.set(breedte, diepte, 1);
		vloer.rotation.x = -Math.PI / 2;
		vloer.position.set(midX, BACKSTAGE_FLOOR_Y + CARPET_LIFT, midZ);
		vloer.receiveShadow = true;
		this.group.add(vloer);
		// De gangvloer en het toneel raken elkaar door de halve meter dikke tussenwand.
		// Collision had daar al een stage-door-sill, maar alleen het grote backstage-vlak
		// werd getekend: je liep dus over een zichtbaar gat. De artiesteningang en de twee
		// coulissedeuren hebben dezelfde drempel. Alle komen uit het vloerrecord dat
		// collision leest.
		for (const id of ['stage-door-sill', 'wing-door-sill-west', 'wing-door-sill-east', 'artist-door-sill'] as const) {
			const volume = THEATRE_HALL_ENTITY.volumes.find((candidate) => candidate.id === id);
			if (!volume) throw new Error(`theater mist loopvlak ${id}`);
			const sill = this.boxOf(vloerMat, geometryBounds(volume.geometry));
			sill.name = `theatre_${id}`;
			sill.receiveShadow = true;
		}

		const plafond = new THREE.Mesh(this.unitPlane, plafondMat);
		plafond.scale.set(breedte, diepte, 1);
		plafond.rotation.x = Math.PI / 2;
		plafond.position.set(midX, BACKSTAGE_CEILING_Y, midZ);
		this.group.add(plafond);

		for (const volume of THEATRE_BACKSTAGE_ENTITY.volumes) {
			this.boxOf(steen, geometryBounds(volume.geometry)).receiveShadow = true;
		}

		// Elk blad schuift in update() de openState van zijn eigen mechanisme na, op
		// dezelfde triggerdoos die het wereldmodel aanwijst; de travee doet het net zo.
		for (const mechanism of THEATRE_BACKSTAGE_DOORS_ENTITY.mechanisms) {
			const translation = mechanism.openState.translation;
			if (!translation) throw new Error(`backstage-mechanisme ${mechanism.id} schuift maar heeft geen translation`);
			const leaves: { mesh: THREE.Mesh; closed: THREE.Vector3 }[] = [];
			for (const id of mechanism.movingVolumeIds) {
				const volume = THEATRE_BACKSTAGE_DOORS_ENTITY.volumes.find((kandidaat) => kandidaat.id === id);
				if (!volume) throw new Error(`backstage-mechanisme ${mechanism.id} beweegt ${id}, maar dat volume bestaat niet`);
				const mesh = this.boxOf(id.startsWith('artist-leaf') ? glasMat : deurMat, geometryBounds(volume.geometry));
				leaves.push({ mesh, closed: mesh.position.clone() });
			}
			this.backstageDoors.push({
				trigger: mechanismTriggerBounds(THEATRE_BACKSTAGE_DOORS_ENTITY, mechanism.id),
				rate: 1 / mechanism.openingSeconds,
				travel: new THREE.Vector3(translation.x, translation.y, translation.z),
				open: 0,
				leaves,
			});
		}

		// Kaptafels, stoelen en het rekwisietenrek uit de inrichting-entiteit.
		for (const volume of THEATRE_BACKSTAGE_FIXTURES_ENTITY.volumes) {
			const mat = volume.id === 'prop-rack' ? staal : volume.id.includes('chair') ? stof : hout;
			const mesh = this.boxOf(mat, geometryBounds(volume.geometry));
			mesh.castShadow = true;
		}
		this.buildBackstageKostuums();
		this.buildBackstageSpiegel(BACKSTAGE_INTERIOR.minX, 1);
		this.buildBackstageSpiegel(BACKSTAGE_INTERIOR.maxX, -1);
		this.buildBackstageBordes(steen);
		this.buildBackstageLicht(pool);
		this.buildAankleedsters();
	}

	/** Een handvol kostuums aan het rek: platte kleurvlakken die eronderuit hangen. */
	private buildBackstageKostuums(): void {
		const rack = THEATRE_PLAN.backstage.rack;
		const kleuren = [0x7a1230, 0x1f3a30, 0x513a1c, 0x2c3550] as const;
		const x = BACKSTAGE_CORRIDOR.minX + half(rack.depth);
		for (const [index, kleur] of kleuren.entries()) {
			const mat = lit({ color: kleur, roughness: 0.95 });
			this.materials.push(mat);
			const t = (index + 0.5) / kleuren.length;
			const z = lerp(rack.centerZ - half(rack.length) + 0.2, rack.centerZ + half(rack.length) - 0.2, t);
			this.box(mat, 0.16, 1.1, 0.34, x, BACKSTAGE_FLOOR_Y + rack.height - 0.6, z).castShadow = true;
		}
	}

	/**
	 * Een spiegel boven de kaptafel: een lijst met een enkelzijdig glasvlak dat de
	 * kamer in kijkt. Enkelzijdig met opzet — een textuur op een dubbelzijdig vlak
	 * leest van achteren gespiegeld, en daar is `spiegeltekst` voor.
	 */
	private buildBackstageSpiegel(wallX: number, inward: 1 | -1): void {
		const { mirror } = THEATRE_PLAN.backstage.vanity;
		const lijst = lit({ color: 0x8a6d2f, roughness: 0.45, metalness: 0.7 });
		this.materials.push(lijst);
		const z = midpoint(BACKSTAGE_INTERIOR.minZ, BACKSTAGE_INTERIOR.maxZ);
		const y = BACKSTAGE_FLOOR_Y + mirror.centerY;
		this.box(lijst, 0.1, mirror.height + 0.16, mirror.width + 0.16, wallX + inward * 0.03, y, z).castShadow = true;
		const tex = this.makeTexture(128, 256, (ctx) => {
			const grad = ctx.createLinearGradient(0, 0, 0, 256);
			grad.addColorStop(0, '#dfe6ea');
			grad.addColorStop(0.5, '#aab6bd');
			grad.addColorStop(1, '#7d8a90');
			ctx.fillStyle = grad;
			ctx.fillRect(0, 0, 128, 256);
		});
		const glas = new THREE.Mesh(this.unitPlane, this.basic(tex));
		glas.scale.set(mirror.width, mirror.height, 1);
		glas.rotation.y = inward > 0 ? Math.PI / 2 : -Math.PI / 2;
		glas.position.set(wallX + inward * 0.06, y, z);
		this.group.add(glas);
	}

	/** Het achterbordes met zijn trap, uit dezelfde maten als de collision. */
	private buildBackstageBordes(mat: THREE.Material): void {
		const bordes = BACKSTAGE_LANDING;
		this.box(
			mat,
			span(bordes.minX, bordes.maxX),
			bordes.y,
			span(bordes.minZ, bordes.maxZ),
			midpoint(bordes.minX, bordes.maxX),
			half(bordes.y),
			midpoint(bordes.minZ, bordes.maxZ),
		).receiveShadow = true;
		for (let i = 0; i < THEATRE_PLAN.backstage.landing.treads; i++) {
			const top = backstageLandingTreadY(i);
			const { minZ, maxZ } = backstageLandingTreadZ(i);
			this.box(
				mat,
				span(bordes.minX, bordes.maxX),
				top,
				span(minZ, maxZ),
				midpoint(bordes.minX, bordes.maxX),
				half(top),
				midpoint(minZ, maxZ),
			).receiveShadow = true;
		}
	}

	/** Gangplafondlampen: één in de gang en één boven elke kaptafel, uit de pool. */
	private buildBackstageLicht(pool: LightPool): void {
		const gloed = new THREE.MeshBasicMaterial({ color: 0xfff2d8, toneMapped: false });
		this.materials.push(gloed);
		const bolGeo = new THREE.SphereGeometry(0.12, 8, 6);
		this.geometries.push(bolGeo);
		const y = BACKSTAGE_CEILING_Y - 0.2;
		const roomZ = midpoint(BACKSTAGE_INTERIOR.minZ, BACKSTAGE_INTERIOR.maxZ);
		const plekken: readonly (readonly [number, number])[] = [
			[THEATRE_ARTIST_PORTAL.centerX, roomZ],
			[midpoint(BACKSTAGE_INTERIOR.minX, BACKSTAGE_CORRIDOR.minX), roomZ],
			[midpoint(BACKSTAGE_CORRIDOR.maxX, BACKSTAGE_INTERIOR.maxX), roomZ],
		];
		for (const [x, z] of plekken) {
			const bol = new THREE.Mesh(bolGeo, gloed);
			bol.position.set(x, y, z);
			this.group.add(bol);
			pool.register({ position: bol.position.clone(), color: 0xffe6b0, intensity: 5, distance: 7, decay: 2 });
		}
	}

	/** Twee aankleedsters aan de kaptafels: een cast, dus `check-props` telt ze. */
	private buildAankleedsters(): void {
		this.backstage.name = 'theatre_backstage_cast';
		this.group.add(this.backstage);
		const rand = mulberry32(0x4b1d);
		const huid = lit({ color: 0xc99a76, roughness: 0.85 });
		const jas = lit({ color: 0x30323a, roughness: 0.9 });
		this.materials.push(huid, jas);
		for (const id of ['vanity-west-chair-a', 'vanity-east-chair-a']) {
			const chair = THEATRE_BACKSTAGE_FIXTURES_ENTITY.volumes.find((volume) => volume.id === id);
			if (!chair) continue;
			const box = geometryBounds(chair.geometry);
			this.backstage.add(
				this.buildBezoeker(midpoint(box.minX, box.maxX), BACKSTAGE_FLOOR_Y, midpoint(box.minZ, box.maxZ), jas, huid, rand),
			);
		}
	}

	/** Een onbelicht vlak met een canvas erop: affiches, borden en het doek. */
	private basic(map: THREE.Texture): THREE.MeshBasicMaterial {
		const mat = new THREE.MeshBasicMaterial({ map, toneMapped: false });
		this.materials.push(mat);
		return mat;
	}
}
