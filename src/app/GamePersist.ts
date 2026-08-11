/**
 * Persist player + light game state across Vite HMR and full reloads.
 * sessionStorage = survives tab reload / HMR, dies when the tab closes.
 */

import type { GraphNode } from '#/data/graph';
import type { VehicleRide } from '#/scene/ScrubberBuggy';
import { finiteNumber, isRecord, readArray, readBoolean, readNumber, readString } from '#/util/values';

const KEY = 'mallsim.game.v3';

const VERSION = 3;

/** Sessies ouder dan dit worden weggegooid, anders word je middenin een oude wereld wakker. */
const MAX_AGE_MS = 8 * 3600 * 1000;

const RIDE_KINDS = ['car', 'scrubber'] as const;

type RideKind = (typeof RIDE_KINDS)[number];

function isRideKind(value: string): value is RideKind {
	return RIDE_KINDS.some((kind) => kind === value);
}

/**
 * Een rit die nog liep toen de pagina omviel.
 *
 * Een edit tijdens het rijden herbouwt de hele wereld, en de instapstand wees
 * daarna naar een voertuig dat niet meer bestond: je stond ineens te voet in het
 * beton naast een auto die er nog wel stond. Hier staat genoeg om dezelfde auto
 * op dezelfde plek terug te zetten en er weer in te stappen.
 */
export type PersistedRide = VehicleRide & { kind: RideKind };

export type PersistedGame = {
	v: typeof VERSION;
	/** epoch ms */
	savedAt: number;
	/** Camera / player */
	x: number;
	y: number;
	z: number;
	yaw: number;
	pitch: number;
	/** Progress */
	score: number;
	metSims: number[];
	/** Free walk unlocked (intro done) */
	freeMove: boolean;
	/** Route */
	storeId: string | null;
	path: { id: string; x: number; y: number; z: number }[];
	thiefFiredAt: number;
	/** Disco party was on */
	disco: boolean;
	/** De rit die liep, of null als je te voet was. */
	ride: PersistedRide | null;
};

/**
 * De rit uit een opgeslagen sessie, of niets.
 *
 * `resume` schrijft x, y, z, yaw en snelheid rechtstreeks in de transform van een
 * voertuig. Eén `null` of `"12"` in sessionStorage zette daarmee een auto op NaN en
 * het is dan de matrix die klapt, niet de laadfunctie. De versiestap houdt oude
 * sessies buiten de deur en zegt niets over de vórm van wat er staat.
 */
function readRide(value: unknown): PersistedRide | null {
	if (!isRecord(value)) return null;
	const kind = readString(value, 'kind');
	if (!isRideKind(kind)) return null;
	const x = finiteNumber(value, 'x');
	const y = finiteNumber(value, 'y');
	const z = finiteNumber(value, 'z');
	const yaw = finiteNumber(value, 'yaw');
	const speed = finiteNumber(value, 'speed');
	if (x === null || y === null || z === null || yaw === null || speed === null) return null;
	return { kind, id: readString(value, 'id'), x, y, z, yaw, speed };
}

function readPath(value: Record<string, unknown>): PersistedGame['path'] {
	const nodes: PersistedGame['path'] = [];
	for (const entry of readArray(value, 'path')) {
		if (!isRecord(entry)) continue;
		const x = finiteNumber(entry, 'x');
		const y = finiteNumber(entry, 'y');
		const z = finiteNumber(entry, 'z');
		if (x === null || y === null || z === null) continue;
		nodes.push({ id: readString(entry, 'id'), x, y, z });
	}
	return nodes;
}

export function loadGame(): PersistedGame | null {
	try {
		const raw = sessionStorage.getItem(KEY);
		if (!raw) return null;
		const parsed: unknown = JSON.parse(raw);
		if (!isRecord(parsed)) return null;
		if (parsed['v'] !== VERSION) return null;
		// Drop ancient sessions so you don't wake up mid-void
		if (Date.now() - readNumber(parsed, 'savedAt') > MAX_AGE_MS) {
			sessionStorage.removeItem(KEY);
			return null;
		}
		const x = finiteNumber(parsed, 'x');
		const y = finiteNumber(parsed, 'y');
		const z = finiteNumber(parsed, 'z');
		const yaw = finiteNumber(parsed, 'yaw');
		const pitch = finiteNumber(parsed, 'pitch');
		if (x === null || y === null || z === null || yaw === null || pitch === null) return null;
		const storeId = readString(parsed, 'storeId');
		return {
			v: VERSION,
			savedAt: readNumber(parsed, 'savedAt'),
			x,
			y,
			z,
			yaw,
			pitch,
			score: readNumber(parsed, 'score'),
			metSims: readArray(parsed, 'metSims').filter((id): id is number => typeof id === 'number' && Number.isFinite(id)),
			freeMove: readBoolean(parsed, 'freeMove'),
			storeId: storeId === '' ? null : storeId,
			path: readPath(parsed),
			thiefFiredAt: readNumber(parsed, 'thiefFiredAt'),
			disco: readBoolean(parsed, 'disco'),
			ride: readRide(parsed['ride']),
		};
	} catch {
		return null;
	}
}

export function saveGame(state: Omit<PersistedGame, 'v' | 'savedAt'>): void {
	try {
		const payload: PersistedGame = {
			v: VERSION,
			savedAt: Date.now(),
			...state,
		};
		sessionStorage.setItem(KEY, JSON.stringify(payload));
	} catch {
		/* private mode */
	}
}

export function clearGame(): void {
	try {
		sessionStorage.removeItem(KEY);
	} catch {
		/* */
	}
}

export function pathToPersist(path: GraphNode[]): PersistedGame['path'] {
	return path.map((n) => ({ id: n.id, x: n.x, y: n.y, z: n.z }));
}
