/**
 * The three knobs that decide what the mall costs and what it looks like.
 *
 * They exist because every one of them was first shipped as somebody's taste
 * baked into the source (no shine, eight lights, ambient at 0.95), and each
 * time the answer turned out to be "depends on the machine and the eye". Two
 * of them can only be applied while the world is being built, so changing them
 * reloads the page; that is honest and instant enough for a setting nobody
 * touches twice a session.
 */
import { LIGHT_POOL_SLOTS } from '#/render/LightPool';
import { booleanUrlPref, urlPref } from '#/render/urlPrefs';

const SHINE_KEY = 'mallsim.shine.v1';
const LAMPS_KEY = 'mallsim.lamps.v1';
const FILL_KEY = 'mallsim.fill.v1';
export const BATCH_KEY = 'mallsim.batch.v1';
export const ZONE_CULL_KEY = 'mallsim.zonecull.v1';
export const SHELL_SHADOW_KEY = 'mallsim.shellshadow.v1';

export type BatchMode = 'global' | 'spatial' | 'spatial-dynamic' | 'spatial-sort';
export const BATCH_CHOICES: readonly BatchMode[] = ['global', 'spatial', 'spatial-dynamic', 'spatial-sort'];

export function isBatchMode(value: unknown): value is BatchMode {
	return typeof value === 'string' && BATCH_CHOICES.some((choice) => choice === value);
}

/** Pool sizes offered. Each one is a different NUM_POINT_LIGHTS, so each is a
 * different set of shader programs, hence the reload. */
export const LAMP_CHOICES: readonly number[] = [2, 4, 8, 16, 24, 32];
/** Multiplier on the ambient + hemisphere "everywhere" light. */
export const FILL_CHOICES: readonly number[] = [0.4, 0.7, 1, 1.4];

function readNumberPref(key: string, query: string, allowed: readonly number[], fallback: number): number {
	const override = Number(urlPref(query));
	if (allowed.includes(override)) return override;
	try {
		const raw = Number(localStorage.getItem(key));
		return allowed.includes(raw) ? raw : fallback;
	} catch {
		return fallback;
	}
}

/** Specular highlights and metalness, i.e. MeshStandardMaterial. Default on. */
export function shineOn(): boolean {
	const override = booleanUrlPref('shine');
	if (override !== undefined) return override;
	try {
		return localStorage.getItem(SHINE_KEY) !== '0';
	} catch {
		return true;
	}
}

export function lampCount(): number {
	return readNumberPref(LAMPS_KEY, 'lamps', LAMP_CHOICES, LIGHT_POOL_SLOTS);
}

export function fillScale(): number {
	return readNumberPref(FILL_KEY, 'fill', FILL_CHOICES, 1);
}

/**
 * How compatible meshes are submitted. The modes deliberately stay available
 * side by side because cell size, extra draw calls and per-instance sorting are
 * a machine-dependent tradeoff that must be measured on the target GPU.
 */
export function batchMode(): BatchMode {
	const override = urlPref('batch');
	if (isBatchMode(override)) return override;
	try {
		const value = localStorage.getItem(BATCH_KEY);
		return isBatchMode(value) ? value : 'spatial';
	} catch {
		return 'spatial';
	}
}

/**
 * Zone- en portaalculling. Standaard aan.
 *
 * Als schakelaar en niet als vaste keuze, want dit is de enige manier om er een
 * A-B-A tegenaan te leggen: één build, één machine, en de cull het enige verschil.
 * Zonder die schakelaar moet een vorige build teruggezet worden en dan meet je
 * ook alle andere verschillen mee.
 */
export function zoneCullOn(): boolean {
	const override = booleanUrlPref('zonecull');
	if (override !== undefined) return override;
	try {
		return localStorage.getItem(ZONE_CULL_KEY) !== '0';
	} catch {
		return true;
	}
}

export function writeZoneCull(on: boolean): void {
	try {
		localStorage.setItem(ZONE_CULL_KEY, on ? '1' : '0');
	} catch {
		/* private mode */
	}
}

/**
 * Werpt de gebouwschil (gevel, dak, garage, stadstorens) zelf schaduw in de zon?
 * Standaard uit.
 *
 * `castShadow` wordt bij het opbouwen gelezen en zit in de batch-sleutel, dus een
 * wissel herlaadt net als glans en lampen. Uit is de bestaande stand: de schil werpt
 * niets en alleen losse binnenobjecten werpen, waardoor winkelwanden hun schaduw dwars
 * door de dichte gevel op de stoep en het plein tekenden.
 */
export function shellShadowOn(): boolean {
	const override = booleanUrlPref('shellshadow');
	if (override !== undefined) return override;
	try {
		return localStorage.getItem(SHELL_SHADOW_KEY) === '1';
	} catch {
		return false;
	}
}

export function writeShellShadow(on: boolean): void {
	try {
		localStorage.setItem(SHELL_SHADOW_KEY, on ? '1' : '0');
	} catch {
		/* private mode */
	}
}

export function writeShine(on: boolean): void {
	try {
		localStorage.setItem(SHINE_KEY, on ? '1' : '0');
	} catch {
		/* private mode */
	}
}

export function writeLamps(n: number): void {
	try {
		localStorage.setItem(LAMPS_KEY, String(n));
	} catch {
		/* private mode */
	}
}

export function writeFill(scale: number): void {
	try {
		localStorage.setItem(FILL_KEY, String(scale));
	} catch {
		/* private mode */
	}
}

export function writeBatchMode(mode: BatchMode): void {
	try {
		localStorage.setItem(BATCH_KEY, mode);
	} catch {
		/* private mode */
	}
}
