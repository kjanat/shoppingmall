import { CROUCHING_PEDESTRIAN, STANDING_PEDESTRIAN } from '#/data/character';
import { half, span } from '#/util/math';

const { eyeHeight, bodyHeight, radius } = STANDING_PEDESTRIAN;

/** Camera height above the walkable deck for a standing player. */
export const EYE = eyeHeight;

/** Physical standing height used by spatial-clearance validation. */
export const PLAYER_HEIGHT = bodyHeight;

/** Horizontal collision radius shared by controls, moving platforms, and tests. */
export const PLAYER_RADIUS = radius;

/** Camera height above the deck with the knees bent. */
export const CROUCH_EYE = CROUCHING_PEDESTRIAN.eyeHeight;

/** Vrije hoogte die er boven je voeten moet zijn voordat je weer rechtop mag komen. */
export const STAND_HEADROOM = STANDING_PEDESTRIAN.requiredHeadroom;

/** Idem gehurkt: hieronder past er geen lichaam meer en loop je er dus ook niet in. */
export const CROUCH_HEADROOM = CROUCHING_PEDESTRIAN.requiredHeadroom;

/**
 * Hoeveel korter het lichaam wordt op gebogen knieën. In de lucht net zoveel hoger
 * tellen de voeten mee, zodat een gehurkte sprong een richel haalt die staand te hoog is.
 */
export const CROUCH_LEG_TUCK = span(CROUCHING_PEDESTRIAN.bodyHeight, STANDING_PEDESTRIAN.bodyHeight);

/**
 * Gehurkte loopsnelheid (m/s). Door de knieën haalt een volwassene ongeveer een
 * derde van zijn wandelpas; anders dan WALK_SPEED staat dit getal wél op mens-echt,
 * want traag hurken is het hele punt van hurken.
 */
export const CROUCH_SPEED = 0.9;

/** Hoe snel de knieën buigen en strekken (1/s); met STANCE_SETTLE eronder is dat een halve seconde. */
export const CROUCH_RATE = 9;

/**
 * Waaronder de knik af is en op zijn eindwaarde klapt.
 *
 * `ease` nadert zijn doel alleen; de sprong en de vrije-hoogte-eis vragen allebei of
 * de knieën écht gestrekt zijn, en "bijna" is daar geen antwoord op.
 */
export const STANCE_SETTLE = 0.01;

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
