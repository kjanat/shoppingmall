import * as THREE from 'three';

/**
 * PoolPeople: badgasten voor het dakeiland.
 *
 * Zelfde bouwdoos als de Catwalk-dames (hourglass-lathe, echte dijen), maar
 * dan in badkleding: bikini's in kleuren die je zonnebril nodig maken,
 * zwembandjes voor volwassenen die prima kunnen zwemmen maar het niet doen,
 * en vier identieke mannen in witte polo's die synchroon knikken alsof dat
 * een persoonlijkheid is. Het vaandel zegt AL ZUT. Niemand weet waarom.
 */

const DECK_Y = 13.95;
const WATER_Y = 13.75;

// Aanname: het zwembad zit rond het midden van het dek (x -32..-6, z -20..20),
// dus centrum ±(-19, 0) met een straal van ~5.5. Klopt het bad niet? Dan
// schuiven deze twee getallen en zit iedereen weer droog/nat naar behoren.
const POOL_X = -19;
const POOL_Z = 0;

const NOD_PERIOD = 5.5; // om de zoveel seconden vindt de crew iets goed
const NOD_TIME = 1.1;

type Rig = {
	root: THREE.Group;
	body: THREE.Group;
	legL: THREE.Group;
	legR: THREE.Group;
	armL: THREE.Group;
	armR: THREE.Group;
	head: THREE.Group;
};

type Swimmer = {
	root: THREE.Group;
	baseY: number;
	phase: number;
	speed: number;
	spin: number;
};

export class PoolPeople {
	readonly group = new THREE.Group();

	private materials: THREE.Material[] = [];
	private geos: THREE.BufferGeometry[] = [];
	private textures: THREE.Texture[] = [];
	private matCache = new Map<string, THREE.MeshStandardMaterial>();

	private readonly s: ReturnType<PoolPeople['buildShared']>;
	private swimmers: Swimmer[] = [];
	private crewHeads: THREE.Group[] = [];
	private oilArm: THREE.Group;
	private banner: THREE.Mesh;

	constructor() {
		this.group.name = 'poolPeople';
		this.s = this.buildShared();

		this.buildSunbathers();
		this.oilArm = this.buildOilLady();
		this.buildSwimmers();
		this.buildAlZutCrew();
		this.banner = this.buildParasol();
	}

	update(dt: number, t: number): void {
		// Dobberen: sinus op y, plus een tergend langzame draai (dt-gedreven,
		// zodat de rotatie framerate-onafhankelijk blijft).
		for (let i = 0; i < this.swimmers.length; i++) {
			const s = this.swimmers[i];
			s.root.position.y = s.baseY + Math.sin(t * s.speed + s.phase) * 0.055;
			s.root.rotation.y += s.spin * dt;
		}

		// AL ZUT CREW: af en toe synchroon knikken. Geen aanleiding, gewoon
		// vier mannen die het collectief ergens mee eens zijn.
		const c = t % NOD_PERIOD;
		const nod = c < NOD_TIME ? Math.sin((c / NOD_TIME) * Math.PI * 2) * 0.16 : 0;
		for (let i = 0; i < this.crewHeads.length; i++) {
			this.crewHeads[i].rotation.x = 0.04 + nod;
		}

		// De insmeerdame wrijft de oliefles over haar arm. Al twintig minuten.
		this.oilArm.rotation.x = -2.05 + Math.sin(t * 6.5) * 0.2;

		// Het vaandel wappert in wind die er op dakhoogte best zou kunnen zijn.
		this.banner.rotation.y = Math.sin(t * 2.1) * 0.1;
	}

	dispose(): void {
		for (const m of this.materials) m.dispose();
		for (const g of this.geos) g.dispose();
		for (const tx of this.textures) tx.dispose();
	}

	// ── gedeelde onderdelen ────────────────────────────────

	/** Eén set geometries voor iedereen — de Pi telt draw calls, geen dijen. */
	private buildShared() {
		// Hourglass-profiel in body-space: taille op de origin, schouders +0.54
		// (zelfde les als de Catwalk: onder→boven, anders kijk je door haar heen).
		const femaleProfile: THREE.Vector2[] = [
			new THREE.Vector2(0.001, -0.12),
			new THREE.Vector2(0.205, -0.12),
			new THREE.Vector2(0.2, -0.06), // heupflare
			new THREE.Vector2(0.115, 0.12), // taille
			new THREE.Vector2(0.135, 0.28), // onderbuste
			new THREE.Vector2(0.185, 0.4), // buste
			new THREE.Vector2(0.155, 0.54), // schouders
			new THREE.Vector2(0.055, 0.62), // nek
			new THREE.Vector2(0.001, 0.62),
		];
		// Mannenprofiel: minder zandloper, meer koelkast met schouders.
		const maleProfile: THREE.Vector2[] = [
			new THREE.Vector2(0.001, -0.12),
			new THREE.Vector2(0.195, -0.12),
			new THREE.Vector2(0.185, 0.02),
			new THREE.Vector2(0.165, 0.16),
			new THREE.Vector2(0.195, 0.34),
			new THREE.Vector2(0.215, 0.5), // schouders
			new THREE.Vector2(0.15, 0.57),
			new THREE.Vector2(0.055, 0.62),
			new THREE.Vector2(0.001, 0.62),
		];
		return {
			torsoF: this.geo(new THREE.LatheGeometry(femaleProfile, 18)),
			torsoM: this.geo(new THREE.LatheGeometry(maleProfile, 14)),
			pelvis: this.geo(new THREE.SphereGeometry(0.185, 14, 10)),
			bust: this.geo(new THREE.SphereGeometry(0.115, 12, 10)),
			thigh: this.geo(new THREE.CapsuleGeometry(0.105, 0.34, 5, 9)),
			calf: this.geo(new THREE.CapsuleGeometry(0.068, 0.28, 5, 8)),
			foot: this.geo(new THREE.BoxGeometry(0.1, 0.05, 0.22)),
			upperArm: this.geo(new THREE.CapsuleGeometry(0.052, 0.24, 4, 7)),
			lowerArm: this.geo(new THREE.CapsuleGeometry(0.042, 0.22, 4, 7)),
			hand: this.geo(new THREE.SphereGeometry(0.045, 8, 6)),
			skull: this.geo(new THREE.SphereGeometry(0.125, 14, 12)),
			neck: this.geo(new THREE.CylinderGeometry(0.045, 0.05, 0.12, 8)),
			lips: this.geo(new THREE.SphereGeometry(0.03, 10, 8)),
			hairLong: this.geo(new THREE.CapsuleGeometry(0.115, 0.34, 6, 12)),
			fringe: this.geo(
				new THREE.SphereGeometry(0.132, 12, 8, Math.PI * 0.22, Math.PI * 1.56, 0, Math.PI * 0.55),
			),
			bun: this.geo(new THREE.SphereGeometry(0.078, 10, 8)),
			capHair: this.geo(new THREE.SphereGeometry(0.128, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.45)),
			// Sportzonnebril: één brede lens plus zwart bandje rond de kop.
			lens: this.geo(new THREE.BoxGeometry(0.17, 0.05, 0.05)),
			band: this.geo(new THREE.TorusGeometry(0.13, 0.011, 6, 16)),
			chain: this.geo(new THREE.TorusGeometry(0.08, 0.011, 6, 14)),
			collar: this.geo(new THREE.TorusGeometry(0.062, 0.014, 6, 12)),
			bikiniBand: this.geo(new THREE.TorusGeometry(0.165, 0.018, 6, 14)),
			bikiniCup: this.geo(new THREE.SphereGeometry(0.062, 8, 6)),
			armband: this.geo(new THREE.TorusGeometry(0.075, 0.028, 6, 12)),
			ring: this.geo(new THREE.TorusGeometry(0.36, 0.11, 8, 18)),
			loungerLeg: this.geo(new THREE.BoxGeometry(0.06, 0.32, 1.15)),
			loungerSeat: this.geo(new THREE.BoxGeometry(0.68, 0.06, 1.4)),
			loungerBack: this.geo(new THREE.BoxGeometry(0.68, 0.06, 0.7)),
			towel: this.geo(new THREE.BoxGeometry(0.6, 0.015, 1.3)),
			bottle: this.geo(new THREE.CylinderGeometry(0.032, 0.038, 0.15, 8)),
			bottleCap: this.geo(new THREE.CylinderGeometry(0.012, 0.012, 0.05, 6)),
			pole: this.geo(new THREE.CylinderGeometry(0.035, 0.035, 2.7, 8)),
			canopy: this.geo(new THREE.ConeGeometry(0.95, 0.4, 10)),
			bannerPlane: this.geo(new THREE.PlaneGeometry(0.85, 0.55)),
		};
	}

	// ── figuren ────────────────────────────────────────────

	/** Basisrig: voeten op root y=0, heupscharnier op 0.9, taille op 1.0. */
	private buildRig(
		torsoGeo: THREE.BufferGeometry,
		torsoMat: THREE.Material,
		skinMat: THREE.Material,
		footMat: THREE.Material,
	): Rig {
		const root = new THREE.Group();

		const hips = new THREE.Group();
		hips.position.y = 0.9;
		root.add(hips);

		const makeLeg = (side: -1 | 1): THREE.Group => {
			const leg = new THREE.Group();
			leg.position.set(side * 0.085, 0, 0);
			const thigh = new THREE.Mesh(this.s.thigh, skinMat);
			thigh.position.y = -0.22;
			leg.add(thigh);
			const calf = new THREE.Mesh(this.s.calf, skinMat);
			calf.position.y = -0.63;
			leg.add(calf);
			// Teenslipper of blote voet — de badstranduniform.
			const foot = new THREE.Mesh(this.s.foot, footMat);
			foot.position.set(0, -0.85, 0.05);
			leg.add(foot);
			hips.add(leg);
			return leg;
		};
		const legL = makeLeg(-1);
		const legR = makeLeg(1);

		const body = new THREE.Group();
		body.position.y = 1.0;
		root.add(body);
		const torso = new THREE.Mesh(torsoGeo, torsoMat);
		body.add(torso);

		const makeArm = (side: -1 | 1): THREE.Group => {
			const arm = new THREE.Group();
			arm.position.set(side * 0.185, 0.52, 0);
			const upper = new THREE.Mesh(this.s.upperArm, skinMat);
			upper.position.y = -0.17;
			arm.add(upper);
			const lower = new THREE.Mesh(this.s.lowerArm, skinMat);
			lower.position.y = -0.43;
			arm.add(lower);
			const hand = new THREE.Mesh(this.s.hand, skinMat);
			hand.scale.set(0.85, 1.15, 0.85);
			hand.position.y = -0.58;
			arm.add(hand);
			body.add(arm);
			return arm;
		};
		const armL = makeArm(-1);
		const armR = makeArm(1);

		const head = new THREE.Group();
		head.position.y = 0.78;
		body.add(head);
		const skull = new THREE.Mesh(this.s.skull, skinMat);
		head.add(skull);
		const neck = new THREE.Mesh(this.s.neck, skinMat);
		neck.position.y = -0.14;
		head.add(neck);

		this.group.add(root);
		return { root, body, legL, legR, armL, armR, head };
	}

	/** Sportzonnebril met zwart bandje — niemand kijkt hier iemand aan. */
	private addShades(head: THREE.Group): void {
		const dark = this.mat(0x121212, 0.3, 0.35);
		const lens = new THREE.Mesh(this.s.lens, dark);
		lens.position.set(0, 0.02, 0.095);
		head.add(lens);
		const band = new THREE.Mesh(this.s.band, dark);
		band.rotation.x = Math.PI / 2;
		band.position.y = 0.02;
		head.add(band);
	}

	private buildWoman(
		skinColor: number,
		kitColor: number,
		hairColor: number,
		hairStyle: 'long' | 'bun',
	): Rig {
		const skin = this.mat(skinColor, 0.72);
		const kit = this.mat(kitColor, 0.45, 0.1);
		const rig = this.buildRig(this.s.torsoF, skin, skin, kit);

		// Bikinibroekje: het bekken in felle kleur, klaar.
		const pelvis = new THREE.Mesh(this.s.pelvis, kit);
		pelvis.scale.set(1.05, 0.62, 0.92);
		pelvis.position.y = 0.96;
		rig.root.add(pelvis);

		// Buste plus bikinitop: bandje rondom, twee cups ervoor. PG, cartoon.
		const bust = new THREE.Mesh(this.s.bust, skin);
		bust.scale.set(1.15, 0.68, 0.8);
		bust.position.set(0, 0.4, 0.095);
		rig.body.add(bust);
		const bikBand = new THREE.Mesh(this.s.bikiniBand, kit);
		bikBand.rotation.x = Math.PI / 2;
		bikBand.position.y = 0.38;
		rig.body.add(bikBand);
		for (const side of [-1, 1] as const) {
			const cup = new THREE.Mesh(this.s.bikiniCup, kit);
			cup.scale.set(1, 0.85, 0.7);
			cup.position.set(side * 0.068, 0.4, 0.125);
			rig.body.add(cup);
		}

		const lips = new THREE.Mesh(this.s.lips, this.mat(0xc2185b, 0.35));
		lips.scale.set(1.4, 0.65, 0.5);
		lips.position.set(0, -0.052, 0.114);
		rig.head.add(lips);
		this.addShades(rig.head);

		const hairMat = this.mat(hairColor, 0.78);
		const fringe = new THREE.Mesh(this.s.fringe, hairMat);
		fringe.position.y = 0.02;
		rig.head.add(fringe);
		if (hairStyle === 'long') {
			const hair = new THREE.Mesh(this.s.hairLong, hairMat);
			hair.position.set(0, -0.08, -0.06);
			rig.head.add(hair);
		} else {
			const bun = new THREE.Mesh(this.s.bun, hairMat);
			bun.position.set(0, 0.1, -0.1);
			rig.head.add(bun);
		}
		return rig;
	}

	private buildMan(skinColor: number, torsoMat: THREE.Material, shortsColor: number): Rig {
		const skin = this.mat(skinColor, 0.72);
		const shorts = this.mat(shortsColor, 0.6);
		const rig = this.buildRig(this.s.torsoM, torsoMat, skin, skin);

		// Zwembroek/korte broek: bekken iets hoger geschaald zodat het kledt.
		const pelvis = new THREE.Mesh(this.s.pelvis, shorts);
		pelvis.scale.set(1.05, 0.75, 0.95);
		pelvis.position.y = 0.93;
		rig.root.add(pelvis);

		const hairMat = this.mat(0x1a1a1a, 0.8);
		const cap = new THREE.Mesh(this.s.capHair, hairMat);
		cap.position.y = 0.015;
		rig.head.add(cap);
		this.addShades(rig.head);
		return rig;
	}

	// ── zonaanbidsters ─────────────────────────────────────

	/** Achterover op de ligstoel, benen vooruit (+z), hoofd richting rugleuning. */
	private poseLying(rig: Rig): void {
		rig.legL.rotation.x = -1.45;
		rig.legR.rotation.x = -1.42;
		rig.body.rotation.x = -0.6;
		rig.head.rotation.x = -0.25;
		rig.armL.rotation.set(-0.2, 0, 0.35);
		rig.armR.rotation.set(-0.2, 0, -0.35);
	}

	/** Op de badrand, kuiten in het (aangenomen) water. */
	private poseSitting(rig: Rig): void {
		rig.legL.rotation.x = -1.0;
		rig.legR.rotation.x = -0.92;
		rig.armL.rotation.set(0.5, 0, 0.35);
		rig.armR.rotation.set(0.5, 0, -0.35);
		rig.head.rotation.x = 0.06;
	}

	private buildSunbathers(): void {
		const frameMat = this.mat(0xf2f2ee, 0.5);
		const towelColors = [0xff5b8d, 0x00bcd4, 0xffca28];
		const loungerX = [-24, -21.2, -18.4];
		const looks: [number, number, number, 'long' | 'bun'][] = [
			[0x8d5524, 0xff2d78, 0x111111, 'long'],
			[0xf0c9a8, 0x00e5ff, 0xf3e0a0, 'long'],
			[0x5c3a21, 0xffea00, 0x1a1a1a, 'bun'],
		];

		for (let i = 0; i < 3; i++) {
			// Ligstoel: twee sledes, ligvlak, schuine rugleuning, handdoek erop.
			const lounger = new THREE.Group();
			lounger.position.set(loungerX[i], DECK_Y, -9.8);
			for (const side of [-1, 1] as const) {
				const leg = new THREE.Mesh(this.s.loungerLeg, frameMat);
				leg.position.set(side * 0.3, 0.16, 0);
				lounger.add(leg);
			}
			const seat = new THREE.Mesh(this.s.loungerSeat, frameMat);
			seat.position.y = 0.35;
			lounger.add(seat);
			const back = new THREE.Mesh(this.s.loungerBack, frameMat);
			back.position.set(0, 0.55, -0.78);
			back.rotation.x = 1.0;
			lounger.add(back);
			const towel = new THREE.Mesh(this.s.towel, this.mat(towelColors[i], 0.9));
			towel.position.y = 0.39;
			lounger.add(towel);
			this.group.add(lounger);

			const [skin, kit, hair, style] = looks[i];
			const rig = this.buildWoman(skin, kit, hair, style);
			rig.root.position.set(loungerX[i], DECK_Y + 0.41 - 0.9, -9.95);
			this.poseLying(rig);
			// Nummer twee heeft een arm achter het hoofd. Maximale ontspanning.
			if (i === 1) rig.armR.rotation.set(-0.5, 0, -2.7);
		}

		// Twee dames op de badrand: één zuid (kijkt noord), één oost (kijkt west).
		const rimA = this.buildWoman(0x6b4423, 0x76ff03, 0x2b1b12, 'long');
		rimA.root.position.set(POOL_X - 2, DECK_Y - 0.85, POOL_Z - 5.9);
		this.poseSitting(rimA);

		const rimB = this.buildWoman(0xd9a377, 0xff6d00, 0x8d4a2f, 'bun');
		rimB.root.position.set(POOL_X + 5.9, DECK_Y - 0.85, POOL_Z + 1.6);
		rimB.root.rotation.y = -Math.PI / 2;
		this.poseSitting(rimB);
	}

	/** De dame die zich insmeert. Retourneert de smeerarm voor update(). */
	private buildOilLady(): THREE.Group {
		const rig = this.buildWoman(0xa9714b, 0xaa00ff, 0x111111, 'long');
		rig.root.position.set(-25.5, DECK_Y, -12.5);
		rig.root.rotation.y = 0.35;

		// Rechterarm opzij: het werkoppervlak. Linkerarm smeert (zie update).
		rig.armR.rotation.set(0, 0, -1.25);
		rig.armL.rotation.set(-2.05, 0, 0.5);

		// Oliefles-prop in de smeerhand, factor 30 zon, factor 0 bescherming.
		const bottle = new THREE.Group();
		const fles = new THREE.Mesh(this.s.bottle, this.mat(0xe07b1f, 0.35, 0.1));
		bottle.add(fles);
		const dop = new THREE.Mesh(this.s.bottleCap, this.mat(0xf6f6f2, 0.5));
		dop.position.y = 0.095;
		bottle.add(dop);
		bottle.position.set(0, -0.58, 0.04);
		bottle.rotation.z = -0.4;
		rig.armL.add(bottle);

		return rig.armL;
	}

	// ── zwemmers ───────────────────────────────────────────

	private buildSwimmers(): void {
		const bandMat = this.mat(0xff8c1a, 0.5, 0.1);
		const casts: {
			x: number;
			z: number;
			man: boolean;
			skin: number;
			kit: number;
			ring: boolean;
		}[] = [
			{ x: POOL_X - 1.8, z: POOL_Z - 1.8, man: false, skin: 0x8d5524, kit: 0x00e5ff, ring: false },
			{ x: POOL_X + 1.6, z: POOL_Z + 1.4, man: false, skin: 0xe8bd97, kit: 0xff2d78, ring: false },
			{ x: POOL_X - 0.6, z: POOL_Z + 2.7, man: true, skin: 0x5c3a21, kit: 0x0aa14b, ring: false },
			{ x: POOL_X + 2.4, z: POOL_Z - 2.3, man: false, skin: 0xd9a377, kit: 0xffea00, ring: true },
		];

		for (let i = 0; i < casts.length; i++) {
			const c = casts[i];
			const rig = c.man
				? this.buildMan(c.skin, this.mat(c.skin, 0.72), c.kit)
				: this.buildWoman(c.skin, c.kit, i % 2 === 0 ? 0x111111 : 0x8d4a2f, 'bun');

			// Zwembandjes om de bovenarmen — volwassen mensen, nul vertrouwen.
			for (const arm of [rig.armL, rig.armR]) {
				const band = new THREE.Mesh(this.s.armband, bandMat);
				band.rotation.x = Math.PI / 2;
				band.position.y = -0.12;
				arm.add(band);
			}
			rig.armL.rotation.set(-0.2, 0, 1.25);
			rig.armR.rotation.set(-0.2, 0, -1.25);
			// Benen ietsje naar achteren gevouwen; het water doet de rest.
			rig.legL.rotation.x = 0.5;
			rig.legR.rotation.x = 0.42;

			let baseY = WATER_Y - 1.15; // borst op de waterlijn
			if (c.ring) {
				baseY = WATER_Y - 0.9; // in de band hang je hoger
				const ring = new THREE.Mesh(this.s.ring, this.mat(0xff5b8d, 0.45, 0.1));
				ring.rotation.x = Math.PI / 2;
				ring.position.y = 0.92;
				rig.root.add(ring);
			}
			rig.root.position.set(c.x, baseY, c.z);
			rig.root.rotation.y = i * 1.7;

			this.swimmers.push({
				root: rig.root,
				baseY,
				phase: i * 1.9,
				speed: 1.1 + i * 0.17,
				spin: (i % 2 === 0 ? 1 : -1) * (0.1 + i * 0.04),
			});
		}
	}

	// ── AL ZUT CREW ────────────────────────────────────────

	private buildAlZutCrew(): void {
		// Vier mannen, identieke witte polo's, gouden kettingen, zonnebrillen.
		// Ze staan bij de tiki-bar en zijn het overal collectief mee eens.
		const polo = this.mat(0xf6f6f2, 0.55);
		const gold = this.mat(0xd4af37, 0.25, 0.9);
		const skins = [0xe8bd97, 0x8d5524, 0xd9a377, 0x5c3a21];

		for (let i = 0; i < 4; i++) {
			const rig = this.buildMan(skins[i], polo, 0x1c2a4a);
			rig.root.position.set(-12.9 + i * 1.4, DECK_Y, 15.2);
			rig.root.rotation.y = (i - 1.5) * 0.12; // losjes naar de bar gedraaid

			// Polokraagje plus ketting — het uniform van de vereniging.
			const collar = new THREE.Mesh(this.s.collar, polo);
			collar.rotation.x = Math.PI / 2;
			collar.position.y = 0.56;
			rig.body.add(collar);
			const chain = new THREE.Mesh(this.s.chain, gold);
			chain.rotation.x = 1.3;
			chain.position.set(0, 0.44, 0.08);
			rig.body.add(chain);

			rig.armL.rotation.set(-0.1, 0, 0.18);
			rig.armR.rotation.set(-0.1, 0, -0.18);
			this.crewHeads.push(rig.head);
		}
	}

	/** Parasolpaal naast de crew, met het clubvaandel. Retourneert het vaandel. */
	private buildParasol(): THREE.Mesh {
		const post = new THREE.Group();
		post.position.set(-14.3, DECK_Y, 15.2);

		const paal = new THREE.Mesh(this.s.pole, this.mat(0x8a6a45, 0.7));
		paal.position.y = 1.35;
		post.add(paal);
		const kap = new THREE.Mesh(this.s.canopy, this.mat(0xc9a05a, 0.85));
		kap.position.y = 2.75;
		post.add(kap);

		// Het vaandel: AL ZUT. Wat het betekent weet alleen de crew, en die knikt.
		const canvas = document.createElement('canvas');
		canvas.width = 256;
		canvas.height = 160;
		const ctx = canvas.getContext('2d')!;
		ctx.fillStyle = '#f2e8d5';
		ctx.fillRect(0, 0, 256, 160);
		ctx.strokeStyle = '#1b2a6b';
		ctx.lineWidth = 10;
		ctx.strokeRect(5, 5, 246, 150);
		ctx.fillStyle = '#1b2a6b';
		ctx.textAlign = 'center';
		ctx.font = '900 58px system-ui,sans-serif';
		ctx.fillText('AL ZUT', 128, 100);
		const tex = new THREE.CanvasTexture(canvas);
		tex.colorSpace = THREE.SRGBColorSpace;
		this.textures.push(tex);
		const vaandelMat = new THREE.MeshBasicMaterial({
			map: tex,
			toneMapped: false,
			side: THREE.DoubleSide,
		});
		this.materials.push(vaandelMat);
		const vaandel = new THREE.Mesh(this.s.bannerPlane, vaandelMat);
		vaandel.position.set(0.48, 2.1, 0);
		post.add(vaandel);

		this.group.add(post);
		return vaandel;
	}

	// ── boekhouding ────────────────────────────────────────

	private mat(color: number, roughness = 0.8, metalness = 0.05): THREE.MeshStandardMaterial {
		const key = `${color}:${roughness}:${metalness}`;
		const hit = this.matCache.get(key);
		if (hit) return hit;
		const m = new THREE.MeshStandardMaterial({ color, roughness, metalness });
		this.materials.push(m);
		this.matCache.set(key, m);
		return m;
	}

	private geo<T extends THREE.BufferGeometry>(g: T): T {
		this.geos.push(g);
		return g;
	}
}
