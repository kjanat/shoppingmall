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

const FOUNDATION_DROP = 4;
const SKIRT_PAD = 12;
const SURFACE_LIP = 0.06;
const RIDGE_H_FRAC = 0.45;

/** Montanha de Janeiro — rock bulk under Vila do Monte, Redeemer on the peak. */
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

	private buildFoundation(): void {
		const dirt = lit({ color: 0x3a2a1c, roughness: 0.98 });
		const soil = lit({ color: 0x4a3a28, roughness: 0.97 });
		this.materials.push(dirt, soil);
		const { x, z, baseW, baseD } = RIO_MOUNTAIN;
		const footH = FOUNDATION_DROP + 1.5;
		this.box(baseW + SKIRT_PAD * 2, footH, baseD + SKIRT_PAD * 2, dirt, x, -FOUNDATION_DROP + half(footH), z);
		this.box(baseW + SKIRT_PAD, 1.6, baseD + SKIRT_PAD, soil, x, 0.5, z);
	}

	private buildRock(): void {
		const rock = lit({ color: 0x3d5c3a, roughness: 0.95 });
		const dirt = lit({ color: 0x4a3a28, roughness: 0.95 });
		const stone = lit({ color: 0x5a5548, roughness: 0.92 });
		this.materials.push(rock, dirt, stone);
		const { x, z, baseW, baseD, rockH } = RIO_MOUNTAIN;

		let y = 0;
		for (const tier of tierSpecs()) {
			const h = rockH * tier.hFrac;
			const w = baseW * tier.u;
			const d = baseD * tier.u;
			const mat = tier.mat === 'dirt' ? dirt : tier.mat === 'stone' ? stone : rock;
			this.box(w, h, d, mat, x, y + half(h), z);
			y += h;
		}
		this.box(baseW * 0.32, rockH * RIDGE_H_FRAC, baseD * 0.38, rock, x - 9, rockH * 0.22, z + 7, 0.4);
		this.box(baseW * 0.28, rockH * 0.4, baseD * 0.32, rock, x + 6, rockH * 0.2, z - 8, -0.35);
	}

	private buildStatue(): void {
		const { x, z, rockH, statueH, armSpan } = RIO_MOUNTAIN;
		const white = new THREE.MeshBasicMaterial({ color: 0xf4f0e8, toneMapped: false });
		const robe = lit({ color: 0xe8e4dc, roughness: 0.75 });
		const yard = lit({ color: 0x5a4a38, roughness: 0.96 });
		this.materials.push(white, robe, yard);
		this.glow = white;

		const baseY = rockH;
		// One flat village square under Jesus — no stepped rings.
		this.box(plazaW, 0.28, plazaW, yard, x, baseY + 0.12, z);
		this.box(5.2, 0.9, 5.2, robe, x, baseY + 0.7, z);

		const feetY = baseY + 1.15;
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
		const { x, z, baseW, baseD } = RIO_MOUNTAIN;
		const { canvas, ctx } = labelCanvas(640, 96);
		ctx.fillStyle = '#0a2818';
		ctx.fillRect(0, 0, 640, 96);
		ctx.fillStyle = '#ffdf00';
		fitText(ctx, RIO_MOUNTAIN.label, { x: 16, y: 12, w: 608, h: 72 }, { size: 42, maxLines: 1 });
		const tex = labelTexture(canvas);
		this.textures.push(tex);
		const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false });
		this.materials.push(mat);
		const geo = new THREE.PlaneGeometry(12, 1.8);
		this.geometries.push(geo);
		const sign = backToBackLabel(geo, mat);
		sign.position.set(x + half(baseW) + 1.5, 2.8, z + half(baseD) * 0.25);
		sign.rotation.y = -Math.PI / 2;
		this.group.add(sign);
	}
}

type TierSpec = Readonly<{ u: number; hFrac: number; mat: 'dirt' | 'rock' | 'stone' }>;

const plazaW = 16;

function tierSpecs(): readonly TierSpec[] {
	return [
		{ u: 1.05, hFrac: 0.16, mat: 'dirt' },
		{ u: 0.92, hFrac: 0.17, mat: 'rock' },
		{ u: 0.78, hFrac: 0.17, mat: 'rock' },
		{ u: 0.64, hFrac: 0.16, mat: 'stone' },
		{ u: 0.5, hFrac: 0.14, mat: 'stone' },
		{ u: 0.36, hFrac: 0.12, mat: 'stone' },
		{ u: 0.24, hFrac: 0.08, mat: 'stone' },
	];
}

/**
 * Solid under the mountain only where it must block walking through rock.
 * Climb is owned by the village slope; rock tiers are visual bulk, not walls.
 */
export function rioMountainColliders(): readonly BoxCollider[] {
	const { x, z, baseW, baseD, rockH, statueH } = RIO_MOUNTAIN;
	const out: BoxCollider[] = [];
	out.push({
		minX: x - half(baseW) - SKIRT_PAD,
		maxX: x + half(baseW) + SKIRT_PAD,
		minZ: z - half(baseD) - SKIRT_PAD,
		maxZ: z + half(baseD) + SKIRT_PAD,
		minY: -FOUNDATION_DROP,
		maxY: 0.1,
		label: 'rio_foundation',
	});
	// West cliff mass (behind Jesus, off the east climb streets).
	out.push({
		minX: x - half(baseW) - 2,
		maxX: x - 10,
		minZ: z - half(baseD) * 0.85,
		maxZ: z + half(baseD) * 0.85,
		minY: 0,
		maxY: rockH - SURFACE_LIP,
		label: 'rio_west_mass',
	});
	const ped = 2.4;
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

/** Flat peak plaza shared with the village square. */
export function rioMountainSurfaces(): readonly Surf[] {
	const { x, z, rockH } = RIO_MOUNTAIN;
	const pad = half(plazaW);
	return [
		{
			minX: x - pad,
			maxX: x + pad,
			minZ: z - pad,
			maxZ: z + pad,
			y: rockH + 0.14,
			label: 'rio_peak_yard',
		},
	];
}
