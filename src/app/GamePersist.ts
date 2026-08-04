/**
 * Persist player + light game state across Vite HMR and full reloads.
 * sessionStorage = survives tab reload / HMR, dies when the tab closes.
 */

import type { GraphNode } from '#/data/graph';

const KEY = 'mallsim.game.v2';

export type PersistedGame = {
	v: 2;
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
	path: { id?: string; x: number; y: number; z: number }[];
	thiefFiredAt: number;
	/** Disco party was on */
	disco: boolean;
};

export function loadGame(): PersistedGame | null {
	try {
		const raw = sessionStorage.getItem(KEY);
		if (!raw) return null;
		const data = JSON.parse(raw);
		if (data.v !== 2) return null;
		// Drop ancient sessions (> 8h) so you don't wake up mid-void
		if (Date.now() - data.savedAt > 8 * 3600 * 1000) {
			sessionStorage.removeItem(KEY);
			return null;
		}
		if (![data.x, data.y, data.z, data.yaw, data.pitch].every(Number.isFinite)) {
			return null;
		}
		return data;
	} catch {
		return null;
	}
}

export function saveGame(state: Omit<PersistedGame, 'v' | 'savedAt'>): void {
	try {
		const payload: PersistedGame = {
			v: 2,
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
