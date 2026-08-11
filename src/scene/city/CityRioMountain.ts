import * as THREE from 'three';
import { lit } from '#/render/material';
import { RIO_MOUNTAIN } from '#/scene/city/cityPlan';
import { backToBackLabel, fitText, labelCanvas, labelTexture } from '#/util/label';
import { half } from '#/util/math';

type BoxCollider = Readonly<{
	minX: number;
	maxX: number;
	minZ: number;
	maxZ: number;
	minY: number;
	maxY: number;
	label: string;
}>;

type Surf = Readonly<{
	minX: number;
	maxX: number;
	minZ: number;
	maxZ: number;
	y: number;
	label: string;
}>;

/** Buried so the foot never reads as a floating plate. */
const FOUNDATION_DROP = 4;
/** How far the base skirt spreads past the first rock tier. */
const SKIRT_PAD = 10;
/** Stair corridor on the east (ring-facing) flank. */
const STAIR_W = 3.8;
/** Must stay under WALK_STEP (0.5 m) so grounded walking can climb. */
const STEP_RISE = 0.38;
const STEP_RUN = 1.25;
/** Surface sits this far above the solid maxY so feet clear the collider. */
const SURFACE_LIP = 0.06;
const RIDGE_H_FRAC = 0.5;
/** Final ramp from last stair onto the pedestal (no jump to Jesus). */
const PEAK_BRIDGE_H = 0.35;

/**
 * Montanha de Janeiro — grounded rock, walkable terraces, switchback stairs to the Redeemer.
 */
export class CityRioMountain {
	readonly group = new THREE.Group();
	readonly peak = new THREE.Vector3(RIO_MOUNTAIN.x, RIO_MOUNTAIN.rockH + RIO_MOUNTAIN.statueH, RIO_MOUNTAIN.z);

	private readonly materials: THREE.Material[] = [];
	private readonly geometries: THREE.BufferGeometry[] = [];
	private readonly textures: THREE.Texture[] = [];
	private readonly unit = new THREE.BoxGeometry(1, 1, 1);
	private glow: THREE.MeshBasicMaterial | null = null;

	constructor() {
		this.group.name = 'city_rio_mountain';
		this.geometries.push(this.unit);
		this.buildFoundation();
		this.buildRock();
		this.buildStairs();
		this.buildStatue();
		this.buildSign();
	}

	update(t: number): void {
		if (!this.glow) return;
		const pulse = 0.75 + 0.25 * Math.sin(t * 0.7);
		this.glow.color.setRGB(pulse, pulse, pulse * 0.95);
	}

	dispose(): void {
		for (const m of this.materials) m.dispose();
		for (const g of this.geometries) g.dispose();
		for (const t of this.textures) t.dispose();
	}

	private box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, rotY = 0): THREE.Mesh {
		const m = new THREE.Mesh(this.unit, mat);
		m.scale.set(w, h, d);
		m.position.set(x, y, z);
		m.rotation.y = rotY;
		m.castShadow = true;
		m.receiveShadow = true;
		this.group.add(m);
		return m;
	}

	/** Wide dirt skirt into the ground so the hill never looks airborne. */
	private buildFoundation(): void {
		const dirt = lit({ color: 0x3a2a1c, roughness: 0.98 });
		const soil = lit({ color: 0x4a3a28, roughness: 0.97 });
		this.materials.push(dirt, soil);
		const { x, z, baseW, baseD } = RIO_MOUNTAIN;
		const footH = FOUNDATION_DROP + 1.2;
		const cy = -FOUNDATION_DROP + half(footH);
		this.box(baseW + SKIRT_PAD * 2, footH, baseD + SKIRT_PAD * 2, dirt, x, cy, z);
		this.box(baseW + SKIRT_PAD * 1.2, 1.4, baseD + SKIRT_PAD * 1.2, soil, x, half(1.4) - 0.2, z);
		// East ramp pad meeting the road / favela approach
		const eastX = x + half(baseW) + 4;
		this.box(14, 1.2, baseD * 0.7, soil, eastX, 0.4, z);
	}

	private buildRock(): void {
		const rock = lit({ color: 0x3d5c3a, roughness: 0.95 });
		const dirt = lit({ color: 0x4a3a28, roughness: 0.95 });
		const stone = lit({ color: 0x5a5548, roughness: 0.92 });
		const deck = lit({ color: 0x5a5040, roughness: 0.96 });
		this.materials.push(rock, dirt, stone, deck);
		const { x, z, baseW, baseD, rockH } = RIO_MOUNTAIN;

		const tiers = tierSpecs();
		let y = 0;
		for (const tier of tiers) {
			const h = rockH * tier.hFrac;
			const cy = y + half(h);
			const w = baseW * tier.u;
			const d = baseD * tier.u;
			this.box(w, h, d, tier.mat === 'dirt' ? dirt : tier.mat === 'stone' ? stone : rock, x, cy, z);
			// Flat walkable deck plate on top of each tier
			this.box(w * 0.98, 0.18, d * 0.98, deck, x, y + h + 0.05, z);
			y += h;
		}

		// Side ridges (solid, sit on foundation)
		this.box(baseW * 0.35, rockH * RIDGE_H_FRAC, baseD * 0.4, rock, x - 8, rockH * 0.25, z + 6, 0.35);
		this.box(baseW * 0.3, rockH * 0.42, baseD * 0.35, rock, x + 5, rockH * 0.22, z - 7, -0.3);
	}

	/** Switchback stairs on the east face: street → peak. */
	private buildStairs(): void {
		const stepMat = lit({ color: 0x6a5a48, roughness: 0.94 });
		const railMat = lit({ color: 0x3a3028, roughness: 0.9 });
		this.materials.push(stepMat, railMat);
		const { x, z, baseW, rockH } = RIO_MOUNTAIN;
		const steps = climbSteps();
		for (const s of steps) {
			this.box(s.w, s.h, s.d, stepMat, s.x, s.y, s.z, s.rotY);
		}
		// Handrails along east climb corridor
		const east = x + half(baseW) * 0.55;
		const railH = rockH * 0.92;
		this.box(0.18, railH, 0.18, railMat, east + half(STAIR_W) + 0.2, half(railH), z - 6);
		this.box(0.18, railH, 0.18, railMat, east + half(STAIR_W) + 0.2, half(railH), z + 6);
		// Mid landings signs
		const { canvas, ctx } = labelCanvas(280, 64);
		ctx.fillStyle = '#1a1408';
		ctx.fillRect(0, 0, 280, 64);
		ctx.fillStyle = '#ffdf00';
		fitText(ctx, '↑ REDEEMER', { x: 10, y: 12, w: 260, h: 40 }, { size: 24, maxLines: 1 });
		const tex = labelTexture(canvas);
		this.textures.push(tex);
		const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false });
		this.materials.push(mat);
		const geo = new THREE.PlaneGeometry(2.4, 0.55);
		this.geometries.push(geo);
		const sign = backToBackLabel(geo, mat);
		sign.position.set(east + 1, 3.2, z);
		sign.rotation.y = -Math.PI / 2;
		this.group.add(sign);
	}

	private buildStatue(): void {
		const { x, z, rockH, statueH, armSpan } = RIO_MOUNTAIN;
		const white = new THREE.MeshBasicMaterial({ color: 0xf4f0e8, toneMapped: false });
		const robe = lit({ color: 0xe8e4dc, roughness: 0.75 });
		this.materials.push(white, robe);
		this.glow = white;

		const baseY = rockH;
		this.box(6.2, 1.5, 6.2, robe, x, baseY + 0.75, z);
		this.box(4.2, 0.65, 4.2, robe, x, baseY + 1.85, z);

		const feetY = baseY + 2.2;
		this.box(1.6, statueH * 0.42, 1.1, white, x, feetY + statueH * 0.21, z);
		this.box(2.4, statueH * 0.12, 1.2, white, x, feetY + statueH * 0.48, z);
		this.box(0.95, statueH * 0.16, 0.9, white, x, feetY + statueH * 0.62, z);
		this.box(1.05, statueH * 0.08, 1, white, x, feetY + statueH * 0.72, z + 0.05);

		const armY = feetY + half(statueH);
		const armLen = half(armSpan);
		const armThick = 0.55;
		this.box(armSpan, armThick, armThick, white, x, armY, z);
		this.box(0.7, 0.55, 0.55, white, x - armLen, armY, z);
		this.box(0.7, 0.55, 0.55, white, x + armLen, armY, z);
		this.box(armSpan * 0.85, 0.35, 0.85, robe, x, armY - 0.35, z);

		const cross = lit({ color: 0xd0ccc4, roughness: 0.8 });
		this.materials.push(cross);
		this.box(0.25, statueH * 0.22, 0.15, cross, x, feetY + statueH * 0.38, z + 0.55);
		this.box(0.7, 0.22, 0.15, cross, x, feetY + statueH * 0.42, z + 0.55);
	}

	private buildSign(): void {
		const { x, z, baseD } = RIO_MOUNTAIN;
		const { canvas, ctx } = labelCanvas(640, 96);
		ctx.fillStyle = '#0a2818';
		ctx.fillRect(0, 0, 640, 96);
		ctx.fillStyle = '#ffdf00';
		fitText(ctx, RIO_MOUNTAIN.label, { x: 16, y: 12, w: 608, h: 72 }, { size: 42, maxLines: 1 });
		const tex = labelTexture(canvas);
		this.textures.push(tex);
		const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false });
		this.materials.push(mat);
		const geo = new THREE.PlaneGeometry(14, 2.1);
		this.geometries.push(geo);
		const sign = backToBackLabel(geo, mat);
		// At street level on the east approach — not floating mid-cliff.
		sign.position.set(x + half(RIO_MOUNTAIN.baseW) + 2, 3.2, z + half(baseD) * 0.3);
		sign.rotation.y = -Math.PI / 2;
		this.group.add(sign);

		const green = new THREE.MeshBasicMaterial({ color: 0x009c3b, toneMapped: false });
		const yellow = new THREE.MeshBasicMaterial({ color: 0xffdf00, toneMapped: false });
		const blue = new THREE.MeshBasicMaterial({ color: 0x002776, toneMapped: false });
		this.materials.push(green, yellow, blue);
		const sx = x + half(RIO_MOUNTAIN.baseW) + 2.2;
		const sz = z + half(baseD) * 0.3;
		this.box(0.12, 0.35, 1.4, green, sx, 2.2, sz - 2);
		this.box(0.12, 0.35, 1.4, yellow, sx, 2.2, sz);
		this.box(0.12, 0.35, 1.4, blue, sx, 2.2, sz + 2);
	}
}

type TierSpec = Readonly<{ u: number; hFrac: number; mat: 'dirt' | 'rock' | 'stone' }>;

function tierSpecs(): readonly TierSpec[] {
	return [
		{ u: 1, hFrac: 0.18, mat: 'dirt' },
		{ u: 0.9, hFrac: 0.18, mat: 'rock' },
		{ u: 0.78, hFrac: 0.18, mat: 'rock' },
		{ u: 0.64, hFrac: 0.16, mat: 'stone' },
		{ u: 0.5, hFrac: 0.14, mat: 'stone' },
		{ u: 0.36, hFrac: 0.1, mat: 'stone' },
		{ u: 0.24, hFrac: 0.06, mat: 'stone' },
	];
}

function tierTops(): readonly { y: number; u: number }[] {
	const { rockH } = RIO_MOUNTAIN;
	const out: { y: number; u: number }[] = [];
	let y = 0;
	for (const t of tierSpecs()) {
		y += rockH * t.hFrac;
		out.push({ y, u: t.u });
	}
	return out;
}

type StepMesh = Readonly<{ x: number; y: number; z: number; w: number; h: number; d: number; rotY: number }>;

/**
 * One continuous stair snake: ring/favela east → switchbacks → pedestal under Jesus.
 * Each tread overlaps the next in XZ and rises ≤ STEP_RISE so WALK_STEP can climb.
 */
function climbSteps(): StepMesh[] {
	const { x, z, baseW, rockH } = RIO_MOUNTAIN;
	const steps: StepMesh[] = [];
	const pedestalY = rockH + 2.15;
	// Waypoints in plan (x,z); height is pure progress along the polyline.
	const route: readonly { x: number; z: number }[] = [
		{ x: x + half(baseW) + 12, z }, // street / favela apron
		{ x: x + half(baseW) + 4, z },
		{ x: x + half(baseW) * 0.7, z: z - 7 },
		{ x: x + half(baseW) * 0.35, z: z - 7 },
		{ x: x + half(baseW) * 0.35, z: z + 7 },
		{ x: x + half(baseW) * 0.05, z: z + 7 },
		{ x: x + half(baseW) * 0.05, z: z - 5 },
		{ x: x - half(baseW) * 0.15, z: z - 5 },
		{ x: x - half(baseW) * 0.15, z: z + 4 },
		{ x, z: z + 4 },
		{ x, z }, // under Jesus
	];
	// Build cumulative lengths
	const segLen: number[] = [];
	let total = 0;
	for (let i = 0; i < route.length - 1; i++) {
		const a = route[i];
		const b = route[i + 1];
		if (!a || !b) continue;
		const len = Math.hypot(b.x - a.x, b.z - a.z);
		segLen.push(len);
		total += len;
	}
	const n = Math.max(2, Math.ceil(pedestalY / STEP_RISE));
	for (let i = 0; i < n; i++) {
		const t = i / (n - 1);
		const dist = t * total;
		// Locate segment
		let acc = 0;
		let px = x;
		let pz = z;
		let yaw = 0;
		for (let s = 0; s < segLen.length; s++) {
			const len = segLen[s] ?? 0;
			const a = route[s];
			const b = route[s + 1];
			if (!a || !b) continue;
			if (acc + len >= dist || s === segLen.length - 1) {
				const u = len < 1e-6 ? 0 : (dist - acc) / len;
				const uu = u < 0 ? 0 : u > 1 ? 1 : u;
				px = a.x + (b.x - a.x) * uu;
				pz = a.z + (b.z - a.z) * uu;
				yaw = Math.atan2(b.x - a.x, b.z - a.z);
				break;
			}
			acc += len;
		}
		const y0 = t * pedestalY;
		const isLanding = i % 8 === 0;
		steps.push({
			x: px,
			y: y0 + half(STEP_RISE),
			z: pz,
			w: isLanding ? STAIR_W + 1.8 : STAIR_W,
			h: STEP_RISE,
			d: isLanding ? STEP_RUN + 1.4 : STEP_RUN + 0.35,
			rotY: yaw,
		});
	}
	// Fat apron at the foot so you can step on from any approach angle.
	const foot = route[0];
	if (foot) {
		steps.push({
			x: foot.x,
			y: half(0.28),
			z: foot.z,
			w: 12,
			h: 0.28,
			d: 16,
			rotY: 0,
		});
	}
	// Peak deck
	steps.push({
		x,
		y: pedestalY - half(PEAK_BRIDGE_H),
		z,
		w: 9,
		h: PEAK_BRIDGE_H,
		d: 9,
		rotY: 0,
	});
	return steps;
}

/** Rock solids + stair solids. Tops stop just under walk surfaces. */
export function rioMountainColliders(): readonly BoxCollider[] {
	const { x, z, baseW, baseD, rockH, statueH } = RIO_MOUNTAIN;
	const out: BoxCollider[] = [];

	// Buried foundation
	out.push({
		minX: x - half(baseW) - SKIRT_PAD,
		maxX: x + half(baseW) + SKIRT_PAD,
		minZ: z - half(baseD) - SKIRT_PAD,
		maxZ: z + half(baseD) + SKIRT_PAD,
		minY: -FOUNDATION_DROP,
		maxY: 0.15,
		label: 'rio_foundation',
	});

	let y0 = 0;
	for (const tier of tierSpecs()) {
		const h = rockH * tier.hFrac;
		const y1 = y0 + h;
		const hw = half(baseW * tier.u);
		const hd = half(baseD * tier.u);
		out.push({
			minX: x - hw,
			maxX: x + hw,
			minZ: z - hd,
			maxZ: z + hd,
			minY: y0,
			maxY: y1 - SURFACE_LIP,
			label: `rio_rock_${y0.toFixed(0)}`,
		});
		y0 = y1;
	}

	for (const [i, s] of climbSteps().entries()) {
		out.push({
			minX: s.x - half(s.w),
			maxX: s.x + half(s.w),
			minZ: s.z - half(s.d),
			maxZ: s.z + half(s.d),
			minY: s.y - half(s.h),
			maxY: s.y + half(s.h) - SURFACE_LIP,
			label: `rio_step_${i}`,
		});
	}

	const ped = 3.2;
	out.push({
		minX: x - ped,
		maxX: x + ped,
		minZ: z - ped,
		maxZ: z + ped,
		minY: rockH,
		maxY: rockH + statueH + 2.5,
		label: 'rio_redeemer',
	});
	return out;
}

/** Walkable decks: each rock terrace + every stair tread + peak pedestal. */
export function rioMountainSurfaces(): readonly Surf[] {
	const { x, z, baseW, baseD, rockH } = RIO_MOUNTAIN;
	const out: Surf[] = [];

	for (const tier of tierTops()) {
		const hw = half(baseW * tier.u) - 0.2;
		const hd = half(baseD * tier.u) - 0.2;
		out.push({
			minX: x - hw,
			maxX: x + hw,
			minZ: z - hd,
			maxZ: z + hd,
			y: tier.y + 0.12,
			label: `rio_terrace_${tier.y.toFixed(0)}`,
		});
	}

	for (const [i, s] of climbSteps().entries()) {
		out.push({
			minX: s.x - half(s.w) + 0.05,
			maxX: s.x + half(s.w) - 0.05,
			minZ: s.z - half(s.d) + 0.05,
			maxZ: s.z + half(s.d) - 0.05,
			y: s.y + half(s.h) + 0.02,
			label: `rio_tread_${i}`,
		});
	}

	const pedY = rockH + 2.15;
	const s = 3.4;
	out.push({
		minX: x - s,
		maxX: x + s,
		minZ: z - s,
		maxZ: z + s,
		y: pedY,
		label: 'rio_pedestal',
	});
	// Ramp ring around pedestal so last stair (any lane) steps on cleanly.
	out.push({
		minX: x - 5.5,
		maxX: x + 5.5,
		minZ: z - 5.5,
		maxZ: z + 5.5,
		y: pedY - 0.2,
		label: 'rio_pedestal_lip',
	});
	return out;
}

/** Height of the east climb at world x (for favela to sit on the same slope). */
export function rioSlopeY(x: number): number {
	const { x: cx, baseW, rockH } = RIO_MOUNTAIN;
	const east = cx + half(baseW);
	const west = cx - half(baseW) * 0.2;
	if (x >= east) return 0;
	if (x <= west) return rockH * 0.85;
	const t = inverseLerp(east, west, x);
	return rockH * 0.85 * t * t;
}

function inverseLerp(a: number, b: number, v: number): number {
	if (a === b) return 0;
	const t = (v - a) / (b - a);
	return t < 0 ? 0 : t > 1 ? 1 : t;
}
