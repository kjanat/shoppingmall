import * as THREE from 'three';
import { levelY } from '#/data/levels';
import {
	ELEVATOR_SPEC,
	PARKED_CAR_SPEC,
	PARKED_CAR_SPOTS,
	PARKING_BAY_SPEC,
	PARKING_BOOTH_LABEL,
	PARKING_CEILING_SPEC,
	PARKING_DECK_SPEC,
	PARKING_EXIT_CHEVRONS,
	PARKING_EXIT_RAIL,
	PARKING_EXIT_RAIL_HEADS,
	PARKING_EXIT_RAMP,
	PARKING_EXIT_RAMP_ANGLE,
	PARKING_EXIT_RAMP_LENGTH,
	PARKING_EXIT_TRENCH,
	PARKING_EXIT_TRENCH_HEAD,
	PARKING_EXIT_TRENCH_WALLS,
	PARKING_SLAB_SPEC,
	PARKING_WALL_PANELS,
	parkingPaintPatches,
	parkingPillarCenters,
	parkingStalls,
} from '#/data/world';
import { shellShadowOn } from '#/render/graphicsPrefs';
import type { LightPool } from '#/render/LightPool';
import { lit } from '#/render/material';
import { addBoxMesh, addSignBack } from '#/render/meshFactory';
import { addExtrudedXZMesh } from '#/render/xzShape';
import { CITY_GROUND_Y } from '#/scene/city/cityPlan';
import { labelCanvas, labelTexture } from '#/util/label';
import { half, midpoint, span } from '#/util/math';
import { at } from '#/util/rand';

/** World Y of the parking deck (one storey under V0) */
export const GARAGE_Y = levelY('p1');

/** Straal van een ophangstang. Een bord dat aan niets hangt is geen bord maar een vlek. */
const SIGN_HANGER_RADIUS = 0.02;

/**
 * Hoever het grijze achtervlak achter een bord hangt dat van twee kanten te naderen
 * is. De borden hier hangen aan stangen of staan op palen in de open lucht, dus van
 * achteren keek je dwars door de tekst heen naar de overkant.
 */
const SIGN_BACK_GAP = 0.03;
const SIGN_BACK_COLOR = 0x8d9296;

/** ← EXIT · STAD, hangend boven de mond binnen in de garage. */
const EXIT_SIGN = { setback: 2, centerY: 2.8, height: 0.7, hangerSpread: 1.3 } as const;

/**
 * CITY RING → bij de uitritmond. Hij stond op de hartlijn van de rijbaan en hing
 * daar aan niets; op twee palen naast de baan staat hij waar wie naar buiten rijdt
 * hem aan zijn rechterkant heeft.
 */
const CITY_SIGN = {
	width: 2.8,
	height: 0.55,
	setback: 2,
	centerY: 1.15,
	centerZ: -5,
	post: { radius: 0.06, spacing: 1.1, behind: 0.06 },
} as const;

/** P1 · PARKEERGARAGE tegen de noordwand, in plaats van een meter ervoor in de lucht. */
const DECK_SIGN_CLEARANCE = 0.04;
/** ↑ LIFT · V0 tegen het westvlak van de liftschacht. */
const LIFT_SIGN_CLEARANCE = 0.05;
/** MAX 2.1 m boven het gangpad, aan de plaat erboven. */
const HEIGHT_SIGN = { x: -20, centerY: 3, height: 0.4, hangerSpread: 0.9 } as const;

/** Hoeveel het vaknummer boven de belijning ligt, zodat de twee niet tegen elkaar op flikkeren. */
const NUMBER_LIFT = 0.01;

/** Eén pijl, geschilderd in meters op de tegel die zich over de baan herhaalt. */
const CHEVRON_PAINT = {
	/** Textuurpixels per meter; de pijl staat op ware grootte in het doek. */
	pixelsPerMetre: 24,
	color: '#ffc107',
	/** Streekbreedte, lengte van de punt tot het einde van de armen, en de rand die vrij blijft. */
	stroke: 0.4,
	reach: 1.6,
	inset: 0.5,
	edge: 0.35,
	/** Alles onder deze dekking valt weg. */
	alphaTest: 0.5,
} as const;

/**
 * Underground parking garage — grey concrete, pillars, bays, a few cars.
 * Reachable via the glass elevator (Hans: “P1 / parkeergarage”).
 */
export class ParkingGarage {
	readonly group = new THREE.Group();
	readonly pos = new THREE.Vector3(0, GARAGE_Y, 0);
	private materials: THREE.Material[] = [];
	private backMat: THREE.Material | null = null;
	private pool: LightPool;
	/** Werpt de garageschil schaduw? Grotendeels ondergronds, dus zon-effect is klein. */
	private readonly shellCasts = shellShadowOn();

	constructor(pool: LightPool) {
		this.pool = pool;
		this.group.name = 'parkingGarage';
		this.group.position.y = GARAGE_Y;
		this.buildShell();
		this.buildPillars();
		this.buildBays();
		this.buildCars();
		this.buildBooth();
		this.buildSigns();
		this.buildLights();
	}

	private track<T extends THREE.Material>(m: T): T {
		this.materials.push(m);
		return m;
	}

	private buildShell(): void {
		const concrete = this.track(lit({ color: 0x5a5a5a, roughness: 0.95 }));
		const dark = this.track(lit({ color: 0x37474f, roughness: 0.9 }));
		addExtrudedXZMesh(this.group, concrete, {
			...PARKING_SLAB_SPEC,
			topY: PARKING_SLAB_SPEC.topY - GARAGE_Y,
			castShadow: this.shellCasts,
			receiveShadow: true,
		});

		// Ceiling slab (underside of mall). Cut like the floor: the glass elevator
		// travels through it, so a solid box put 30 cm of concrete in the cabin.
		const { clearHeight } = PARKING_DECK_SPEC;
		addExtrudedXZMesh(this.group, dark, {
			...PARKING_CEILING_SPEC,
			name: 'parking-ceiling',
			topY: PARKING_CEILING_SPEC.topY - GARAGE_Y,
			castShadow: this.shellCasts,
		});

		// Perimeter walls. Only the exit mouth is an opening, and its lintel is the
		// one panel that starts above the deck instead of on it.
		for (const panel of PARKING_WALL_PANELS) {
			const base = panel.base - GARAGE_Y;
			addBoxMesh(this.group, dark, {
				name: `parking-wall-${panel.id}`,
				width: panel.size.width,
				height: span(base, clearHeight),
				depth: panel.size.depth,
				position: { x: panel.center.x, y: midpoint(base, clearHeight), z: panel.center.z },
				castShadow: this.shellCasts,
			});
		}

		// ── West exit ramp → outdoor city (local y 0 = world GARAGE_Y) ──
		this.buildExitRamp(concrete, dark);
	}

	/** Ramp from P1 deck up to street level, heading west out of the mall */
	private buildExitRamp(concrete: THREE.Material, dark: THREE.Material): void {
		const { start, end, width, thickness } = PARKING_EXIT_RAMP;
		const localStartY = start.y - GARAGE_Y;
		const localEndY = end.y - GARAGE_Y;
		// Lengte en hoek van de helling komen uit de spec: de leuning, de verf en de
		// wereldcontrole rekenen met dezelfde twee, en dit was de vierde kopie ervan.
		const angle = PARKING_EXIT_RAMP_ANGLE;
		const centerX = midpoint(start.x, end.x);
		const surfaceCenterY = midpoint(localStartY, localEndY);
		const slabNormalOffset = half(thickness);
		const slab = new THREE.Mesh(new THREE.BoxGeometry(PARKING_EXIT_RAMP_LENGTH, thickness, width), concrete);
		slab.position.set(centerX + Math.sin(angle) * slabNormalOffset, surfaceCenterY - Math.cos(angle) * slabNormalOffset, 0);
		slab.rotation.z = angle;
		slab.castShadow = this.shellCasts;
		slab.receiveShadow = true;
		this.group.add(slab);

		// Leuning en kop komen uit PARKING_EXIT_RAIL: de doos is precies zo lang dat
		// zijn gedraaide hoeken op de mond uitkomen, en de kop dekt hem daar af.
		const rail = PARKING_EXIT_RAIL;
		for (const sign of [-1, 1] as const) {
			const bar = new THREE.Mesh(new THREE.BoxGeometry(rail.length, rail.height, rail.thickness), dark);
			bar.position.set(rail.centerX, rail.centerY - GARAGE_Y, sign * rail.offsetZ);
			bar.rotation.z = rail.angle;
			this.group.add(bar);
		}
		for (const head of PARKING_EXIT_RAIL_HEADS) {
			addBoxMesh(this.group, dark, {
				name: 'parking-exit-rail-head',
				width: span(head.minX, head.maxX),
				height: span(head.minY, head.maxY),
				depth: span(head.minZ, head.maxZ),
				position: {
					x: midpoint(head.minX, head.maxX),
					y: midpoint(head.minY, head.maxY) - GARAGE_Y,
					z: midpoint(head.minZ, head.maxZ),
				},
				castShadow: this.shellCasts,
			});
		}

		// Keermuren langs de hele geul. Zonder deze keek je vanuit P1 dwars de wereld
		// uit: onder maaiveld staat er buiten de parkeerschil niets, en het grondvlak
		// van de stad is enkelzijdig, dus auto's en torens zweefden op de lucht.
		for (const muur of PARKING_EXIT_TRENCH_WALLS) {
			const onder = PARKING_EXIT_TRENCH.baseY - GARAGE_Y;
			const boven = muur.topY - GARAGE_Y;
			addBoxMesh(this.group, concrete, {
				name: `parking-trench-${muur.id}`,
				width: span(muur.minX, muur.maxX),
				height: span(onder, boven),
				depth: span(muur.minZ, muur.maxZ),
				position: {
					x: midpoint(muur.minX, muur.maxX),
					y: midpoint(onder, boven),
					z: midpoint(muur.minZ, muur.maxZ),
				},
				castShadow: this.shellCasts,
			});
		}
		// En de kop erboven: tussen het parkeerdak en de begane-grondplaat zat een
		// spouw van bijna een meter waar de geul met zijn volle hoogte in uitkwam.
		addBoxMesh(this.group, concrete, {
			name: 'parking-trench-head',
			width: span(PARKING_EXIT_TRENCH_HEAD.minX, PARKING_EXIT_TRENCH_HEAD.maxX),
			height: span(PARKING_EXIT_TRENCH_HEAD.minY, PARKING_EXIT_TRENCH_HEAD.maxY),
			depth: span(PARKING_EXIT_TRENCH_HEAD.minZ, PARKING_EXIT_TRENCH_HEAD.maxZ),
			position: {
				x: midpoint(PARKING_EXIT_TRENCH_HEAD.minX, PARKING_EXIT_TRENCH_HEAD.maxX),
				y: midpoint(PARKING_EXIT_TRENCH_HEAD.minY, PARKING_EXIT_TRENCH_HEAD.maxY) - GARAGE_Y,
				z: midpoint(PARKING_EXIT_TRENCH_HEAD.minZ, PARKING_EXIT_TRENCH_HEAD.maxZ),
			},
			castShadow: this.shellCasts,
		});
		this.buildExitChevrons();

		// Sign at ramp mouth (inside garage), hanging from the deck above it.
		const exitSign = this.makeTextPlane('← EXIT · STAD', 3.2, 0.7, '#b71c1c', '#fff');
		exitSign.position.set(start.x + EXIT_SIGN.setback, localStartY + EXIT_SIGN.centerY, 0);
		exitSign.rotation.y = Math.PI / 2;
		this.group.add(exitSign);
		this.backSign(exitSign);
		this.hangFromCeiling(exitSign.position.x, exitSign.position.y + half(EXIT_SIGN.height), EXIT_SIGN.hangerSpread);

		// CITY RING stond zonder iets eronder midden boven de rijbaan. Nu op twee palen
		// op de stoep naast de mond, aan de kant waar wie naar buiten rijdt hem heeft.
		const citySign = this.makeTextPlane('CITY RING →', CITY_SIGN.width, CITY_SIGN.height, '#0d47a1', '#fff');
		const citySignX = end.x + CITY_SIGN.setback;
		const citySignY = localEndY + CITY_SIGN.centerY;
		citySign.position.set(citySignX, citySignY, CITY_SIGN.centerZ);
		citySign.rotation.y = Math.PI / 2;
		this.group.add(citySign);
		// Hij staat vrij op de stoep, dus van het plein af kijk je tegen zijn rug aan.
		this.backSign(citySign);
		const postTop = citySignY + half(CITY_SIGN.height);
		const postBase = CITY_GROUND_Y - GARAGE_Y;
		const postMat = this.track(lit({ color: 0x9aa2a8, roughness: 0.5, metalness: 0.6 }));
		for (const sign of [-1, 1] as const) {
			const post = new THREE.Mesh(
				new THREE.CylinderGeometry(CITY_SIGN.post.radius, CITY_SIGN.post.radius, span(postBase, postTop), 8),
				postMat,
			);
			post.position.set(
				citySignX - CITY_SIGN.post.behind,
				midpoint(postBase, postTop),
				CITY_SIGN.centerZ + sign * CITY_SIGN.post.spacing,
			);
			this.group.add(post);
		}
	}

	/**
	 * Het pijlvak op de uitrit: één vlak dat in het hellingvlak zelf ligt.
	 *
	 * De geometrie wordt platgelegd in het XZ-vlak en pas daarna om z gekanteld, dus
	 * hij draait met de helling mee in plaats van er horizontaal boven te hangen.
	 * `PARKING_EXIT_CHEVRONS` zet hem uit, inclusief de hoogte langs de normaal.
	 */
	private buildExitChevrons(): void {
		const vak = PARKING_EXIT_CHEVRONS;
		const geometry = new THREE.PlaneGeometry(vak.length, vak.width);
		geometry.rotateX(-Math.PI / 2);
		const strip = new THREE.Mesh(geometry, this.track(this.chevronMaterial()));
		strip.name = 'parking-exit-chevrons';
		strip.position.set(vak.center.x, vak.center.y - GARAGE_Y, vak.center.z);
		strip.rotation.z = vak.angle;
		this.group.add(strip);
	}

	/** Eén pijl per herhaling, geschilderd op ware grootte in meters en dan getegeld over de baan. */
	private chevronMaterial(): THREE.MeshBasicMaterial {
		const vak = PARKING_EXIT_CHEVRONS;
		const pixels = CHEVRON_PAINT.pixelsPerMetre;
		const tegel = vak.length / vak.count;
		const { canvas, ctx } = labelCanvas(tegel * pixels, vak.width * pixels);
		ctx.scale(pixels, pixels);
		ctx.strokeStyle = CHEVRON_PAINT.color;
		ctx.lineWidth = CHEVRON_PAINT.stroke;
		ctx.lineCap = 'butt';
		ctx.lineJoin = 'miter';
		// De punt wijst naar u = 0, en dat is de mondzijde: de kant waar u naartoe rijdt.
		const punt = CHEVRON_PAINT.inset;
		const staart = punt + CHEVRON_PAINT.reach;
		ctx.beginPath();
		ctx.moveTo(staart, CHEVRON_PAINT.edge);
		ctx.lineTo(punt, half(vak.width));
		ctx.lineTo(staart, vak.width - CHEVRON_PAINT.edge);
		ctx.stroke();
		const texture = labelTexture(canvas);
		texture.wrapS = THREE.RepeatWrapping;
		texture.repeat.set(vak.count, 1);
		// Alleen alphaTest en niet transparent: zo blijft het vlak in de dekkende
		// wachtrij, schrijft het diepte en hoeft er niets gesorteerd te worden.
		return new THREE.MeshBasicMaterial({ map: texture, alphaTest: CHEVRON_PAINT.alphaTest, toneMapped: false });
	}

	/** Twee dunne stangen van de plaat boven een hangend bord naar de bovenkant ervan. */
	private hangFromCeiling(x: number, topY: number, spread: number): void {
		const ceiling = PARKING_DECK_SPEC.clearHeight;
		const rodMat = this.track(lit({ color: 0x9aa2a8, roughness: 0.5, metalness: 0.6 }));
		for (const sign of [-1, 1] as const) {
			const rod = new THREE.Mesh(
				new THREE.CylinderGeometry(SIGN_HANGER_RADIUS, SIGN_HANGER_RADIUS, span(topY, ceiling), 6),
				rodMat,
			);
			rod.position.set(x, midpoint(topY, ceiling), sign * spread);
			this.group.add(rod);
		}
	}

	private buildPillars(): void {
		const mat = this.track(
			lit({
				color: 0x78909c,
				roughness: 0.75,
				metalness: 0.1,
			}),
		);
		const { pillar, clearHeight } = PARKING_DECK_SPEC;
		for (const { x, z } of parkingPillarCenters()) {
			const p = new THREE.Mesh(new THREE.BoxGeometry(pillar.width, clearHeight, pillar.width), mat);
			p.position.set(x, half(clearHeight), z);
			p.castShadow = this.shellCasts;
			this.group.add(p);
		}
	}

	/**
	 * De belijning van de vakken en de pijlen op het middenpad, allebei uit
	 * `parkingPaintPatches` en dus al om de kolomvoeten heen geknipt. Ze liepen er
	 * dwars doorheen: zes vakken en drie pijlen verdwenen half in het beton.
	 */
	private buildBays(): void {
		const line = this.track(new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
		const yellow = this.track(new THREE.MeshBasicMaterial({ color: 0xffc107, toneMapped: false }));
		const { paintY, number } = PARKING_BAY_SPEC;
		for (const patch of parkingPaintPatches()) {
			const verf = new THREE.Mesh(new THREE.PlaneGeometry(patch.width, patch.depth), patch.kind === 'bay' ? line : yellow);
			verf.name = `parking-paint-${patch.id}`;
			verf.rotation.x = -Math.PI / 2;
			verf.position.set(patch.center.x, paintY, patch.center.z);
			this.group.add(verf);
		}
		// Het nummer ligt op zijn eigen vak, aan de kant van het middenpad.
		for (const { id, center } of parkingStalls()) {
			const num = this.makeTextPlane(id, number.width, number.height);
			num.rotation.x = -Math.PI / 2;
			num.position.set(center.x, paintY + NUMBER_LIFT, center.z + (center.z < 0 ? number.offsetZ : -number.offsetZ));
			this.group.add(num);
		}
	}

	private buildCars(): void {
		// Decorative parked cars only — player rentals live in DriveableCars
		// (avoid overlapping the E-rent spots at ±15.6/-14, 5.2/-14, etc.)
		const colors = [0x212121, 0xf5f5f5, 0xff8f00, 0x455a64, 0x5d4037];
		PARKED_CAR_SPOTS.forEach(({ x, z, yaw }, i) => {
			const car = this.makeCar(at(colors, i));
			car.position.set(x, PARKED_CAR_SPEC.standY, z);
			car.rotation.y = yaw;
			this.group.add(car);
		});
	}

	private makeCar(color: number): THREE.Group {
		const g = new THREE.Group();
		const { body: bodySpec, cabin: cabinSpec, wheel } = PARKED_CAR_SPEC;
		const bodyM = this.track(lit({ color, roughness: 0.45, metalness: 0.35 }));
		const dark = this.track(lit({ color: 0x111111, roughness: 0.7, metalness: 0.4 }));
		const glass = this.track(
			lit({
				color: 0x90caf9,
				transparent: true,
				opacity: 0.55,
				roughness: 0.15,
			}),
		);
		const body = new THREE.Mesh(new THREE.BoxGeometry(bodySpec.width, bodySpec.height, bodySpec.length), bodyM);
		body.position.y = bodySpec.centerY;
		g.add(body);
		const cabin = new THREE.Mesh(new THREE.BoxGeometry(cabinSpec.width, cabinSpec.height, cabinSpec.length), glass);
		cabin.position.set(0, cabinSpec.centerY, cabinSpec.offsetZ);
		g.add(cabin);
		// wheels
		for (const [sx, sz] of [
			[-1, 1],
			[1, 1],
			[-1, -1],
			[1, -1],
		] as const) {
			const w = new THREE.Mesh(new THREE.CylinderGeometry(wheel.radius, wheel.radius, wheel.width, 10), dark);
			w.rotation.z = Math.PI / 2;
			w.position.set(sx * wheel.offsetX, wheel.radius, sz * wheel.offsetZ);
			g.add(w);
		}
		return g;
	}

	private buildBooth(): void {
		const spec = PARKING_DECK_SPEC.booth;
		const booth = new THREE.Group();
		booth.position.set(spec.center.x, 0, spec.center.z);
		const wood = this.track(lit({ color: 0xffc107, roughness: 0.7 }));
		const box = new THREE.Mesh(new THREE.BoxGeometry(spec.width, spec.height, spec.depth), wood);
		box.position.y = half(spec.height);
		booth.add(box);
		const win = new THREE.Mesh(
			new THREE.PlaneGeometry(1.2, 0.8),
			this.track(
				lit({
					color: 0x81d4fa,
					transparent: true,
					opacity: 0.5,
				}),
			),
		);
		win.position.set(0, 1.4, 1.02);
		booth.add(win);
		const sign = this.makeTextPlane(PARKING_BOOTH_LABEL, 1.6, 0.4);
		sign.position.set(0, 2.55, 0);
		booth.add(sign);
		addSignBack(booth, sign, this.signBack(), SIGN_BACK_GAP);
		this.group.add(booth);
	}

	/**
	 * De drie dekborden. Ze zweefden alle drie: het grote een meter vóór de
	 * noordwand, het liftbord los naast de schacht en het doorrijhoogtebord midden
	 * boven het gangpad. Nu tegen de wand, tegen de schacht, en aan de plaat erboven.
	 */
	private buildSigns(): void {
		const northWall = PARKING_WALL_PANELS.find((panel) => panel.id === 'north');
		if (!northWall) throw new Error('geen noordpaneel in PARKING_WALL_PANELS');
		const big = this.makeTextPlane('P1  PARKEERGARAGE', 6, 1.0, '#0d47a1', '#fff');
		big.position.set(0, 3.2, northWall.center.z + half(northWall.size.depth) + DECK_SIGN_CLEARANCE);
		this.group.add(big);

		const exit = this.makeTextPlane('↑ LIFT · V0', 2.5, 0.55, '#b71c1c', '#fff');
		exit.position.set(ELEVATOR_SPEC.center.x - ELEVATOR_SPEC.shaft.wallOffset - LIFT_SIGN_CLEARANCE, 2.4, ELEVATOR_SPEC.center.z);
		exit.rotation.y = -Math.PI / 2;
		this.group.add(exit);

		const no = this.makeTextPlane('MAX 2.1 m', 2.2, HEIGHT_SIGN.height, '#212121', '#ffc107');
		no.position.set(HEIGHT_SIGN.x, HEIGHT_SIGN.centerY, 0);
		no.rotation.y = Math.PI / 2;
		this.group.add(no);
		this.backSign(no);
		this.hangFromCeiling(HEIGHT_SIGN.x, HEIGHT_SIGN.centerY + half(HEIGHT_SIGN.height), HEIGHT_SIGN.hangerSpread);
	}

	/**
	 * Het grijze achtervlak, gedeeld over alle borden die vrij hangen of staan. De
	 * borden die met hun rug tegen een wand of een schacht zitten krijgen er geen: daar
	 * kan niemand achter komen.
	 */
	private signBack(): THREE.Material {
		this.backMat ??= this.track(lit({ color: SIGN_BACK_COLOR, roughness: 0.8 }));
		return this.backMat;
	}

	private backSign(sign: THREE.Mesh): void {
		addSignBack(this.group, sign, this.signBack(), SIGN_BACK_GAP);
	}

	private buildLights(): void {
		// Dim fluorescent rows
		for (let i = -3; i <= 3; i++) {
			this.pool.register({
				color: 0xfff3e0,
				intensity: 2.2,
				distance: 16,
				decay: 2,
				position: new THREE.Vector3(i * 8, GARAGE_Y + 4.0, 0),
			});
			const fixture = new THREE.Mesh(
				new THREE.BoxGeometry(3.5, 0.08, 0.25),
				this.track(
					lit({
						color: 0xfffde7,
						emissive: 0xfff9c4,
						emissiveIntensity: 0.6,
					}),
				),
			);
			fixture.position.set(i * 8, 4.35, 0);
			this.group.add(fixture);
		}
		// Elevator area brighter
		this.pool.register({
			color: 0xe3f2fd,
			intensity: 4,
			distance: 12,
			decay: 2,
			position: new THREE.Vector3(ELEVATOR_SPEC.center.x, GARAGE_Y + 3.5, ELEVATOR_SPEC.center.z),
		});
	}

	private makeTextPlane(text: string, w: number, h: number, bg = '#1565c0', fg = '#ffffff'): THREE.Mesh {
		const { canvas: c, ctx } = labelCanvas(512, 128);
		ctx.fillStyle = bg;
		ctx.fillRect(0, 0, 512, 128);
		ctx.fillStyle = fg;
		ctx.font = 'bold 42px system-ui';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(text, 256, 64);
		const tex = labelTexture(c);
		return new THREE.Mesh(
			new THREE.PlaneGeometry(w, h),
			this.track(new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })),
		);
	}
}
