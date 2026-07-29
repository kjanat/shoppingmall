import { STORES } from '../data/stores';

export type AABB = {
	minX: number;
	maxX: number;
	minZ: number;
	maxZ: number;
	/** Optional vertical range — if set, only collide when agent Y is in range */
	minY?: number;
	maxY?: number;
	label?: string;
	/** Climbers (the player) walk ON this instead of into it — see `ramps`. */
	climbable?: boolean;
};

/** A walkable incline running along Z (escalator / stairs). */
export type Ramp = {
	minX: number;
	maxX: number;
	zBottom: number;
	zTop: number;
	yBottom: number;
	yTop: number;
	label: string;
};

const FLOOR_H = 6;
const MALL_W = 72;
const MALL_D = 48;

/**
 * Lightweight horizontal collision world (XZ cylinders vs AABBs).
 * Keeps player + sims out of walls, stores, escalator/stairs volumes.
 */
export class CollisionWorld {
	readonly boxes: AABB[] = [];
	/** Inclines the player can actually walk up — mirrors the built geometry. */
	readonly ramps: Ramp[] = [
		// East roltrap only — never shares space with west stairs
		{
			minX: 20.7,
			maxX: 23.3,
			zBottom: 8,
			zTop: -2,
			yBottom: 0,
			yTop: 6,
			label: 'escalator',
		},
		// West trap only — opposite wall, cannot cross the escalator
		{
			minX: -23.5,
			maxX: -20.5,
			zBottom: 4,
			zTop: -14,
			yBottom: 0,
			yTop: 6,
			label: 'stairs',
		},
	];

	constructor() {
		this.buildMall();
	}

	private add(
		minX: number,
		maxX: number,
		minZ: number,
		maxZ: number,
		opts?: { minY?: number; maxY?: number; label?: string; climbable?: boolean },
	): void {
		this.boxes.push({
			minX,
			maxX,
			minZ,
			maxZ,
			minY: opts?.minY,
			maxY: opts?.maxY,
			label: opts?.label,
			climbable: opts?.climbable,
		});
	}

	/** Runtime colliders (WC walls, props added after construct) */
	addBox(
		minX: number,
		maxX: number,
		minZ: number,
		maxZ: number,
		opts?: { minY?: number; maxY?: number; label?: string; climbable?: boolean },
	): void {
		this.add(minX, maxX, minZ, maxZ, opts);
	}

	private buildMall(): void {
		const hw = MALL_W / 2;
		const hd = MALL_D / 2;
		const wallT = 0.8;

		// Outer walls (both floors — full height vertical ignore for XZ)
		this.add(-hw - wallT, -hw + 0.2, -hd - wallT, hd + wallT, { label: 'wall_w' });
		this.add(hw - 0.2, hw + wallT, -hd - wallT, hd + wallT, { label: 'wall_e' });
		this.add(-hw - wallT, hw + wallT, -hd - wallT, -hd + 0.2, { label: 'wall_n' });
		this.add(-hw - wallT, hw + wallT, hd - 0.2, hd + wallT, { label: 'wall_s' });

		// Store: thin BACK wall only — open interior for stock + shopkeeper
		for (const s of STORES) {
			if (s.id === 'info') continue;
			const y0 = s.floor * FLOOR_H;
			const y1 = y0 + 4.5;
			const roomDepth = s.depth * 0.92;
			const backCx = s.x - Math.sin(s.rotation) * roomDepth;
			const backCz = s.z - Math.cos(s.rotation) * roomDepth;
			const halfW = s.width * 0.48;
			this.add(backCx - halfW, backCx + halfW, backCz - 0.4, backCz + 0.4, {
				minY: y0 - 0.5,
				maxY: y1,
				label: `store_back_${s.id}`,
			});
		}

		// Escalator volume (east only)
		this.add(20.8, 23.2, -3.5, 9, { label: 'escalator', climbable: true });

		// Stairs volume (west only) — does NOT overlap escalator
		this.add(-23.5, -20.5, -15.5, 5, { label: 'stairs', climbable: true });

		// Floor-1 openings — kept in step with the holes cut in MallBuilder, which
		// sit over the flights themselves (not beside the top landings).
		this.add(-24.2, -19.8, -14.8, -7.2, {
			minY: 5.2,
			maxY: 7.5,
			label: 'stair_shaft_top',
			climbable: true,
		});
		this.add(20.1, 23.9, -2.8, 1.8, {
			minY: 5.2,
			maxY: 7.5,
			label: 'esc_shaft_top',
			climbable: true,
		});

		// Atrium fountain / planter (floor 0)
		this.add(-2.6, 2.6, -2.6, 2.6, { minY: -0.5, maxY: 3.5, label: 'fountain' });

		// Floor-1 VOID (architect: weide/void) — cannot walk over atrium hole
		// Hole is roughly ±8 x ±6 on floor 1 — solid barrier so sims don't hang mid-air
		this.add(-8.5, 8.5, -6.5, 6.5, { minY: 4.5, maxY: 12, label: 'void_f1' });

		// (No UFO pad box any more — the saucer hovers in the atrium void, so the
		//  floor-1 balcony at z≈16 is walkable again.)

		// Aperol bar
		this.add(-16, -12, 9, 11.5, { minY: -0.5, maxY: 3, label: 'aperol' });

		// Kiosk base
		this.add(-1.0, 1.0, 9.0, 11.0, { minY: -0.5, maxY: 3, label: 'kiosk' });
	}

	/**
	 * Snap agent Y to solid floor (never float mid-air / through slab).
	 * Derived from `ramps` so it can't drift out of sync with the built geometry —
	 * hard-coded windows are what made sims pop on the west stairs.
	 */
	snapFloorY(x: number, z: number, y: number): number {
		if (y > 0.4 && y < FLOOR_H - 0.4) {
			for (const r of this.ramps) {
				if (x < r.minX - 1 || x > r.maxX + 1) continue;
				if (z < Math.min(r.zBottom, r.zTop) - 1.5) continue;
				if (z > Math.max(r.zBottom, r.zTop) + 1.5) continue;
				return y;
			}
		}
		return y < 3.2 ? 0 : FLOOR_H;
	}

	/**
	 * Walkable surface height at (x,z) for a climber (the player).
	 *
	 * Inside an incline's corridor the incline *is* the floor, but only while it
	 * is within `step` of where your feet already are — that's what keeps you on
	 * the floor-1 slab when you walk over the escalator shaft instead of dropping
	 * through it. Airborne callers pass a bigger `step` so a jump mid-escalator
	 * doesn't snap you to the deck above.
	 */
	groundHeightAt(x: number, z: number, currentY: number, step = 0.5): number {
		const slab = currentY < 3.2 ? 0 : FLOOR_H;

		for (const r of this.ramps) {
			if (x < r.minX || x > r.maxX) continue;
			const zLo = Math.min(r.zBottom, r.zTop) - 1.2;
			const zHi = Math.max(r.zBottom, r.zTop) + 1.2;
			if (z < zLo || z > zHi) continue;

			const raw = (z - r.zBottom) / (r.zTop - r.zBottom);
			const t = raw < 0 ? 0 : raw > 1 ? 1 : raw;
			const h = r.yBottom + (r.yTop - r.yBottom) * t;
			if (Math.abs(h - currentY) <= step) return h;
		}
		return slab;
	}

	/** True while the climber is standing on an incline rather than a slab. */
	onRamp(x: number, z: number, y: number): boolean {
		return y > 0.6 && y < FLOOR_H - 0.6
			&& this.ramps.some(
				(r) =>
					x >= r.minX && x <= r.maxX
					&& z >= Math.min(r.zBottom, r.zTop) - 1.2
					&& z <= Math.max(r.zBottom, r.zTop) + 1.2,
			);
	}

	/**
	 * Resolve a circle (radius r) at (x,z) with optional y for floor-filtered boxes.
	 * Returns corrected position. Multi-pass for corners.
	 * `climb` skips the escalator/stairs volumes — the player walks up those.
	 */
	resolveCircle(
		x: number,
		z: number,
		y: number,
		radius: number,
		iterations = 3,
		climb = false,
	): { x: number; z: number } {
		let px = x;
		let pz = z;
		for (let iter = 0; iter < iterations; iter++) {
			for (const b of this.boxes) {
				if (climb && b.climbable) continue;
				if (b.minY !== undefined && y + 0.3 < b.minY) continue;
				if (b.maxY !== undefined && y > b.maxY) continue;

				// Closest point on AABB to circle center
				const cx = Math.max(b.minX, Math.min(px, b.maxX));
				const cz = Math.max(b.minZ, Math.min(pz, b.maxZ));
				let dx = px - cx;
				let dz = pz - cz;
				const d2 = dx * dx + dz * dz;

				// Center inside box → push to nearest face
				if (d2 < 1e-8) {
					const left = px - b.minX;
					const right = b.maxX - px;
					const down = pz - b.minZ;
					const up = b.maxZ - pz;
					const m = Math.min(left, right, down, up);
					if (m === left) px = b.minX - radius;
					else if (m === right) px = b.maxX + radius;
					else if (m === down) pz = b.minZ - radius;
					else pz = b.maxZ + radius;
					continue;
				}

				if (d2 < radius * radius) {
					const d = Math.sqrt(d2);
					const push = (radius - d) / d;
					px += dx * push;
					pz += dz * push;
				}
			}
		}

		// Keep inside mall footprint with margin
		const m = 1.2;
		const hw = MALL_W / 2 - m;
		const hd = MALL_D / 2 - m;
		px = Math.max(-hw, Math.min(hw, px));
		pz = Math.max(-hd, Math.min(hd, pz));

		// Floor-1 void eject (don't hang over atrium hole)
		if (y > 4) {
			const inHole = Math.abs(px) < 8.2 && Math.abs(pz) < 6.2;
			if (inHole) {
				const toEdgeX = 8.4 - Math.abs(px);
				const toEdgeZ = 6.4 - Math.abs(pz);
				if (toEdgeX < toEdgeZ) {
					px = px >= 0 ? 8.5 + radius : -8.5 - radius;
				} else {
					pz = pz >= 0 ? 6.5 + radius : -6.5 - radius;
				}
			}
		}

		return { x: px, z: pz };
	}

	/** Separate two agents (sim-sim / player-sim). */
	separate(
		ax: number,
		az: number,
		bx: number,
		bz: number,
		minDist: number,
	): { ax: number; az: number; bx: number; bz: number } {
		let dx = bx - ax;
		let dz = bz - az;
		let d2 = dx * dx + dz * dz;
		if (d2 < 1e-8) {
			dx = 0.01;
			dz = 0;
			d2 = dx * dx;
		}
		const d = Math.sqrt(d2);
		if (d >= minDist) return { ax, az, bx, bz };
		// Full split each side (was 0.5 total → still overlapped under load)
		const push = (minDist - d) * 0.52;
		const nx = dx / d;
		const nz = dz / d;
		return {
			ax: ax - nx * push,
			az: az - nz * push,
			bx: bx + nx * push,
			bz: bz + nz * push,
		};
	}
}
