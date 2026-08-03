import * as THREE from 'three';

/**
 * How many real point lights the whole session ever has.
 *
 * Exported because `scripts/check-lights.ts` asserts against it: the number of
 * PointLights in the scene graph is the invariant this file exists to hold, and
 * a second copy of it in the check would be the first thing to drift.
 */
export const LIGHT_POOL_SLOTS = 8;

/** How fast a slot's intensity walks to its target, per second. */
const FADE_RATE = 10;
/** A challenger has to beat the light already in the slot by this much. */
const HYSTERESIS = 1.3;
/** Clamp on the internally derived frame time — a backgrounded tab must not jump. */
const MAX_DT = 0.1;

type LightBase = {
	color: THREE.ColorRepresentation;
	intensity: number;
	distance: number;
	decay: number;
	/** Scoring multiplier. Above 1 keeps a light in a slot it would otherwise lose. */
	priority?: number;
	/** Whether `setDimFactor` applies. The disco's own lights set this false. */
	dimmable?: boolean;
};

export type LightSpec = LightBase & ({ position: THREE.Vector3 } | { follow: THREE.Object3D; offset?: THREE.Vector3 });

/**
 * What a feature gets back instead of a `THREE.PointLight`. Animate it exactly
 * as a real light was animated: the fields are read once per frame and copied
 * into whichever pool slot won the light.
 */
export class LightHandle {
	intensity: number;
	distance: number;
	decay: number;
	readonly color: THREE.Color;
	/**
	 * World position. Static lights may write to it. In follow mode the pool
	 * derives it from the followed object every frame, so writes are overwritten.
	 */
	readonly position = new THREE.Vector3();

	/** — everything below is the pool's bookkeeping — */
	readonly priority: number;
	readonly dimmable: boolean;
	readonly follow: THREE.Object3D | null;
	readonly offset: THREE.Vector3 | null;
	/** Which real slot renders this light, or -1. */
	slot = -1;
	/** Score of the last `update`, already multiplied by the incumbency bonus. */
	rank = 0;
	/** Set by `update` while picking the winners; meaningless between frames. */
	wanted = false;

	constructor(spec: LightSpec) {
		this.intensity = spec.intensity;
		this.distance = spec.distance;
		this.decay = spec.decay;
		this.color = new THREE.Color(spec.color);
		this.priority = spec.priority ?? 1;
		this.dimmable = spec.dimmable ?? true;
		if ('follow' in spec) {
			this.follow = spec.follow;
			this.offset = spec.offset ? spec.offset.clone() : new THREE.Vector3();
		} else {
			this.follow = null;
			this.offset = null;
			this.position.copy(spec.position);
		}
	}
}

function byRank(a: LightHandle, b: LightHandle): number {
	return b.rank - a.rank;
}

/**
 * A fixed set of real point lights that the mall's many virtual lights take
 * turns renting.
 *
 * three.js pastes `NUM_POINT_LIGHTS` into every shader and makes it part of the
 * program cache key, so the *count of lights the renderer can see* decides which
 * program a material gets. The mall used to build 85 PointLights and toggle
 * groups of them on and off (disco, alien probe), which relinked every material
 * in the building mid-frame and made the cold load link 105 programs. Keeping
 * that number nailed to `LIGHT_POOL_SLOTS` for the whole session is the entire
 * point of this class.
 *
 * Which is why the real lights are added once and **`visible` stays `true`
 * forever**: an invisible light is not counted by WebGLRenderer, so hiding one
 * changes `NUM_POINT_LIGHTS` and triggers exactly the relink storm this class
 * exists to kill. An unused slot is switched off with `intensity = 0`, never
 * with `visible = false`.
 */
export class LightPool {
	private readonly lights: THREE.PointLight[] = [];
	/** Which handle currently rents each slot. */
	private readonly owners: (LightHandle | null)[] = [];
	private readonly virtuals: LightHandle[] = [];
	/** Reused every frame — sorting must not allocate. */
	private readonly ranked: LightHandle[] = [];
	private dimFactor = 1;
	/** `update` takes no dt (it is called from the frame loop with the camera). */
	private lastTime = 0;

	constructor(scene: THREE.Scene, slots = LIGHT_POOL_SLOTS) {
		for (let i = 0; i < slots; i++) {
			const light = new THREE.PointLight(0xffffff, 0, 10, 2);
			// Shadow-casting point lights cost a cubemap pass each; the mall's look
			// comes from the single directional sun and never wanted these.
			light.castShadow = false;
			light.name = `pool_${i}`;
			scene.add(light);
			this.lights.push(light);
			this.owners.push(null);
		}
	}

	/** Register a virtual light. The handle is animated by the caller, forever. */
	register(spec: LightSpec): LightHandle {
		const handle = new LightHandle(spec);
		this.virtuals.push(handle);
		return handle;
	}

	/**
	 * Scale every dimmable light's contribution (the disco dims the mall).
	 *
	 * This is a scoring input as well as a brightness one: the disco registers its
	 * own lights as `dimmable: false`, so dimming the mall makes the daylight
	 * washes lose the scoring race to the disco balls and win their slots back
	 * when the party stops. No traverse, no save/restore of other people's state.
	 */
	setDimFactor(f: number): void {
		this.dimFactor = f;
	}

	/** The effective intensity of a handle: what it is worth on screen right now. */
	private effective(h: LightHandle): number {
		return h.intensity * (h.dimmable ? this.dimFactor : 1);
	}

	/** Once per frame, after the scene's world matrices are up to date. */
	update(camera: THREE.Camera): void {
		const now = performance.now() / 1000;
		const dt = this.lastTime === 0 ? 1 / 60 : Math.min(MAX_DT, Math.max(0, now - this.lastTime));
		this.lastTime = now;

		const eye = camera.position;
		this.ranked.length = 0;
		for (const h of this.virtuals) {
			if (h.follow && h.offset) {
				// One frame of lag against the followed object: App calls this after
				// SceneBatcher.update(), which has just refreshed every world matrix.
				h.position.copy(h.offset).applyMatrix4(h.follow.matrixWorld);
			}
			const strength = this.effective(h);
			if (strength <= 0 || h.distance <= 0) {
				// An idle muzzle flash is worth nothing and must never hold a slot.
				h.rank = 0;
				h.wanted = false;
				continue;
			}
			const d = h.position.distanceTo(eye);
			const reach = Math.max(0, 1 - d / h.distance);
			// The incumbency bonus IS the hysteresis: a challenger only wins the slot
			// once it scores 30% above what the light already sitting in it scores,
			// so a light does not flicker between slots while you walk past it.
			h.rank = strength * h.priority * reach * (h.slot >= 0 ? HYSTERESIS : 1);
			h.wanted = false;
			this.ranked.push(h);
		}

		this.ranked.sort(byRank);
		const winners = Math.min(this.lights.length, this.ranked.length);
		for (let i = 0; i < winners; i++) {
			const h = this.ranked[i];
			if (h && h.rank > 0) h.wanted = true;
		}

		// Evict first, so a light that moved slots does not find them all taken.
		for (let i = 0; i < this.owners.length; i++) {
			const owner = this.owners[i];
			if (owner && !owner.wanted) {
				owner.slot = -1;
				this.owners[i] = null;
			}
		}
		for (let i = 0; i < winners; i++) {
			const h = this.ranked[i];
			if (!h?.wanted || h.slot >= 0) continue;
			const free = this.owners.indexOf(null);
			if (free < 0) break;
			this.owners[free] = h;
			h.slot = free;
			const light = this.lights[free];
			// Start dark: the slot is about to teleport across the mall, and fading
			// up from nothing reads as a light coming on rather than as a jump.
			if (light) light.intensity = 0;
		}

		const step = Math.min(1, dt * FADE_RATE);
		for (let i = 0; i < this.lights.length; i++) {
			const light = this.lights[i];
			if (!light) continue;
			const owner = this.owners[i];
			let target = 0;
			if (owner) {
				light.position.copy(owner.position);
				light.color.copy(owner.color);
				light.distance = owner.distance;
				light.decay = owner.decay;
				target = this.effective(owner);
			}
			light.intensity += (target - light.intensity) * step;
		}
	}
}
