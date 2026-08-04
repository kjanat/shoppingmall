import type { VerticalConnector } from '#/data/connectors';
import { ATRIUM_BARRIER, ATRIUM_VOID, MALL_FOOTPRINT } from '#/data/layout';
import { levelY } from '#/data/levels';
import { STORES } from '#/data/stores';
import {
	ESCALATOR,
	HELIPAD_DECK_BOUNDS,
	PARKING_EXIT_RAMP,
	SECRET_STAIRS_OPENING_BOUNDS,
	STAIRS,
	VERTICAL_CONNECTORS,
} from '#/data/world';
import { POOL_FLOOR_Y, POOL_WATER_Y, poolFloorY } from '#/scene/RoofIsland';
import { clamp, clamp01, half } from '#/util/math';

export { ESCALATOR_SPEED } from '#/data/world';

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
	/**
	 * Z span of the hole cut in the floor-1 slab above this flight — must match
	 * the `addRectHole` calls in MallBuilder. Inside it there is no slab, so a
	 * walker either rides the incline or drops onto it.
	 */
	openMinZ: number;
	openMaxZ: number;
	/**
	 * Tredesnelheid langs de helling (m/s) van een helling die zelf beweegt.
	 * Ontbreekt hij, dan is het een gewone trap en vervoert hij niemand.
	 */
	carrySpeed?: number;
};

type PathRamp = Readonly<{
	start: Readonly<{ x: number; y: number; z: number }>;
	end: Readonly<{ x: number; y: number; z: number }>;
	width: number;
	label: string;
}>;

function pathRampSurface(ramp: PathRamp, x: number, z: number, margin = 0): number | null {
	const dx = ramp.end.x - ramp.start.x;
	const dz = ramp.end.z - ramp.start.z;
	const run = Math.hypot(dx, dz);
	if (run <= 1e-6) return null;
	const along = ((x - ramp.start.x) * dx + (z - ramp.start.z) * dz) / run;
	const across = ((x - ramp.start.x) * -dz + (z - ramp.start.z) * dx) / run;
	if (along < -margin || along > run + margin || Math.abs(across) > ramp.width / 2 + margin) return null;
	const t = clamp01(along / run);
	return ramp.start.y + (ramp.end.y - ramp.start.y) * t;
}

function connectorRamp(connector: VerticalConnector): Ramp {
	return {
		minX: connector.collision.minX,
		maxX: connector.collision.maxX,
		zBottom: connector.zBottom,
		zTop: connector.zTop,
		yBottom: levelY(connector.from),
		yTop: levelY(connector.to),
		label: connector.id,
		openMinZ: connector.collision.openMinZ,
		openMaxZ: connector.collision.openMaxZ,
		...(connector.collision.carrySpeed === undefined ? {} : { carrySpeed: connector.collision.carrySpeed }),
	};
}

/** One storey */
const FLOOR_H = levelY('v1') - levelY('v0');
const ROOF_H = levelY('roof');
const BASEMENT_H = levelY('p1');
/**
 * Hoogteverschil waarbinnen een lopende speler een vlak nog als zijn vloer ziet.
 * Controls geeft hem mee aan `groundHeightAt`, `rampCarryAt` rekent met dezelfde
 * waarde: een bewegende helling hoort je precies dan te vervoeren als je er ook
 * echt op staat. Stond hij hier ruimer, dan sleepte de roltrap je onderaan ook
 * mee terwijl je gewoon op de vloerplaat eronder liep.
 */
export const WALK_STEP = 0.5;

/**
 * Tredesnelheid van de roltrap langs de helling (m/s). Staat hier omdat de
 * fysica hem nodig heeft om je te vervoeren en MallBuilder om de treden ermee te
 * tekenen. Twee losse getallen die gelijk moeten blijven glijden vroeg of laat
 * uit elkaar, en dan lopen de treden onder je voeten door.
 */
/**
 * Lightweight horizontal collision world (XZ cylinders vs AABBs).
 * Keeps player + sims out of walls, stores, escalator/stairs volumes.
 */
export class CollisionWorld {
	readonly boxes: AABB[] = [];
	readonly pathRamps: readonly PathRamp[] = [
		{
			start: PARKING_EXIT_RAMP.start,
			end: PARKING_EXIT_RAMP.end,
			width: PARKING_EXIT_RAMP.width,
			label: PARKING_EXIT_RAMP.id,
		},
	];
	/** Inclines the player can actually walk up — mirrors the built geometry. */
	readonly ramps: Ramp[] = [
		...VERTICAL_CONNECTORS.map(connectorRamp),
		// Glijbaan-ladder op het dakeiland: extreem steile "ramp" — loop er
		// noordwaarts tegenaan en je klautert naar het platform (arcade-klimmen)
		{
			minX: -29.2,
			maxX: -27.8,
			zBottom: -12.2,
			zTop: -10.9,
			yBottom: 13.95,
			yTop: 18.03,
			label: 'slide_ladder',
			openMinZ: -11.5,
			openMaxZ: -10.4,
		},
	];

	/**
	 * Flat walkable roof patches (deck clipped clear of the atrium skylight).
	 * Het SE-dek is opgeknipt rond het gedeelde secret-stairs-trapgat. Een los
	 * getal hier legde dat gat eerder met een onzichtbare collisionplaat dicht.
	 */
	readonly roofPads: { minX: number; maxX: number; minZ: number; maxZ: number; y: number }[] = [
		// Helipad SE deck, in vier stukken om het trapgat heen
		{
			minX: HELIPAD_DECK_BOUNDS.minX,
			maxX: SECRET_STAIRS_OPENING_BOUNDS.minX,
			minZ: HELIPAD_DECK_BOUNDS.minZ,
			maxZ: HELIPAD_DECK_BOUNDS.maxZ,
			y: ROOF_H,
		},
		{
			minX: SECRET_STAIRS_OPENING_BOUNDS.maxX,
			maxX: HELIPAD_DECK_BOUNDS.maxX,
			minZ: HELIPAD_DECK_BOUNDS.minZ,
			maxZ: HELIPAD_DECK_BOUNDS.maxZ,
			y: ROOF_H,
		},
		{
			minX: SECRET_STAIRS_OPENING_BOUNDS.minX,
			maxX: SECRET_STAIRS_OPENING_BOUNDS.maxX,
			minZ: HELIPAD_DECK_BOUNDS.minZ,
			maxZ: SECRET_STAIRS_OPENING_BOUNDS.minZ,
			y: ROOF_H,
		},
		{
			minX: SECRET_STAIRS_OPENING_BOUNDS.minX,
			maxX: SECRET_STAIRS_OPENING_BOUNDS.maxX,
			minZ: SECRET_STAIRS_OPENING_BOUNDS.maxZ,
			maxZ: HELIPAD_DECK_BOUNDS.maxZ,
			y: ROOF_H,
		},
		// Glass elevator roof hatch (16, −8) + corridor toward helipad
		{ minX: 12, maxX: 28, minZ: -12, maxZ: 8, y: ROOF_H },
		// De gang naar de helipad, in drie stukken om hetzelfde trapgat heen als
		// hierboven. In één stuk (14..30, 4..18) legde hij het gat weer dicht dat
		// de vier pads erboven juist openhouden, en liep je erover in plaats van
		// de trap af.
		{ minX: 14, maxX: SECRET_STAIRS_OPENING_BOUNDS.minX, minZ: 4, maxZ: 18, y: ROOF_H },
		{ minX: SECRET_STAIRS_OPENING_BOUNDS.maxX, maxX: 30, minZ: 4, maxZ: 18, y: ROOF_H },
		{
			minX: SECRET_STAIRS_OPENING_BOUNDS.minX,
			maxX: SECRET_STAIRS_OPENING_BOUNDS.maxX,
			minZ: 4,
			maxZ: SECRET_STAIRS_OPENING_BOUNDS.minZ,
			y: ROOF_H,
		},
	];

	/** Low platforms you can hop onto (deck top is the walkable surface). */
	readonly platforms: { minX: number; maxX: number; minZ: number; maxZ: number; y: number; label: string }[] = [
		// Catwalk deck incl. rounded tip — jump on, strut, jump off
		{ minX: -29.5, maxX: -26.5, minZ: -4.7, maxZ: 12.05, y: 0.34, label: 'catwalk' },
		// Glijbaan-platform op het dakeiland (boven de ladder)
		{ minX: -29.45, maxX: -27.55, minZ: -10.95, maxZ: -9.05, y: 18.03, label: 'slide_platform' },
	];

	/** Atrium hole in the floor-1 slab — jump the balustrade and you drop through. */

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
		const mallEdgeX = half(MALL_FOOTPRINT.width);
		const mallEdgeZ = half(MALL_FOOTPRINT.depth);
		const wallT = 0.8;

		// West wall has a basement-height opening for the authored parking ramp.
		// A single floor-agnostic AABB here made the rendered exit impassable.
		const exitExtentZ = half(PARKING_EXIT_RAMP.width) + 0.5;
		this.add(-mallEdgeX - wallT, -mallEdgeX + 0.2, -mallEdgeZ - wallT, -exitExtentZ, { label: 'wall_w_north' });
		this.add(-mallEdgeX - wallT, -mallEdgeX + 0.2, exitExtentZ, mallEdgeZ + wallT, { label: 'wall_w_south' });
		this.add(-mallEdgeX - wallT, -mallEdgeX + 0.2, -exitExtentZ, exitExtentZ, {
			minY: -0.5,
			maxY: ROOF_H + 2,
			label: 'wall_w_above_exit',
		});
		this.add(mallEdgeX - 0.2, mallEdgeX + wallT, -mallEdgeZ - wallT, mallEdgeZ + wallT, { label: 'wall_e' });
		this.add(-mallEdgeX - wallT, mallEdgeX + wallT, -mallEdgeZ - wallT, -mallEdgeZ + 0.2, { label: 'wall_n' });
		this.add(-mallEdgeX - wallT, mallEdgeX + wallT, mallEdgeZ - 0.2, mallEdgeZ + wallT, { label: 'wall_s' });

		// Store: thin BACK wall only — open interior for stock + shopkeeper
		for (const s of STORES) {
			if (s.id === 'info' || s.utility) continue;
			const y0 = levelY(s.level);
			const y1 = y0 + 4.5;
			const roomDepth = s.depth * 0.92;
			const backCx = s.x - Math.sin(s.rotation) * roomDepth;
			const backCz = s.z - Math.cos(s.rotation) * roomDepth;
			const storeCollisionExtent = s.width * 0.48;
			this.add(backCx - storeCollisionExtent, backCx + storeCollisionExtent, backCz - 0.4, backCz + 0.4, {
				minY: y0 - 0.5,
				maxY: y1,
				label: `store_back_${s.id}`,
			});
		}

		for (const connector of [ESCALATOR, STAIRS]) {
			this.add(connector.collision.minX, connector.collision.maxX, connector.collision.minZ, connector.collision.maxZ, {
				label: connector.id,
				climbable: true,
			});
		}

		// No barrier boxes at the shaft heads: they sat exactly where a climber is
		// at y≈5.5 and shoved sims off the top of the flight. The openings are
		// handled vertically instead — see `Ramp.openMinZ` / `groundHeightAt`.

		// Atrium fountain / planter (floor 0)
		this.add(-2.6, 2.6, -2.6, 2.6, { minY: -0.5, maxY: 3.5, label: 'fountain' });

		// Floor-1 VOID (architect: weide/void) — cannot walk over atrium hole
		// Hole is roughly ±8 x ±6 on floor 1 — solid barrier so sims don't hang mid-air
		this.add(-half(ATRIUM_BARRIER.width), half(ATRIUM_BARRIER.width), -half(ATRIUM_BARRIER.depth), half(ATRIUM_BARRIER.depth), {
			minY: 4.5,
			maxY: 12,
			label: 'void_f1',
		});

		// (No UFO pad box any more — the saucer hovers in the atrium void, so the
		//  floor-1 balcony at z≈16 is walkable again.)

		// Catwalk deck (Fashion Week, floor 0 west in front of Douglas).
		// maxY sits just under the deck top (0.34): standing ON the deck skips this
		// box, standing on the floor bumps into the kerb — so you hop on, not clip in.
		this.add(-29.5, -26.5, -5.2, 11.5, { minY: -0.5, maxY: 0.3, label: 'catwalk' });

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
		for (const ramp of this.pathRamps) {
			const surface = pathRampSurface(ramp, x, z, 0.5);
			if (surface !== null && Math.abs(surface - y) < 1) return surface;
		}
		if (y > 0.4 && y < FLOOR_H - 0.4) {
			for (const r of this.ramps) {
				if (r.label === 'secret_stairs') continue;
				if (x < r.minX - 1 || x > r.maxX + 1) continue;
				if (z < Math.min(r.zBottom, r.zTop) - 1.5) continue;
				if (z > Math.max(r.zBottom, r.zTop) + 1.5) continue;
				return y;
			}
		}
		// Mid secret stairs
		if (y > FLOOR_H + 0.4 && y < ROOF_H - 0.4) {
			for (const r of this.ramps) {
				if (r.label !== 'secret_stairs') continue;
				if (x < r.minX - 1 || x > r.maxX + 1) continue;
				if (z < Math.min(r.zBottom, r.zTop) - 1.5) continue;
				if (z > Math.max(r.zBottom, r.zTop) + 1.5) continue;
				return y;
			}
		}
		if (y >= 10) {
			for (const p of this.roofPads) {
				if (x >= p.minX && x <= p.maxX && z >= p.minZ && z <= p.maxZ) return p.y;
			}
		}
		if (y >= 10) return ROOF_H;
		if (y < -2) return BASEMENT_H;
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
	groundHeightAt(x: number, z: number, currentY: number, step = 0.7): number {
		for (const ramp of this.pathRamps) {
			const surface = pathRampSurface(ramp, x, z, 0.2);
			if (surface !== null && Math.abs(surface - currentY) <= step + 0.2) return surface;
		}
		// Platforms and flights that sit ABOVE a roof pad go first. The pads span
		// whole decks and answer unconditionally up here (`currentY > FLOOR_H + 2`),
		// so anything standing on one is unreachable if the pad is asked first.
		// Both are gated on already being at that height, so nothing below changes.
		for (const p of this.platforms) {
			if (x < p.minX || x > p.maxX || z < p.minZ || z > p.maxZ) continue;
			if (currentY >= p.y - 0.35 && currentY < p.y + 2) return p.y;
		}
		for (const r of this.ramps) {
			if (r.yTop <= ROOF_H) continue;
			if (x < r.minX || x > r.maxX) continue;
			const zLo = Math.min(r.zBottom, r.zTop) - 1.2;
			const zHi = Math.max(r.zBottom, r.zTop) + 1.2;
			if (z < zLo || z > zHi) continue;
			const raw = (z - r.zBottom) / (r.zTop - r.zBottom);
			const t = raw < 0 ? 0 : raw > 1 ? 1 : raw;
			const h = r.yBottom + (r.yTop - r.yBottom) * t;
			if (Math.abs(h - currentY) <= step) return h;
		}

		// Het zwembad is een gat in het dek: binnen de waterlijn is de bodem de
		// vloer. Staat vóór roofPads, want die plaat loopt dwars over het bad heen.
		if (currentY > FLOOR_H + 2) {
			const pool = poolFloorY(x, z);
			if (pool !== null) return pool;
		}

		// Roof deck when you're up there
		for (const p of this.roofPads) {
			if (x < p.minX || x > p.maxX || z < p.minZ || z > p.maxZ) continue;
			if (Math.abs(p.y - currentY) <= step + 0.4 || currentY > FLOOR_H + 2) {
				return p.y;
			}
		}

		// Over the atrium hole there is no slab at any height below the roof: the
		// balustrade-jump drops through, and the drone can descend back in through
		// the skylight (capped just under ROOF_H so roof walkers aren't affected).
		// Does not punch into the basement garage.
		if (
			currentY < ROOF_H - 0.5 &&
			currentY > 0.3 &&
			Math.abs(x) < half(ATRIUM_VOID.width) &&
			Math.abs(z) < half(ATRIUM_VOID.depth)
		) {
			return 0;
		}

		// Underground parking deck
		if (currentY < -2) return BASEMENT_H;

		const slab = currentY < 3.2 ? 0 : currentY >= 10 ? ROOF_H : FLOOR_H;

		for (const r of this.ramps) {
			if (x < r.minX || x > r.maxX) continue;
			const zLo = Math.min(r.zBottom, r.zTop) - 1.2;
			const zHi = Math.max(r.zBottom, r.zTop) + 1.2;
			if (z < zLo || z > zHi) continue;

			const raw = (z - r.zBottom) / (r.zTop - r.zBottom);
			const t = raw < 0 ? 0 : raw > 1 ? 1 : raw;
			const h = r.yBottom + (r.yTop - r.yBottom) * t;
			// Close enough to stand on → ride the incline
			if (Math.abs(h - currentY) <= step) return h;
			// Over the slab cut-out there is no floor: drop onto the flight
			if (currentY > h && z >= r.openMinZ && z <= r.openMaxZ) return h;
			// Secret stairs: always prefer incline when in the shaft
			if (r.label === 'secret_stairs' && currentY > FLOOR_H - 0.5) return h;
			// Otherwise this is solid slab (or you're walking underneath the flight)
			return slab;
		}
		return slab;
	}

	/**
	 * Hoeveel water er boven je voeten staat in het dakbad, 0 op het droge.
	 * De hoogtecheck eerst: onder het bad ligt gewoon de mall.
	 */
	waterDepthAt(x: number, z: number, feetY: number): number {
		if (feetY > POOL_WATER_Y || feetY < POOL_FLOOR_Y - 0.5) return 0;
		return poolFloorY(x, z) === null ? 0 : POOL_WATER_Y - feetY;
	}

	/**
	 * Drift van een bewegende helling voor wie erop staat, anders null. Zelfde
	 * mechaniek als MovingWalkways.beltVelocityAt, dus de aanroeper verplaatst je
	 * ermee door de collision heen. Alleen de horizontale component: de hoogte
	 * volgt al uit groundHeightAt zodra je meeschuift, en samen zijn ze precies
	 * `carrySpeed` langs de helling. Een trap zonder carrySpeed vervoert niet.
	 */
	rampCarryAt(x: number, z: number, feetY: number): { x: number; z: number } | null {
		for (const r of this.ramps) {
			const speed = r.carrySpeed;
			if (speed === undefined) continue;
			if (x < r.minX || x > r.maxX) continue;
			if (z < Math.min(r.zBottom, r.zTop) || z > Math.max(r.zBottom, r.zTop)) continue;
			const run = r.zTop - r.zBottom;
			const rise = r.yTop - r.yBottom;
			const h = r.yBottom + rise * ((z - r.zBottom) / run);
			if (Math.abs(h - feetY) > WALK_STEP) continue;
			return { x: 0, z: (speed * run) / Math.hypot(run, rise) };
		}
		return null;
	}

	/** True while the climber is standing on an incline rather than a slab. */
	onRamp(x: number, z: number, y: number): boolean {
		if (
			this.pathRamps.some(
				(ramp) => pathRampSurface(ramp, x, z, 0.2) !== null && Math.abs((pathRampSurface(ramp, x, z) ?? y) - y) < 0.7,
			)
		) {
			return true;
		}
		return (
			y > 0.6 &&
			y < FLOOR_H - 0.6 &&
			this.ramps.some(
				(r) => x >= r.minX && x <= r.maxX && z >= Math.min(r.zBottom, r.zTop) - 1.2 && z <= Math.max(r.zBottom, r.zTop) + 1.2,
			)
		);
	}

	/**
	 * 'mall' = clamp to mall footprint (default, sims + walkers).
	 * 'city' = full outdoor world (±95 / ±75) for cars / fly-out.
	 */
	boundsMode: 'mall' | 'city' = 'mall';

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
		airborne = false,
	): { x: number; z: number } {
		let px = x;
		let pz = z;
		const inGarageExit =
			y < 0.8 &&
			px <= Math.max(PARKING_EXIT_RAMP.start.x, PARKING_EXIT_RAMP.end.x) + 1.5 &&
			Math.abs(pz - PARKING_EXIT_RAMP.start.z) <= PARKING_EXIT_RAMP.width / 2 + 1;
		const city = this.boundsMode === 'city' || inGarageExit;
		for (let iter = 0; iter < iterations; iter++) {
			for (const b of this.boxes) {
				if (climb && b.climbable) continue;
				// Mid-jump the void barrier doesn't exist — that's how you clear
				// the balustrade. Gravity takes it from there.
				if (airborne && (b.label === 'void_f1' || b.label === 'catwalk')) continue;
				// Cars outside: skip interior mall wall boxes that only exist for foot traffic
				if (city && y > -1 && b.label?.startsWith('store')) continue;
				if (b.minY !== undefined && y + 0.3 < b.minY) continue;
				if (b.maxY !== undefined && y > b.maxY) continue;

				// Closest point on AABB to circle center
				const cx = clamp(px, b.minX, b.maxX);
				const cz = clamp(pz, b.minZ, b.maxZ);
				const dx = px - cx;
				const dz = pz - cz;
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

		if (city) {
			// Full outdoor city world
			px = clamp(px, -95, 95);
			pz = clamp(pz, -75, 75);
		} else {
			// Keep inside mall footprint with margin
			const m = 1.2;
			const limitX = half(MALL_FOOTPRINT.width) - m;
			const limitZ = half(MALL_FOOTPRINT.depth) - m;
			px = clamp(px, -limitX, limitX);
			pz = clamp(pz, -limitZ, limitZ);
		}

		// Floor-1 void eject — only when standing/walking (not cars at basement).
		// Mid-jump (airborne) we MUST allow XZ over the hole so you can leap
		// the balustrade and plummet to the fountain plaza.
		//
		// Bovengrens net als in groundHeightAt: boven het gat ligt op dakhoogte
		// gewoon het glazen dak. Zonder die grens werd je daar weggeduwd, terwijl
		// er een vloer onder je voeten zat.
		if (!airborne && !city && y > 4 && y < ROOF_H - 0.5) {
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
	separate(ax: number, az: number, bx: number, bz: number, minDist: number): { ax: number; az: number; bx: number; bz: number } {
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
