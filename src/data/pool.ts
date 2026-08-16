/**
 * Het dakzwembad als model, los van hoe het getekend wordt.
 *
 * De waterlijn, de bodem en de diepte horen bij de wereld, niet bij de tekenaar: de
 * fysica leest waar de bodem ligt, de zonegraaf leest dat het bad een kuil in het dak
 * is, en RoofIsland tekent hetzelfde bad. Stond dit in de scene, dan trok de datalaag
 * de renderlaag binnen om te weten waar het water is — een inversie die bovendien de
 * headless profielcontrole brak (RoofIsland sleept `render/material` mee, en dat is
 * bun-only). Hier woont het model; RoofIsland leest het en tekent erop.
 */

import type { Vector2 } from 'three';
import { Shape } from 'three';
import { levelY } from '#/data/levels';
import type { Polygon2 } from '#/data/spatial';
import { planBounds, pointInPlan } from '#/data/spatial';
import { distanceToSegment2 } from '#/util/geometry2';
import { at } from '#/util/rand';

const DECK_Y = levelY('roof');

/** Waterspiegel-centrum in wereldcoördinaten. PoolPeople zet er zwemmers op. */
export const POOL_CENTER = { x: -20, z: 2 } as const;
export const POOL_ROT = 0.3;

/** Nierboon — twee lobben, één taille. Anatomisch niet correct, wel gezellig. */
function kidneyShape(): Shape {
	const sh = new Shape();
	sh.moveTo(-6.5, -0.4);
	sh.bezierCurveTo(-6.9, 1.8, -4.8, 3.6, -2.6, 3.6);
	sh.bezierCurveTo(-0.8, 3.6, 0.4, 2.8, 2.2, 3.0);
	sh.bezierCurveTo(4.2, 3.2, 6.2, 2.2, 6.4, 0.4);
	sh.bezierCurveTo(6.6, -1.6, 4.6, -2.8, 2.8, -2.4);
	sh.bezierCurveTo(1.4, -2.0, 1.0, -0.6, -0.6, -0.8);
	sh.bezierCurveTo(-2.2, -1.0, -2.4, -2.6, -4.2, -2.6);
	sh.bezierCurveTo(-6.0, -2.6, -6.3, -1.6, -6.5, -0.4);
	return sh;
}

/**
 * De waterlijn, één keer bemonsterd. Water, bodem, rand én de zwemmers lezen
 * allemaal deze punten, dus ze kunnen niet meer uit elkaar lopen. Eerder was
 * de rand `kidney(1.15)`: dat schaalt om de vorm-oorsprong, en die ligt niet
 * in het bad, dus de rand schoof mee in plaats van gelijkmatig te verbreden.
 */
export const POOL_OUTLINE: Vector2[] = kidneyShape().getPoints(96);

/** Dezelfde waterlijn, maar in wereld-XZ. */
export const POOL_POLYGON: ReadonlyArray<readonly [number, number]> = POOL_OUTLINE.map((p) => {
	// De vlakken staan plat via rotation.x = -PI/2, dus vorm-y wordt wereld-min-z.
	const lx = p.x;
	const lz = -p.y;
	const c = Math.cos(POOL_ROT);
	const s = Math.sin(POOL_ROT);
	return [POOL_CENTER.x + lx * c + lz * s, POOL_CENTER.z - lx * s + lz * c] as const;
});

/** Dezelfde waterlijn als planvorm, zodat de gedeelde vlakwiskunde erop werkt. */
const POOL_PLAN: Polygon2 = { kind: 'polygon', points: POOL_POLYGON.map(([x, z]) => ({ x, z })) };

/** Ligt (x, z) in het water? Ray casting op de echte waterlijn. */
export function inPool(x: number, z: number): boolean {
	return pointInPlan(POOL_PLAN, x, z);
}

/** Waterspiegel in wereld-y: het watervlak uit buildPool ligt precies hier. */
export const POOL_WATER_Y = DECK_Y + 0.1;
/**
 * Bodem van het diepe: 1.15 onder de waterlijn zet je borst op het water.
 * PoolPeople hangt zijn zwemmers met dezelfde 1.15 op, maar rekent vanaf een
 * eigen WATER_Y (13.75), dus die drijven 0.30 lager dan waar jij staat.
 */
export const POOL_FLOOR_Y = POOL_WATER_Y - 1.15;
/** Breedte van de aflopende instap: binnen deze band waad je naar het diepe. */
const POOL_SHALLOW_W = 1.8;

/** Doos om de waterlijn, zodat alles wat er niet in staat de raycast overslaat. */
const POOL_BOUNDS = planBounds(POOL_PLAN);

/** Kortste afstand tot de waterlijn: hoe verder naar binnen, hoe dieper. */
export function rimDistance(x: number, z: number): number {
	let best = Number.POSITIVE_INFINITY;
	for (let i = 0; i < POOL_POLYGON.length; i++) {
		const a = at(POOL_POLYGON, i);
		const b = at(POOL_POLYGON, i + 1);
		const d = distanceToSegment2(x, z, a[0], a[1], b[0], b[1]);
		if (d < best) best = d;
	}
	return best;
}

/**
 * Loophoogte in het bad, of `null` als je er niet in staat.
 *
 * Aan de waterlijn is dat nog gewoon dekhoogte en daarna zakt de bodem in
 * POOL_SHALLOW_W meter naar POOL_FLOOR_Y: je waadt erin in plaats van dat je
 * van een richel valt. De bak zit alleen hier en niet in de meshes, want onder
 * 13.9 begint de dakplaat van de mall: een echt uitgesneden kuil zou door dat
 * beton snijden en de onderlijven van de zwemmers bloot leggen. In first person
 * zie je alleen je camera zakken, en die klopt wel.
 */
export function poolFloorY(x: number, z: number): number | null {
	if (x < POOL_BOUNDS.minX || x > POOL_BOUNDS.maxX) return null;
	if (z < POOL_BOUNDS.minZ || z > POOL_BOUNDS.maxZ) return null;
	if (!inPool(x, z)) return null;
	const raw = rimDistance(x, z) / POOL_SHALLOW_W;
	const t = raw > 1 ? 1 : raw;
	// Smoothstep: vlakke bodem in het diepe, zachte knik bij de rand
	return DECK_Y - (DECK_Y - POOL_FLOOR_Y) * t * t * (3 - 2 * t);
}
