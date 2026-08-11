import type { CollisionWorld } from '#/physics/Collision';
import { GRAVITY } from '#/player/constants';

/**
 * De verticale beweging van een voertuig op wielen: staan, afrijden, vallen, landen.
 *
 * Elke frame naar `groundHeightAt` snappen teleporteert een voertuig van een helling
 * af naar de hoogte eronder; de buggy deed dat aan de mond van de garagegeul en de
 * huurauto's deden het nog steeds. Hier staat het één keer, met dezelfde `GRAVITY`
 * als de speler, zodat een rand afrijden een boog is en geen sprong in de montage.
 */
export type VehicleGroundState = {
	/** Hoogte van de wielen. */
	y: number;
	vy: number;
	grounded: boolean;
};

export type VehicleGroundOptions = Readonly<{
	/**
	 * Vloer die alles overstemt, of null. De liftcabine is er zo een: staat het
	 * voertuig erin, dan is de cabinevloer zijn vloer en telt de wereld niet mee.
	 */
	floorOverride: number | null;
	/** Loopvlakken hierboven horen niet bij dit voertuig; het rijdt geen daken. */
	ceiling: number;
}>;

/** Zakt de vloer verder dan dit onder de wielen, dan rijd je een rand af en val je. */
export const DROP_STEP = 0.9;

/** Wat er van je vaart over is na een landing. */
export const LANDING_GRIP = 0.8;

/** Hoe ver een staand voertuig omhoog of omlaag naar zijn eigen loopvlak zoekt. */
const STANDING_STEP = 2;

/** Idem in de lucht: strak, want alleen het vlak waar je op valt telt nog. */
const FALLING_STEP = 0.5;

/**
 * Eén frame verticale beweging op (x, z). Schrijft in `state` en meldt of hij deze
 * frame geland is, want dat is het moment waarop de aanroeper zijn vaart demp
 * met `LANDING_GRIP`.
 */
export function stepVehicleGround(
	world: CollisionWorld,
	state: VehicleGroundState,
	x: number,
	z: number,
	dt: number,
	options: VehicleGroundOptions,
): boolean {
	if (options.floorOverride !== null) {
		state.y = options.floorOverride;
		state.vy = 0;
		state.grounded = true;
		return false;
	}
	if (state.grounded) {
		const surface = world.groundHeightAt(x, z, state.y + FALLING_STEP, STANDING_STEP);
		// Een loopvlak boven het plafond hoort niet bij dit voertuig: het dak, of een
		// steile voetgangertrap die het nooit had mogen raken. Dan niet de laatste hoogte
		// vasthouden en in de lucht blijven hangen (de kar bleef zo op 7,99 m halverwege
		// de geheime trap staan), maar loslaten en met dezelfde GRAVITY naar de echte
		// vloer eronder vallen, net als van een rand af.
		if (surface >= options.ceiling || state.y - surface > DROP_STEP) {
			state.grounded = false;
			state.vy = 0;
			return false;
		}
		state.y = surface;
		return false;
	}
	state.vy -= GRAVITY * dt;
	state.y += state.vy * dt;
	const ground = world.groundHeightAt(x, z, state.y, FALLING_STEP);
	if (state.y > ground) return false;
	state.y = ground;
	state.vy = 0;
	state.grounded = true;
	return true;
}
