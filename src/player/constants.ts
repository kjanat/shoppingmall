import { STANDING_PEDESTRIAN } from '#/data/character';

const { eyeHeight, bodyHeight, radius } = STANDING_PEDESTRIAN;

/** Camera height above the walkable deck for a standing player. */
export const EYE = eyeHeight;

/** Physical standing height used by spatial-clearance validation. */
export const PLAYER_HEIGHT = bodyHeight;

/** Horizontal collision radius shared by controls, moving platforms, and tests. */
export const PLAYER_RADIUS = radius;
