import type { BufferGeometry, Material, Texture, Vector3 } from 'three';
import {
	BoxGeometry,
	CapsuleGeometry,
	Color,
	CylinderGeometry,
	DynamicDrawUsage,
	Group,
	InstancedBufferAttribute,
	InstancedMesh,
	Mesh,
	MeshBasicMaterial,
	Object3D,
	PlaneGeometry,
	SphereGeometry,
} from 'three';
import { lit } from '#/render/material';
import { FAVELA_PLAN, favelaContourXs, favelaGroundY, favelaIsStreet, RIO_MOUNTAIN } from '#/scene/city/cityPlan';
import { backToBackLabel, fitText, labelCanvas, labelTexture } from '#/util/label';
import { half, lerp, midpoint, span } from '#/util/math';
import { at, mulberry32, pickWith, plusMinusWith } from '#/util/rand';

type BoxCollider = Readonly<{
	minX: number;
	maxX: number;
	minZ: number;
	maxZ: number;
	minY: number;
	maxY: number;
	label: string;
}>;

type Shack = Readonly<{
	x: number;
	z: number;
	y: number;
	w: number;
	d: number;
	h: number;
	rot: number;
	wall: number;
	roof: number;
}>;

/** Wall paints — sun-bleached stucco, turquoise doors energy, pink, mustard. */
const WALL_COLORS = [
	0xe8c4a0, 0xd4a574, 0xc9a0a0, 0x7eb8a8, 0x6b9ec4, 0xe8a0b8, 0xd4c060, 0xb0a090, 0x9a7a5a, 0xf0d0a0, 0x88a878, 0xc07060,
] as const;

/** Corrugated tin: rust, zinc, charcoal. */
const ROOF_COLORS = [0x6a5040, 0x8a7060, 0x4a4a48, 0x5a3a28, 0x707068, 0x3a3830] as const;

/** Upper shack sits this far up the lower box (fraction of lower height). */
const UPPER_STACK_Y = 0.55;
/** Cell jitter: house sits this fraction into the grid cell from the edge. */
const CELL_INSET = 0.25;
/** Cell jitter span inside a cell (1 − 2×inset). */
const CELL_JITTER = 1 - CELL_INSET * 2;
/** Extra storey height noise on stacked rooms. */
const UPPER_H_NOISE = 0.5;

/** Window glow pulse mix. */
const WINDOW_PULSE_BASE = 0.55;
const WINDOW_PULSE_SPAN = 0.45;

const GANG_SEED = 0xb3ed05;
const GANG_COUNT = 3;
const MEMBERS_PER_GANG = 11;
const GANG_TOTAL = GANG_COUNT * MEMBERS_PER_GANG;
const TWINK_SEED = 0x71eef5;
const TWINK_COUNT = 22;
const INTERACT_R = 3.2;
const PATROL_SPEED = 1.35;
const TWINK_SPEED = 1.05;
const TWINK_SCALE = 0.88;
const SLOP_COLOR = 0x6b7a3a;
const HEAD_LEAN = 0.5;

type FavelaGangResult = Readonly<{ status: string; scoreDelta: number }>;

type GangDef = Readonly<{
	id: string;
	name: string;
	color: number;
	/** Tag / shirt accent. */
	accent: number;
	/** z-band fraction of favela for home turf (0 south → 1 north). */
	z0: number;
	z1: number;
	lines: readonly string[];
}>;

const GANGS: readonly GangDef[] = [
	{
		id: 'vermelhos',
		name: 'Os Vermelhos',
		color: 0xb91c1c,
		accent: 0xfef08a,
		z0: 0.55,
		z1: 1,
		lines: ['Pedágio, amigo.', 'This alley is red.', 'Respect the hill.', 'You lost, tourist?'],
	},
	{
		id: 'azuis',
		name: 'Comando Azul',
		color: 0x1d4ed8,
		accent: 0x93c5fd,
		z0: 0,
		z1: 0.45,
		lines: ['Blue side, keep moving.', 'We run the lower steps.', 'Pay up or walk around.', "Azuis don't share."],
	},
	{
		id: 'dourados',
		name: 'Os Dourados',
		color: 0xca8a04,
		accent: 0xfde68a,
		z0: 0.3,
		z1: 0.7,
		lines: ['Gold on the ridge.', 'Watch the rooftops.', 'You see the mountain? Ours too.', 'Shine or leave.'],
	},
] as const;

interface Gangster {
	gang: number;
	x: number;
	z: number;
	y: number;
	yaw: number;
	phase: number;
	pathI: number;
	path: readonly { x: number; z: number }[];
	mode: 'patrol' | 'idle' | 'lookout';
	cooldown: number;
}

interface Twink {
	x: number;
	z: number;
	y: number;
	yaw: number;
	phase: number;
	pathI: number;
	path: readonly { x: number; z: number }[];
	mode: 'wander' | 'lounge' | 'slop' | 'dance';
	skin: number;
	hair: number;
	crop: number;
	shorts: number;
	slop: boolean;
	name: string;
}

const TWINK_NAMES = [
	'Kai',
	'Jules',
	'Remy',
	'Ash',
	'Theo',
	'Nico',
	'Ezra',
	'Luca',
	'Milo',
	'Soren',
	'Ari',
	'Finn',
	'Ollie',
	'Sky',
	'Ren',
	'Ivo',
] as const;

const TWINK_LINES = [
	'The slop is… an experience.',
	'Want a bite? No refunds.',
	'Hill life, baby.',
	'My crop top is cleaner than the stew.',
	'Gangs own the alleys. We own the vibe.',
	'Messy hair, messy bowl.',
	'You climbed all this way for slop?',
	'Hot, broke, and full of mystery beans.',
] as const;

const CROP_COLORS = [0xff6b9d, 0xffffff, 0x22d3ee, 0xa855f7, 0xfbbf24, 0x111111, 0xf472b6] as const;
const SHORTS_COLORS = [0x1e293b, 0x334155, 0x0f172a, 0x3b0764, 0x7c2d12] as const;
const HAIR_COLORS = [0x1a1a1a, 0x3d2314, 0x6b4423, 0xf5e6d3, 0xc0c0c0, 0xff66aa, 0x4a90d9] as const;
const SKIN_TONES = [0xf1c27d, 0xffdbac, 0xe0ac69, 0xc68642, 0xf5d0b0, 0xd4a574] as const;

/**
 * Sloppenwijk: shacks, rival gangs, and twinks with bowls of mystery slop.
 */
class CityFavela {
	readonly group = new Group();

	private readonly materials: Material[] = [];
	private readonly geometries: BufferGeometry[] = [];
	private readonly textures: Texture[] = [];
	private readonly instanced: InstancedMesh[] = [];
	private readonly unit = new BoxGeometry(1, 1, 1);
	private readonly dummy = new Object3D();
	private readonly shacks: Shack[];
	private windowMat: MeshBasicMaterial | null = null;
	private readonly gangsters: Gangster[] = [];
	private readonly twinks: Twink[] = [];
	private bodyMesh: InstancedMesh | null = null;
	private headMesh: InstancedMesh | null = null;
	private legMesh: InstancedMesh | null = null;
	private shirtMesh: InstancedMesh | null = null;
	private twBody: InstancedMesh | null = null;
	private twHead: InstancedMesh | null = null;
	private twLeg: InstancedMesh | null = null;
	private twCrop: InstancedMesh | null = null;
	private twHair: InstancedMesh | null = null;
	private twBowl: InstancedMesh | null = null;
	private twSlop: InstancedMesh | null = null;
	private promptHud: HTMLDivElement | null = null;
	private readonly paid = new Set<string>();
	private readonly greeted = new Set<string>();
	private readonly twinkDone = new Set<string>();

	constructor() {
		this.group.name = 'city_favela';
		this.unit.translate(0, 0.5, 0);
		this.geometries.push(this.unit);
		this.shacks = planShacks();
		this.buildTerrain();
		this.buildShacks();
		this.buildWindows();
		this.buildClothesLines();
		this.buildSign();
		this.buildGangTags();
		this.buildGangs();
		this.buildSlopKitchen();
		this.buildTwinks();
	}

	update(dt: number, t: number, viewer?: Vector3): void {
		if (this.windowMat) {
			const pulse = WINDOW_PULSE_BASE + WINDOW_PULSE_SPAN * Math.sin(t * 1.3);
			this.windowMat.color.setRGB(1.2 * pulse, 0.85 * pulse, 0.35 * pulse);
		}
		this.stepGangs(dt, t);
		this.writeGangMatrices(t);
		this.stepTwinks(dt, t);
		this.writeTwinkMatrices(t);
		if (viewer) this.refreshPrompt(viewer);
	}

	inGangRange(viewer: Vector3): boolean {
		return this.nearestGangster(viewer) !== null || this.nearestTwink(viewer) !== null;
	}

	promptAt(viewer: Vector3): string | null {
		const tw = this.nearestTwink(viewer);
		const g = this.nearestGangster(viewer);
		const dTw = tw ? Math.hypot(tw.x - viewer.x, tw.z - viewer.z) : Number.POSITIVE_INFINITY;
		const dG = g ? Math.hypot(g.x - viewer.x, g.z - viewer.z) : Number.POSITIVE_INFINITY;
		if (tw && dTw <= dG) return `E · hang with ${tw.name} (slop)`;
		if (g) {
			const def = at(GANGS, g.gang);
			return `E · talk to ${def.name}`;
		}
		return null;
	}

	tryInteract(viewer: Vector3): FavelaGangResult | null {
		const tw = this.nearestTwink(viewer);
		const g = this.nearestGangster(viewer);
		const dTw = tw ? Math.hypot(tw.x - viewer.x, tw.z - viewer.z) : Number.POSITIVE_INFINITY;
		const dG = g ? Math.hypot(g.x - viewer.x, g.z - viewer.z) : Number.POSITIVE_INFINITY;
		if (tw && dTw <= dG) return this.interactTwink(tw);
		if (g) return this.interactGang(g);
		return null;
	}

	private interactGang(g: Gangster): FavelaGangResult {
		const def = at(GANGS, g.gang);
		const key = `${def.id}-${g.pathI}-${Math.round(g.x)}-${Math.round(g.z)}`;
		const rand = mulberry32((g.x * 1000 + g.z * 17 + g.gang * 99) | 0);
		const line = at(def.lines, Math.floor(rand() * def.lines.length));

		if (!this.greeted.has(def.id)) {
			this.greeted.add(def.id);
			return {
				status: `🔫 ${def.name}: “${line}” · turf marked (+4)`,
				scoreDelta: 4,
			};
		}
		if (!this.paid.has(key) && rand() < 0.55) {
			this.paid.add(key);
			const toll = 2 + Math.floor(rand() * 4);
			return {
				status: `💰 ${def.name} pedágio −${toll} · “${line}”`,
				scoreDelta: -toll,
			};
		}
		if (rand() < 0.35) {
			return {
				status: `🤝 ${def.name} respect · “${line}” (+6)`,
				scoreDelta: 6,
			};
		}
		return {
			status: `🔫 ${def.name}: “${line}”`,
			scoreDelta: 0,
		};
	}

	private interactTwink(tw: Twink): FavelaGangResult {
		const key = tw.name;
		const rand = mulberry32((tw.x * 800 + tw.z * 31 + tw.name.length * 13) | 0);
		const line = at(TWINK_LINES, Math.floor(rand() * TWINK_LINES.length));
		if (!this.twinkDone.has(key)) {
			this.twinkDone.add(key);
			if (tw.slop) {
				return {
					status: `🥣 ${tw.name} shares hill slop · “${line}” (+5)`,
					scoreDelta: 5,
				};
			}
			return {
				status: `✨ ${tw.name} winks · “${line}” (+4)`,
				scoreDelta: 4,
			};
		}
		if (tw.slop && rand() < 0.4) {
			return {
				status: `🤢 Second helping of slop with ${tw.name} · bravery (+2)`,
				scoreDelta: 2,
			};
		}
		return {
			status: `💕 ${tw.name}: “${line}”`,
			scoreDelta: 0,
		};
	}

	dispose(): void {
		for (const m of this.instanced) m.dispose();
		for (const m of this.materials) m.dispose();
		for (const g of this.geometries) g.dispose();
		for (const t of this.textures) t.dispose();
		this.promptHud?.remove();
	}

	private buildTerrain(): void {
		const dirt = lit({ color: 0x4a3a28, roughness: 0.98 });
		const path = lit({ color: 0x5c4a38, roughness: 0.96 });
		const fill = lit({ color: 0x3a2a1c, roughness: 0.98 });
		this.materials.push(dirt, path, fill);
		const { minX, maxX, minZ, maxZ, alleyHalf, streetHalf, yLow, yHigh, contours, plazaR } = FAVELA_PLAN;
		const depth = span(minZ, maxZ) + 2;
		const zc = midpoint(minZ, maxZ);
		const strips = 28;
		for (let i = 0; i < strips; i++) {
			const u0 = i / strips;
			const u1 = (i + 1) / strips;
			const x0 = lerp(maxX, minX, u0);
			const x1 = lerp(maxX, minX, u1);
			const top = favelaGroundY(midpoint(x0, x1), zc);
			const w = Math.abs(x1 - x0) + 0.45;
			const h = Math.max(0.5, top + 0.4);
			const bulk = new Mesh(this.unit, fill);
			bulk.scale.set(w, h, depth);
			bulk.position.set(midpoint(x0, x1), half(h) - 0.25, zc);
			bulk.receiveShadow = true;
			bulk.castShadow = true;
			this.group.add(bulk);
			const deck = new Mesh(this.unit, dirt);
			deck.scale.set(w + 0.2, 0.2, depth - 0.4);
			deck.position.set(midpoint(x0, x1), top + 0.04, zc);
			deck.receiveShadow = true;
			this.group.add(deck);
		}
		// Continuous sloping streets from ring to Redeemer (one mesh per spine).
		const peakX = RIO_MOUNTAIN.x;
		const run = peakX - maxX;
		const rise = yHigh - yLow;
		const rampLen = Math.hypot(run, rise);
		const rampAngle = Math.atan2(rise, run);
		const spines = [zc - 12, zc, zc + 12];
		for (const az of spines) {
			const lane = new Mesh(this.unit, path);
			lane.scale.set(rampLen, 0.12, alleyHalf * 2 - 0.2);
			lane.position.set(midpoint(maxX, peakX), midpoint(yLow, yHigh) + 0.08, az);
			lane.rotation.z = rampAngle;
			lane.receiveShadow = true;
			this.group.add(lane);
		}
		// Switchback flanks between contours.
		for (let i = 0; i < contours; i++) {
			const x0 = lerp(maxX, minX, i / contours);
			const x1 = lerp(maxX, minX, (i + 1) / contours);
			const y0 = favelaGroundY(x0, zc);
			const y1 = favelaGroundY(x1, zc);
			const segRun = x1 - x0;
			const segRise = y1 - y0;
			const segLen = Math.hypot(segRun, segRise);
			const az = i % 2 === 0 ? minZ + alleyHalf * 2.2 : maxZ - alleyHalf * 2.2;
			const lane = new Mesh(this.unit, path);
			lane.scale.set(segLen, 0.11, alleyHalf * 2 - 0.25);
			lane.position.set(midpoint(x0, x1), midpoint(y0, y1) + 0.07, az);
			lane.rotation.z = Math.atan2(segRise, segRun);
			lane.receiveShadow = true;
			this.group.add(lane);
		}
		// Contour streets (level N–S lanes).
		for (const bandX of favelaContourXs()) {
			const y = favelaGroundY(bandX, zc);
			const street = new Mesh(this.unit, path);
			street.scale.set(streetHalf * 2, 0.12, depth - 1.2);
			street.position.set(bandX, y + 0.07, zc);
			street.receiveShadow = true;
			this.group.add(street);
		}
		const peak = new Mesh(this.unit, path);
		peak.scale.set(plazaR * 2, 0.18, plazaR * 2);
		peak.position.set(RIO_MOUNTAIN.x, RIO_MOUNTAIN.rockH + 0.1, RIO_MOUNTAIN.z);
		peak.receiveShadow = true;
		this.group.add(peak);
		const apron = new Mesh(this.unit, path);
		apron.scale.set(8, 0.26, depth * 0.92);
		apron.position.set(maxX + 3, 0.11, zc);
		apron.receiveShadow = true;
		this.group.add(apron);
	}

	private buildShacks(): void {
		const wallMat = lit({ color: 0xffffff, roughness: 0.92, metalness: 0.02 });
		const roofMat = lit({ color: 0xffffff, roughness: 0.88, metalness: 0.15 });
		this.materials.push(wallMat, roofMat);
		const n = this.shacks.length;
		const walls = new InstancedMesh(this.unit, wallMat, n);
		const roofs = new InstancedMesh(this.unit, roofMat, n);
		walls.name = 'favela_walls';
		roofs.name = 'favela_roofs';
		walls.castShadow = true;
		roofs.castShadow = true;
		walls.instanceColor = new InstancedBufferAttribute(new Float32Array(n * 3), 3);
		roofs.instanceColor = new InstancedBufferAttribute(new Float32Array(n * 3), 3);
		const tint = new Color();
		const roofTint = new Color();

		for (let i = 0; i < n; i++) {
			const s = at(this.shacks, i);
			this.dummy.position.set(s.x, s.y, s.z);
			this.dummy.rotation.set(0, s.rot, 0);
			this.dummy.scale.set(s.w, s.h, s.d);
			this.dummy.updateMatrix();
			walls.setMatrixAt(i, this.dummy.matrix);
			tint.setHex(s.wall);
			walls.setColorAt(i, tint);

			// Corrugated roof: slightly larger, tilted, sitting on top.
			this.dummy.position.set(s.x, s.y + s.h + 0.12, s.z);
			this.dummy.rotation.set(0.08, s.rot, 0.04);
			this.dummy.scale.set(s.w + 0.35, 0.22, s.d + 0.3);
			this.dummy.updateMatrix();
			roofs.setMatrixAt(i, this.dummy.matrix);
			roofTint.setHex(s.roof);
			roofs.setColorAt(i, roofTint);
		}
		walls.instanceMatrix.needsUpdate = true;
		roofs.instanceMatrix.needsUpdate = true;
		if (walls.instanceColor) walls.instanceColor.needsUpdate = true;
		if (roofs.instanceColor) roofs.instanceColor.needsUpdate = true;
		walls.computeBoundingSphere();
		roofs.computeBoundingSphere();
		this.instanced.push(walls, roofs);
		this.group.add(walls, roofs);
	}

	private buildWindows(): void {
		const glow = new MeshBasicMaterial({ color: 0xffcc66, toneMapped: false });
		this.materials.push(glow);
		this.windowMat = glow;
		const n = this.shacks.length;
		const mesh = new InstancedMesh(this.unit, glow, n);
		mesh.name = 'favela_windows';
		for (let i = 0; i < n; i++) {
			const s = at(this.shacks, i);
			const face = 0.02 + half(s.d);
			const ox = Math.sin(s.rot) * face;
			const oz = Math.cos(s.rot) * face;
			this.dummy.position.set(s.x + ox, s.y + s.h * 0.55, s.z + oz);
			this.dummy.rotation.set(0, s.rot, 0);
			this.dummy.scale.set(s.w * 0.35, s.h * 0.28, 0.08);
			this.dummy.updateMatrix();
			mesh.setMatrixAt(i, this.dummy.matrix);
		}
		mesh.instanceMatrix.needsUpdate = true;
		mesh.computeBoundingSphere();
		this.instanced.push(mesh);
		this.group.add(mesh);
	}

	private buildClothesLines(): void {
		const cloth = lit({ color: 0xe8e0d0, roughness: 0.85 });
		this.materials.push(cloth);
		const lines: { x: number; z: number; y: number; len: number; rot: number }[] = [];
		const rand = mulberry32(FAVELA_PLAN.seed ^ 0x111);
		for (let i = 0; i < this.shacks.length - 1; i++) {
			if (rand() > 0.35) continue;
			const a = at(this.shacks, i);
			const b = at(this.shacks, i + 1);
			const dx = b.x - a.x;
			const dz = b.z - a.z;
			const dist = Math.hypot(dx, dz);
			if (dist < 2 || dist > 7) continue;
			lines.push({
				x: midpoint(a.x, b.x),
				z: midpoint(a.z, b.z),
				y: Math.max(a.y, b.y) + Math.min(a.h, b.h) * 0.85,
				len: dist * 0.9,
				rot: Math.atan2(dx, dz),
			});
		}
		if (lines.length === 0) return;
		const mesh = new InstancedMesh(this.unit, cloth, lines.length);
		for (let i = 0; i < lines.length; i++) {
			const L = at(lines, i);
			this.dummy.position.set(L.x, L.y, L.z);
			this.dummy.rotation.set(0, L.rot, 0);
			this.dummy.scale.set(0.06, 0.04, L.len);
			this.dummy.updateMatrix();
			mesh.setMatrixAt(i, this.dummy.matrix);
		}
		mesh.instanceMatrix.needsUpdate = true;
		mesh.computeBoundingSphere();
		this.instanced.push(mesh);
		this.group.add(mesh);

		// Laundry flags on a few lines
		const colors = [0xff3355, 0x3388ff, 0xffee44, 0xffffff, 0x33cc66] as const;
		const flags = Math.min(40, lines.length * 2);
		const flagMat = lit({ color: 0xffffff, roughness: 0.9 });
		this.materials.push(flagMat);
		const flagMesh = new InstancedMesh(this.unit, flagMat, flags);
		flagMesh.instanceColor = new InstancedBufferAttribute(new Float32Array(flags * 3), 3);
		const c = new Color();
		for (let i = 0; i < flags; i++) {
			const L = at(lines, i % lines.length);
			const along = (i % 5) / 5 - 0.4;
			this.dummy.position.set(L.x + Math.sin(L.rot) * along * L.len, L.y - 0.35, L.z + Math.cos(L.rot) * along * L.len);
			this.dummy.rotation.set(0, L.rot, 0.15);
			this.dummy.scale.set(0.35, 0.55, 0.05);
			this.dummy.updateMatrix();
			flagMesh.setMatrixAt(i, this.dummy.matrix);
			c.setHex(at(colors, i % colors.length));
			flagMesh.setColorAt(i, c);
		}
		flagMesh.instanceMatrix.needsUpdate = true;
		if (flagMesh.instanceColor) flagMesh.instanceColor.needsUpdate = true;
		flagMesh.computeBoundingSphere();
		this.instanced.push(flagMesh);
		this.group.add(flagMesh);
	}

	private buildSign(): void {
		const { maxX, minZ, maxZ } = FAVELA_PLAN;
		const x = maxX - 1.5;
		const z = midpoint(minZ, maxZ);
		const y = favelaGroundY(x, z) + 3.5;
		const { canvas, ctx } = labelCanvas(520, 100);
		ctx.fillStyle = '#2a1010';
		ctx.fillRect(0, 0, 520, 100);
		ctx.fillStyle = '#ffcc66';
		fitText(ctx, FAVELA_PLAN.label, { x: 12, y: 10, w: 496, h: 50 }, { size: 36, maxLines: 1 });
		ctx.fillStyle = '#ffffff';
		fitText(ctx, 'FOLLOW THE STREETS UP', { x: 12, y: 58, w: 496, h: 32 }, { size: 18, maxLines: 1 });
		const tex = labelTexture(canvas);
		this.textures.push(tex);
		const mat = new MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false });
		this.materials.push(mat);
		const geo = new PlaneGeometry(10, 1.9);
		this.geometries.push(geo);
		const sign = backToBackLabel(geo, mat);
		sign.position.set(x, y, z);
		sign.rotation.y = Math.PI / 2;
		this.group.add(sign);
	}

	private buildGangTags(): void {
		const { minX, maxX, minZ, maxZ } = FAVELA_PLAN;
		for (let gi = 0; gi < GANGS.length; gi++) {
			const def = at(GANGS, gi);
			const z = lerp(minZ, maxZ, midpoint(def.z0, def.z1));
			const x = lerp(maxX, minX, 0.35 + gi * 0.12);
			const y = favelaGroundY(x, z) + 2.8;
			const { canvas, ctx } = labelCanvas(256, 96);
			ctx.fillStyle = '#0a0a0a';
			ctx.fillRect(0, 0, 256, 96);
			ctx.fillStyle = `#${def.color.toString(16).padStart(6, '0')}`;
			ctx.fillRect(0, 0, 12, 96);
			ctx.fillStyle = '#ffffff';
			fitText(ctx, def.name.toUpperCase(), { x: 20, y: 12, w: 220, h: 40 }, { size: 22, maxLines: 1 });
			fitText(ctx, 'TURF', { x: 20, y: 54, w: 220, h: 28 }, { size: 16, maxLines: 1 });
			const tex = labelTexture(canvas);
			this.textures.push(tex);
			const mat = new MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false });
			this.materials.push(mat);
			const geo = new PlaneGeometry(3.2, 1.2);
			this.geometries.push(geo);
			const tag = backToBackLabel(geo, mat);
			tag.position.set(x, y, z);
			tag.rotation.y = Math.PI / 2 + gi * 0.15;
			this.group.add(tag);

			// Paint splash on ground
			const splash = lit({ color: def.color, roughness: 0.95 });
			this.materials.push(splash);
			const blot = new Mesh(this.unit, splash);
			blot.scale.set(2.4, 0.06, 1.1);
			blot.position.set(x, favelaGroundY(x, z) + 0.1, z);
			this.group.add(blot);
		}
	}

	private buildGangs(): void {
		const rand = mulberry32(GANG_SEED);
		const bodyMat = lit({ color: 0xffffff, roughness: 0.9 });
		const headMat = lit({ color: 0xffffff, roughness: 0.88 });
		const legMat = lit({ color: 0xffffff, roughness: 0.92 });
		const shirtMat = lit({ color: 0xffffff, roughness: 0.85 });
		this.materials.push(bodyMat, headMat, legMat, shirtMat);

		const bodyGeo = new CapsuleGeometry(0.16, 0.45, 3, 6);
		const headGeo = new SphereGeometry(0.14, 8, 6);
		const legGeo = new CapsuleGeometry(0.07, 0.38, 3, 6);
		const shirtGeo = new BoxGeometry(0.42, 0.38, 0.28);
		this.geometries.push(bodyGeo, headGeo, legGeo, shirtGeo);

		const n = GANG_TOTAL;
		this.bodyMesh = new InstancedMesh(bodyGeo, bodyMat, n);
		this.headMesh = new InstancedMesh(headGeo, headMat, n);
		this.legMesh = new InstancedMesh(legGeo, legMat, n * 2);
		this.shirtMesh = new InstancedMesh(shirtGeo, shirtMat, n);
		for (const mesh of [this.bodyMesh, this.headMesh, this.legMesh, this.shirtMesh]) {
			mesh.instanceColor = new InstancedBufferAttribute(new Float32Array((mesh === this.legMesh ? n * 2 : n) * 3), 3);
			mesh.instanceMatrix.setUsage(DynamicDrawUsage);
			mesh.frustumCulled = false;
			mesh.castShadow = true;
			this.instanced.push(mesh);
			this.group.add(mesh);
		}

		const skinTones = [0xc68642, 0xe0ac69, 0x8d5524, 0xf1c27d, 0xffdbac, 0x6b4423] as const;
		const pants = [0x1a1a22, 0x2a2a30, 0x3a3028, 0x111118] as const;

		let idx = 0;
		for (let gi = 0; gi < GANGS.length; gi++) {
			const def = at(GANGS, gi);
			const path = this.gangPath(def, rand);
			for (let m = 0; m < MEMBERS_PER_GANG; m++) {
				const start = at(path, Math.floor(rand() * path.length));
				const roll = rand();
				this.gangsters.push({
					gang: gi,
					x: start.x + plusMinusWith(0.4, rand),
					z: start.z + plusMinusWith(0.4, rand),
					y: favelaGroundY(start.x, start.z),
					yaw: rand() * Math.PI * 2,
					phase: rand() * Math.PI * 2,
					pathI: Math.floor(rand() * path.length),
					path,
					mode: roll < 0.55 ? 'patrol' : roll < 0.85 ? 'lookout' : 'idle',
					cooldown: 0,
				});
				// Skin / pants colors fixed per instance (shirt uses gang color each frame).
				const skin = new Color(pickWith(skinTones, rand));
				const pant = new Color(pickWith(pants, rand));
				if (this.bodyMesh.instanceColor) this.bodyMesh.setColorAt(idx, skin);
				if (this.headMesh.instanceColor) this.headMesh.setColorAt(idx, skin);
				if (this.legMesh.instanceColor) {
					this.legMesh.setColorAt(idx * 2, pant);
					this.legMesh.setColorAt(idx * 2 + 1, pant);
				}
				if (this.shirtMesh.instanceColor) this.shirtMesh.setColorAt(idx, new Color(def.color));
				idx++;
			}
		}
		if (this.bodyMesh.instanceColor) this.bodyMesh.instanceColor.needsUpdate = true;
		if (this.headMesh.instanceColor) this.headMesh.instanceColor.needsUpdate = true;
		if (this.legMesh.instanceColor) this.legMesh.instanceColor.needsUpdate = true;
		if (this.shirtMesh.instanceColor) this.shirtMesh.instanceColor.needsUpdate = true;
	}

	private gangPath(def: GangDef, rand: () => number): { x: number; z: number }[] {
		const { minX, maxX, minZ, maxZ } = FAVELA_PLAN;
		const zA = lerp(minZ, maxZ, def.z0 + 0.05);
		const zB = lerp(minZ, maxZ, def.z1 - 0.05);
		const pts: { x: number; z: number }[] = [];
		const n = 8;
		for (let i = 0; i < n; i++) {
			const u = i / n;
			const x = lerp(maxX - 1.5, minX + 2, (u + rand() * 0.15) % 1);
			const z = lerp(zA, zB, (u * 1.7 + rand() * 0.2) % 1);
			pts.push({ x, z });
		}
		return pts;
	}

	private stepGangs(dt: number, t: number): void {
		for (const g of this.gangsters) {
			g.phase += dt * (g.mode === 'patrol' ? 1.2 : 0.6);
			g.cooldown = Math.max(0, g.cooldown - dt);
			if (g.mode === 'patrol') {
				const target = at(g.path, g.pathI);
				const dx = target.x - g.x;
				const dz = target.z - g.z;
				const dist = Math.hypot(dx, dz);
				if (dist < 0.45) g.pathI = (g.pathI + 1) % g.path.length;
				else {
					const step = Math.min(dist, PATROL_SPEED * dt);
					g.x += (dx / dist) * step;
					g.z += (dz / dist) * step;
					g.yaw = Math.atan2(dx, dz);
				}
			} else if (g.mode === 'lookout') {
				g.yaw = t * 0.35 + g.phase;
			} else {
				g.yaw += Math.sin(g.phase) * 0.4 * dt;
			}
			g.y = favelaGroundY(g.x, g.z);
		}
	}

	private writeGangMatrices(t: number): void {
		if (!(this.bodyMesh && this.headMesh && this.legMesh && this.shirtMesh)) return;
		const color = new Color();
		for (let i = 0; i < this.gangsters.length; i++) {
			const g = at(this.gangsters, i);
			const def = at(GANGS, g.gang);
			const bob = g.mode === 'patrol' ? Math.abs(Math.sin(g.phase * 6)) * 0.04 : 0;
			const baseY = g.y + bob;

			// Torso
			this.dummy.position.set(g.x, baseY + 1.05, g.z);
			this.dummy.rotation.set(0, g.yaw, 0);
			this.dummy.scale.set(1, 1, 1);
			this.dummy.updateMatrix();
			this.bodyMesh.setMatrixAt(i, this.dummy.matrix);

			// Shirt over torso
			this.dummy.position.set(g.x, baseY + 1.12, g.z);
			this.dummy.scale.set(1, 1, 1);
			this.dummy.updateMatrix();
			this.shirtMesh.setMatrixAt(i, this.dummy.matrix);
			color.setHex(def.color);
			this.shirtMesh.setColorAt(i, color);

			// Head
			this.dummy.position.set(g.x, baseY + 1.55, g.z);
			this.dummy.scale.set(1, 1, 1);
			this.dummy.updateMatrix();
			this.headMesh.setMatrixAt(i, this.dummy.matrix);

			// Legs with walk swing
			const swing = g.mode === 'patrol' ? Math.sin(g.phase * 6) * 0.45 : 0;
			for (const side of [-1, 1] as const) {
				const li = i * 2 + (side < 0 ? 0 : 1);
				this.dummy.position.set(g.x + Math.cos(g.yaw) * side * 0.1, baseY + 0.45, g.z + Math.sin(g.yaw) * side * 0.1);
				this.dummy.rotation.set(side * swing, g.yaw, 0);
				this.dummy.scale.set(1, 1, 1);
				this.dummy.updateMatrix();
				this.legMesh.setMatrixAt(li, this.dummy.matrix);
			}
		}
		// Idle weapon wave for lookouts — subtle shirt scale pulse as “alert”
		void t;
		this.bodyMesh.instanceMatrix.needsUpdate = true;
		this.headMesh.instanceMatrix.needsUpdate = true;
		this.legMesh.instanceMatrix.needsUpdate = true;
		this.shirtMesh.instanceMatrix.needsUpdate = true;
		if (this.shirtMesh.instanceColor) this.shirtMesh.instanceColor.needsUpdate = true;
		this.bodyMesh.computeBoundingSphere();
		this.headMesh.computeBoundingSphere();
		this.legMesh.computeBoundingSphere();
		this.shirtMesh.computeBoundingSphere();
	}

	private nearestGangster(viewer: Vector3): Gangster | null {
		let best: Gangster | null = null;
		let bestD = INTERACT_R;
		for (const g of this.gangsters) {
			const d = Math.hypot(g.x - viewer.x, g.z - viewer.z);
			if (d < bestD && Math.abs(g.y - viewer.y + 1.5) < 8) {
				bestD = d;
				best = g;
			}
		}
		return best;
	}

	private nearestTwink(viewer: Vector3): Twink | null {
		let best: Twink | null = null;
		let bestD = INTERACT_R;
		for (const tw of this.twinks) {
			const d = Math.hypot(tw.x - viewer.x, tw.z - viewer.z);
			if (d < bestD && Math.abs(tw.y - viewer.y + 1.5) < 8) {
				bestD = d;
				best = tw;
			}
		}
		return best;
	}

	private buildSlopKitchen(): void {
		const { minX, maxX, minZ, maxZ } = FAVELA_PLAN;
		const x = lerp(maxX, minX, 0.55);
		const z = midpoint(minZ, maxZ) + 4;
		const y = favelaGroundY(x, z);
		const counter = lit({ color: 0x3a2a1a, roughness: 0.95 });
		const pot = lit({ color: 0x2a2a28, roughness: 0.7, metalness: 0.3 });
		const slop = lit({ color: SLOP_COLOR, roughness: 0.98 });
		const steam = new MeshBasicMaterial({ color: 0xccffaa, transparent: true, opacity: 0.35, toneMapped: false });
		this.materials.push(counter, pot, slop, steam);
		const desk = new Mesh(this.unit, counter);
		desk.scale.set(3.2, 1.1, 1.6);
		desk.position.set(x, y + 0.55, z);
		this.group.add(desk);
		const cauldron = new Mesh(new CylinderGeometry(0.55, 0.65, 0.7, 10), pot);
		this.geometries.push(cauldron.geometry);
		cauldron.position.set(x, y + 1.45, z);
		this.group.add(cauldron);
		const goo = new Mesh(new CylinderGeometry(0.48, 0.48, 0.12, 10), slop);
		this.geometries.push(goo.geometry);
		goo.position.set(x, y + 1.72, z);
		this.group.add(goo);
		const puff = new Mesh(new SphereGeometry(0.35, 8, 6), steam);
		this.geometries.push(puff.geometry);
		puff.position.set(x, y + 2.2, z);
		this.group.add(puff);

		const { canvas, ctx } = labelCanvas(400, 80);
		ctx.fillStyle = '#1a1008';
		ctx.fillRect(0, 0, 400, 80);
		ctx.fillStyle = '#a3e635';
		fitText(ctx, 'SLOP KITCHEN', { x: 12, y: 10, w: 376, h: 36 }, { size: 28, maxLines: 1 });
		ctx.fillStyle = '#ffffff';
		fitText(ctx, 'MYSTERY BEANS · TWINK SPECIAL', { x: 12, y: 46, w: 376, h: 24 }, { size: 14, maxLines: 1 });
		const tex = labelTexture(canvas);
		this.textures.push(tex);
		const mat = new MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false });
		this.materials.push(mat);
		const geo = new PlaneGeometry(3.6, 0.75);
		this.geometries.push(geo);
		const sign = backToBackLabel(geo, mat);
		sign.position.set(x, y + 2.6, z + 0.9);
		this.group.add(sign);
	}

	private buildTwinks(): void {
		const rand = mulberry32(TWINK_SEED);
		const bodyMat = lit({ color: 0xffffff, roughness: 0.88 });
		const headMat = lit({ color: 0xffffff, roughness: 0.86 });
		const legMat = lit({ color: 0xffffff, roughness: 0.9 });
		const cropMat = lit({ color: 0xffffff, roughness: 0.82 });
		const hairMat = lit({ color: 0xffffff, roughness: 0.9 });
		const bowlMat = lit({ color: 0x8a8070, roughness: 0.75 });
		const slopMat = lit({ color: SLOP_COLOR, roughness: 0.98 });
		this.materials.push(bodyMat, headMat, legMat, cropMat, hairMat, bowlMat, slopMat);

		// Leaner than gangsters.
		const bodyGeo = new CapsuleGeometry(0.11, 0.42, 3, 6);
		const headGeo = new SphereGeometry(0.12, 8, 6);
		const legGeo = new CapsuleGeometry(0.055, 0.36, 3, 6);
		const cropGeo = new BoxGeometry(0.34, 0.22, 0.22);
		const hairGeo = new SphereGeometry(0.13, 8, 6);
		const bowlGeo = new CylinderGeometry(0.12, 0.1, 0.08, 8);
		const slopGeo = new CylinderGeometry(0.1, 0.1, 0.04, 8);
		this.geometries.push(bodyGeo, headGeo, legGeo, cropGeo, hairGeo, bowlGeo, slopGeo);

		const n = TWINK_COUNT;
		this.twBody = new InstancedMesh(bodyGeo, bodyMat, n);
		this.twHead = new InstancedMesh(headGeo, headMat, n);
		this.twLeg = new InstancedMesh(legGeo, legMat, n * 2);
		this.twCrop = new InstancedMesh(cropGeo, cropMat, n);
		this.twHair = new InstancedMesh(hairGeo, hairMat, n);
		this.twBowl = new InstancedMesh(bowlGeo, bowlMat, n);
		this.twSlop = new InstancedMesh(slopGeo, slopMat, n);
		for (const mesh of [this.twBody, this.twHead, this.twLeg, this.twCrop, this.twHair, this.twBowl, this.twSlop]) {
			const count = mesh === this.twLeg ? n * 2 : n;
			mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(count * 3), 3);
			mesh.instanceMatrix.setUsage(DynamicDrawUsage);
			mesh.frustumCulled = false;
			mesh.castShadow = true;
			this.instanced.push(mesh);
			this.group.add(mesh);
		}

		const path = this.twinkPath(rand);
		const kitchen = path[0] ?? {
			x: midpoint(FAVELA_PLAN.minX, FAVELA_PLAN.maxX),
			z: midpoint(FAVELA_PLAN.minZ, FAVELA_PLAN.maxZ),
		};
		for (let i = 0; i < n; i++) {
			const start = at(path, Math.floor(rand() * path.length));
			const roll = rand();
			const mode: Twink['mode'] = roll < 0.3 ? 'wander' : roll < 0.55 ? 'lounge' : roll < 0.8 ? 'slop' : 'dance';
			const holdSlop = mode === 'slop' || rand() < 0.45;
			const spot = mode === 'slop' ? { x: kitchen.x + plusMinusWith(1.8, rand), z: kitchen.z + plusMinusWith(1.4, rand) } : start;
			this.twinks.push({
				x: spot.x,
				z: spot.z,
				y: favelaGroundY(spot.x, spot.z),
				yaw: rand() * Math.PI * 2,
				phase: rand() * Math.PI * 2,
				pathI: Math.floor(rand() * path.length),
				path,
				mode,
				skin: pickWith(SKIN_TONES, rand),
				hair: pickWith(HAIR_COLORS, rand),
				crop: pickWith(CROP_COLORS, rand),
				shorts: pickWith(SHORTS_COLORS, rand),
				slop: holdSlop,
				name: at(TWINK_NAMES, i % TWINK_NAMES.length),
			});
			const skin = new Color(this.twinks[i]?.skin ?? 0xffdbac);
			const hair = new Color(this.twinks[i]?.hair ?? 0x1a1a1a);
			const crop = new Color(this.twinks[i]?.crop ?? 0xffffff);
			const shorts = new Color(this.twinks[i]?.shorts ?? 0x1e293b);
			if (this.twBody.instanceColor) this.twBody.setColorAt(i, skin);
			if (this.twHead.instanceColor) this.twHead.setColorAt(i, skin);
			if (this.twHair.instanceColor) this.twHair.setColorAt(i, hair);
			if (this.twCrop.instanceColor) this.twCrop.setColorAt(i, crop);
			if (this.twLeg.instanceColor) {
				this.twLeg.setColorAt(i * 2, shorts);
				this.twLeg.setColorAt(i * 2 + 1, shorts);
			}
			if (this.twBowl.instanceColor) this.twBowl.setColorAt(i, new Color(0x8a8070));
			if (this.twSlop.instanceColor) this.twSlop.setColorAt(i, new Color(SLOP_COLOR));
		}
		for (const mesh of [this.twBody, this.twHead, this.twLeg, this.twCrop, this.twHair, this.twBowl, this.twSlop]) {
			if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
		}
	}

	private twinkPath(rand: () => number): { x: number; z: number }[] {
		const { minX, maxX, minZ, maxZ } = FAVELA_PLAN;
		const pts: { x: number; z: number }[] = [];
		const n = 10;
		for (let i = 0; i < n; i++) {
			const u = (i + rand() * 0.4) / n;
			pts.push({
				x: lerp(maxX - 2, minX + 3, u),
				z: lerp(minZ + 3, maxZ - 3, (u * 2.3 + rand() * 0.25) % 1),
			});
		}
		// Kitchen hangout
		pts.push({
			x: lerp(maxX, minX, 0.55),
			z: midpoint(minZ, maxZ) + 4,
		});
		return pts;
	}

	private stepTwinks(dt: number, t: number): void {
		for (const tw of this.twinks) {
			tw.phase += dt * (tw.mode === 'dance' ? 2.2 : tw.mode === 'wander' ? 1.1 : 0.55);
			if (tw.mode === 'wander') {
				const target = at(tw.path, tw.pathI);
				const dx = target.x - tw.x;
				const dz = target.z - tw.z;
				const dist = Math.hypot(dx, dz);
				if (dist < 0.4) tw.pathI = (tw.pathI + 1) % tw.path.length;
				else {
					const step = Math.min(dist, TWINK_SPEED * dt);
					tw.x += (dx / dist) * step;
					tw.z += (dz / dist) * step;
					tw.yaw = Math.atan2(dx, dz);
				}
			} else if (tw.mode === 'dance') {
				tw.yaw = t * 0.8 + tw.phase;
				tw.x += Math.sin(tw.phase * 3) * 0.15 * dt;
				tw.z += Math.cos(tw.phase * 2.5) * 0.15 * dt;
			} else if (tw.mode === 'lounge') {
				tw.yaw += Math.sin(tw.phase * 0.7) * 0.25 * dt;
			} else {
				// slop: face kitchen, bob
				const kx = lerp(FAVELA_PLAN.maxX, FAVELA_PLAN.minX, 0.55);
				const kz = midpoint(FAVELA_PLAN.minZ, FAVELA_PLAN.maxZ) + 4;
				tw.yaw = Math.atan2(kx - tw.x, kz - tw.z) + Math.sin(tw.phase) * 0.15;
			}
			tw.y = favelaGroundY(tw.x, tw.z);
		}
	}

	private writeTwinkMatrices(t: number): void {
		if (!(this.twBody && this.twHead && this.twLeg && this.twCrop && this.twHair && this.twBowl && this.twSlop)) return;
		const s = TWINK_SCALE;
		for (let i = 0; i < this.twinks.length; i++) {
			const tw = at(this.twinks, i);
			const bob =
				tw.mode === 'dance'
					? Math.abs(Math.sin(tw.phase * 5)) * 0.1
					: tw.mode === 'wander'
						? Math.abs(Math.sin(tw.phase * 6)) * 0.035
						: tw.mode === 'slop'
							? Math.sin(tw.phase * 2) * 0.02
							: 0;
			const baseY = tw.y + bob;
			const lean = tw.mode === 'lounge' ? 0.25 : tw.mode === 'slop' ? 0.12 : 0;

			// Skinny torso
			this.dummy.position.set(tw.x, baseY + 1.0 * s, tw.z);
			this.dummy.rotation.set(lean, tw.yaw, 0);
			this.dummy.scale.set(s, s, s);
			this.dummy.updateMatrix();
			this.twBody.setMatrixAt(i, this.dummy.matrix);

			// Crop top high on chest
			this.dummy.position.set(tw.x, baseY + 1.18 * s, tw.z);
			this.dummy.rotation.set(lean, tw.yaw, 0);
			this.dummy.scale.set(s, s, s);
			this.dummy.updateMatrix();
			this.twCrop.setMatrixAt(i, this.dummy.matrix);

			// Head
			this.dummy.position.set(tw.x, baseY + 1.48 * s, tw.z);
			this.dummy.rotation.set(lean * HEAD_LEAN, tw.yaw, 0);
			this.dummy.scale.set(s, s, s);
			this.dummy.updateMatrix();
			this.twHead.setMatrixAt(i, this.dummy.matrix);

			// Messy hair (slightly offset / bigger)
			const hairMess = 1.15 + 0.08 * Math.sin(tw.phase + i);
			this.dummy.position.set(tw.x, baseY + 1.58 * s, tw.z - 0.02);
			this.dummy.rotation.set(0.15, tw.yaw, 0.1);
			this.dummy.scale.set(s * hairMess, s * 0.85, s * hairMess);
			this.dummy.updateMatrix();
			this.twHair.setMatrixAt(i, this.dummy.matrix);

			// Shorts = short legs upper only via scale
			const swing = tw.mode === 'wander' || tw.mode === 'dance' ? Math.sin(tw.phase * 6) * 0.4 : 0;
			for (const side of [-1, 1] as const) {
				const li = i * 2 + (side < 0 ? 0 : 1);
				this.dummy.position.set(
					tw.x + Math.cos(tw.yaw) * side * 0.08 * s,
					baseY + 0.42 * s,
					tw.z + Math.sin(tw.yaw) * side * 0.08 * s,
				);
				this.dummy.rotation.set(side * swing + lean, tw.yaw, 0);
				this.dummy.scale.set(s, s * 0.85, s);
				this.dummy.updateMatrix();
				this.twLeg.setMatrixAt(li, this.dummy.matrix);
			}

			// Bowl of slop in hands
			const hold = tw.slop ? 1 : 0.001;
			const handX = tw.x + Math.sin(tw.yaw) * 0.22 * s;
			const handZ = tw.z + Math.cos(tw.yaw) * 0.22 * s;
			const handY = baseY + (tw.mode === 'slop' ? 1.05 : 0.95) * s;
			this.dummy.position.set(handX, handY, handZ);
			this.dummy.rotation.set(0.4, tw.yaw, 0);
			this.dummy.scale.set(hold, hold, hold);
			this.dummy.updateMatrix();
			this.twBowl.setMatrixAt(i, this.dummy.matrix);
			this.dummy.position.set(handX, handY + 0.05 * hold, handZ);
			this.dummy.scale.set(hold, hold, hold);
			this.dummy.updateMatrix();
			this.twSlop.setMatrixAt(i, this.dummy.matrix);
		}
		void t;
		for (const mesh of [this.twBody, this.twHead, this.twLeg, this.twCrop, this.twHair, this.twBowl, this.twSlop]) {
			mesh.instanceMatrix.needsUpdate = true;
			mesh.computeBoundingSphere();
		}
	}

	private refreshPrompt(viewer: Vector3): void {
		const text = this.promptAt(viewer);
		if (!text) {
			if (this.promptHud) this.promptHud.style.display = 'none';
			return;
		}
		if (!this.promptHud) {
			const el = document.createElement('div');
			el.style.cssText =
				'position:fixed;left:50%;bottom:16%;transform:translateX(-50%);z-index:50;padding:8px 14px;background:rgba(40,0,0,.78);color:#fff;font:600 14px system-ui,sans-serif;border-radius:8px;pointer-events:none;border:1px solid #ff3344';
			document.body.appendChild(el);
			this.promptHud = el;
		}
		const border = text.includes('slop') || text.includes('hang') ? '#ff66aa' : '#ff3344';
		this.promptHud.style.borderColor = border;
		this.promptHud.textContent = text;
		this.promptHud.style.display = 'block';
	}
}

/** House footprint must stay off free streets (margin clears the walk corridor). */
function shackFoulsStreet(x: number, z: number, hw: number, hd: number): boolean {
	const m = 0.2;
	if (favelaIsStreet(x, z)) return true;
	if (favelaIsStreet(x - hw - m, z)) return true;
	if (favelaIsStreet(x + hw + m, z)) return true;
	if (favelaIsStreet(x, z - hd - m)) return true;
	if (favelaIsStreet(x, z + hd + m)) return true;
	if (Math.hypot(x - RIO_MOUNTAIN.x, z - RIO_MOUNTAIN.z) < FAVELA_PLAN.plazaR + 1.5) return true;
	return false;
}

function planShacks(): Shack[] {
	const rand = mulberry32(FAVELA_PLAN.seed);
	const out: Shack[] = [];
	const { cols, rows, minX, maxX, minZ, maxZ } = FAVELA_PLAN;
	for (let row = 0; row < rows; row++) {
		for (let col = 0; col < cols; col++) {
			if (rand() < 0.08) continue;
			const u = (col + CELL_INSET + rand() * CELL_JITTER) / cols;
			const v = (row + CELL_INSET + rand() * CELL_JITTER) / rows;
			const x = lerp(maxX, minX, u);
			const z = lerp(minZ, maxZ, v);
			// Smaller houses so they fit between contour streets.
			const w = 1.9 + rand() * 1.5;
			const d = 1.8 + rand() * 1.4;
			const hw = half(w);
			const hd = half(d);
			if (shackFoulsStreet(x, z, hw, hd)) continue;
			const y = favelaGroundY(x, z);
			const storeys = rand() < 0.4 ? 2 : rand() < 0.12 ? 3 : 1;
			const h = (2.1 + rand() * 0.7) * storeys;
			out.push({
				x,
				z,
				y,
				w,
				d,
				h,
				rot: plusMinusWith(0.3, rand),
				wall: pickWith(WALL_COLORS, rand),
				roof: pickWith(ROOF_COLORS, rand),
			});
			if (storeys >= 2 && rand() < 0.55) {
				const upperScale = 0.7 + rand() * 0.2;
				out.push({
					x: x + plusMinusWith(0.1, rand),
					z: z + plusMinusWith(0.1, rand),
					y: y + h * UPPER_STACK_Y,
					w: w * upperScale,
					d: d * upperScale,
					h: 1.95 + rand() * UPPER_H_NOISE,
					rot: plusMinusWith(0.28, rand),
					wall: pickWith(WALL_COLORS, rand),
					roof: pickWith(ROOF_COLORS, rand),
				});
			}
		}
	}
	return out;
}

function favelaColliders(): readonly BoxCollider[] {
	return planShacks().map((s, i) => {
		const hw = half(s.w) + 0.08;
		const hd = half(s.d) + 0.08;
		return {
			minX: s.x - hw,
			maxX: s.x + hw,
			minZ: s.z - hd,
			maxZ: s.z + hd,
			minY: s.y,
			maxY: s.y + s.h + 0.3,
			label: `favela_shack_${i}`,
		};
	});
}

/** Walkable village ground: dense slope carpet (rise ≤ WALK_STEP per segment) + plaza. */
function favelaSurfaces(): readonly Readonly<{
	minX: number;
	maxX: number;
	minZ: number;
	maxZ: number;
	y: number;
	label: string;
}>[] {
	const { minX, maxX, minZ, maxZ, alleyHalf, streetHalf, yLow, yHigh, plazaR } = FAVELA_PLAN;
	const zc = midpoint(minZ, maxZ);
	const out: { minX: number; maxX: number; minZ: number; maxZ: number; y: number; label: string }[] = [];
	const segs = Math.max(140, Math.ceil((yHigh - yLow) / 0.32) + 8);

	for (let i = 0; i < segs; i++) {
		const u0 = i / segs;
		const u1 = (i + 1) / segs;
		const x0 = lerp(maxX + 3, minX - 1.5, u0);
		const x1 = lerp(maxX + 3, minX - 1.5, u1);
		const y = favelaGroundY(midpoint(x0, x1), zc);
		out.push({
			minX: Math.min(x0, x1) - 0.06,
			maxX: Math.max(x0, x1) + 0.06,
			minZ: minZ - 0.5,
			maxZ: maxZ + 0.5,
			y: y + 0.09,
			label: `vila_ground_${i}`,
		});
	}

	const spines = [zc - 12, zc, zc + 12];
	const peakX = RIO_MOUNTAIN.x;
	for (let ai = 0; ai < spines.length; ai++) {
		const az = spines[ai] ?? zc;
		for (let i = 0; i < segs; i++) {
			const u = (i + 0.5) / segs;
			const x = lerp(maxX + 2, peakX, u);
			const y = favelaGroundY(x, az);
			out.push({
				minX: x - 1.15,
				maxX: x + 1.15,
				minZ: az - alleyHalf,
				maxZ: az + alleyHalf,
				y: y + 0.12,
				label: `vila_spine_${ai}_${i}`,
			});
		}
	}

	for (const bandX of favelaContourXs()) {
		const y = favelaGroundY(bandX, zc);
		out.push({
			minX: bandX - streetHalf,
			maxX: bandX + streetHalf,
			minZ: minZ + 0.3,
			maxZ: maxZ - 0.3,
			y: y + 0.11,
			label: `vila_contour_${bandX.toFixed(0)}`,
		});
	}

	out.push({
		minX: RIO_MOUNTAIN.x - plazaR,
		maxX: RIO_MOUNTAIN.x + plazaR,
		minZ: RIO_MOUNTAIN.z - plazaR,
		maxZ: RIO_MOUNTAIN.z + plazaR,
		y: RIO_MOUNTAIN.rockH + 0.14,
		label: 'vila_peak_plaza',
	});
	out.push({
		minX: maxX,
		maxX: maxX + 9,
		minZ: minZ - 0.6,
		maxZ: maxZ + 0.6,
		y: 0.14,
		label: 'vila_apron',
	});
	return out;
}

function favelaFillColliders(): readonly BoxCollider[] {
	const { minX, maxX, minZ, maxZ } = FAVELA_PLAN;
	const zc = midpoint(minZ, maxZ);
	const depth = span(minZ, maxZ);
	const out: BoxCollider[] = [];
	// Dense strips; maxY uses the LOW end of each strip so fill never pokes through the walk surface.
	const strips = 40;
	for (let i = 0; i < strips; i++) {
		const u0 = i / strips;
		const u1 = (i + 1) / strips;
		const x0 = lerp(maxX, minX, u0);
		const x1 = lerp(maxX, minX, u1);
		const top = Math.min(favelaGroundY(x0, zc), favelaGroundY(x1, zc));
		out.push({
			minX: Math.min(x0, x1),
			maxX: Math.max(x0, x1),
			minZ: zc - half(depth),
			maxZ: zc + half(depth),
			minY: -0.5,
			maxY: top - 0.12,
			label: `vila_fill_${i}`,
		});
	}
	return out;
}

export { CityFavela, favelaColliders, favelaFillColliders, favelaSurfaces };
export type { FavelaGangResult };
