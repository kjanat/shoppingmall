import * as THREE from 'three';
import { lit } from '#/render/material';
import { labelCanvas, labelTexture } from '#/util/label';

/**
 * PRAIRIE THEATRE — monumentaal cultuurpaleis op het NO-blok (x 56..88, z -68..-44).
 *
 * Zuilen, brede trap, marquee met 40 chase-lampjes en een rood tapijt tot de
 * stoep. Vanavond: De Baard-Dief. Uitverkocht, uiteraard — de hele stad heeft
 * kaartjes en niemand komt, want niemand woont hier (zie CityBuildings).
 *
 * Pi-budget: geen lampen, alleen emissive/basic. De chase loopt via
 * instanceColor op één InstancedMesh en schrijft alleen als de tik verspringt.
 */

/** Seconde per chase-stap. Om de tik wisselt ook de kleur — dat heet dramaturgie. */
const CHASE_TICK = 0.32;
const BULB_COUNT = 40;

export class CityTheatre {
	readonly group = new THREE.Group();

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

	constructor() {
		this.group.name = 'city_theatre';

		this.unitBox = new THREE.BoxGeometry(1, 1, 1);
		this.unitPlane = new THREE.PlaneGeometry(1, 1);
		this.geometries.push(this.unitBox, this.unitPlane);

		this.buildBlok();
		this.buildZuilen();
		this.bulbs = this.buildMarquee();
		this.titleMat = this.buildBorden();
		this.buildTapijt();
		this.applyChase(0);
	}

	update(dt: number, t: number): void {
		const step = Math.floor(t / CHASE_TICK);
		if (step !== this.lastStep) {
			this.lastStep = step;
			this.applyChase(step);
		}
		// Naambord dimt licht mee op de offbeat; ease op dt zodat een framedrop
		// op de Pi geen stroboscoop van maakt.
		const target = step % 2 === 0 ? 1 : 0.82;
		this.titleLevel += (target - this.titleLevel) * Math.min(1, dt * 6);
		this.titleMat.color.setScalar(this.titleLevel);
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

		// Zaalblok: x 58..86, z -66..-52, 13 hoog. Ramen heeft een theater niet nodig.
		this.box(steen, 28, 13, 14, 72, 6.5, -59);
		this.box(steen, 29.5, 0.9, 15.5, 72, 13.45, -59); // kroonlijst
		this.box(steen, 12, 2.4, 9, 72, 14.9, -59.5); // attiek — voor de toneeltoren-suggestie

		// Podium (het buiten-soort) met brede trap naar de stoep.
		const podium = this.box(donker, 30, 1.5, 5, 72, 0.75, -49.5);
		podium.receiveShadow = true;
		for (let i = 0; i < 4; i++) {
			const top = 1.2 - 0.3 * i;
			const tree = this.box(donker, 20, top, 0.6, 72, top * 0.5, -46.7 + 0.6 * i);
			tree.receiveShadow = true;
		}

		// Drie dubbele deuren; dicht, want de voorstelling is al begonnen.
		for (const dx of [68, 72, 76]) {
			this.box(deur, 2.2, 3.6, 0.15, dx, 3.3, -51.9);
		}
	}

	/** Acht zuilen + basementen + kapitelen (instanced) en het hoofdgestel. */
	private buildZuilen(): void {
		const steen = lit({ color: 0xd8cfba, roughness: 0.85, metalness: 0.02 });
		this.materials.push(steen);

		const zuilGeo = new THREE.CylinderGeometry(0.55, 0.6, 8.1, 10);
		this.geometries.push(zuilGeo);
		const zuilen = new THREE.InstancedMesh(zuilGeo, steen, 8);
		zuilen.name = 'theatre_zuilen';
		const blokjes = new THREE.InstancedMesh(this.unitBox, steen, 16);
		blokjes.name = 'theatre_kapitelen';

		for (let i = 0; i < 8; i++) {
			const x = 61.5 + i * 3;
			this.dummy.rotation.set(0, 0, 0);
			this.dummy.position.set(x, 5.55, -50.6);
			this.dummy.scale.set(1, 1, 1);
			this.dummy.updateMatrix();
			zuilen.setMatrixAt(i, this.dummy.matrix);
			// Basement op het podium, kapiteel onder het hoofdgestel.
			this.dummy.position.set(x, 1.72, -50.6);
			this.dummy.scale.set(1.5, 0.45, 1.5);
			this.dummy.updateMatrix();
			blokjes.setMatrixAt(i * 2, this.dummy.matrix);
			this.dummy.position.set(x, 9.8, -50.6);
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
}
