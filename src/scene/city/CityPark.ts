import * as THREE from 'three';
import { ctx2d } from '@/util/dom';
import { labelCanvas, labelTexture } from '@/util/label';
import { at } from '@/util/rand';

/**
 * Stadspark op het NW-blok buiten de ringweg (x −90..−56, z −70..−40).
 * Gras, een slingerend grindpad dat doodloopt op de vijver (bewuste keuze,
 * aldus de landschapsarchitect), 24 bomen, 6 bankjes, 3 lantaarns die licht
 * suggereren zonder de Pi lastig te vallen, een fonteintje en twee eenden.
 * Puur decor vanaf het dak en uit de heli — de sims winkelen, ze recreëren niet.
 */

const CX = -73;
const CZ = -55;
const PARK_W = 34;
const PARK_D = 30;
const GROUND_Y = 0.02; // net boven de parkeerplaats-plane, zie CityRoads

const POND_R = 5;
const RIM_R = 5.7;

const TREES = 24;

/**
 * Grindpad-waypoints (wereld-x/z). Komt binnen op de westrand, slingert met
 * een ruime boog om de vijver heen en eindigt pal op de vijverrand — wie het
 * pad volgt krijgt gegarandeerd eenden.
 */
const PATH: readonly [number, number][] = [
	[-90, -61],
	[-83, -63.5],
	[-75, -64],
	[-68, -61.5],
	[-62.5, -56],
	[-62.5, -49],
	[-68, -45],
	[-75, -44.2],
	[-81, -46.5],
	[-84.5, -51],
	[-81, -55.5],
	[-78.5, -56.5],
];

export class CityPark {
	readonly group = new THREE.Group();

	private materials: THREE.Material[] = [];
	private geometries: THREE.BufferGeometry[] = [];
	private textures: THREE.Texture[] = [];
	private trunks!: THREE.InstancedMesh;
	private leaves!: THREE.InstancedMesh;
	/** Loof-pivot op het parkcentrum; het hele bladerdak wiegt als één geheel. */
	private sway = new THREE.Group();
	private jet!: THREE.Mesh;
	private splash!: THREE.Mesh;

	/** LCG-seed — elke reload hetzelfde park, de gemeente houdt niet van verrassingen. */
	private seed = 20260731;

	constructor() {
		this.group.name = 'city_park';
		this.sway.position.set(CX, 0, CZ);
		this.group.add(this.sway);
		this.buildGround();
		this.buildPond();
		this.buildTrees();
		this.buildBenches();
		this.buildLanterns();
		this.buildFountain();
		this.buildDucks();
	}

	update(_dt: number, t: number): void {
		// Zachte bries: alleen het loof beweegt, de stammen doen stoïcijns.
		this.sway.rotation.z = Math.sin(t * 0.55) * 0.008;
		this.sway.rotation.x = Math.sin(t * 0.41 + 1.7) * 0.006;
		// Fonteintje pompt in een vast ritme; de gemeente betaalt per liter.
		this.jet.scale.y = 1 + Math.sin(t * 4.2) * 0.12;
		const s = 1 + Math.sin(t * 4.2 + 0.9) * 0.1;
		this.splash.scale.set(s, 1, s);
	}

	dispose(): void {
		this.trunks.dispose();
		this.leaves.dispose();
		for (const m of this.materials) m.dispose();
		for (const g of this.geometries) g.dispose();
		for (const t of this.textures) t.dispose();
	}

	// ── grondvlak + grindpad ───────────────────────────────

	/**
	 * Eén canvas-texture voor gras én pad: goedkoper dan losse pad-geometrie
	 * en van bovenaf (waar dit park vooral bekeken wordt) niet van echt te
	 * onderscheiden. Canvas-linksboven = wereld (−90, −70).
	 */
	private buildGround(): void {
		const W = 512;
		const H = 452; // ~vierkante texels bij 34×30 wereldmeter
		const px = (x: number): number => ((x - (CX - PARK_W / 2)) / PARK_W) * W;
		const py = (z: number): number => ((z - (CZ - PARK_D / 2)) / PARK_D) * H;
		const { canvas: c, ctx } = labelCanvas(W, H);
		ctx.fillStyle = '#47793d';
		ctx.fillRect(0, 0, W, H);
		// Grasvlekjes — een effen groen vlak heet een biljartlaken, geen park
		for (let i = 0; i < 700; i++) {
			const g = 100 + Math.floor(this.rnd() * 45);
			ctx.fillStyle = `rgb(${g - 45},${g},${g - 55})`;
			ctx.fillRect(this.rnd() * W, this.rnd() * H, 3, 3);
		}
		// Grindpad: donkere rand + lichte kern, gladgestreken langs de waypoints
		const drawPath = (width: number, color: string): void => {
			ctx.strokeStyle = color;
			ctx.lineWidth = width;
			ctx.lineCap = 'round';
			ctx.lineJoin = 'round';
			ctx.beginPath();
			const first = at(PATH, 0);
			ctx.moveTo(px(first[0]), py(first[1]));
			for (let i = 1; i < PATH.length - 1; i++) {
				const here = at(PATH, i);
				const next = at(PATH, i + 1);
				const mx = (px(here[0]) + px(next[0])) / 2;
				const my = (py(here[1]) + py(next[1])) / 2;
				ctx.quadraticCurveTo(px(here[0]), py(here[1]), mx, my);
			}
			const last = at(PATH, PATH.length - 1);
			ctx.lineTo(px(last[0]), py(last[1]));
			ctx.stroke();
		};
		drawPath(38, '#8f8870');
		drawPath(30, '#d6ccae');
		const tex = labelTexture(c);
		this.textures.push(tex);
		const geo = new THREE.PlaneGeometry(PARK_W, PARK_D);
		geo.rotateX(-Math.PI / 2);
		this.geometries.push(geo);
		const ground = new THREE.Mesh(geo, this.track(new THREE.MeshStandardMaterial({ map: tex, roughness: 1 })));
		ground.position.set(CX, GROUND_Y, CZ);
		ground.receiveShadow = true;
		this.group.add(ground);
	}

	// ── vijver ─────────────────────────────────────────────

	/** Donkere rand-schijf met daarbovenop de lichtere waterschijf. */
	private buildPond(): void {
		const rimGeo = new THREE.CircleGeometry(RIM_R, 36);
		rimGeo.rotateX(-Math.PI / 2);
		const waterGeo = new THREE.CircleGeometry(POND_R, 36);
		waterGeo.rotateX(-Math.PI / 2);
		this.geometries.push(rimGeo, waterGeo);
		const rim = new THREE.Mesh(rimGeo, this.track(new THREE.MeshStandardMaterial({ color: 0x24506e, roughness: 0.7 })));
		rim.position.set(CX, GROUND_Y + 0.02, CZ);
		const water = new THREE.Mesh(
			waterGeo,
			this.track(new THREE.MeshStandardMaterial({ color: 0x3d84c4, roughness: 0.25, metalness: 0.1 })),
		);
		water.position.set(CX, GROUND_Y + 0.035, CZ);
		water.receiveShadow = true;
		this.group.add(rim, water);
	}

	// ── bomen ──────────────────────────────────────────────

	/**
	 * 24 bomen als twee InstancedMeshes: stammen (wereldvast) en loofbollen
	 * (relatief aan de sway-pivot). Rejection sampling houdt ze uit de vijver
	 * en van het pad.
	 */
	private buildTrees(): void {
		const trunkGeo = new THREE.CylinderGeometry(0.14, 0.2, 1.8, 6);
		trunkGeo.translate(0, 0.9, 0);
		const leafGeo = new THREE.SphereGeometry(1.15, 8, 6);
		leafGeo.translate(0, 2.4, 0);
		this.geometries.push(trunkGeo, leafGeo);
		const trunkMat = this.track(new THREE.MeshStandardMaterial({ color: 0x5d4632, roughness: 0.9 }));
		const leafMat = this.track(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 }));
		this.trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, TREES);
		this.leaves = new THREE.InstancedMesh(leafGeo, leafMat, TREES);

		// Afstand punt→padsegment, zodat er geen boom midden op het grind kiemt
		const distToPath = (x: number, z: number): number => {
			let best = Infinity;
			for (let i = 0; i < PATH.length - 1; i++) {
				const [ax, az] = at(PATH, i);
				const [bx, bz] = at(PATH, i + 1);
				const dx = bx - ax;
				const dz = bz - az;
				const u = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
				best = Math.min(best, Math.hypot(x - (ax + dx * u), z - (az + dz * u)));
			}
			return best;
		};

		const dummy = new THREE.Object3D();
		const tint = new THREE.Color();
		const palette = [0x3f7a2e, 0x4c8a38, 0x62953c, 0x8fae3f] as const;
		let placed = 0;
		let guard = 0;
		while (placed < TREES && guard++ < 600) {
			const x = CX - PARK_W / 2 + 1.7 + this.rnd() * (PARK_W - 3.4);
			const z = CZ - PARK_D / 2 + 1.7 + this.rnd() * (PARK_D - 3.4);
			if (Math.hypot(x - CX, z - CZ) < RIM_R + 1.8) continue; // geen wilg in het water
			if (distToPath(x, z) < 2.6) continue; // en geen eik op het grind
			const s = 0.85 + this.rnd() * 0.5;
			dummy.position.set(x, GROUND_Y, z);
			dummy.scale.set(s, s, s);
			dummy.updateMatrix();
			this.trunks.setMatrixAt(placed, dummy.matrix);
			// Loof relatief aan de pivot, iets platgedrukt: bol maar bescheiden
			dummy.position.set(x - CX, GROUND_Y, z - CZ);
			dummy.scale.set(s, s * 0.85, s);
			dummy.updateMatrix();
			this.leaves.setMatrixAt(placed, dummy.matrix);
			this.leaves.setColorAt(placed, tint.setHex(at(palette, placed)));
			placed++;
		}
		// Mocht de guard ooit winnen: liever minder bomen dan 24-placed stuks
		// met identiteitsmatrix midden in de mall.
		this.trunks.count = placed;
		this.leaves.count = placed;
		this.trunks.instanceMatrix.needsUpdate = true;
		this.leaves.instanceMatrix.needsUpdate = true;
		if (this.leaves.instanceColor) this.leaves.instanceColor.needsUpdate = true;
		this.group.add(this.trunks);
		this.sway.add(this.leaves);
	}

	// ── bankjes ────────────────────────────────────────────

	/** Zes bankjes, gedeelde geometrie, allemaal met vijverzicht. */
	private buildBenches(): void {
		const seatGeo = new THREE.BoxGeometry(1.7, 0.09, 0.5);
		const backGeo = new THREE.BoxGeometry(1.7, 0.5, 0.08);
		const legGeo = new THREE.BoxGeometry(0.09, 0.44, 0.46);
		this.geometries.push(seatGeo, backGeo, legGeo);
		const wood = this.track(new THREE.MeshStandardMaterial({ color: 0x7a5638, roughness: 0.8 }));
		const steel = this.track(new THREE.MeshStandardMaterial({ color: 0x2f3438, metalness: 0.5, roughness: 0.5 }));
		const spots: readonly [number, number][] = [
			[-83, -66],
			[-68, -64],
			[-60.5, -50],
			[-68, -42.8],
			[-79.5, -43.5],
			[-86.5, -53],
		];
		for (const [x, z] of spots) {
			const b = new THREE.Group();
			const seat = new THREE.Mesh(seatGeo, wood);
			seat.position.y = 0.46;
			b.add(seat);
			const back = new THREE.Mesh(backGeo, wood);
			back.position.set(0, 0.74, -0.24);
			back.rotation.x = -0.14;
			b.add(back);
			for (const sx of [-0.72, 0.72]) {
				const leg = new THREE.Mesh(legGeo, steel);
				leg.position.set(sx, 0.22, 0);
				b.add(leg);
			}
			b.position.set(x, GROUND_Y, z);
			b.rotation.y = Math.atan2(CX - x, CZ - z);
			this.group.add(b);
		}
	}

	// ── lantaarns ──────────────────────────────────────────

	/** Drie palen met een emissive bol — géén PointLight, de Pi mag ook leven. */
	private buildLanterns(): void {
		const poleGeo = new THREE.CylinderGeometry(0.06, 0.1, 3.1, 8);
		poleGeo.translate(0, 1.55, 0);
		const bulbGeo = new THREE.SphereGeometry(0.24, 10, 8);
		const capGeo = new THREE.ConeGeometry(0.3, 0.26, 8);
		this.geometries.push(poleGeo, bulbGeo, capGeo);
		const poleMat = this.track(new THREE.MeshStandardMaterial({ color: 0x2c353c, metalness: 0.6, roughness: 0.45 }));
		const bulbMat = this.track(new THREE.MeshBasicMaterial({ color: 0xffd98a, toneMapped: false }));
		const spots: readonly [number, number][] = [
			[-87.5, -59],
			[-63.5, -59],
			[-73.5, -43.2],
		];
		for (const [x, z] of spots) {
			const pole = new THREE.Mesh(poleGeo, poleMat);
			pole.position.set(x, GROUND_Y, z);
			const bulb = new THREE.Mesh(bulbGeo, bulbMat);
			bulb.position.set(x, GROUND_Y + 3.2, z);
			const cap = new THREE.Mesh(capGeo, poleMat);
			cap.position.set(x, GROUND_Y + 3.5, z);
			this.group.add(pole, bulb, cap);
		}
	}

	// ── fonteintje ─────────────────────────────────────────

	/** Sokkel + waterstraal + platgedrukte spatbol; de straal pulseert in update(). */
	private buildFountain(): void {
		const pedGeo = new THREE.CylinderGeometry(0.55, 0.72, 0.4, 12);
		const jetGeo = new THREE.CylinderGeometry(0.07, 0.14, 1.15, 8);
		jetGeo.translate(0, 0.575, 0); // voet op de sokkel, zodat scale.y omhoog groeit
		const splashGeo = new THREE.SphereGeometry(0.5, 10, 8);
		splashGeo.scale(1, 0.22, 1);
		this.geometries.push(pedGeo, jetGeo, splashGeo);
		const stone = this.track(new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.85 }));
		const waterJet = this.track(
			new THREE.MeshBasicMaterial({
				color: 0xbfe4ff,
				transparent: true,
				opacity: 0.7,
				toneMapped: false,
			}),
		);
		const ped = new THREE.Mesh(pedGeo, stone);
		ped.position.set(CX, GROUND_Y + 0.2, CZ);
		this.jet = new THREE.Mesh(jetGeo, waterJet);
		this.jet.position.set(CX, GROUND_Y + 0.38, CZ);
		this.splash = new THREE.Mesh(splashGeo, waterJet);
		this.splash.position.set(CX, GROUND_Y + 0.44, CZ);
		this.group.add(ped, this.jet, this.splash);
	}

	// ── eenden ─────────────────────────────────────────────

	/**
	 * Eén woerd met kekke groene kop en één badeend-geel exemplaar. Statisch —
	 * eenden die stilliggen zijn nog steeds eenden.
	 */
	private buildDucks(): void {
		const bodyGeo = new THREE.SphereGeometry(1, 10, 8);
		bodyGeo.scale(0.3, 0.22, 0.42);
		const headGeo = new THREE.SphereGeometry(0.15, 8, 6);
		const beakGeo = new THREE.ConeGeometry(0.055, 0.16, 6);
		beakGeo.rotateX(Math.PI / 2); // punt naar voren, zoals bij echte eenden
		const eyeGeo = new THREE.SphereGeometry(0.03, 6, 4);
		this.geometries.push(bodyGeo, headGeo, beakGeo, eyeGeo);
		const black = this.track(new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4 }));
		const makeDuck = (bodyHex: number, headHex: number, beakHex: number): THREE.Group => {
			const bodyMat = this.track(new THREE.MeshStandardMaterial({ color: bodyHex, roughness: 0.8 }));
			const headMat = this.track(new THREE.MeshStandardMaterial({ color: headHex, roughness: 0.8 }));
			const beakMat = this.track(new THREE.MeshStandardMaterial({ color: beakHex, roughness: 0.6 }));
			const d = new THREE.Group();
			d.add(new THREE.Mesh(bodyGeo, bodyMat));
			const head = new THREE.Mesh(headGeo, headMat);
			head.position.set(0, 0.24, 0.3);
			d.add(head);
			const beak = new THREE.Mesh(beakGeo, beakMat);
			beak.position.set(0, 0.22, 0.46);
			d.add(beak);
			for (const ex of [-0.07, 0.07]) {
				const eye = new THREE.Mesh(eyeGeo, black);
				eye.position.set(ex, 0.29, 0.39);
				d.add(eye);
			}
			return d;
		};
		const mallard = makeDuck(0x8a7355, 0x2e7d32, 0xffb300);
		mallard.position.set(CX + 1.4, GROUND_Y + 0.16, CZ + 1.6);
		mallard.rotation.y = 0.7;
		const duckling = makeDuck(0xffd54f, 0xffd54f, 0xff8f00);
		duckling.scale.setScalar(0.75);
		duckling.position.set(CX - 1.9, GROUND_Y + 0.13, CZ - 1.2);
		duckling.rotation.y = -1.9;
		this.group.add(mallard, duckling);
	}

	// ── gereedschap ────────────────────────────────────────

	/** Deterministische pseudo-random (Park–Miller). */
	private rnd(): number {
		this.seed = (this.seed * 16807) % 2147483647;
		return this.seed / 2147483647;
	}

	private track<T extends THREE.Material>(m: T): T {
		this.materials.push(m);
		return m;
	}
}
