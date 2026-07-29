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

	constructor() {
		this.buildMall();
	}

	private add(
		minX: number,
		maxX: number,
		minZ: number,
		maxZ: number,
		opts?: { minY?: number; maxY?: number; label?: string },
	): void {
		this.boxes.push({
			minX,
			maxX,
			minZ,
			maxZ,
			minY: opts?.minY,
			maxY: opts?.maxY,
			label: opts?.label,
		});
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

		// Store pods — solid BACK half only so doorways stay walkable (shops OPEN)
		for (const s of STORES) {
			if (s.id === 'info') continue;
			const y0 = s.floor * FLOOR_H;
			const y1 = y0 + 4.5;
			// Center of solid back mass (deeper into store, not the entrance)
			const pull = s.depth * 0.55;
			const cx = s.x - Math.sin(s.rotation) * pull;
			const cz = s.z - Math.cos(s.rotation) * pull;
			const extX = s.width * 0.45;
			const extZ = s.depth * 0.35;
			this.add(cx - extX, cx + extX, cz - extZ, cz + extZ, {
				minY: y0 - 0.5,
				maxY: y1,
				label: `store_${s.id}`,
			});
		}

		// Escalator volume (east) — solid so nobody walks through the incline
		// Bottom (22,0,6) → top (22,6,-4), width ~2
		this.add(20.8, 23.2, -5.5, 7.2, { label: 'escalator' });

		// Stairs volume (west)
		this.add(-23.5, -20.5, -17, -4.5, { label: 'stairs' });

		// Atrium fountain / planter (floor 0)
		this.add(-2.6, 2.6, -2.6, 2.6, { minY: -0.5, maxY: 3.5, label: 'fountain' });

		// Floor-1 VOID (architect: weide/void) — cannot walk over atrium hole
		// Hole is roughly ±8 x ±6 on floor 1 — solid barrier so sims don't hang mid-air
		this.add(-8.5, 8.5, -6.5, 6.5, { minY: 4.5, maxY: 12, label: 'void_f1' });

		// Spaceship pad — food-court roof / south edge (better place)
		this.add(-4, 4, 14, 20, { minY: 5, maxY: 14, label: 'ufo_pad' });

		// Aperol bar
		this.add(-16, -12, 9, 11.5, { minY: -0.5, maxY: 3, label: 'aperol' });

		// Kiosk base
		this.add(-1.0, 1.0, 9.0, 11.0, { minY: -0.5, maxY: 3, label: 'kiosk' });
	}

	/** Snap agent Y to solid floor (never float mid-air / through slab) */
	snapFloorY(x: number, z: number, y: number): number {
		// Escalator/stairs mid-climb: allow intermediate Y
		if (y > 0.4 && y < 5.6) {
			if (x > 19 && x < 25 && z > -6 && z < 8) return y;
			if (x > -25 && x < -19 && z > -18 && z < -4) return y;
		}
		return y < 3.2 ? 0 : 6;
	}

	/**
	 * Resolve a circle (radius r) at (x,z) with optional y for floor-filtered boxes.
	 * Returns corrected position. Multi-pass for corners.
	 */
	resolveCircle(
		x: number,
		z: number,
		y: number,
		radius: number,
		iterations = 3,
	): { x: number; z: number } {
		let px = x;
		let pz = z;
		for (let iter = 0; iter < iterations; iter++) {
			for (const b of this.boxes) {
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
		const push = (minDist - d) * 0.5;
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
