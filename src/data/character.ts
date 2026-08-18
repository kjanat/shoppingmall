import { span } from '#/util/math';

/** Canonical dimensions used when validating and simulating a standing pedestrian. */
const STANDING_PEDESTRIAN = {
	eyeHeight: 1.68,
	bodyHeight: 1.9,
	requiredHeadroom: 2.2,
	radius: 0.4,
} as const;

/** Eye of a seated rider above the saddle (m): seated eye height is ~0.79, leaned forward on a motorcycle. */
const SEATED_EYE_ABOVE_SEAT = 0.72;

/** Crown height of a deep crouch-walk (m); a 1.90 m body on bent knees keeps this much of itself. */
const CROUCH_BODY_HEIGHT = 1.2;

/** Read off the standing set, because bending the knees does not move the eye relative to the crown. */
const EYE_BELOW_CROWN = span(STANDING_PEDESTRIAN.eyeHeight, STANDING_PEDESTRIAN.bodyHeight);

/** Read off the standing set, so one figure says how much air a body wants over its own crown. */
const HEADROOM_ABOVE_CROWN = span(STANDING_PEDESTRIAN.bodyHeight, STANDING_PEDESTRIAN.requiredHeadroom);

/** The same pedestrian on bent knees; shoulders do not narrow, so the radius is the standing one. */
const CROUCHING_PEDESTRIAN = {
	eyeHeight: CROUCH_BODY_HEIGHT - EYE_BELOW_CROWN,
	bodyHeight: CROUCH_BODY_HEIGHT,
	requiredHeadroom: CROUCH_BODY_HEIGHT + HEADROOM_ABOVE_CROWN,
	radius: STANDING_PEDESTRIAN.radius,
} as const;

type PedestrianProfile = Readonly<{
	eyeHeight: number;
	bodyHeight: number;
	requiredHeadroom: number;
	radius: number;
}>;

type PedestrianPosture = 'standing' | 'crouching';

/**
 * The body a route is measured against, named by the posture the route is passable in.
 *
 * A crouch-only passage is a policy of the passage and not of whoever walks it, so the
 * clearance machinery reads the profile from here rather than assuming a standing body.
 */
const PEDESTRIAN_BY_POSTURE: Readonly<Record<PedestrianPosture, PedestrianProfile>> = {
	standing: STANDING_PEDESTRIAN,
	crouching: CROUCHING_PEDESTRIAN,
};

/** Free height a body in this posture needs over its feet before it fits at all. */
function postureHeadroom(posture: PedestrianPosture): number {
	return PEDESTRIAN_BY_POSTURE[posture].requiredHeadroom;
}

export { SEATED_EYE_ABOVE_SEAT, STANDING_PEDESTRIAN, CROUCHING_PEDESTRIAN, PEDESTRIAN_BY_POSTURE, postureHeadroom };
export type { PedestrianProfile, PedestrianPosture };
