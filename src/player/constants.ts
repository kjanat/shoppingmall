import { STANDING_PEDESTRIAN } from '#/data/character';
import { half } from '#/util/math';

const { eyeHeight, bodyHeight, radius } = STANDING_PEDESTRIAN;

/** Camera height above the walkable deck for a standing player. */
export const EYE = eyeHeight;

/** Physical standing height used by spatial-clearance validation. */
export const PLAYER_HEIGHT = bodyHeight;

/** Horizontal collision radius shared by controls, moving platforms, and tests. */
export const PLAYER_RADIUS = radius;

/**
 * Aardse valversnelling (m/s²), op Kajs besluit: echte constanten zodat er
 * over te redeneren valt. Alles hieronder is er tegenaan geijkt.
 */
export const GRAVITY = 9.81;

/**
 * Afzetsnelheid van een sprong (m/s). Een volwassene komt zonder aanloop
 * 0,40 tot 0,50 m van de grond; bij 0,46 m hoort een afzet van √(2gh) = 3,0 m/s.
 */
export const JUMP_V = 3;

/** Hoe hoog die afzet je voeten brengt (m): v²/2g. */
export const JUMP_RISE = half((JUMP_V * JUMP_V) / GRAVITY);

/**
 * Loopsnelheid (m/s). 2,6 m/s is 9,4 km/u: een lichte dribbelpas, op Kajs
 * verzoek boven de echte wandelpas (max ~2,0) omdat first-person anders traag
 * voelt. Bewust de enige plek waar gevoel boven mens-echt gaat.
 */
export const WALK_SPEED = 2.6;

/**
 * Rensnelheid (m/s). 7,0 m/s is 25,2 km/u: 200m-sprinttempo. Zelfde
 * gevoelskeuze als WALK_SPEED, verhouding ~2,7 behouden.
 */
export const RUN_SPEED = 7.0;

/**
 * Hoogteverschil waarbinnen een springer een vlak nog als zijn vloer ziet (m).
 * Ruimer dan WALK_STEP, zodat een sprong midden op de roltrap je niet naar het
 * dek erboven klikt. `controleBalustradesprong` rekent met dezelfde waarde.
 */
export const AIR_STEP = 2.5;
