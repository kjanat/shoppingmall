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

/**
 * Montanha de Janeiro — Corcovado knock-off SW of the ring.
 * Green rock tiers + white Redeemer with arms out. Visible from the mall roof and the con road.
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

	private buildRock(): void {
		const rock = lit({ color: 0x3d5c3a, roughness: 0.95 });
		const dirt = lit({ color: 0x4a3a28, roughness: 0.95 });
		const stone = lit({ color: 0x5a5548, roughness: 0.92 });
		this.materials.push(rock, dirt, stone);
		const { x, z, baseW, baseD, rockH } = RIO_MOUNTAIN;

		const tiers = [
			{ u: 1, h: 0.22, mat: dirt },
			{ u: 0.88, h: 0.2, mat: rock },
			{ u: 0.72, h: 0.22, mat: rock },
			{ u: 0.55, h: 0.18, mat: stone },
			{ u: 0.4, h: 0.12, mat: stone },
			{ u: 0.28, h: 0.06, mat: stone },
		] as const;

		let y = 0;
		for (const tier of tiers) {
			const h = rockH * tier.h;
			const cy = y + half(h);
			this.box(baseW * tier.u, h, baseD * tier.u, tier.mat, x, cy, z, 0.08);
			this.box(baseW * tier.u * 0.92, h * 0.95, baseD * tier.u * 1.05, tier.mat, x + 1.2, cy, z - 0.8, -0.12);
			y += h;
		}

		// Ridges for silhouette from the ring.
		this.box(baseW * 0.35, rockH * 0.55, baseD * 0.4, rock, x - 6, rockH * 0.28, z + 4, 0.4);
		this.box(baseW * 0.3, rockH * 0.45, baseD * 0.35, rock, x + 7, rockH * 0.24, z - 5, -0.35);

		// Path scar up the face (lighter dirt strip).
		const path = lit({ color: 0x6b5a40, roughness: 0.98 });
		this.materials.push(path);
		this.box(2.2, rockH * 0.92, 1.1, path, x + 2, rockH * 0.46, z + 3, 0.55);
	}

	private buildStatue(): void {
		const { x, z, rockH, statueH, armSpan } = RIO_MOUNTAIN;
		const white = new THREE.MeshBasicMaterial({ color: 0xf4f0e8, toneMapped: false });
		const robe = lit({ color: 0xe8e4dc, roughness: 0.75 });
		this.materials.push(white, robe);
		this.glow = white;

		const baseY = rockH;
		// Pedestal
		this.box(5.5, 1.4, 5.5, robe, x, baseY + 0.7, z);
		this.box(3.8, 0.6, 3.8, robe, x, baseY + 1.7, z);

		const feetY = baseY + 2.1;
		// Legs + torso (robe silhouette)
		this.box(1.6, statueH * 0.42, 1.1, white, x, feetY + statueH * 0.21, z);
		// Shoulders block
		this.box(2.4, statueH * 0.12, 1.2, white, x, feetY + statueH * 0.48, z);
		// Head
		this.box(0.95, statueH * 0.16, 0.9, white, x, feetY + statueH * 0.62, z);
		// Hair / crown mass
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
		const { x, z, rockH } = RIO_MOUNTAIN;
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
		sign.position.set(x, rockH * 0.35, z + half(RIO_MOUNTAIN.baseD) + 0.5);
		this.group.add(sign);

		// Tiny Brazilian tricolor strip under the name
		const green = new THREE.MeshBasicMaterial({ color: 0x009c3b, toneMapped: false });
		const yellow = new THREE.MeshBasicMaterial({ color: 0xffdf00, toneMapped: false });
		const blue = new THREE.MeshBasicMaterial({ color: 0x002776, toneMapped: false });
		this.materials.push(green, yellow, blue);
		const stripY = rockH * 0.28;
		const stripZ = z + half(RIO_MOUNTAIN.baseD) + 0.45;
		this.box(4.5, 0.35, 0.12, green, x - 3.2, stripY, stripZ);
		this.box(4.5, 0.35, 0.12, yellow, x, stripY, stripZ);
		this.box(4.5, 0.35, 0.12, blue, x + 3.2, stripY, stripZ);
	}
}

/** Stepped rock solid for walking bodies. */
export function rioMountainColliders(): readonly BoxCollider[] {
	const { x, z, baseW, baseD, rockH, statueH } = RIO_MOUNTAIN;
	const tiers = [
		{ u: 1, h0: 0, h1: rockH * 0.22 },
		{ u: 0.88, h0: rockH * 0.22, h1: rockH * 0.42 },
		{ u: 0.72, h0: rockH * 0.42, h1: rockH * 0.64 },
		{ u: 0.55, h0: rockH * 0.64, h1: rockH * 0.82 },
		{ u: 0.4, h0: rockH * 0.82, h1: rockH * 0.94 },
		{ u: 0.28, h0: rockH * 0.94, h1: rockH },
	];
	const out: BoxCollider[] = [];
	for (let i = 0; i < tiers.length; i++) {
		const t = tiers[i];
		if (!t) continue;
		const hw = half(baseW * t.u);
		const hd = half(baseD * t.u);
		out.push({
			minX: x - hw,
			maxX: x + hw,
			minZ: z - hd,
			maxZ: z + hd,
			minY: t.h0,
			maxY: t.h1,
			label: `rio_rock_${i}`,
		});
	}
	// Pedestal + figure as one tall thin solid so you bounce off Christ.
	const ped = 2.8;
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

/** Optional flat pad on the peak for drone / lookout (not a full walkable climb). */
export function rioMountainSurfaces(): readonly Readonly<{
	minX: number;
	maxX: number;
	minZ: number;
	maxZ: number;
	y: number;
	label: string;
}>[] {
	const { x, z, rockH } = RIO_MOUNTAIN;
	const s = 2.4;
	return [
		{
			minX: x - s,
			maxX: x + s,
			minZ: z - s,
			maxZ: z + s,
			y: rockH + 2,
			label: 'rio_pedestal',
		},
	];
}
