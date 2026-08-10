import { half, lerp } from '#/util/math';

/**
 * De maten van de stad buiten de mall, op één plek.
 *
 * De skyline, het theater en de garage tekenden hun eigen coördinaten, en de
 * fysica had er geen. Nu de speler van het dak kan springen en er buiten
 * rondloopt, moeten collision en scene exact hetzelfde blok bedoelen: elke
 * tweede kopie van een getal is een muur die net naast zijn gevel staat.
 */

export type Rect = Readonly<{ minX: number; maxX: number; minZ: number; maxZ: number }>;

/** De wereldrand. Collision klemt hierop, de drone ook. */
export const CITY_BOUNDS = { minX: -95, maxX: 95, minZ: -75, maxZ: 75 } as const;

/** Straatniveau. Buiten de mall ligt hier de vloer, tenzij een citySurface hoger komt. */
export const CITY_GROUND_Y = 0;

/** Deterministische RNG (mulberry32) — de stad staat er elke reload hetzelfde bij. */
export function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export type Rand = () => number;

export const TOWER_SEED = 0x404;

export type TowerSpec = Readonly<{ x: number; z: number; w: number; d: number; h: number; rot: number }>;

/**
 * Kavels van theater, garage en park — daar bouwt de skyline niet overheen.
 * "Building's in the way" was letterlijk waar: torens verzwolgen de marquee.
 */
export const CITY_KAVELS = {
	theatre: { minX: 52, maxX: 90, minZ: -70, maxZ: -40 },
	garage: { minX: 52, maxX: 90, minZ: 40, maxZ: 72 },
	park: { minX: -94, maxX: -52, minZ: -74, maxZ: -36 },
} as const satisfies Record<string, Rect>;

const KAVELS: readonly Rect[] = Object.values(CITY_KAVELS);

function opKavel(x: number, z: number, w: number, d: number): boolean {
	return KAVELS.some((k) => x + half(w) > k.minX && x - half(w) < k.maxX && z + half(d) > k.minZ && z - half(d) < k.maxZ);
}

/**
 * ~30 torens in vier banden om de ringweg: |x| 58..90 of |z| 44..72,
 * netjes binnen de wereldgrens, ook mét halve breedte.
 */
export function planTowers(rand: Rand): TowerSpec[] {
	const specs: TowerSpec[] = [];
	const bands: [number, () => [number, number]][] = [
		[8, () => [lerp(-85, 85, rand()), -lerp(46, 67, rand())]], // noord
		[8, () => [lerp(-85, 85, rand()), lerp(46, 67, rand())]], // zuid
		[7, () => [lerp(60, 87, rand()), lerp(-64, 64, rand())]], // oost
		[7, () => [-lerp(60, 87, rand()), lerp(-64, 64, rand())]], // west
	];

	for (const [count, pick] of bands) {
		for (let i = 0; i < count; i++) {
			for (let attempt = 0; attempt < 8; attempt++) {
				const [x, z] = pick();
				const w = lerp(6, 13, rand());
				const d = lerp(6, 13, rand());
				// Meest middelhoog, ~1 op 5 een uitschieter richting 46.
				const h = rand() < 0.22 ? 30 + 16 * rand() : 10 + 20 * rand();
				// Niet op elkaars tenen (de hoeken van de banden overlappen),
				// en niet op een gereserveerd kavel
				const vrij =
					!opKavel(x, z, w, d) &&
					specs.every((s) => Math.abs(s.x - x) > half(s.w + w) + 1.5 || Math.abs(s.z - z) > half(s.d + d) + 1.5);
				if (vrij) {
					// Ietsje scheef van het grid — net genoeg om te verontrusten
					specs.push({ x, z, w, d, h, rot: (rand() - 0.5) * 0.12 });
					break;
				}
				// Na 8 pogingen dan maar geen toren; een gat in de skyline is ook moody.
			}
		}
	}
	return specs;
}

/**
 * Dezelfde lijst die CityBuildings tekent. Deterministisch uit `TOWER_SEED`,
 * dus wie hem hier opvraagt krijgt exact de torens die er staan.
 */
export const TOWER_SPECS: readonly TowerSpec[] = planTowers(mulberry32(TOWER_SEED));

/**
 * PRAIRIE THEATRE op het NO-kavel: zaalblok, portico op een podium, en een
 * brede trap van vier treden vanaf de stoep. De trap is de enige manier omhoog.
 */
export const THEATRE_PLAN = {
	hall: { minX: 58, maxX: 86, minZ: -66, maxZ: -52 },
	hallHeight: 13,
	podium: { minX: 57, maxX: 87, minZ: -52, maxZ: -47 },
	podiumY: 1.5,
	/** Treden lopen zuidwaarts omlaag vanaf `zTop`; `rise` blijft onder WALK_STEP. */
	stair: { minX: 62, maxX: 82, zTop: -47, treads: 4, tread: 0.6, rise: 0.3 },
	columns: { x0: 61.5, pitch: 3, count: 8, z: -50.6, radius: 0.6, bottomY: 1.5, topY: 9.6 },
} as const;

/** Bovenkant van trede `i`, geteld vanaf de bovenste (die tegen het podium ligt). */
export function theatreTreadY(i: number): number {
	return THEATRE_PLAN.stair.rise * (THEATRE_PLAN.stair.treads - i);
}

/** Z-strook van trede `i`, van boven naar beneden. */
export function theatreTreadZ(i: number): { minZ: number; maxZ: number } {
	const { zTop, tread } = THEATRE_PLAN.stair;
	return { minZ: zTop + i * tread, maxZ: zTop + (i + 1) * tread };
}

/**
 * De parkeergarage op het ZO-kavel. Het maaiveld-dek is open aan alle zijden,
 * dus daar loop je zo tussen de kolommen door naar binnen.
 */
export const GARAGE_PLAN = {
	footprint: { minX: 58, maxX: 83, minZ: 46, maxZ: 64 },
	floorHeight: 3.2,
	slabThickness: 0.35,
	decks: 4,
	groundDeckY: 0.2,
	columnX: [59, 62.8, 71.2, 79.6, 82.4],
	columnZ: [46.8, 55, 63.2],
	columnSize: 0.45,
	columnTopY: 12.8,
} as const;
