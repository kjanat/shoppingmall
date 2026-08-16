import type { Material } from 'three';
import {
	BoxGeometry,
	CircleGeometry,
	CylinderGeometry,
	DoubleSide,
	Group,
	Mesh,
	MeshBasicMaterial,
	PlaneGeometry,
	Vector3,
} from 'three';
import { levelY } from '#/data/levels';
import {
	ENTRANCE_CANOPY_BAY_ZS,
	ENTRANCE_CANOPY_PARTS,
	ENTRANCE_CANOPY_RIB_ZS,
	ENTRANCE_CANOPY_WASH_Z,
	ENTRANCE_PORTAL,
	ENTRANCE_SPEC,
} from '#/data/world';
import type { LightPool } from '#/render/LightPool';
import { lit } from '#/render/material';
import { ENTRANCE_CARPET } from '#/scene/city/cityPlan';
import { fitText, labelCanvas, labelTexture, roundRect } from '#/util/label';
import { clamp, half, midpoint, span } from '#/util/math';

/**
 * HOOFDINGANG · de straatentree in de westgevel.
 *
 * Elke maat komt uit `ENTRANCE_SPEC`, want dezelfde getallen snijden het gat in de
 * wandspec en zetten de dozen in Collision. Wat hier staat is alleen wat je ziet:
 * het portaal, de twee schuifbladen, de luifel op zijn kolommen, de belettering en
 * de loper naar het zebrapad.
 *
 * De bladen houden zelf niets tegen: in de fysica staat de deuropening gewoon open.
 * Ze schuiven op de aanwezigheidszone van `entrance-doors`, dus wie erheen loopt
 * ziet ze opengaan en wie erdoorheen loopt merkt er niets van.
 */

const V0 = levelY('v0');

/** Het bronzen kozijn om het glas: stijlen, latei, dorpelplint en de tussenstijlen. */
const FRAME = {
	thickness: 0.22,
	/** Hoeveel het kozijn buiten het gat uitsteekt, aan alle kanten. */
	reveal: 0.18,
	/** Bronzen plint onder het glas, waar het tegen schoenen en karren moet kunnen. */
	plinthHeight: 0.12,
	/** Een tussenstijl is de helft van een kozijnstijl, en het glas steekt er iets doorheen. */
	mullionDepth: 0.11,
	glassBite: 0.02,
	trimBite: 0.06,
} as const;

/** Het schuifblad zelf: de rail eronder, de kap erboven en de greep. */
const LEAF = {
	railBite: 0.03,
	headDepth: 0.11,
	handleRadius: 0.03,
	/** Greephoogte als deel van het blad, en hoe ver hij van de sluitrand staat. */
	handleHeightRatio: 0.45,
	handleInset: 0.12,
} as const;

/**
 * Randprofiel en kolomvoet onder de luifel. De ribben en de spots zelf staan in
 * `ENTRANCE_SPEC.canopy`, want de controle rekent hun onderlinge speling na.
 */
const CANOPY_TRIM = {
	collarHeight: 0.16,
	collarScale: 1.3,
	/** De kolom loopt naar onderen iets uit, zodat hij draagt in plaats van te steken. */
	columnFlare: 1.15,
} as const;

/** Sterkte en bereik van de twee virtuele lampen die de entree dragen. */
const HALL_LIGHT = { intensity: 16, distance: 20, decay: 1.7, height: 4.2, inset: 2.6 } as const;
const CANOPY_LIGHT = { intensity: 13, distance: 16, decay: 1.8, drop: 0.7 } as const;

/** Het bordje binnen bij de deur. De gevelbelettering staat in `ENTRANCE_SPEC.lettering`. */
const SIGN = {
	boardInset: 0.06,
	board: { width: 2.4, height: 0.9, drop: 0.7 },
} as const;

const GLASS_COLOR = 0xbfe3f5;
const BRONZE = 0xb08d57;
const STONE = 0xe9e4dc;
const CARPET_COLOR = 0xa4132a;
const LAMP_COLOR = 0xfff1d0;
const PAVING_COLOR = 0x9aa0a6;

export class Entrance {
	readonly group = new Group();
	private materials: Material[] = [];
	/** De twee bladen, elk met zijn eigen schuifrichting. */
	private leaves: { root: Group; closedZ: number; direction: -1 | 1 }[] = [];
	/** 0 = dicht, 1 = open. Loopt in `doorSeconds` van de ene stand naar de andere. */
	private opening = 0;

	constructor(pool: LightPool) {
		this.group.name = 'entrance';
		this.buildForecourt();
		this.buildPortal();
		this.buildDoors();
		this.buildCanopy();
		this.buildLettering();
		this.buildFlags();

		// Twee virtuele lampen: één binnen de dorpel en één onder de luifel. Ze huren
		// hun slot bij de pool en volgen dus vanzelf de discodim.
		pool.register({
			color: 0xfff4e0,
			intensity: HALL_LIGHT.intensity,
			distance: HALL_LIGHT.distance,
			decay: HALL_LIGHT.decay,
			position: new Vector3(ENTRANCE_PORTAL.innerX + HALL_LIGHT.inset, V0 + HALL_LIGHT.height, ENTRANCE_PORTAL.centerZ),
		});
		pool.register({
			color: 0xffe9c4,
			intensity: CANOPY_LIGHT.intensity,
			distance: CANOPY_LIGHT.distance,
			decay: CANOPY_LIGHT.decay,
			position: new Vector3(
				midpoint(ENTRANCE_PORTAL.canopyX, ENTRANCE_PORTAL.outerX),
				ENTRANCE_SPEC.canopy.topY - ENTRANCE_SPEC.canopy.thickness - CANOPY_LIGHT.drop,
				ENTRANCE_CANOPY_WASH_Z,
			),
		});
	}

	/**
	 * Schuift de bladen. `subject` is de speler; staat hij in de aanwezigheidszone
	 * van het mechanisme, dan gaan ze open, en anders weer dicht.
	 */
	update(dt: number, subject: Vector3): void {
		const { trigger } = ENTRANCE_PORTAL;
		const inside =
			subject.x > trigger.minX &&
			subject.x < trigger.maxX &&
			subject.z > trigger.minZ &&
			subject.z < trigger.maxZ &&
			subject.y < V0 + trigger.maxY;
		const target = inside ? 1 : 0;
		const step = dt / ENTRANCE_SPEC.doorSeconds;
		this.opening = clamp(this.opening + Math.sign(target - this.opening) * step, 0, 1);
		for (const leaf of this.leaves) {
			leaf.root.position.z = leaf.closedZ + leaf.direction * ENTRANCE_PORTAL.doorTravel * this.opening;
		}
	}

	dispose(): void {
		for (const m of this.materials) m.dispose();
	}

	private track<T extends Material>(m: T): T {
		this.materials.push(m);
		return m;
	}

	private glassMat(opacity: number): Material {
		return this.track(lit({ color: GLASS_COLOR, transparent: true, opacity, roughness: 0.08, metalness: 0.2 }));
	}

	private box(material: Material, w: number, h: number, d: number, x: number, y: number, z: number): Mesh {
		const mesh = new Mesh(new BoxGeometry(w, h, d), material);
		mesh.position.set(x, y, z);
		this.group.add(mesh);
		return mesh;
	}

	/**
	 * Het plein voor de deur: eigen bestrating tot aan de dorpel, zodat de entree niet
	 * op de tegels van het plein uitkomt maar op zijn eigen voorplein. Hij loopt tot op
	 * de dorpelhoogte en dus een tikje boven de bestrating eromheen.
	 */
	private buildForecourt(): void {
		const { forecourt, carpet } = ENTRANCE_SPEC;
		const paving = this.track(lit({ color: PAVING_COLOR, roughness: 0.95 }));
		this.box(
			paving,
			span(forecourt.west, ENTRANCE_PORTAL.outerX),
			forecourt.drop,
			span(forecourt.north, forecourt.south),
			midpoint(forecourt.west, ENTRANCE_PORTAL.outerX),
			V0 - half(forecourt.drop),
			midpoint(forecourt.north, forecourt.south),
		);

		// De loper: één rechte baan van de dorpel naar de oversteek, waar de
		// stadsplattegrond hem laat eindigen.
		const carpetMat = this.track(lit({ color: CARPET_COLOR, roughness: 0.85 }));
		this.box(
			carpetMat,
			span(ENTRANCE_CARPET.minX, ENTRANCE_CARPET.maxX),
			carpet.thickness,
			span(ENTRANCE_CARPET.minZ, ENTRANCE_CARPET.maxZ),
			midpoint(ENTRANCE_CARPET.minX, ENTRANCE_CARPET.maxX),
			V0 + half(carpet.thickness),
			midpoint(ENTRANCE_CARPET.minZ, ENTRANCE_CARPET.maxZ),
		);

		// Binnen de deuren gaat de loper over in gepolijste steen.
		const hall = this.track(lit({ color: STONE, roughness: 0.35, metalness: 0.05 }));
		this.box(
			hall,
			ENTRANCE_SPEC.hall.depth,
			ENTRANCE_SPEC.hall.thickness,
			ENTRANCE_SPEC.width,
			ENTRANCE_PORTAL.innerX + half(ENTRANCE_SPEC.hall.depth),
			V0 + half(ENTRANCE_SPEC.hall.thickness),
			ENTRANCE_PORTAL.centerZ,
		);
		this.box(
			carpetMat,
			ENTRANCE_SPEC.hall.depth,
			carpet.thickness,
			carpet.width,
			ENTRANCE_PORTAL.innerX + half(ENTRANCE_SPEC.hall.depth),
			V0 + ENTRANCE_SPEC.hall.thickness + half(carpet.thickness),
			ENTRANCE_PORTAL.centerZ,
		);
	}

	/** Het glazen portaal: zijlichten, scherm boven de deuren en het bronzen kozijn. */
	private buildPortal(): void {
		const { glassThickness, doorHeadY, glassTopY, sidelightWidth, width } = ENTRANCE_SPEC;
		const glass = this.glassMat(0.32);
		const bronze = this.track(lit({ color: BRONZE, metalness: 0.85, roughness: 0.3 }));

		for (const sign of [-1, 1] as const) {
			const z = ENTRANCE_PORTAL.centerZ + sign * half(width - sidelightWidth);
			this.box(
				glass,
				glassThickness,
				doorHeadY - FRAME.plinthHeight,
				sidelightWidth,
				ENTRANCE_PORTAL.glassX,
				midpoint(V0 + FRAME.plinthHeight, V0 + doorHeadY),
				z,
			);
			this.box(
				bronze,
				glassThickness + FRAME.glassBite,
				FRAME.plinthHeight,
				sidelightWidth,
				ENTRANCE_PORTAL.glassX,
				V0 + half(FRAME.plinthHeight),
				z,
			);
		}

		// Het scherm boven de deuren: twee verdiepingen glas in één vlak, met een
		// stijl per meter zodat het niet als een lege ruit leest.
		this.box(
			this.glassMat(0.26),
			glassThickness,
			glassTopY - doorHeadY,
			width,
			ENTRANCE_PORTAL.glassX,
			midpoint(V0 + doorHeadY, V0 + glassTopY),
			ENTRANCE_PORTAL.centerZ,
		);
		const mullions = Math.round(width);
		for (let i = 1; i < mullions; i++) {
			const z = ENTRANCE_PORTAL.minZ + (width * i) / mullions;
			this.box(
				bronze,
				glassThickness + LEAF.railBite,
				glassTopY - doorHeadY,
				FRAME.mullionDepth,
				ENTRANCE_PORTAL.glassX,
				midpoint(V0 + doorHeadY, V0 + glassTopY),
				z,
			);
		}
		// De latei op de deurhoogte, de bovendorpel en de twee stijlen van de hele bay.
		for (const y of [doorHeadY, glassTopY]) {
			this.box(
				bronze,
				glassThickness + FRAME.trimBite,
				FRAME.thickness,
				width + FRAME.reveal * 2,
				ENTRANCE_PORTAL.glassX,
				V0 + y,
				ENTRANCE_PORTAL.centerZ,
			);
		}
		for (const sign of [-1, 1] as const) {
			this.box(
				bronze,
				glassThickness + FRAME.trimBite,
				glassTopY + FRAME.thickness,
				FRAME.thickness,
				ENTRANCE_PORTAL.glassX,
				V0 + half(glassTopY),
				ENTRANCE_PORTAL.centerZ + sign * (half(width) + FRAME.reveal),
			);
		}
	}

	/** De twee schuifbladen, elk met een handgreepstijl en een bronzen onderrail. */
	private buildDoors(): void {
		const { doorThickness, doorLeafHeight } = ENTRANCE_SPEC;
		const leafDepth = half(span(ENTRANCE_PORTAL.doorMinZ, ENTRANCE_PORTAL.doorMaxZ));
		const glass = this.glassMat(0.3);
		const bronze = this.track(lit({ color: BRONZE, metalness: 0.85, roughness: 0.3 }));

		for (const direction of [-1, 1] as const) {
			const root = new Group();
			const closedZ = ENTRANCE_PORTAL.centerZ + direction * half(leafDepth);
			root.position.set(ENTRANCE_PORTAL.glassX, V0, closedZ);
			this.group.add(root);

			const pane = new Mesh(new BoxGeometry(doorThickness, doorLeafHeight - FRAME.plinthHeight, leafDepth), glass);
			pane.position.y = midpoint(FRAME.plinthHeight, doorLeafHeight);
			root.add(pane);
			const rail = new Mesh(new BoxGeometry(doorThickness + LEAF.railBite, FRAME.plinthHeight, leafDepth), bronze);
			rail.position.y = half(FRAME.plinthHeight);
			root.add(rail);
			const head = new Mesh(new BoxGeometry(doorThickness + LEAF.railBite, LEAF.headDepth, leafDepth), bronze);
			head.position.y = doorLeafHeight;
			root.add(head);
			// Greep aan de sluitende kant, zodat je ziet welke kant welke is.
			const handle = new Mesh(new CylinderGeometry(LEAF.handleRadius, LEAF.handleRadius, half(doorLeafHeight), 8), bronze);
			handle.position.set(
				-doorThickness,
				doorLeafHeight * LEAF.handleHeightRatio,
				-direction * (half(leafDepth) - LEAF.handleInset),
			);
			root.add(handle);

			this.leaves.push({ root, closedZ, direction });
		}
	}

	/** Luifel op twee kolommen, met ribben en verzonken spots. */
	private buildCanopy(): void {
		const { canopy, column } = ENTRANCE_SPEC;
		const shell = this.track(lit({ color: 0xf2efe9, roughness: 0.7, metalness: 0.1 }));
		const bronze = this.track(lit({ color: BRONZE, metalness: 0.85, roughness: 0.3 }));
		const projection = span(ENTRANCE_PORTAL.canopyX, ENTRANCE_PORTAL.outerX);
		const centerX = midpoint(ENTRANCE_PORTAL.canopyX, ENTRANCE_PORTAL.outerX);

		// De plaat en het bronzen randprofiel eromheen. Waar de dozen liggen staat in
		// het wereldmodel, want geen twee vlakken ervan mogen op hetzelfde vlak vallen
		// en dat rekent `controleIngang` na.
		for (const part of ENTRANCE_CANOPY_PARTS) {
			this.box(
				part.finish === 'slab' ? shell : bronze,
				span(part.minX, part.maxX),
				span(part.minY, part.maxY),
				span(part.minZ, part.maxZ),
				midpoint(part.minX, part.maxX),
				midpoint(part.minY, part.maxY),
				midpoint(part.minZ, part.maxZ),
			);
		}

		const { rib, spot } = canopy;
		const ribY = canopy.topY - canopy.thickness - rib.drop;
		for (const z of ENTRANCE_CANOPY_RIB_ZS) {
			this.box(bronze, projection - canopy.trim.reach, rib.height, rib.width, centerX, ribY, z);
		}
		// Eén spot per vak tússen twee ribben, en onder de ribben in plaats van ertussenin:
		// op een eigen steek liepen ze de ribben in en bleef er van elke spot een streepje over.
		const lampMat = this.track(new MeshBasicMaterial({ color: LAMP_COLOR, toneMapped: false }));
		for (const z of ENTRANCE_CANOPY_BAY_ZS) {
			const lamp = new Mesh(new CircleGeometry(spot.radius, 12), lampMat);
			lamp.rotation.x = Math.PI / 2;
			lamp.position.set(centerX - projection * spot.shift, ribY - half(rib.height) - spot.drop, z);
			this.group.add(lamp);
		}

		const height = canopy.topY - canopy.thickness;
		const collarRadius = column.radius * CANOPY_TRIM.collarScale;
		for (const sign of [-1, 1] as const) {
			const post = new Mesh(new CylinderGeometry(column.radius, column.radius * CANOPY_TRIM.columnFlare, height, 14), shell);
			post.position.set(ENTRANCE_PORTAL.columnX, V0 + half(height), ENTRANCE_PORTAL.centerZ + sign * column.offsetZ);
			post.castShadow = true;
			this.group.add(post);
			const collar = new Mesh(new CylinderGeometry(collarRadius, collarRadius, CANOPY_TRIM.collarHeight, 14), bronze);
			collar.position.set(
				ENTRANCE_PORTAL.columnX,
				V0 + half(CANOPY_TRIM.collarHeight),
				ENTRANCE_PORTAL.centerZ + sign * column.offsetZ,
			);
			this.group.add(collar);
		}
	}

	/** MALL SIM · PRAIRIE LAKES boven de luifel, plus het bordje bij de deur. */
	private buildLettering(): void {
		const { lettering } = ENTRANCE_SPEC;
		const { canvas, ctx, w, h } = labelCanvas(1024, 128);
		const grad = ctx.createLinearGradient(0, 0, w, 0);
		grad.addColorStop(0, '#f7c873');
		grad.addColorStop(0.5, '#fffaf0');
		grad.addColorStop(1, '#f7c873');
		ctx.fillStyle = grad;
		fitText(ctx, 'MALL SIM · PRAIRIE LAKES', { x: 0, y: 0, w, h }, { maxLines: 1, size: h, weight: '800' });
		const sign = new Mesh(
			new PlaneGeometry(lettering.width, lettering.height),
			this.track(new MeshBasicMaterial({ map: labelTexture(canvas), transparent: true, toneMapped: false })),
		);
		sign.position.set(ENTRANCE_PORTAL.outerX - lettering.standoff, V0 + lettering.centerY, ENTRANCE_PORTAL.centerZ);
		sign.rotation.y = -Math.PI / 2;
		this.group.add(sign);

		const plate = labelCanvas(512, 192);
		plate.ctx.fillStyle = '#0f172a';
		roundRect(plate.ctx, { x: 6, y: 6, width: plate.w - 12, height: plate.h - 12, radius: 18 });
		plate.ctx.fill();
		plate.ctx.strokeStyle = '#f7c873';
		plate.ctx.lineWidth = 4;
		plate.ctx.stroke();
		plate.ctx.fillStyle = '#f7c873';
		fitText(plate.ctx, 'HOOFDINGANG', { x: 20, y: 24, w: plate.w - 40, h: 82 }, { maxLines: 1, weight: '800' });
		plate.ctx.fillStyle = '#cbd5e1';
		fitText(plate.ctx, 'AUTOMATISCHE DEUREN · WELKOM', { x: 20, y: 112, w: plate.w - 40, h: 52 }, { maxLines: 1, weight: '600' });
		const board = new Mesh(
			new PlaneGeometry(SIGN.board.width, SIGN.board.height),
			this.track(new MeshBasicMaterial({ map: labelTexture(plate.canvas), transparent: true, toneMapped: false })),
		);
		board.position.set(
			ENTRANCE_PORTAL.innerX + SIGN.boardInset,
			V0 + ENTRANCE_SPEC.doorHeadY - SIGN.board.drop,
			ENTRANCE_PORTAL.centerZ,
		);
		board.rotation.y = Math.PI / 2;
		this.group.add(board);
	}

	/**
	 * Twee vlaggenmasten die de entree van verre aanwijzen. Ze staan vóór de luifel
	 * en naast de loper: onder de luifel is 5,6 m en een mast is 7,4 m, en noordelijk
	 * ervan ligt de uitritgeul open tot op de helling zes meter lager.
	 */
	private buildFlags(): void {
		const { flag: spec } = ENTRANCE_SPEC;
		const steel = this.track(lit({ color: 0xd7dbe0, metalness: 0.7, roughness: 0.35 }));
		const cloth = this.track(lit({ color: 0xe30613, roughness: 0.85, side: DoubleSide }));
		for (const sign of [-1, 1] as const) {
			const x = ENTRANCE_PORTAL.flagX;
			const z = ENTRANCE_PORTAL.centerZ + sign * ENTRANCE_PORTAL.flagOffsetZ;
			const mast = new Mesh(new CylinderGeometry(spec.radius, spec.radius * spec.baseFlare, spec.height, 10), steel);
			mast.position.set(x, V0 + half(spec.height), z);
			this.group.add(mast);
			// Het doek waait van het gebouw af; naar de luifel toe zou het er dwars doorheen hangen.
			const banner = new Mesh(new PlaneGeometry(spec.cloth.width, spec.cloth.height), cloth);
			banner.position.set(x - half(spec.cloth.width), V0 + spec.height - spec.cloth.drop, z);
			this.group.add(banner);
		}
	}
}
