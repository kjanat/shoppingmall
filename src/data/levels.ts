/**
 * The mall's vertical layout, once.
 *
 * Before this file "floor" meant two different things: the store directory
 * counted 0=begane grond, 1=verdieping 1, 2=dak, while the lift counted
 * 0=garage, 1=begane grond, 2=verdieping 1, 3=dak. A `2` was ambiguous.
 * Ids can't be confused, so that is what everything speaks now.
 *
 * `y` is the walkable deck. Anything that used to hardcode 0, 6, 13.95 or -6,
 * and anything that used to guess a floor from a height, resolves here.
 */
export type Level = {
	id: string;
	/** Walkable deck height */
	y: number;
	/** Short code for HUD chips and the map */
	code: string;
	name: string;
	hint: string;
};

export const LEVELS = [
	{ id: 'roof', y: 13.95, code: 'DAK', name: 'Dak', hint: 'Helipad · uitzicht' },
	{ id: 'v1', y: 6, code: 'V1', name: 'Verdieping 1', hint: 'Kruidvat · food court' },
	{ id: 'v0', y: 0, code: 'V0', name: 'Begane grond', hint: 'Winkels · kiosk' },
	{ id: 'p1', y: -6, code: 'P1', name: 'Parkeergarage', hint: "Ondergronds · auto's" },
] as const satisfies readonly Level[];

/** Algorithmic elevation order for movement that advances upward by index. */
export const LEVELS_BOTTOM_UP = LEVELS.toReversed();

export type LevelId = (typeof LEVELS)[number]['id'];

const BY_ID = new Map<LevelId, Level>(LEVELS.map((l) => [l.id, l]));

export function level(id: LevelId): Level {
	const found = BY_ID.get(id);
	if (!found) throw new Error(`no level ${id}`);
	return found;
}

export function levelY(id: LevelId): number {
	return level(id).y;
}

/** Position by elevation, with a larger index meaning a physically higher deck. */
export function levelElevationIndex(id: LevelId): number {
	return LEVELS_BOTTOM_UP.findIndex((entry) => entry.id === id);
}

export function levelAtElevationIndex(index: number): LevelId | undefined {
	return LEVELS_BOTTOM_UP[index]?.id;
}

/**
 * How far below a deck still counts as standing on it. Absorbs the few
 * centimetres of slop between graph nodes, spawn points and the slabs.
 */
const DECK_SLACK = 0.5;

/**
 * The deck something at height `y` is on: the highest one it has reached.
 * Works for feet and for eye height alike, because the decks are 6 m apart
 * and nobody is 6 m tall. This replaces a dozen hand-written thresholds
 * (`y > 3`, `y < 4.5`, `y >= 10`, …) that all disagreed slightly.
 */
export function levelAt(y: number): LevelId {
	let best: (typeof LEVELS)[number] = LEVELS[3];
	for (const l of LEVELS_BOTTOM_UP) {
		if (y >= l.y - DECK_SLACK) best = l;
	}
	return best.id;
}

/** True when `y` is at or above the given deck. */
export function isAtOrAbove(y: number, id: LevelId): boolean {
	return y >= levelY(id) - DECK_SLACK;
}
