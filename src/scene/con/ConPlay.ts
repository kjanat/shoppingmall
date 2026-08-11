import * as THREE from 'three';
import {
	CON_DEALERS,
	CON_FLOOR_Y,
	CON_HOTEL,
	CON_LOT,
	CON_PLAZA,
	CON_PORTAL,
	CON_STAGE,
	conBoothGrid,
	inRect2,
	rectCenter,
	rectInterior,
} from '#/data/conPlan';
import { lit } from '#/render/material';
import { backToBackLabel, fitText, labelCanvas, labelTexture } from '#/util/label';
import { midpoint } from '#/util/math';
import { at, mulberry32, pickWith } from '#/util/rand';

const BADGE_KEY = 'mallsim.con.badge.v1';
const GOT_KEY = 'mallsim.con.got.v1';

export type ConPlayResult = Readonly<{
	status: string;
	scoreDelta: number;
}>;

type Spot = Readonly<{
	id: string;
	x: number;
	z: number;
	radius: number;
	label: string;
	once?: string;
	needBadge?: boolean;
	run: (ctx: PlayCtx) => ConPlayResult;
}>;

type PlayCtx = {
	hasBadge: boolean;
	grantBadge: () => void;
	got: Set<string>;
	mark: (id: string) => void;
	done: number;
	goal: number;
};

const MERCH = [
	{ name: 'badge pin', pts: 3 },
	{ name: 'commission slot', pts: 5 },
	{ name: 'fursuit keychain', pts: 4 },
	{ name: 'pride bandana', pts: 3 },
	{ name: 'con T-shirt', pts: 6 },
	{ name: 'artist print', pts: 5 },
	{ name: 'paw sticker pack', pts: 2 },
	{ name: 'headshot sketch', pts: 7 },
	{ name: 'tail fluff sample', pts: 3 },
	{ name: 'knotty enamel pin', pts: 4 },
] as const;

const SNACKS = [
	{ name: 'tako set', pts: 4 },
	{ name: 'bunny bites', pts: 3 },
	{ name: 'pawbble tea', pts: 2 },
	{ name: 'hotdoggo', pts: 2 },
] as const;

const TRUCKS = [
	{ x: CON_PLAZA.minX + 8, z: CON_PLAZA.minZ + 8, name: 'Tako Truck' },
	{ x: CON_PLAZA.minX + 8, z: CON_PLAZA.maxZ - 8, name: 'Bunny Bites' },
	{ x: CON_PLAZA.minX + 18, z: CON_PLAZA.minZ + 10, name: 'Pawbble Tea' },
	{ x: CON_PLAZA.minX + 18, z: CON_PLAZA.maxZ - 10, name: 'Hotdoggo' },
] as const;

const VENDOR_NAMES = [
	'Yote Prints',
	'PawPress',
	'Knotty Knots',
	'Snuut Studio',
	'Tail&Scale',
	'Howl Goods',
	'Floof Co',
	'Murr Mart',
	'SoftPaws',
	'Den Den',
	'BarkByte',
	'Rainbow Ruff',
] as const;

const PANELS = [
	'How to sew a zipper that survives a rave',
	'Commission pricing without tears',
	'Headless lounge etiquette 101',
	'Photo consent & suit care',
] as const;

/**
 * Everything you can actually do at the con with E.
 */
export class ConPlay {
	readonly group = new THREE.Group();
	private readonly spots: Spot[];
	private readonly got = new Set<string>();
	private hasBadge = false;
	private dancing = false;
	private danceHold = new THREE.Vector3();
	private danceAcc = 0;
	private promptHud: HTMLDivElement | null = null;
	private questHud: HTMLDivElement | null = null;
	private readonly materials: THREE.Material[] = [];
	private readonly geometries: THREE.BufferGeometry[] = [];
	private readonly textures: THREE.Texture[] = [];
	private readonly unit = new THREE.BoxGeometry(1, 1, 1);
	private readonly goal: number;
	private readonly ring: THREE.Mesh;
	private readonly arrow: THREE.Mesh;
	private readonly regX = CON_PORTAL.innerX + 3.5;

	constructor() {
		this.group.name = 'con_play';
		this.geometries.push(this.unit);
		this.hasBadge = readFlag(BADGE_KEY);
		for (const id of readList(GOT_KEY)) this.got.add(id);
		this.spots = this.buildSpots();
		this.goal = this.spots.filter((s) => s.once).length + 1;
		this.buildRegistration();
		this.buildMarkers();
		this.buildQuestBoard();
		this.buildPath();
		const ringMat = new THREE.MeshBasicMaterial({
			color: 0x00ffcc,
			toneMapped: false,
			transparent: true,
			opacity: 0.85,
			side: THREE.DoubleSide,
		});
		const arrowMat = new THREE.MeshBasicMaterial({ color: 0xff66cc, toneMapped: false });
		this.materials.push(ringMat, arrowMat);
		const ringGeo = new THREE.RingGeometry(0.55, 0.85, 24);
		const arrowGeo = new THREE.ConeGeometry(0.35, 0.9, 6);
		this.geometries.push(ringGeo, arrowGeo);
		this.ring = new THREE.Mesh(ringGeo, ringMat);
		this.ring.rotation.x = -Math.PI / 2;
		this.ring.position.y = CON_FLOOR_Y + 0.12;
		this.ring.visible = false;
		this.group.add(this.ring);
		this.arrow = new THREE.Mesh(arrowGeo, arrowMat);
		this.arrow.position.y = CON_FLOOR_Y + 2.6;
		this.arrow.visible = false;
		this.group.add(this.arrow);
	}

	onLot(viewer: THREE.Vector3): boolean {
		return inRect2(CON_LOT, viewer.x, viewer.z);
	}

	/** Sticky objective for the main status bar. */
	activityHint(viewer: THREE.Vector3): string | null {
		if (!this.onLot(viewer)) return null;
		if (this.dancing) return '💃 Dancing · Esc leave · +score ticking';
		const near = this.nearest(viewer);
		if (near) {
			if (near.needBadge && !this.hasBadge) {
				return `🎫 E here needs badge · first: badge desk at doors (${Math.round(this.dist(viewer, this.regX, 0))} m)`;
			}
			return `E · ${near.label} · con ${this.progress()}/${this.goal}`;
		}
		const next = this.nextObjective(viewer);
		if (!next) return `🐾 Con complete-ish · ${this.progress()}/${this.goal} · roam pink poles / dealers`;
		const d = Math.round(this.dist(viewer, next.x, next.z));
		return `🐾 NEXT: ${next.label} · ${d} m that way · pink poles + cyan ring · E when close`;
	}

	update(dt: number, viewer: THREE.Vector3): ConPlayResult | null {
		this.refreshPrompt(viewer);
		this.refreshQuestHud(viewer);
		this.refreshNav(viewer, dt);
		if (!this.dancing) return null;
		this.danceAcc += dt;
		if (this.danceAcc < 2.5) return null;
		this.danceAcc = 0;
		return { status: '💃 Still dancing · Esc leave (+2)', scoreDelta: 2 };
	}

	promptAt(viewer: THREE.Vector3): string | null {
		if (this.dancing) return 'Esc · stop dancing';
		const spot = this.nearest(viewer);
		if (!spot) return null;
		return `E · ${spot.label}  ·  con ${this.progress()}/${this.goal}`;
	}

	inRange(viewer: THREE.Vector3): boolean {
		return this.dancing || this.nearest(viewer) !== null;
	}

	get joinAnchor(): THREE.Vector3 | null {
		return this.dancing ? this.danceHold : null;
	}

	tryLeave(): boolean {
		if (!this.dancing) return false;
		this.dancing = false;
		return true;
	}

	tryUse(viewer: THREE.Vector3): ConPlayResult | null {
		if (this.dancing) return null;
		const spot = this.nearest(viewer) ?? this.nearestLoose(viewer);
		if (!spot) {
			if (!this.onLot(viewer)) return null;
			const next = this.nextObjective(viewer);
			if (!next) return { status: `🐾 Walk to pink poles · con ${this.progress()}/${this.goal}`, scoreDelta: 0 };
			return {
				status: `🐾 Closer · ${next.label} is ${Math.round(this.dist(viewer, next.x, next.z))} m (cyan ring)`,
				scoreDelta: 0,
			};
		}
		if (spot.needBadge && !this.hasBadge) {
			return {
				status: '🎫 Need weekend badge first · cyan desk at MAIN DOORS · follow arrows',
				scoreDelta: 0,
			};
		}
		if (spot.once && this.got.has(spot.once)) {
			return { status: `Already done: ${spot.label} · con ${this.progress()}/${this.goal}`, scoreDelta: 0 };
		}
		const result = spot.run(this.ctx());
		if (spot.id === 'stage-dance' && result.scoreDelta >= 0) {
			this.dancing = true;
			this.danceHold.copy(viewer);
			this.danceAcc = 0;
		}
		return {
			...result,
			status: `${result.status} · con ${this.progress()}/${this.goal}`,
		};
	}

	dispose(): void {
		for (const m of this.materials) m.dispose();
		for (const g of this.geometries) g.dispose();
		for (const t of this.textures) t.dispose();
		this.promptHud?.remove();
		this.questHud?.remove();
	}

	private progress(): number {
		let n = this.hasBadge ? 1 : 0;
		for (const s of this.spots) {
			if (s.once && this.got.has(s.once)) n++;
		}
		return n;
	}

	private dist(viewer: THREE.Vector3, x: number, z: number): number {
		return Math.hypot(x - viewer.x, z - viewer.z);
	}

	private nextObjective(viewer: THREE.Vector3): Spot | null {
		const order = ['badge', 'guide', 'photo', 'food-0', 'meet-greet', 'stage-dance', 'hotel', 'raffle'];
		for (const id of order) {
			const spot = this.spots.find((s) => s.id === id);
			if (!spot) continue;
			if (id === 'badge' && this.hasBadge) continue;
			if (spot.once && this.got.has(spot.once)) continue;
			if (spot.needBadge && !this.hasBadge && id !== 'badge') continue;
			return spot;
		}
		let best: Spot | null = null;
		let bestD = Infinity;
		for (const spot of this.spots) {
			if (spot.id.startsWith('booth-') && Number(spot.id.slice(6)) % 8 !== 0) continue;
			if (spot.once && this.got.has(spot.once)) continue;
			if (spot.needBadge && !this.hasBadge) continue;
			if (spot.id === 'stage-dance') continue;
			const d = this.dist(viewer, spot.x, spot.z);
			if (d < bestD) {
				bestD = d;
				best = spot;
			}
		}
		return best;
	}

	private refreshNav(viewer: THREE.Vector3, dt: number): void {
		if (!this.onLot(viewer) || this.dancing) {
			this.ring.visible = false;
			this.arrow.visible = false;
			return;
		}
		const target = this.nearest(viewer) ?? this.nextObjective(viewer);
		if (!target) {
			this.ring.visible = false;
			this.arrow.visible = false;
			return;
		}
		this.ring.visible = true;
		this.ring.position.x = target.x;
		this.ring.position.z = target.z;
		const pulse = 1 + 0.12 * Math.sin(performance.now() * 0.006);
		this.ring.scale.setScalar(pulse);
		this.arrow.visible = true;
		this.arrow.position.x = target.x;
		this.arrow.position.z = target.z;
		this.arrow.position.y = CON_FLOOR_Y + 2.4 + 0.2 * Math.sin(performance.now() * 0.005);
		this.arrow.rotation.y += dt * 2.2;
		void viewer;
	}

	private refreshQuestHud(viewer: THREE.Vector3): void {
		if (!this.onLot(viewer)) {
			if (this.questHud) this.questHud.style.display = 'none';
			return;
		}
		if (!this.questHud) {
			const el = document.createElement('div');
			el.style.cssText =
				'position:fixed;top:12%;right:12px;z-index:55;width:min(280px,42vw);padding:10px 12px;background:rgba(40,0,30,.82);color:#ffe8f6;font:600 12px system-ui,sans-serif;border-radius:10px;pointer-events:none;border:1px solid #ff66cc;line-height:1.45';
			document.body.appendChild(el);
			this.questHud = el;
		}
		const lines = [
			`🐾 PRAIRIE FUR CON  ${this.progress()}/${this.goal}`,
			this.hasBadge ? '✓ weekend badge' : '○ E at BADGE desk (doors)',
			this.got.has('guide') ? '✓ con guide' : '○ E guide board',
			this.got.has('photo-op') ? '✓ pride photo' : '○ plaza photo op',
			this.got.has('food-0') || this.got.has('food-1') ? '✓ food truck' : '○ plaza food truck',
			this.got.has('meet-greet') ? '✓ meet & greet' : '○ dealers meet & greet',
			this.got.has('hotel-checkin') ? '✓ hotel' : '○ hotel check-in',
			'○ stage dance · booths · 18+ wing east',
			'Cyan ring = go here · E when prompt shows',
		];
		this.questHud.innerHTML = lines.map((l) => `<div>${l}</div>`).join('');
		this.questHud.style.display = 'block';
	}

	private ctx(): PlayCtx {
		return {
			hasBadge: this.hasBadge,
			grantBadge: () => {
				this.hasBadge = true;
				writeFlag(BADGE_KEY, true);
			},
			got: this.got,
			mark: (id) => {
				this.got.add(id);
				writeList(GOT_KEY, [...this.got]);
			},
			done: this.progress(),
			goal: this.goal,
		};
	}

	private nearest(viewer: THREE.Vector3): Spot | null {
		let best: Spot | null = null;
		let bestD = Infinity;
		for (const spot of this.spots) {
			const d = this.dist(viewer, spot.x, spot.z);
			if (d <= spot.radius && d < bestD) {
				bestD = d;
				best = spot;
			}
		}
		return best;
	}

	/** Slightly wider grab so E still does something near a pole. */
	private nearestLoose(viewer: THREE.Vector3): Spot | null {
		let best: Spot | null = null;
		let bestD = 5.5;
		for (const spot of this.spots) {
			if (spot.id.startsWith('booth-')) continue;
			const d = this.dist(viewer, spot.x, spot.z);
			if (d < bestD) {
				bestD = d;
				best = spot;
			}
		}
		return best;
	}

	private refreshPrompt(viewer: THREE.Vector3): void {
		const text = this.promptAt(viewer);
		if (!text) {
			if (this.promptHud) this.promptHud.style.display = 'none';
			return;
		}
		if (!this.promptHud) {
			const el = document.createElement('div');
			el.style.cssText =
				'position:fixed;left:50%;bottom:14%;transform:translateX(-50%);z-index:50;padding:8px 14px;background:rgba(80,0,60,.78);color:#fff;font:600 14px system-ui,sans-serif;border-radius:8px;pointer-events:none;border:1px solid #ff66cc;max-width:90vw;text-align:center';
			document.body.appendChild(el);
			this.promptHud = el;
		}
		this.promptHud.textContent = text;
		this.promptHud.style.display = 'block';
	}

	private buildSpots(): Spot[] {
		const spots: Spot[] = [];
		const regX = CON_PORTAL.innerX + 3.5;
		spots.push({
			id: 'badge',
			x: regX,
			z: 0,
			radius: 5.5,
			label: this.hasBadge ? 'badge desk (have badge)' : 'get WEEKEND BADGE',
			run: (ctx) => {
				if (ctx.hasBadge) return { status: '🎫 Badge already clipped on', scoreDelta: 0 };
				ctx.grantBadge();
				return { status: '🎫 WEEKEND BADGE clipped · welcome to Prairie Fur Con (+10)', scoreDelta: 10 };
			},
		});

		spots.push({
			id: 'guide',
			x: regX + 4,
			z: 5,
			radius: 4,
			label: 'read con guide',
			once: 'guide',
			run: (ctx) => {
				ctx.mark('guide');
				return {
					status: '📋 Guide: badge → dealers → stage → hotel → food · 18+ darkroom east of dealers (red door)',
					scoreDelta: 2,
				};
			},
		});

		const grid = conBoothGrid();
		const rand = mulberry32(0xdea1);
		let bi = 0;
		for (let row = 0; row < grid.rows; row++) {
			for (let col = 0; col < grid.cols; col++) {
				if ((row + col) % 2 !== 0) continue;
				const x = grid.startX + col * grid.pitchX;
				const z = grid.startZ + row * grid.pitchZ;
				const id = `booth-${bi}`;
				const vendor = at(VENDOR_NAMES, bi % VENDOR_NAMES.length);
				const merch = pickWith(MERCH, rand);
				bi++;
				spots.push({
					id,
					x,
					z,
					radius: 2.8,
					label: `buy @ ${vendor}`,
					needBadge: true,
					once: id,
					run: (ctx) => {
						ctx.mark(id);
						return {
							status: `🛒 ${vendor}: “${merch.name}” bagged (+${merch.pts})`,
							scoreDelta: merch.pts,
						};
					},
				});
			}
		}

		const stage = rectCenter(CON_STAGE);
		const stageIn = rectInterior(CON_STAGE);
		spots.push({
			id: 'stage-dance',
			x: stage.x,
			z: stage.z + 6,
			radius: 8,
			label: 'dance on MAIN STAGE',
			needBadge: true,
			run: () => ({ status: '💃 Floor is yours · techno goes hard · Esc leave', scoreDelta: 5 }),
		});
		spots.push({
			id: 'dj-shout',
			x: stage.x,
			z: stageIn.minZ + 4,
			radius: 4,
			label: 'request a shoutout',
			needBadge: true,
			once: 'dj-shout',
			run: (ctx) => {
				ctx.mark('dj-shout');
				return { status: '🔊 DJ: “THIS ONE’S FOR THE PRAIRIE PACK” · crowd howls (+8)', scoreDelta: 8 };
			},
		});
		spots.push({
			id: 'bar',
			x: stageIn.maxX - 8,
			z: stage.z,
			radius: 3.5,
			label: 'order at the stage bar',
			needBadge: true,
			once: 'stage-bar',
			run: (ctx) => {
				ctx.mark('stage-bar');
				return { status: '🍹 Pawsecco + glow stick · wet nose energy (+5)', scoreDelta: 5 };
			},
		});

		const hotel = rectCenter(CON_HOTEL);
		const hotelIn = rectInterior(CON_HOTEL);
		spots.push({
			id: 'hotel',
			x: hotel.x,
			z: hotelIn.minZ + 6,
			radius: 4,
			label: 'hotel check-in',
			needBadge: true,
			once: 'hotel-checkin',
			run: (ctx) => {
				ctx.mark('hotel-checkin');
				return { status: '🏨 Room key WOOF-420 · minibar free · party floor 4 (+8)', scoreDelta: 8 };
			},
		});
		spots.push({
			id: 'headless',
			x: hotel.x - 12,
			z: hotel.z,
			radius: 4,
			label: 'headless lounge',
			needBadge: true,
			once: 'headless',
			run: (ctx) => {
				ctx.mark('headless');
				return { status: '😌 Head off · water · fans · suiters nod at you (+6)', scoreDelta: 6 };
			},
		});
		spots.push({
			id: 'room-party',
			x: hotel.x + 14,
			z: hotel.z - 8,
			radius: 3.5,
			label: 'crash a room party',
			needBadge: true,
			once: 'room-party',
			run: (ctx) => {
				ctx.mark('room-party');
				return { status: '🎉 Floor 4 room party · someone handed you a glow collar (+7)', scoreDelta: 7 };
			},
		});

		for (let i = 0; i < TRUCKS.length; i++) {
			const t = at(TRUCKS, i);
			const id = `food-${i}`;
			const snack = at(SNACKS, i);
			spots.push({
				id,
				x: t.x,
				z: t.z,
				radius: 3.2,
				label: `eat @ ${t.name}`,
				once: id,
				run: (ctx) => {
					ctx.mark(id);
					return { status: `🍴 ${t.name}: ${snack.name} (+${snack.pts})`, scoreDelta: snack.pts };
				},
			});
		}

		const photoX = midpoint(CON_PLAZA.minX, CON_PLAZA.maxX);
		spots.push({
			id: 'photo',
			x: photoX,
			z: CON_PLAZA.minZ + 6,
			radius: 4,
			label: 'pride photo op',
			once: 'photo-op',
			run: (ctx) => {
				ctx.mark('photo-op');
				return { status: '📸 Con selfie under pride flags · posted (+5)', scoreDelta: 5 };
			},
		});
		spots.push({
			id: 'raffle',
			x: photoX,
			z: CON_PLAZA.maxZ - 8,
			radius: 3.5,
			label: 'con raffle ticket',
			needBadge: true,
			once: 'raffle',
			run: (ctx) => {
				ctx.mark('raffle');
				return { status: '🎟️ Raffle #42069 · grand prize is a free commission (+4)', scoreDelta: 4 };
			},
		});

		const dealers = rectCenter(CON_DEALERS);
		const dealIn = rectInterior(CON_DEALERS);
		spots.push({
			id: 'meet-greet',
			x: dealers.x,
			z: dealers.z,
			radius: 5,
			label: 'fursuit meet & greet',
			needBadge: true,
			once: 'meet-greet',
			run: (ctx) => {
				ctx.mark('meet-greet');
				return { status: '🫂 Group hug · 40 suiters · fabric softener cloud (+8)', scoreDelta: 8 };
			},
		});
		spots.push({
			id: 'conbook',
			x: dealIn.minX + 10,
			z: dealIn.minZ + 8,
			radius: 3.5,
			label: 'sign the con book',
			needBadge: true,
			once: 'conbook',
			run: (ctx) => {
				ctx.mark('conbook');
				return { status: '✍️ Signed as “local yote” · doodled a paw (+4)', scoreDelta: 4 };
			},
		});

		const panelSpots = [
			{ x: dealIn.maxX - 12, z: dealIn.minZ + 16 },
			{ x: dealIn.maxX - 12, z: dealIn.minZ + 40 },
			{ x: stageIn.minX + 18, z: stageIn.maxZ - 14 },
			{ x: stageIn.minX + 18, z: stageIn.maxZ - 36 },
		];
		for (let i = 0; i < PANELS.length; i++) {
			const topic = at(PANELS, i);
			const id = `panel-${i}`;
			const pos = at(panelSpots, i);
			spots.push({
				id,
				x: pos.x,
				z: pos.z,
				radius: 3.5,
				label: `sit panel: ${topic.slice(0, 28)}…`,
				needBadge: true,
				once: id,
				run: (ctx) => {
					ctx.mark(id);
					return { status: `🎤 Panel: “${topic}” · notes taken (+6)`, scoreDelta: 6 };
				},
			});
		}

		spots.push({
			id: 'highfive-n',
			x: dealers.x - 30,
			z: dealers.z + 20,
			radius: 3,
			label: 'high-five a suiter',
			needBadge: true,
			once: 'hf-n',
			run: (ctx) => {
				ctx.mark('hf-n');
				return { status: '✋ High-five · big paws · “yooo” (+3)', scoreDelta: 3 };
			},
		});
		spots.push({
			id: 'highfive-s',
			x: stage.x + 20,
			z: stage.z - 15,
			radius: 3,
			label: 'high-five a suiter',
			needBadge: true,
			once: 'hf-s',
			run: (ctx) => {
				ctx.mark('hf-s');
				return { status: '✋ Double high-five · tail wags (+3)', scoreDelta: 3 };
			},
		});
		spots.push({
			id: 'photo-wall',
			x: dealIn.minX + 8,
			z: dealers.z,
			radius: 3.5,
			label: 'artist alley photo wall',
			needBadge: true,
			once: 'photo-wall',
			run: (ctx) => {
				ctx.mark('photo-wall');
				return { status: '🖼️ Pose at the photo wall · flash goes off (+5)', scoreDelta: 5 };
			},
		});

		return spots;
	}

	private buildRegistration(): void {
		const desk = lit({ color: 0x3a2060, roughness: 0.3 });
		const neon = new THREE.MeshBasicMaterial({ color: 0x66ffcc, toneMapped: false });
		this.materials.push(desk, neon);
		const x = CON_PORTAL.innerX + 3.5;
		const counter = new THREE.Mesh(this.unit, desk);
		counter.scale.set(5.5, 1.1, 1.6);
		counter.position.set(x, CON_FLOOR_Y + 0.55, 0);
		this.group.add(counter);
		const poleL = new THREE.Mesh(this.unit, desk);
		poleL.scale.set(0.2, 2.2, 0.2);
		poleL.position.set(x - 2.4, CON_FLOOR_Y + 1.1, -1.2);
		this.group.add(poleL);
		const poleR = poleL.clone();
		poleR.position.z = 1.2;
		this.group.add(poleR);
		const banner = this.tag('BADGES · E HERE', 3.2, 0.5);
		banner.position.set(x, CON_FLOOR_Y + 2.35, 0);
		this.group.add(banner);
		const glow = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), neon);
		this.geometries.push(glow.geometry);
		glow.position.set(x, CON_FLOOR_Y + 2.9, 0);
		this.group.add(glow);
	}

	private buildQuestBoard(): void {
		const board = lit({ color: 0x1a1028, roughness: 0.85 });
		this.materials.push(board);
		const x = CON_PORTAL.innerX + 7.5;
		const z = 5;
		const mesh = new THREE.Mesh(this.unit, board);
		mesh.scale.set(0.18, 2.4, 3.2);
		mesh.position.set(x, CON_FLOOR_Y + 1.4, z);
		this.group.add(mesh);
		const face = this.tag('E = DO STUFF\nPINK = INTERACT\nBADGE FIRST', 2.8, 1.6);
		face.position.set(x - 0.12, CON_FLOOR_Y + 1.5, z);
		face.rotation.y = Math.PI / 2;
		this.group.add(face);
	}

	private buildPath(): void {
		const mat = new THREE.MeshBasicMaterial({
			color: 0xff44aa,
			toneMapped: false,
			transparent: true,
			opacity: 0.55,
		});
		this.materials.push(mat);
		const steps = 14;
		const x0 = CON_PLAZA.minX + 6;
		const x1 = this.regX;
		for (let i = 0; i < steps; i++) {
			const t = (i + 0.5) / steps;
			const x = x0 + (x1 - x0) * t;
			const chev = new THREE.Mesh(this.unit, mat);
			chev.scale.set(1.4, 0.04, 0.7);
			chev.position.set(x, CON_FLOOR_Y + 0.1, 0);
			this.group.add(chev);
			const tip = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.7, 3), mat);
			this.geometries.push(tip.geometry);
			tip.rotation.x = Math.PI / 2;
			tip.rotation.z = -Math.PI / 2;
			tip.position.set(x + 0.9, CON_FLOOR_Y + 0.12, 0);
			this.group.add(tip);
		}
		const doorArrow = this.tag('→ BADGES THIS WAY →', 6, 0.55);
		doorArrow.position.set(midpoint(x0, x1), CON_FLOOR_Y + 0.35, 2.2);
		doorArrow.rotation.x = -Math.PI / 2;
		this.group.add(doorArrow);
	}

	private buildMarkers(): void {
		const pole = lit({ color: 0xff66cc, roughness: 0.5 });
		const glow = new THREE.MeshBasicMaterial({ color: 0xff88dd, toneMapped: false });
		this.materials.push(pole, glow);
		const landmark = new Set([
			'badge',
			'guide',
			'stage-dance',
			'dj-shout',
			'bar',
			'hotel',
			'headless',
			'room-party',
			'photo',
			'raffle',
			'meet-greet',
			'conbook',
			'photo-wall',
		]);
		for (const spot of this.spots) {
			const isBooth = spot.id.startsWith('booth-');
			const boothN = isBooth ? Number(spot.id.slice(6)) : -1;
			if (isBooth && boothN % 6 !== 0) continue;
			if (
				!isBooth &&
				!landmark.has(spot.id) &&
				!spot.id.startsWith('panel-') &&
				!spot.id.startsWith('food-') &&
				!spot.id.startsWith('highfive')
			) {
				continue;
			}
			const p = new THREE.Mesh(this.unit, pole);
			p.scale.set(0.14, 1.6, 0.14);
			p.position.set(spot.x, CON_FLOOR_Y + 0.8, spot.z);
			this.group.add(p);
			const ball = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), glow);
			this.geometries.push(ball.geometry);
			ball.position.set(spot.x, CON_FLOOR_Y + 1.75, spot.z);
			this.group.add(ball);

			if (landmark.has(spot.id) || spot.id.startsWith('food-') || spot.id.startsWith('panel-')) {
				const short = spot.label.length > 28 ? `${spot.label.slice(0, 26)}…` : spot.label;
				const tag = this.tag(short.toUpperCase(), 2.6, 0.4);
				tag.position.set(spot.x, CON_FLOOR_Y + 2.25, spot.z);
				this.group.add(tag);
			}
		}
	}

	private tag(text: string, w = 2.4, h = 0.45): THREE.Object3D {
		const pxW = Math.max(160, Math.round(w * 100));
		const pxH = Math.max(48, Math.round(h * 100));
		const { canvas, ctx } = labelCanvas(pxW, pxH);
		ctx.fillStyle = '#3a0030';
		ctx.fillRect(0, 0, pxW, pxH);
		ctx.fillStyle = '#ffffff';
		fitText(ctx, text, { x: 6, y: 4, w: pxW - 12, h: pxH - 8 }, { size: Math.min(28, pxH * 0.4), maxLines: 3 });
		const tex = labelTexture(canvas);
		this.textures.push(tex);
		const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false });
		this.materials.push(mat);
		const geo = new THREE.PlaneGeometry(w, h);
		this.geometries.push(geo);
		return backToBackLabel(geo, mat);
	}
}

function readFlag(key: string): boolean {
	try {
		return sessionStorage.getItem(key) === '1';
	} catch {
		return false;
	}
}

function writeFlag(key: string, on: boolean): void {
	try {
		if (on) sessionStorage.setItem(key, '1');
		else sessionStorage.removeItem(key);
	} catch {
		/* private */
	}
}

function readList(key: string): string[] {
	try {
		const raw = sessionStorage.getItem(key);
		if (!raw) return [];
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((x): x is string => typeof x === 'string');
	} catch {
		return [];
	}
}

function writeList(key: string, list: string[]): void {
	try {
		sessionStorage.setItem(key, JSON.stringify(list));
	} catch {
		/* private */
	}
}
