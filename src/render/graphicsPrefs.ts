import * as THREE from 'three';

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
const SHINE_KEY = 'mallsim.shine.v1';
const LAMPS_KEY = 'mallsim.lamps.v1';
const FILL_KEY = 'mallsim.fill.v1';

/** Pool sizes offered. Each one is a different NUM_POINT_LIGHTS, so each is a
 * different set of shader programs, hence the reload. */
export const LAMP_CHOICES: readonly number[] = [8, 16, 24, 32];
/** Multiplier on the ambient + hemisphere "everywhere" light. */
export const FILL_CHOICES: readonly number[] = [0.4, 0.7, 1, 1.4];

function readNumberPref(key: string, allowed: readonly number[], fallback: number): number {
	try {
		const raw = Number(localStorage.getItem(key));
		return allowed.includes(raw) ? raw : fallback;
	} catch {
		return fallback;
	}
}

/** Specular highlights and metalness, i.e. MeshStandardMaterial. Default on. */
export function shineOn(): boolean {
	try {
		return localStorage.getItem(SHINE_KEY) !== '0';
	} catch {
		return true;
	}
}

export function lampCount(): number {
	return readNumberPref(LAMPS_KEY, LAMP_CHOICES, 16);
}

export function fillScale(): number {
	return readNumberPref(FILL_KEY, FILL_CHOICES, 1);
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

/**
 * Swap every MeshStandardMaterial in the scene for a Lambert one.
 *
 * Done here in one pass rather than at each of the ~390 construction sites:
 * the source keeps the richer material, and this strips it back when the
 * player asks for speed. Lambert has no roughness/metalness and no specular
 * lobe. That is the whole point: it drops the expensive part of the light
 * loop, which is multiplied by the number of pooled lights in every fragment.
 * Everything else (colour, map, emissive, transparency, side) carries over.
 *
 * Must run before SceneBatcher: the batcher clones a material per batch and
 * keys its grouping on the type, so swapping afterwards would leave the
 * batches shading with the old one.
 */
export function stripShine(scene: THREE.Scene): number {
	const swapped = new Map<THREE.Material, THREE.MeshLambertMaterial>();
	let count = 0;
	scene.traverse((object) => {
		if (!(object instanceof THREE.Mesh) || Array.isArray(object.material)) return;
		const source = object.material;
		if (!(source instanceof THREE.MeshStandardMaterial)) return;
		const existing = swapped.get(source);
		if (existing) {
			object.material = existing;
			return;
		}
		const lambert = new THREE.MeshLambertMaterial({
			color: source.color,
			map: source.map,
			emissive: source.emissive,
			emissiveMap: source.emissiveMap,
			emissiveIntensity: source.emissiveIntensity,
			alphaMap: source.alphaMap,
			aoMap: source.aoMap,
			aoMapIntensity: source.aoMapIntensity,
			lightMap: source.lightMap,
			lightMapIntensity: source.lightMapIntensity,
			transparent: source.transparent,
			opacity: source.opacity,
			side: source.side,
			depthWrite: source.depthWrite,
			depthTest: source.depthTest,
			alphaTest: source.alphaTest,
			vertexColors: source.vertexColors,
			fog: source.fog,
			toneMapped: source.toneMapped,
			wireframe: source.wireframe,
			flatShading: source.flatShading,
		});
		swapped.set(source, lambert);
		object.material = lambert;
		count++;
	});
	return count;
}
