import type { PedestrianPosture } from '#/data/character';
import { postureHeadroom } from '#/data/character';
import { pointInSegmentStrip2, segmentParameter2 } from '#/util/geometry2';
import { clamp01, half, lerp, midpoint, span } from '#/util/math';

export type Vec2 = Readonly<{ x: number; z: number }>;
export type Vec3 = Readonly<{ x: number; y: number; z: number }>;

export type CardinalSide = 'north' | 'south' | 'west' | 'east';

/** The outward unit normal of each elevation. Which way is out is a property of the side itself. */
export const CARDINAL_OUTWARD = {
	west: { x: -1, z: 0 },
	east: { x: 1, z: 0 },
	north: { x: 0, z: -1 },
	south: { x: 0, z: 1 },
} as const satisfies Readonly<Record<CardinalSide, Vec2>>;

/** The elevation across the building from each one. */
export const CARDINAL_OPPOSITE = {
	west: 'east',
	east: 'west',
	north: 'south',
	south: 'north',
} as const satisfies Readonly<Record<CardinalSide, CardinalSide>>;

export type RectangleSource2 = Readonly<{
	center: Vec2;
	size: Readonly<{ width: number; depth: number }>;
}>;

export type Transform3 = Readonly<{
	position: Vec3;
	rotation: Readonly<{ yaw: number; pitch: number; roll: number }>;
}>;

export type Rectangle2 = Readonly<{
	kind: 'rectangle';
	center: Vec2;
	width: number;
	depth: number;
	yaw: number;
}>;

export type Circle2 = Readonly<{
	kind: 'circle';
	center: Vec2;
	radius: number;
}>;

export type Polygon2 = Readonly<{
	kind: 'polygon';
	points: readonly Vec2[];
}>;

export type PlanShape = Rectangle2 | Circle2 | Polygon2;

export type PrismGeometry = Readonly<{
	kind: 'prism';
	plan: PlanShape;
	minY: number;
	maxY: number;
	/** Empty vertical columns removed from this solid. */
	holes: readonly PlanShape[];
}>;

export type StairGeometry = Readonly<{
	kind: 'stair-flight';
	start: Vec3;
	end: Vec3;
	width: number;
	treadCount: number;
	treadThickness: number;
	/** Open leaves usable clearance below the sloped underside. */
	underside: 'open' | 'closed';
}>;

export type RampGeometry = Readonly<{
	kind: 'ramp';
	start: Vec3;
	end: Vec3;
	width: number;
	thickness: number;
}>;

export type FlightClearanceGeometry = Readonly<{
	kind: 'flight-clearance';
	start: Vec3;
	end: Vec3;
	width: number;
	height: number;
}>;

export type CylinderGeometry = Readonly<{
	kind: 'cylinder';
	center: Vec3;
	radius: number;
	height: number;
	axis: 'x' | 'y' | 'z';
}>;

export type SpatialGeometry = PrismGeometry | StairGeometry | RampGeometry | FlightClearanceGeometry | CylinderGeometry;

export type SpatialRole =
	| 'solid'
	| 'walkable'
	| 'support'
	| 'opening-clearance'
	| 'connector-clearance'
	| 'storefront-clearance'
	| 'aisle-clearance'
	| 'decorative-covering'
	| 'trigger'
	| 'fluid';

export type PlacementClass = 'structure' | 'fixture' | 'furnishing' | 'clutter' | 'covering' | 'connector';

/**
 * How deep this volume may sink into geometry it is allowed to touch.
 *
 * `allowsOverlapFrom` only names placement classes, so it cannot tell a shop
 * standing against the perimeter wall from a shop poking 0.4 m out through the
 * facade. Both are a fixture meeting a structure. Depth is what separates them,
 * and it is declared by the volume doing the cutting: a cave carved into the west
 * wall says so, and every other volume stays at zero and therefore cannot drift
 * through a wall unnoticed.
 */
export type Penetration = Readonly<{
	/** Metres of allowed intrusion. Zero still lets two faces rest against each other. */
	depth: number;
	/** Placement classes this volume may cut into, up to `depth`. */
	into: readonly PlacementClass[];
}>;

export const NO_PENETRATION: Penetration = { depth: 0, into: [] };

/**
 * How far this volume may reach past the outside face of the building, and where.
 *
 * The mirror image of `Penetration`. A canopy column stands on the pavement on
 * purpose, and the facade control in check-world has no way to tell that from a
 * shop that has drifted through the wall: both are a blocking volume outside the
 * envelope. The volume that means it says so here, with the metres it needs, and
 * a declaration that reaches past nothing is itself a build failure.
 */
export type Protrusion = Readonly<{
	/** Metres of allowed reach beyond the outside face. */
	depth: number;
	/** Facade sides this volume may reach past. */
	sides: readonly CardinalSide[];
}>;

/**
 * Metres of reach past the envelope below which a volume counts as resting against
 * it rather than protruding.
 *
 * One number, because two parties have to agree on it exactly: the facade control
 * demands a permit above this figure, and the geometry that writes its own permits
 * issues one above the same figure. Split them and a piece that reaches out by a
 * hair either goes unpermitted or carries a permit the control calls unused.
 */
export const PROTRUSION_MARGIN = 0.02;

/**
 * The gap this volume's back face keeps to the structure behind it, and why it may.
 *
 * A shop is a box put down in front of a wall, and nothing measured what was left
 * between the two: eighteen of the nineteen stopped between 0.28 and 1.2 m short of
 * the perimeter, and ISLAND HOP stood 3.8 m clear of it with its own blue back panel
 * floating in the slit. `Penetration` answers the mirror question, how far a volume
 * may cut *into* what is behind it, so it cannot answer this one.
 */
export type Standoff = Readonly<{
	/** Which face of the volume is its back. */
	side: CardinalSide;
	/** Metres of gap allowed between that face and the nearest structure behind it. */
	depth: number;
}>;

/**
 * Metres of gap below which a back face counts as resting against what is behind it.
 *
 * One number for both parties, like `PROTRUSION_MARGIN`: the rule demands a
 * declaration above this figure and a declaration that covers less than this figure
 * is doing no work.
 */
export const STANDOFF_MARGIN = 0.02;

/** Marks the room shell of a shop: the box whose back has to meet the wall behind it. */
export const ROOM_SHELL_TAG = 'room-shell';

/** Marks a sign hung on the building. It may rest against what carries it and cut into nothing. */
export const SIGNAGE_TAG = 'signage';

export type SpatialVolume = Readonly<{
	id: string;
	role: SpatialRole;
	geometry: SpatialGeometry;
	/** A solid with this false is visual geometry and does not block bodies. */
	blocksMovement: boolean;
	/** Declared intrusion into other geometry; absent means none is permitted. */
	penetration?: Penetration;
	/** Declared reach past the building envelope; absent means the facade is the limit. */
	protrusion?: Protrusion;
	/** Declared gap behind this volume's back; absent means it has to meet what stands there. */
	standoff?: Standoff;
	/** Visual and physical obstruction are separate. Opaque visual geometry can block a route without a collider. */
	clearance:
		| Readonly<{ kind: 'clear' }>
		| Readonly<{ kind: 'fixed-obstruction' }>
		| Readonly<{ kind: 'automatic-gate'; mechanismId: string }>;
	/** Placement classes allowed to touch or overlap this volume. */
	allowsOverlapFrom: readonly PlacementClass[];
	tags: readonly string[];
}>;

export type ConnectionKind = 'door' | 'stairs' | 'escalator' | 'elevator' | 'ladder' | 'ramp' | 'opening';

export type ConnectionPort = Readonly<{
	id: string;
	kind: ConnectionKind;
	position: Vec3;
	direction: Vec3;
	width: number;
	height: number;
	connectsTo: readonly string[];
	oneWay: boolean;
	allows: readonly ('walking' | 'wheeled' | 'service' | 'falling')[];
	clearanceVolumeId: string;
	/**
	 * The posture a body has to be in to pass here.
	 *
	 * Crouch-only is a property of the passage, so the height its clearance has to
	 * offer is read from the profile this names instead of from a standing body every
	 * time. A duct that says `crouching` asks for the crouching headroom and nothing
	 * else changes.
	 */
	posture: PedestrianPosture;
}>;

export type InteractionChannel =
	| 'linear-force'
	| 'linear-acceleration'
	| 'linear-velocity'
	| 'linear-displacement'
	| 'angular-force'
	| 'angular-velocity'
	| 'gravity'
	| 'wind'
	| 'conveyor'
	| 'buoyancy'
	| 'drag';

export type VectorField =
	| Readonly<{ kind: 'constant'; vector: Vec3; space: 'world' | 'local' }>
	| Readonly<{ kind: 'state'; stateId: string; initial: Vec3; space: 'world' | 'local' }>
	| Readonly<{ kind: 'radial'; origin: Vec3; magnitude: number; direction: 'inward' | 'outward' }>
	| Readonly<{ kind: 'vortex'; origin: Vec3; axis: Vec3; magnitude: number }>
	| Readonly<{ kind: 'surface'; vector: Vec3; space: 'world' | 'local' }>;

export type EffectFalloff =
	| Readonly<{ kind: 'none' }>
	| Readonly<{ kind: 'linear'; range: number }>
	| Readonly<{ kind: 'inverse-square'; range: number; minimumDistance: number }>;

export type TargetSelector = Readonly<{
	mobility: readonly Mobility[];
	requireTags: readonly string[];
	excludeTags: readonly string[];
	requireChannels: readonly InteractionChannel[];
}>;

/**
 * Hoe een doos tussen twee punten meetelt.
 *
 * `line-of-sight` is een blik: wie zélf in een doos staat kijkt eruit, want een
 * bewaker die tegen een wand aan geduwd is zou anders nooit meer iets zien.
 * `projectile` is een lichaam onderweg: dat eindigt in een muur en gaat er niet
 * uit verder. Dat verschil is er één keer niet gemaakt en toen kwamen kogels aan
 * de andere kant van elke wand naar buiten, omdat de stap van een frame ergens
 * midden ín het steen eindigt en het frame erna daar begint.
 */
export type Occlusion = Readonly<{
	mode: 'none' | 'solid' | 'line-of-sight' | 'projectile';
	blockingTags: readonly string[];
}>;

/**
 * The tag a collider carries when it stops sight as well as bodies.
 *
 * Not every collider does. The atrium void barrier and the escalator shafts are
 * boxes that exist to steer a walking body and reach from the floor to the sky;
 * reading them as walls would put a wall across the middle of the building.
 */
export const SIGHT_BLOCKING_TAG = 'sight-blocking';

/** The occlusion every system that needs a clear view declares, so they cannot drift apart. */
export const LINE_OF_SIGHT: Occlusion = { mode: 'line-of-sight', blockingTags: [SIGHT_BLOCKING_TAG] };

/** Dezelfde dozen, gelezen als muur voor iets dat er tegenaan vliegt in plaats van erdoorheen kijkt. */
export const PROJECTILE_PATH: Occlusion = { mode: 'projectile', blockingTags: [SIGHT_BLOCKING_TAG] };

export type InteractionEmitter = Readonly<{
	id: string;
	channel: InteractionChannel;
	field: VectorField;
	sourceVolumeId: string;
	falloff: EffectFalloff;
	timing:
		| Readonly<{ kind: 'continuous' }>
		| Readonly<{ kind: 'pulse'; duration: number; cooldown: number }>
		| Readonly<{ kind: 'event'; event: string }>;
	targets: TargetSelector;
	occlusion: Occlusion;
}>;

export type Mobility = 'static' | 'kinematic' | 'dynamic' | 'character' | 'particle';

export type InteractionReceiver = Readonly<{
	mobility: Mobility;
	mass: number | null;
	tags: readonly string[];
	channels: readonly InteractionChannel[];
	responses: Readonly<{
		translation: 'none' | 'integrate' | 'set' | 'constrain-to-surface';
		rotation: 'none' | 'integrate' | 'align-with-field';
	}>;
}>;

export type PlacementPolicy = Readonly<{
	class: PlacementClass;
	requiresSupport: boolean;
	mayCover: readonly SpatialRole[];
	mayBeCoveredBy: readonly PlacementClass[];
}>;

export type Kinematics =
	| Readonly<{ kind: 'static' }>
	| Readonly<{
			kind: 'linear-path';
			stateId: string;
			stops: readonly Vec3[];
			speed: number;
			control: 'requested' | 'automatic-loop' | 'ping-pong';
			carriesTargets: boolean;
	  }>
	| Readonly<{
			kind: 'rotation';
			stateId: string;
			axis: Vec3;
			radiansPerSecond: number;
	  }>;

/**
 * Wie een doorgang mag passeren.
 *
 * Een slagboom kent het verschil tussen een auto van de wegbeheerder, de auto
 * die de speler zelf rijdt en iemand te voet. Zonder deze klassen kon een
 * runtime dat verschil alleen aan het voertuigtype ophangen, en dan staat het
 * antwoord in de code van het voertuig in plaats van op de boom.
 */
export const TRAFFIC_CLASSES = ['npc-traffic', 'player-vehicle', 'pedestrian'] as const;

export type TrafficClass = (typeof TRAFFIC_CLASSES)[number];

export type AccessPolicy = Readonly<{
	/** De klassen waarvoor dit mechanisme opengaat. */
	admits: readonly TrafficClass[];
}>;

export type ClearanceMechanism = Readonly<{
	id: string;
	kind: 'sliding' | 'hinged' | 'retracting';
	stateId: string;
	movingVolumeIds: readonly string[];
	triggerVolumeId: string;
	openState: Readonly<{ translation?: Vec3; rotationRadians?: number }>;
	openingSeconds: number;
	failSafe: 'open' | 'closed';
	/** Voor wie hij opengaat. Wie er niet in staat komt er niet langs. */
	access: AccessPolicy;
}>;

export type MapPresentation = Readonly<{
	visible: boolean;
	layer: 'structure' | 'opening' | 'shop' | 'circulation' | 'parking' | 'fixture' | 'clutter';
	label?: string;
	priority: number;
}>;

export type WorldEntity<Category extends string = string, Level extends string = string> = Readonly<{
	id: string;
	label: string;
	category: Category;
	levels: readonly Level[];
	transform: Transform3;
	volumes: readonly SpatialVolume[];
	ports: readonly ConnectionPort[];
	placement: PlacementPolicy;
	kinematics: Kinematics;
	mechanisms: readonly ClearanceMechanism[];
	receiver: InteractionReceiver;
	emitters: readonly InteractionEmitter[];
	map: MapPresentation;
	tags: readonly string[];
}>;

export type SpatialProblem = Readonly<{
	code:
		| 'duplicate-id'
		| 'invalid-geometry'
		| 'missing-volume'
		| 'broken-connection'
		| 'blocked-clearance'
		| 'unsupported-placement'
		| 'uncontained-volume'
		| 'coplanar-surface'
		| 'invalid-interaction'
		| 'unused-penetration'
		| 'unmeasurable-clearance'
		| 'insufficient-headroom'
		| 'detached-backing'
		| 'unused-standoff';
	message: string;
	entities: readonly string[];
}>;

/** Marks the volume whose plan every other volume of the same entity has to stay inside. */
export const PLAN_ENVELOPE_TAG = 'plan-envelope';

/**
 * Marks a volume you see through but cannot walk through.
 *
 * The zone graph reads it: the main entrance is two storeys of glazing over a
 * doorway, so the street and both decks behind it stay in sight of each other
 * whether the sliding pair is open or shut.
 */
export const GLASS_TAG = 'glass';

/**
 * Declares that an entity holding declared free space still joins nothing.
 *
 * The lift recess at P1 is the case it exists for: it is an opening in the
 * schema and a niche in the building. A tag on an entity that does join two
 * zones fails the zone-graph control the way an unused exemption row does.
 */
export const NOT_A_PORTAL_TAG = 'geen-portaal';

export type Bounds2 = Readonly<{ minX: number; maxX: number; minZ: number; maxZ: number }>;
export type Bounds3 = Bounds2 & Readonly<{ minY: number; maxY: number }>;

const EPSILON = 1e-6;

/** Two horizontal faces within this distance share a depth value, and the winner moves with the camera. */
const COPLANAR_TOLERANCE = 1e-3;

function finite(values: readonly number[]): boolean {
	return values.every(Number.isFinite);
}

function positive(value: number): boolean {
	return Number.isFinite(value) && value > 0;
}

/** Converts the center-and-size records used by layout data into a spatial plan. */
export function rectanglePlan(source: RectangleSource2, yaw = 0): Rectangle2 {
	return { kind: 'rectangle', center: source.center, width: source.size.width, depth: source.size.depth, yaw };
}

export function planBounds(shape: PlanShape): Bounds2 {
	if (shape.kind === 'circle') {
		return {
			minX: shape.center.x - shape.radius,
			maxX: shape.center.x + shape.radius,
			minZ: shape.center.z - shape.radius,
			maxZ: shape.center.z + shape.radius,
		};
	}
	if (shape.kind === 'rectangle') {
		const cosine = Math.abs(Math.cos(shape.yaw));
		const sine = Math.abs(Math.sin(shape.yaw));
		const extentX = half(shape.width * cosine + shape.depth * sine);
		const extentZ = half(shape.width * sine + shape.depth * cosine);
		return {
			minX: shape.center.x - extentX,
			maxX: shape.center.x + extentX,
			minZ: shape.center.z - extentZ,
			maxZ: shape.center.z + extentZ,
		};
	}
	let minX = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let minZ = Number.POSITIVE_INFINITY;
	let maxZ = Number.NEGATIVE_INFINITY;
	for (const point of shape.points) {
		minX = Math.min(minX, point.x);
		maxX = Math.max(maxX, point.x);
		minZ = Math.min(minZ, point.z);
		maxZ = Math.max(maxZ, point.z);
	}
	return { minX, maxX, minZ, maxZ };
}

/** What remains of `vlak` once `gat` is cut out of it: zero to four rectangles. */
export function boundsMinusHole(vlak: Bounds2, gat: Bounds2): Bounds2[] {
	const minX = Math.max(vlak.minX, gat.minX);
	const maxX = Math.min(vlak.maxX, gat.maxX);
	return [
		{ ...vlak, maxX: Math.min(vlak.maxX, gat.minX) },
		{ ...vlak, minX: Math.max(vlak.minX, gat.maxX) },
		{ minX, maxX, minZ: vlak.minZ, maxZ: Math.min(vlak.maxZ, gat.minZ) },
		{ minX, maxX, minZ: Math.max(vlak.minZ, gat.maxZ), maxZ: vlak.maxZ },
	].filter((stuk) => span(stuk.minX, stuk.maxX) > 0 && span(stuk.minZ, stuk.maxZ) > 0);
}

/** What remains of `vlak` once every hole in `gaten` is cut out of it. */
export function boundsMinusHoles(vlak: Bounds2, gaten: readonly Bounds2[]): Bounds2[] {
	let stukken: Bounds2[] = [vlak];
	for (const gat of gaten) stukken = stukken.flatMap((stuk) => boundsMinusHole(stuk, gat));
	return stukken;
}

export function geometryBounds(geometry: SpatialGeometry): Bounds3 {
	if (geometry.kind === 'prism') return { ...planBounds(geometry.plan), minY: geometry.minY, maxY: geometry.maxY };
	if (geometry.kind === 'cylinder') {
		if (geometry.axis === 'y') {
			return {
				minX: geometry.center.x - geometry.radius,
				maxX: geometry.center.x + geometry.radius,
				minY: geometry.center.y - half(geometry.height),
				maxY: geometry.center.y + half(geometry.height),
				minZ: geometry.center.z - geometry.radius,
				maxZ: geometry.center.z + geometry.radius,
			};
		}
		const extentX = geometry.axis === 'x' ? half(geometry.height) : geometry.radius;
		const extentZ = geometry.axis === 'z' ? half(geometry.height) : geometry.radius;
		return {
			minX: geometry.center.x - extentX,
			maxX: geometry.center.x + extentX,
			minY: geometry.center.y - geometry.radius,
			maxY: geometry.center.y + geometry.radius,
			minZ: geometry.center.z - extentZ,
			maxZ: geometry.center.z + extentZ,
		};
	}
	const deltaX = geometry.end.x - geometry.start.x;
	const deltaZ = geometry.end.z - geometry.start.z;
	const run = Math.hypot(deltaX, deltaZ);
	const perpendicularX = run <= EPSILON ? 1 : -deltaZ / run;
	const perpendicularZ = run <= EPSILON ? 0 : deltaX / run;
	const extendX = half(Math.abs(perpendicularX) * geometry.width);
	const extendZ = half(Math.abs(perpendicularZ) * geometry.width);
	return {
		minX: Math.min(geometry.start.x, geometry.end.x) - extendX,
		maxX: Math.max(geometry.start.x, geometry.end.x) + extendX,
		minY: Math.min(geometry.start.y, geometry.end.y) - ('thickness' in geometry ? geometry.thickness : 0),
		maxY: Math.max(geometry.start.y, geometry.end.y) + (geometry.kind === 'flight-clearance' ? geometry.height : 0),
		minZ: Math.min(geometry.start.z, geometry.end.z) - extendZ,
		maxZ: Math.max(geometry.start.z, geometry.end.z) + extendZ,
	};
}

/**
 * The free height a clearance volume offers a body walking through it.
 *
 * A flight carries its own figure: its bounding box spans the whole rise, so reading
 * the box would report a stair as twelve metres of headroom.
 */
export function clearanceHeight(geometry: SpatialGeometry): number {
	if (geometry.kind === 'flight-clearance') return geometry.height;
	const bounds = geometryBounds(geometry);
	return span(bounds.minY, bounds.maxY);
}

function boundsOverlap(a: Bounds3, b: Bounds3): boolean {
	return (
		a.minX < b.maxX - EPSILON &&
		a.maxX > b.minX + EPSILON &&
		a.minY < b.maxY - EPSILON &&
		a.maxY > b.minY + EPSILON &&
		a.minZ < b.maxZ - EPSILON &&
		a.maxZ > b.minZ + EPSILON
	);
}

export function pointInPlan(shape: PlanShape, x: number, z: number): boolean {
	if (shape.kind === 'circle') return Math.hypot(x - shape.center.x, z - shape.center.z) <= shape.radius + EPSILON;
	if (shape.kind === 'rectangle') {
		const dx = x - shape.center.x;
		const dz = z - shape.center.z;
		const cosine = Math.cos(-shape.yaw);
		const sine = Math.sin(-shape.yaw);
		const localX = dx * cosine - dz * sine;
		const localZ = dx * sine + dz * cosine;
		return Math.abs(localX) <= half(shape.width) + EPSILON && Math.abs(localZ) <= half(shape.depth) + EPSILON;
	}
	let inside = false;
	for (let i = 0, j = shape.points.length - 1; i < shape.points.length; j = i, i++) {
		const current = shape.points[i];
		const previous = shape.points[j];
		if (!current || !previous) continue;
		const crosses = current.z > z !== previous.z > z;
		if (crosses && x < ((previous.x - current.x) * (z - current.z)) / (previous.z - current.z) + current.x) inside = !inside;
	}
	return inside;
}

function planSamples(shape: PlanShape): readonly Vec2[] {
	const bounds = planBounds(shape);
	return [
		{ x: midpoint(bounds.minX, bounds.maxX), z: midpoint(bounds.minZ, bounds.maxZ) },
		{ x: bounds.minX, z: bounds.minZ },
		{ x: bounds.minX, z: bounds.maxZ },
		{ x: bounds.maxX, z: bounds.minZ },
		{ x: bounds.maxX, z: bounds.maxZ },
	];
}

function prismContainsPlanPoint(prism: PrismGeometry, point: Vec2): boolean {
	return pointInPlan(prism.plan, point.x, point.z) && !prism.holes.some((hole) => pointInPlan(hole, point.x, point.z));
}

/**
 * Two plans crossing like a plus sign put no corner of either inside the other, so the
 * shared window has to be sampled as well. A runway laid straight through a toilet wall
 * read as clear on corners alone.
 */
function sharedWindowSamples(a: PrismGeometry, b: PrismGeometry): readonly Vec2[] {
	const boundsA = planBounds(a.plan);
	const boundsB = planBounds(b.plan);
	const minX = Math.max(boundsA.minX, boundsB.minX);
	const maxX = Math.min(boundsA.maxX, boundsB.maxX);
	const minZ = Math.max(boundsA.minZ, boundsB.minZ);
	const maxZ = Math.min(boundsA.maxZ, boundsB.maxZ);
	if (minX > maxX || minZ > maxZ) return [];
	return [
		{ x: midpoint(minX, maxX), z: midpoint(minZ, maxZ) },
		{ x: minX, z: minZ },
		{ x: minX, z: maxZ },
		{ x: maxX, z: minZ },
		{ x: maxX, z: maxZ },
	];
}

function prismPlanOverlap(a: PrismGeometry, b: PrismGeometry): boolean {
	const samples = [...planSamples(a.plan), ...planSamples(b.plan), ...sharedWindowSamples(a, b)];
	return samples.some((point) => prismContainsPlanPoint(a, point) && prismContainsPlanPoint(b, point));
}

function horizontalOverlap(a: SpatialGeometry, b: SpatialGeometry): boolean {
	if (a.kind === 'prism' && b.kind === 'prism') return prismPlanOverlap(a, b);
	if (a.kind === 'cylinder' && a.axis === 'y' && b.kind === 'prism') {
		return prismContainsPlanPoint(b, { x: a.center.x, z: a.center.z });
	}
	if (b.kind === 'cylinder' && b.axis === 'y' && a.kind === 'prism') {
		return prismContainsPlanPoint(a, { x: b.center.x, z: b.center.z });
	}
	const boundsA = geometryBounds(a);
	const boundsB = geometryBounds(b);
	return (
		boundsA.minX < boundsB.maxX - EPSILON &&
		boundsA.maxX > boundsB.minX + EPSILON &&
		boundsA.minZ < boundsB.maxZ - EPSILON &&
		boundsA.maxZ > boundsB.minZ + EPSILON
	);
}

function flightSurfaceY(geometry: StairGeometry | RampGeometry | FlightClearanceGeometry, x: number, z: number): number {
	const t = segmentParameter2(x, z, geometry.start.x, geometry.start.z, geometry.end.x, geometry.end.z);
	return geometry.start.y + (geometry.end.y - geometry.start.y) * t;
}

function pointInFlightPlan(geometry: StairGeometry | RampGeometry, x: number, z: number): boolean {
	return pointInSegmentStrip2(x, z, geometry.start.x, geometry.start.z, geometry.end.x, geometry.end.z, geometry.width, EPSILON);
}

function prismFlightOverlap(prism: PrismGeometry, flight: StairGeometry | RampGeometry): boolean {
	const flightBounds = geometryBounds(flight);
	const prismBounds = geometryBounds(prism);
	if (!boundsOverlap(flightBounds, prismBounds)) return false;
	const minX = Math.max(flightBounds.minX, prismBounds.minX);
	const maxX = Math.min(flightBounds.maxX, prismBounds.maxX);
	const minZ = Math.max(flightBounds.minZ, prismBounds.minZ);
	const maxZ = Math.min(flightBounds.maxZ, prismBounds.maxZ);
	const points: Vec2[] = [];
	for (const x of [minX, midpoint(minX, maxX), maxX]) {
		for (const z of [minZ, midpoint(minZ, maxZ), maxZ]) {
			const point = { x, z };
			if (prismContainsPlanPoint(prism, point) && pointInFlightPlan(flight, x, z)) points.push(point);
		}
	}
	if (points.length === 0) return false;
	const thickness = flight.kind === 'ramp' ? flight.thickness : flight.treadThickness;
	return points.some((point) => prism.maxY > flightSurfaceY(flight, point.x, point.z) - thickness + EPSILON);
}

/** An interval on the flight's own plan axis, in world metres. */
type AxisInterval = Readonly<{ min: number; max: number }>;

/**
 * What a solid does to the headroom over a flight.
 *
 * Nine sampled corner and midpoints used to answer this, and the strip where the
 * east escalator's riders cross the V1 slab edge, z 1.6 to 2.42, fell between
 * three of them: the world validated green while a head went through concrete.
 * The answer is now the interval itself.
 *
 * `unmeasurable` is a third answer because coverage is read as an interval on one
 * axis. A circular, polygonal or yawed hole has no such interval, and both silent
 * answers would be a guess.
 */
export type FlightClearanceVerdict =
	| Readonly<{ kind: 'clear' }>
	| Readonly<{ kind: 'blocked'; axis: 'x' | 'z'; from: number; to: number }>
	| Readonly<{ kind: 'unmeasurable'; reason: string }>;

/** The swath a flight sweeps in plan: its run along one world axis, widened across the other. */
type FlightSwath = Readonly<{ axis: 'x' | 'z'; from: number; to: number; crossMin: number; crossMax: number }>;

const QUARTER_TURN = Math.PI / 2;

function alongAxis(bounds: Bounds2, axis: 'x' | 'z'): AxisInterval {
	return axis === 'x' ? { min: bounds.minX, max: bounds.maxX } : { min: bounds.minZ, max: bounds.maxZ };
}

function acrossAxis(bounds: Bounds2, axis: 'x' | 'z'): AxisInterval {
	return axis === 'x' ? { min: bounds.minZ, max: bounds.maxZ } : { min: bounds.minX, max: bounds.maxX };
}

/** Bounds of a plan shape that is an axis-aligned rectangle, and null for every other shape. */
function axisAlignedRectangleBounds(shape: PlanShape): Bounds2 | null {
	if (shape.kind !== 'rectangle') return null;
	const turns = shape.yaw / QUARTER_TURN;
	return Math.abs(turns - Math.round(turns)) <= EPSILON ? planBounds(shape) : null;
}

function flightSwath(flight: FlightClearanceGeometry): FlightSwath | null {
	const alongZ = Math.abs(flight.end.x - flight.start.x) <= EPSILON;
	const alongX = Math.abs(flight.end.z - flight.start.z) <= EPSILON;
	if (alongZ === alongX) return null;
	const reach = half(flight.width);
	if (alongZ) {
		return {
			axis: 'z',
			from: flight.start.z,
			to: flight.end.z,
			crossMin: flight.start.x - reach,
			crossMax: flight.start.x + reach,
		};
	}
	return {
		axis: 'x',
		from: flight.start.x,
		to: flight.end.x,
		crossMin: flight.start.z - reach,
		crossMax: flight.start.z + reach,
	};
}

/**
 * The stretch of the flight, as a parameter from start to end, where the band a
 * standing body needs meets the prism's own band.
 *
 * The surface height runs linearly between the two endpoints, so the stretch is a
 * single interval and follows from a division. A flight with no rise has no such
 * division and fouls over its whole run or over none of it.
 */
function foulingWindow(flight: FlightClearanceGeometry, prism: PrismGeometry): AxisInterval | null {
	const lowest = prism.minY - flight.height + EPSILON;
	const highest = prism.maxY - EPSILON;
	const rise = flight.end.y - flight.start.y;
	if (Math.abs(rise) <= EPSILON) {
		return flight.start.y > lowest && flight.start.y < highest ? { min: 0, max: 1 } : null;
	}
	const first = (lowest - flight.start.y) / rise;
	const second = (highest - flight.start.y) / rise;
	const min = clamp01(Math.min(first, second));
	const max = clamp01(Math.max(first, second));
	return max - min > EPSILON ? { min, max } : null;
}

export function flightClearanceVerdict(prism: PrismGeometry, flight: FlightClearanceGeometry): FlightClearanceVerdict {
	if (!boundsOverlap(geometryBounds(flight), geometryBounds(prism))) return { kind: 'clear' };
	const swath = flightSwath(flight);
	if (!swath) return { kind: 'unmeasurable', reason: 'the flight does not run along a single plan axis' };
	const window = foulingWindow(flight, prism);
	if (!window) return { kind: 'clear' };
	const edgeA = lerp(swath.from, swath.to, window.min);
	const edgeB = lerp(swath.from, swath.to, window.max);
	const planReach = planBounds(prism.plan);
	const planAcross = acrossAxis(planReach, swath.axis);
	if (planAcross.max <= swath.crossMin + EPSILON || planAcross.min >= swath.crossMax - EPSILON) return { kind: 'clear' };
	const planAlong = alongAxis(planReach, swath.axis);
	const foulMin = Math.min(edgeA, edgeB);
	const foulMax = Math.max(edgeA, edgeB);
	const solidMin = Math.max(foulMin, planAlong.min);
	const solidMax = Math.min(foulMax, planAlong.max);
	if (solidMax - solidMin <= EPSILON) return { kind: 'clear' };

	const covered: AxisInterval[] = [];
	for (const hole of prism.holes) {
		const rectangle = axisAlignedRectangleBounds(hole);
		const reach = rectangle ?? planBounds(hole);
		const along = alongAxis(reach, swath.axis);
		const across = acrossAxis(reach, swath.axis);
		const meetsSwath =
			along.max > solidMin + EPSILON &&
			along.min < solidMax - EPSILON &&
			across.max > swath.crossMin + EPSILON &&
			across.min < swath.crossMax - EPSILON;
		if (!rectangle) {
			if (meetsSwath) return { kind: 'unmeasurable', reason: `hole shape '${hole.kind}' is not an axis-aligned rectangle` };
			continue;
		}
		if (!meetsSwath) continue;
		// A hole covers only where it spans the whole width of the swath. Half a bite
		// out of it leaves a strip of deck standing beside the rider.
		if (across.min > swath.crossMin + EPSILON || across.max < swath.crossMax - EPSILON) continue;
		covered.push({ min: Math.max(along.min, solidMin), max: Math.min(along.max, solidMax) });
	}

	// Coverage is measured as a union. Subtracting the holes' lengths counts the
	// metres two overlapping holes share twice, and calls deck that is still there
	// covered.
	const merged = [...covered].sort((a, b) => a.min - b.min);
	let reached = solidMin;
	for (const interval of merged) {
		if (interval.min > reached + EPSILON) return { kind: 'blocked', axis: swath.axis, from: reached, to: interval.min };
		reached = Math.max(reached, interval.max);
	}
	if (solidMax > reached + EPSILON) return { kind: 'blocked', axis: swath.axis, from: reached, to: solidMax };
	return { kind: 'clear' };
}

/**
 * The upright box a cylinder occupies, so it can be measured against a flight.
 *
 * Wider than the cylinder at the four corners, so it over-reports and never
 * under-reports, and far tighter than the flight's own bounding box, which is what
 * the pair fell back to.
 */
function prismOverCylinder(cylinder: CylinderGeometry): PrismGeometry {
	const bounds = geometryBounds(cylinder);
	return {
		kind: 'prism',
		plan: {
			kind: 'rectangle',
			center: { x: midpoint(bounds.minX, bounds.maxX), z: midpoint(bounds.minZ, bounds.maxZ) },
			width: span(bounds.minX, bounds.maxX),
			depth: span(bounds.minZ, bounds.maxZ),
			yaw: 0,
		},
		minY: bounds.minY,
		maxY: bounds.maxY,
		holes: [],
	};
}

/** A solid this function can hand to `flightClearanceVerdict`, and null for the rest. */
function solidPrism(geometry: SpatialGeometry): PrismGeometry | null {
	if (geometry.kind === 'prism') return geometry;
	if (geometry.kind === 'cylinder') return prismOverCylinder(geometry);
	return null;
}

/**
 * The verdict for a solid against a flight clearance in either order, and null for
 * any other pair.
 *
 * A cylinder used to fall past this to the bare `return true` in `geometriesOverlap`,
 * and a flight's bounding box is far wider than the flight, so a lamp post beside a
 * staircase read as a lamp post in it.
 */
function clearanceVerdict(a: SpatialGeometry, b: SpatialGeometry): FlightClearanceVerdict | null {
	if (b.kind === 'flight-clearance') {
		const solid = solidPrism(a);
		return solid && flightClearanceVerdict(solid, b);
	}
	if (a.kind === 'flight-clearance') {
		const solid = solidPrism(b);
		return solid && flightClearanceVerdict(solid, a);
	}
	return null;
}

export function geometriesOverlap(a: SpatialGeometry, b: SpatialGeometry): boolean {
	if (!boundsOverlap(geometryBounds(a), geometryBounds(b))) return false;
	if (a.kind === 'prism' && b.kind === 'prism') return prismPlanOverlap(a, b);
	if (a.kind === 'prism' && (b.kind === 'stair-flight' || b.kind === 'ramp')) return prismFlightOverlap(a, b);
	if (b.kind === 'prism' && (a.kind === 'stair-flight' || a.kind === 'ramp')) return prismFlightOverlap(b, a);
	const verdict = clearanceVerdict(a, b);
	if (verdict) return verdict.kind !== 'clear';
	return true;
}

function geometryValid(geometry: SpatialGeometry): boolean {
	if (geometry.kind === 'prism') {
		const plan = geometry.plan;
		const planValid =
			plan.kind === 'rectangle'
				? positive(plan.width) && positive(plan.depth) && finite([plan.center.x, plan.center.z, plan.yaw])
				: plan.kind === 'circle'
					? positive(plan.radius) && finite([plan.center.x, plan.center.z])
					: plan.points.length >= 3 && plan.points.every((point) => finite([point.x, point.z]));
		return planValid && finite([geometry.minY, geometry.maxY]) && geometry.maxY > geometry.minY;
	}
	if (geometry.kind === 'cylinder')
		return positive(geometry.radius) && positive(geometry.height) && finite(Object.values(geometry.center));
	return (
		positive(geometry.width) &&
		positive(
			geometry.kind === 'ramp'
				? geometry.thickness
				: geometry.kind === 'stair-flight'
					? geometry.treadThickness
					: geometry.height,
		) &&
		finite([...Object.values(geometry.start), ...Object.values(geometry.end)]) &&
		(geometry.kind !== 'stair-flight' || Number.isInteger(geometry.treadCount)) &&
		(geometry.kind !== 'stair-flight' || geometry.treadCount > 0)
	);
}

function overlapAllowed(a: WorldEntity, volumeA: SpatialVolume, b: WorldEntity, volumeB: SpatialVolume): boolean {
	if (volumeA.role === 'decorative-covering' || volumeB.role === 'decorative-covering') {
		const covering = volumeA.role === 'decorative-covering' ? a : b;
		const other = covering === a ? b : a;
		return (
			covering.placement.mayBeCoveredBy.includes(other.placement.class) ||
			other.placement.mayCover.includes('decorative-covering')
		);
	}
	return volumeA.allowsOverlapFrom.includes(b.placement.class) && volumeB.allowsOverlapFrom.includes(a.placement.class);
}

/**
 * A flight's bounding box is far wider than its body, so only volumes whose bounds
 * are their shape can be compared this way.
 */
function boundedByItsShape(geometry: SpatialGeometry): boolean {
	return geometry.kind === 'prism' || geometry.kind === 'cylinder';
}

/**
 * Horizontal intrusion of one volume into another: the smaller of the two axis
 * overlaps, which is how far past the shared face the geometry reaches. Faces that
 * merely rest against each other give zero.
 */
function intrusionDepth(a: SpatialGeometry, b: SpatialGeometry): number {
	const boundsA = geometryBounds(a);
	const boundsB = geometryBounds(b);
	const x = Math.min(boundsA.maxX, boundsB.maxX) - Math.max(boundsA.minX, boundsB.minX);
	const y = Math.min(boundsA.maxY, boundsB.maxY) - Math.max(boundsA.minY, boundsB.minY);
	const z = Math.min(boundsA.maxZ, boundsB.maxZ) - Math.max(boundsA.minZ, boundsB.minZ);
	if (x <= EPSILON || y <= EPSILON || z <= EPSILON) return 0;
	return Math.min(x, z);
}

/**
 * Whether `volume` declared the intrusion it is making into `target`. Only volumes
 * whose bounds are their shape are measured: a flight's box is far wider than the
 * flight, so its overlap figure means nothing.
 */
function declaredIntrusion(volume: SpatialVolume, target: WorldEntity, depth: number): boolean {
	const permit = volume.penetration ?? NO_PENETRATION;
	return permit.into.includes(target.placement.class) && depth <= permit.depth + EPSILON;
}

/**
 * Two solids may share a face, and `allowsOverlapFrom` says which classes may do
 * so. It cannot say how far, so a shop resting against the perimeter wall and a
 * shop standing 0.4 m outside the facade were the same thing to it. KRUIDVAT was
 * visibly through the north wall on the floor plan while this validator passed.
 */
function undeclaredIntrusion(a: WorldEntity, volumeA: SpatialVolume, b: WorldEntity, volumeB: SpatialVolume): number {
	if (!boundedByItsShape(volumeA.geometry) || !boundedByItsShape(volumeB.geometry)) return 0;
	if (!volumeA.blocksMovement || !volumeB.blocksMovement) return 0;
	const depth = intrusionDepth(volumeA.geometry, volumeB.geometry);
	if (depth <= EPSILON) return 0;
	if (declaredIntrusion(volumeA, b, depth) || declaredIntrusion(volumeB, a, depth)) return 0;
	return depth;
}

/**
 * A surface you are meant to walk on cannot pass through something that stops bodies:
 * the far end of it is unreachable. Neither of the rules above sees this. The physical
 * overlap rule needs `blocksMovement` on both sides and a deck blocks nothing itself,
 * and `allowsOverlapFrom` lets any two authored fixtures share space on purpose.
 */
function obstructedSurface(a: SpatialVolume, b: SpatialVolume): boolean {
	if (!boundedByItsShape(a.geometry) || !boundedByItsShape(b.geometry)) return false;
	const walkable = a.role === 'walkable' ? a : b.role === 'walkable' ? b : null;
	if (!walkable) return false;
	const obstacle = walkable === a ? b : a;
	return obstacle.blocksMovement;
}

function passageClearance(volume: SpatialVolume): boolean {
	return volume.role === 'opening-clearance' || volume.role === 'connector-clearance';
}

/**
 * Reserved floor: nothing an entity puts down may stand in it.
 *
 * A shopfront keeps the strip in front of its window; a theatre aisle keeps the
 * lane between two banks of seats. Both are floor a body walks on and neither is
 * a passage between two places, so they answer the same question and are asked it
 * in the same breath.
 */
function reservedFloor(volume: SpatialVolume): boolean {
	return volume.role === 'storefront-clearance' || volume.role === 'aisle-clearance';
}

/** Declared free space: it reaches past the geometry it belongs to, which is its whole point. */
function clearanceRole(volume: SpatialVolume): boolean {
	return passageClearance(volume) || reservedFloor(volume);
}

/**
 * What ruins the floor in front of a shopfront. A collider is one way; the Fashion Week
 * backdrop is 5.4 m of opaque geometry with `blocksMovement` false, and every placement
 * rule in this file needs that flag on both sides, so nothing looked at it.
 */
function blocksFrontage(volume: SpatialVolume): boolean {
	return volume.clearance.kind === 'fixed-obstruction' || volume.role === 'solid';
}

/** Metres by which `volume` reaches past `envelope` in plan, and zero or less when it fits. */
function planOvershoot(envelope: Bounds3, volume: Bounds3): number {
	return Math.max(
		envelope.minX - volume.minX,
		volume.maxX - envelope.maxX,
		envelope.minZ - volume.minZ,
		volume.maxZ - envelope.maxZ,
	);
}

const VISIBLE_SURFACE_ROLES: readonly SpatialRole[] = ['solid', 'walkable', 'support', 'decorative-covering'];

/**
 * Both volumes present a top face at the same height. Only shapes that are their own
 * bounds are measured, since a flight's box ends at the deck it arrives on while the
 * flight itself is a slope. Resting a bottom on a top is the support relation and a
 * different question.
 */
function coplanarTops(a: SpatialVolume, b: SpatialVolume): boolean {
	if (!boundedByItsShape(a.geometry) || !boundedByItsShape(b.geometry)) return false;
	if (!VISIBLE_SURFACE_ROLES.includes(a.role) || !VISIBLE_SURFACE_ROLES.includes(b.role)) return false;
	return Math.abs(geometryBounds(a.geometry).maxY - geometryBounds(b.geometry).maxY) <= COPLANAR_TOLERANCE;
}

/** Solid to the eye, whether or not it stops a body. */
const OPAQUE_ROLES: readonly SpatialRole[] = ['solid', 'walkable', 'support'];

/**
 * Clutter is put down on the world; it cannot stand inside the building. Both the
 * physical-overlap rule and the intrusion rule need `blocksMovement` on both sides,
 * and a decorative car has it off, so two of them sat 0.35 m inside a concrete
 * pillar with every check green. Paint is the other half of the question and is
 * answered by `coveringInStructure`.
 */
function clutterInStructure(a: WorldEntity, volumeA: SpatialVolume, b: WorldEntity, volumeB: SpatialVolume): boolean {
	if (!boundedByItsShape(volumeA.geometry) || !boundedByItsShape(volumeB.geometry)) return false;
	const clutter = a.placement.class === 'clutter' ? volumeA : b.placement.class === 'clutter' ? volumeB : null;
	const structure = a.placement.class === 'structure' ? volumeA : b.placement.class === 'structure' ? volumeB : null;
	if (!clutter || !structure) return false;
	return OPAQUE_ROLES.includes(clutter.role) && OPAQUE_ROLES.includes(structure.role);
}

type VolumeOfEntity = Readonly<{ entity: WorldEntity; volume: SpatialVolume }>;

/**
 * The covering and the structural body it is inside of, or null.
 *
 * Running under structure is what paint is for: the deck slab carries it, the
 * ceiling and the lintel pass over it, and neither of those ever reaches this far,
 * because two volumes have to meet in three dimensions before they are compared at
 * all. What does reach here is a stripe crossing something that stands on the same
 * floor, and there the paint is inside the concrete rather than under it. Six
 * parking bays and three lane arrows ran through a column that way, and every rule
 * in this file let them: `overlapAllowed` grants a covering its overlap by name, and
 * the rule above ignores coverings entirely.
 */
function coveringInStructure(
	a: WorldEntity,
	volumeA: SpatialVolume,
	b: WorldEntity,
	volumeB: SpatialVolume,
): Readonly<{ covering: VolumeOfEntity; structure: VolumeOfEntity }> | null {
	if (!boundedByItsShape(volumeA.geometry) || !boundedByItsShape(volumeB.geometry)) return null;
	const first = { entity: a, volume: volumeA };
	const second = { entity: b, volume: volumeB };
	const covering = volumeA.role === 'decorative-covering' ? first : volumeB.role === 'decorative-covering' ? second : null;
	if (!covering) return null;
	const structure = covering === first ? second : first;
	if (structure.entity.placement.class !== 'structure' || !OPAQUE_ROLES.includes(structure.volume.role)) return null;
	return { covering, structure };
}

/**
 * Whether this permit is doing any work: the volume really does reach into geometry
 * of a class it named.
 *
 * A permit that cuts into nothing is the mirror of the unused protrusion the facade
 * control already reports. Both retaining walls of the exit trench declared 25 mm into
 * the structure and then stopped at the facade, so the declaration outlived the lap it
 * was written for and nothing said a word.
 */
function penetrationUsed(volume: SpatialVolume, target: WorldEntity, other: SpatialVolume): boolean {
	const permit = volume.penetration;
	if (!permit || permit.depth <= EPSILON) return false;
	if (!permit.into.includes(target.placement.class)) return false;
	return intrusionDepth(volume.geometry, other.geometry) > EPSILON;
}

/**
 * Which way this entity's back points, from its own yaw, and null for a yaw that is
 * off the quarter turns. A yaw of zero faces +z, so the back is the north face.
 */
function backSide(yaw: number): CardinalSide | null {
	const turns = yaw / QUARTER_TURN;
	if (Math.abs(turns - Math.round(turns)) > EPSILON) return null;
	const quarters: readonly CardinalSide[] = ['north', 'west', 'south', 'east'];
	return quarters[((Math.round(turns) % quarters.length) + quarters.length) % quarters.length] ?? null;
}

/** Where `bounds` ends on the named side, measured along that side's outward normal. */
function faceOf(bounds: Bounds3, side: CardinalSide): number {
	const outward = CARDINAL_OUTWARD[side];
	if (outward.x !== 0) return outward.x < 0 ? bounds.minX : bounds.maxX;
	return outward.z < 0 ? bounds.minZ : bounds.maxZ;
}

/** The two axes as intervals, so a rule can pick the one it is not measuring along. */
function acrossInterval(bounds: Bounds3, side: CardinalSide): AxisInterval {
	return CARDINAL_OUTWARD[side].x !== 0 ? { min: bounds.minZ, max: bounds.maxZ } : { min: bounds.minX, max: bounds.maxX };
}

function intervalsMeet(a: AxisInterval, b: AxisInterval): boolean {
	return a.max > b.min + EPSILON && a.min < b.max - EPSILON;
}

/**
 * Metres between a room shell's back face and the nearest structure standing behind
 * it, and `null` where nothing stands there at all.
 *
 * Only structure counts. A shop rests against the building, and another fixture in
 * the slit is the thing this rule exists to find rather than an answer to it.
 */
function backingGap(shell: Bounds3, side: CardinalSide, entities: readonly WorldEntity[], owner: WorldEntity): number | null {
	const outward = CARDINAL_OUTWARD[side];
	const sign = outward.x !== 0 ? outward.x : outward.z;
	const face = faceOf(shell, side);
	const across = acrossInterval(shell, side);
	let nearest: number | null = null;
	for (const entity of entities) {
		if (entity.id === owner.id || entity.placement.class !== 'structure') continue;
		for (const volume of entity.volumes) {
			if (!OPAQUE_ROLES.includes(volume.role) || !boundedByItsShape(volume.geometry)) continue;
			const bounds = geometryBounds(volume.geometry);
			if (bounds.maxY <= shell.minY + EPSILON || bounds.minY >= shell.maxY - EPSILON) continue;
			if (!intervalsMeet(across, acrossInterval(bounds, side))) continue;
			const near = faceOf(bounds, CARDINAL_OPPOSITE[side]);
			const gap = (near - face) * sign;
			// Strictly behind: a slab reaching past the shell on both sides is the floor
			// it stands on, not the wall it should be resting against.
			if (gap < -EPSILON) continue;
			if (nearest === null || gap < nearest) nearest = gap;
		}
	}
	return nearest;
}

/**
 * Signs cutting into each other or into what they hang from.
 *
 * Two rules should have caught this and neither could. `undeclaredIntrusion` needs a
 * collider on both sides and a hanging sign has none, and the pass that calls it
 * compares entities two at a time while a shop's fascia and its own banners belong to
 * one entity. ISLAND HOP's green charter banner, its red cash-only banner and the gold
 * fascia therefore all interpenetrated at ceiling height with this file green.
 */
function signageClashes(entities: readonly WorldEntity[]): SpatialProblem[] {
	const all = entities.flatMap((entity) =>
		entity.volumes
			.filter((volume) => boundedByItsShape(volume.geometry) && VISIBLE_SURFACE_ROLES.includes(volume.role))
			.map((volume) => ({ entity, volume })),
	);
	const problems: SpatialProblem[] = [];
	for (const sign of all.filter((candidate) => candidate.volume.tags.includes(SIGNAGE_TAG))) {
		for (const other of all) {
			if (other.volume === sign.volume) continue;
			// Elk paar één keer: twee vaandels die elkaar snijden zijn één fout.
			if (other.volume.tags.includes(SIGNAGE_TAG) && all.indexOf(other) < all.indexOf(sign)) continue;
			// Een bord hangt binnen het grondvlak van zijn eigen winkel, en dat is waar
			// een plan-envelop voor is. Of het daarbinnen blijft is `uncontained-volume`.
			if (other.entity.id === sign.entity.id && other.volume.tags.includes(PLAN_ENVELOPE_TAG)) continue;
			const depth = intrusionDepth(sign.volume.geometry, other.volume.geometry);
			if (depth <= EPSILON) continue;
			problems.push({
				code: 'unsupported-placement',
				message: `${sign.entity.id}.${sign.volume.id} cuts ${depth.toFixed(3)} m into ${other.entity.id}.${other.volume.id}; a sign hangs clear of what it is hung from`,
				entities: [sign.entity.id, other.entity.id],
			});
		}
	}
	return problems;
}

/** An authored interpenetration: the wall caps run over the side walls and say so. */
function authoredJoin(a: WorldEntity, volumeA: SpatialVolume, b: WorldEntity, volumeB: SpatialVolume): boolean {
	const depth = intrusionDepth(volumeA.geometry, volumeB.geometry);
	return declaredIntrusion(volumeA, b, depth) || declaredIntrusion(volumeB, a, depth);
}

export function validateSpatialWorld(entities: readonly WorldEntity[]): SpatialProblem[] {
	const problems: SpatialProblem[] = [];
	const entityIds = new Set<string>();
	const portOwners = new Map<string, WorldEntity>();

	for (const entity of entities) {
		if (entityIds.has(entity.id))
			problems.push({ code: 'duplicate-id', message: `duplicate entity id ${entity.id}`, entities: [entity.id] });
		entityIds.add(entity.id);
		const volumeIds = new Set<string>();
		for (const volume of entity.volumes) {
			if (volumeIds.has(volume.id)) {
				problems.push({
					code: 'duplicate-id',
					message: `${entity.id} has duplicate volume id ${volume.id}`,
					entities: [entity.id],
				});
			}
			volumeIds.add(volume.id);
			if (!geometryValid(volume.geometry)) {
				problems.push({
					code: 'invalid-geometry',
					message: `${entity.id}.${volume.id} has invalid geometry`,
					entities: [entity.id],
				});
			}
		}
		for (const port of entity.ports) {
			if (portOwners.has(port.id))
				problems.push({ code: 'duplicate-id', message: `duplicate port id ${port.id}`, entities: [entity.id] });
			portOwners.set(port.id, entity);
			const clearance = entity.volumes.find((volume) => volume.id === port.clearanceVolumeId);
			if (!clearance) {
				problems.push({
					code: 'missing-volume',
					message: `${entity.id}.${port.id} references missing clearance volume ${port.clearanceVolumeId}`,
					entities: [entity.id],
				});
				continue;
			}
			// Alleen wie er te voet doorheen gaat heeft een houding; een leiding of een
			// auto meet zijn vrije hoogte aan iets anders.
			if (!port.allows.includes('walking')) continue;
			const needed = postureHeadroom(port.posture);
			const offered = clearanceHeight(clearance.geometry);
			if (offered < needed - EPSILON) {
				problems.push({
					code: 'insufficient-headroom',
					message: `${entity.id}.${port.id} is walked ${port.posture} and needs ${needed.toFixed(3)} m, but ${clearance.id} offers ${offered.toFixed(3)} m`,
					entities: [entity.id],
				});
			}
			if (port.height < needed - EPSILON) {
				problems.push({
					code: 'insufficient-headroom',
					message: `${entity.id}.${port.id} is walked ${port.posture} and needs ${needed.toFixed(3)} m, but declares an opening ${port.height.toFixed(3)} m high`,
					entities: [entity.id],
				});
			}
		}
		for (const emitter of entity.emitters) {
			if (!volumeIds.has(emitter.sourceVolumeId)) {
				problems.push({
					code: 'missing-volume',
					message: `${entity.id}.${emitter.id} references missing source volume ${emitter.sourceVolumeId}`,
					entities: [entity.id],
				});
			}
			if (emitter.targets.requireChannels.length > 0 && !emitter.targets.requireChannels.includes(emitter.channel)) {
				problems.push({
					code: 'invalid-interaction',
					message: `${entity.id}.${emitter.id} emits ${emitter.channel} but its selector requires different channels`,
					entities: [entity.id],
				});
			}
		}
		for (const mechanism of entity.mechanisms) {
			const trigger = entity.volumes.find((volume) => volume.id === mechanism.triggerVolumeId);
			if (trigger?.role !== 'trigger') {
				problems.push({
					code: 'missing-volume',
					message: `${entity.id}.${mechanism.id} requires trigger volume ${mechanism.triggerVolumeId}`,
					entities: [entity.id],
				});
			}
			if (!positive(mechanism.openingSeconds) || mechanism.movingVolumeIds.length === 0) {
				problems.push({
					code: 'invalid-interaction',
					message: `${entity.id}.${mechanism.id} has no valid moving geometry or opening time`,
					entities: [entity.id],
				});
			}
			if (mechanism.access.admits.length === 0) {
				problems.push({
					code: 'invalid-interaction',
					message: `${entity.id}.${mechanism.id} admits no traffic class, so nothing it guards can ever be passed`,
					entities: [entity.id],
				});
			}
			for (const movingId of mechanism.movingVolumeIds) {
				const moving = entity.volumes.find((volume) => volume.id === movingId);
				if (moving?.clearance.kind !== 'automatic-gate' || moving.clearance.mechanismId !== mechanism.id) {
					problems.push({
						code: 'invalid-interaction',
						message: `${entity.id}.${mechanism.id} does not control gate volume ${movingId}`,
						entities: [entity.id],
					});
				}
			}
		}
		for (const volume of entity.volumes) {
			if (volume.clearance.kind !== 'automatic-gate') continue;
			const mechanismId = volume.clearance.mechanismId;
			if (!entity.mechanisms.some((mechanism) => mechanism.id === mechanismId)) {
				problems.push({
					code: 'invalid-interaction',
					message: `${entity.id}.${volume.id} references missing automatic gate ${mechanismId}`,
					entities: [entity.id],
				});
			}
		}
	}

	for (const entity of entities) {
		for (const port of entity.ports) {
			for (const peerId of port.connectsTo) {
				const peerOwner = portOwners.get(peerId);
				const peer = peerOwner?.ports.find((candidate) => candidate.id === peerId);
				if (!peerOwner || !peer?.connectsTo.includes(port.id) || peer.kind !== port.kind) {
					problems.push({
						code: 'broken-connection',
						message: `${entity.id}.${port.id} does not have a reciprocal ${port.kind} connection to ${peerId}`,
						entities: peerOwner ? [entity.id, peerOwner.id] : [entity.id],
					});
				}
			}
		}
	}

	const usedPenetration = new Set<string>();
	for (let i = 0; i < entities.length; i++) {
		const a = entities[i];
		if (!a) continue;
		for (let j = i + 1; j < entities.length; j++) {
			const b = entities[j];
			if (!b) continue;
			for (const volumeA of a.volumes) {
				for (const volumeB of b.volumes) {
					if (penetrationUsed(volumeA, b, volumeB)) usedPenetration.add(`${a.id}.${volumeA.id}`);
					if (penetrationUsed(volumeB, a, volumeA)) usedPenetration.add(`${b.id}.${volumeB.id}`);
					if (
						coplanarTops(volumeA, volumeB) &&
						horizontalOverlap(volumeA.geometry, volumeB.geometry) &&
						!authoredJoin(a, volumeA, b, volumeB)
					) {
						problems.push({
							code: 'coplanar-surface',
							message: `${a.id}.${volumeA.id} and ${b.id}.${volumeB.id} both end at y ${geometryBounds(
								volumeA.geometry,
							).maxY.toFixed(3)} and overlap in plan`,
							entities: [a.id, b.id],
						});
					}
					if (!geometriesOverlap(volumeA.geometry, volumeB.geometry)) continue;
					const clearanceA = passageClearance(volumeA);
					const clearanceB = passageClearance(volumeB);
					const buriedCovering = coveringInStructure(a, volumeA, b, volumeB);
					const frontage = reservedFloor(volumeA)
						? { entity: a, volume: volumeA, obstacle: { entity: b, volume: volumeB } }
						: reservedFloor(volumeB)
							? { entity: b, volume: volumeB, obstacle: { entity: a, volume: volumeA } }
							: null;
					if (
						(clearanceA && volumeB.clearance.kind === 'fixed-obstruction') ||
						(clearanceB && volumeA.clearance.kind === 'fixed-obstruction')
					) {
						const verdict = clearanceVerdict(volumeA.geometry, volumeB.geometry);
						problems.push(
							verdict?.kind === 'unmeasurable'
								? {
										code: 'unmeasurable-clearance',
										message: `${a.id}.${volumeA.id} meets ${b.id}.${volumeB.id} where ${verdict.reason}`,
										entities: [a.id, b.id],
									}
								: {
										code: 'blocked-clearance',
										message:
											verdict?.kind === 'blocked'
												? `${a.id}.${volumeA.id} intersects ${b.id}.${volumeB.id} over ${verdict.axis} ${verdict.from.toFixed(3)}..${verdict.to.toFixed(3)}`
												: `${a.id}.${volumeA.id} intersects ${b.id}.${volumeB.id}`,
										entities: [a.id, b.id],
									},
						);
					} else if (frontage && blocksFrontage(frontage.obstacle.volume)) {
						problems.push({
							code: 'blocked-clearance',
							message: `${frontage.obstacle.entity.id}.${frontage.obstacle.volume.id} stands in ${frontage.entity.id}.${frontage.volume.id}, which is floor kept clear`,
							entities: [a.id, b.id],
						});
					} else if (!overlapAllowed(a, volumeA, b, volumeB) && volumeA.blocksMovement && volumeB.blocksMovement) {
						problems.push({
							code: 'unsupported-placement',
							message: `${a.id}.${volumeA.id} physically overlaps ${b.id}.${volumeB.id}`,
							entities: [a.id, b.id],
						});
					} else if (clutterInStructure(a, volumeA, b, volumeB) && !authoredJoin(a, volumeA, b, volumeB)) {
						problems.push({
							code: 'unsupported-placement',
							message: `${a.id}.${volumeA.id} and ${b.id}.${volumeB.id} interpenetrate, and clutter cannot stand inside the structure`,
							entities: [a.id, b.id],
						});
					} else if (buriedCovering && !authoredJoin(a, volumeA, b, volumeB)) {
						problems.push({
							code: 'unsupported-placement',
							message: `${buriedCovering.covering.entity.id}.${buriedCovering.covering.volume.id} runs through ${buriedCovering.structure.entity.id}.${buriedCovering.structure.volume.id} instead of around its footprint`,
							entities: [a.id, b.id],
						});
					} else if (obstructedSurface(volumeA, volumeB)) {
						const surface = volumeA.role === 'walkable' ? { entity: a, volume: volumeA } : { entity: b, volume: volumeB };
						const obstacle = surface.volume === volumeA ? { entity: b, volume: volumeB } : { entity: a, volume: volumeA };
						problems.push({
							code: 'blocked-clearance',
							message: `${surface.entity.id}.${surface.volume.id} runs through ${obstacle.entity.id}.${obstacle.volume.id}`,
							entities: [a.id, b.id],
						});
					} else {
						const depth = undeclaredIntrusion(a, volumeA, b, volumeB);
						if (depth > 0) {
							problems.push({
								code: 'unsupported-placement',
								message: `${a.id}.${volumeA.id} and ${b.id}.${volumeB.id} overlap ${depth.toFixed(3)} m, and neither declares a penetration`,
								entities: [a.id, b.id],
							});
						}
					}
				}
			}
		}
	}

	for (const entity of entities) {
		for (const volume of entity.volumes) {
			const permit = volume.penetration;
			if (!permit || permit.depth <= EPSILON) continue;
			if (usedPenetration.has(`${entity.id}.${volume.id}`)) continue;
			problems.push({
				code: 'unused-penetration',
				message: `${entity.id}.${volume.id} declares ${permit.depth.toFixed(3)} m of penetration into ${permit.into.join(', ')} but cuts into nothing`,
				entities: [entity.id],
			});
		}
	}

	problems.push(...signageClashes(entities));

	for (const entity of entities) {
		for (const volume of entity.volumes) {
			if (!volume.tags.includes(ROOM_SHELL_TAG)) continue;
			const side = backSide(entity.transform.rotation.yaw);
			if (side === null) {
				problems.push({
					code: 'detached-backing',
					message: `${entity.id}.${volume.id} is turned off the quarter turns, so which face is its back cannot be read`,
					entities: [entity.id],
				});
				continue;
			}
			const gap = backingGap(geometryBounds(volume.geometry), side, entities, entity);
			const permit = volume.standoff;
			if (permit && permit.side !== side) {
				problems.push({
					code: 'unused-standoff',
					message: `${entity.id}.${volume.id} declares its standoff on the ${permit.side} face while its back is the ${side} face`,
					entities: [entity.id],
				});
				continue;
			}
			if (gap === null) {
				problems.push({
					code: 'detached-backing',
					message: `${entity.id}.${volume.id} has no structure behind its ${side} face at all`,
					entities: [entity.id],
				});
				continue;
			}
			const allowed = permit ? permit.depth : 0;
			if (gap > allowed + STANDOFF_MARGIN) {
				problems.push({
					code: 'detached-backing',
					message: `${entity.id}.${volume.id} stands ${gap.toFixed(3)} m clear of the structure behind its ${side} face and declares ${allowed.toFixed(3)} m`,
					entities: [entity.id],
				});
			} else if (permit && gap < permit.depth - STANDOFF_MARGIN) {
				// Dezelfde helft als bij een ongebruikte protrusion: een verklaring die
				// ruimer is dan het gat dat er ligt houdt een vergunning open voor
				// geometrie die allang teruggeschoven is.
				problems.push({
					code: 'unused-standoff',
					message: `${entity.id}.${volume.id} declares ${permit.depth.toFixed(3)} m of standoff and keeps only ${gap.toFixed(3)} m`,
					entities: [entity.id],
				});
			}
		}
	}

	for (const entity of entities) {
		const envelopes = entity.volumes.filter((volume) => volume.tags.includes(PLAN_ENVELOPE_TAG));
		if (envelopes.length === 0) continue;
		for (const volume of entity.volumes) {
			if (envelopes.includes(volume) || clearanceRole(volume)) continue;
			const bounds = geometryBounds(volume.geometry);
			let nearest: Readonly<{ id: string; overshoot: number }> | null = null;
			for (const envelope of envelopes) {
				const overshoot = planOvershoot(geometryBounds(envelope.geometry), bounds);
				if (!nearest || overshoot < nearest.overshoot) nearest = { id: envelope.id, overshoot };
			}
			if (nearest && nearest.overshoot > EPSILON) {
				problems.push({
					code: 'uncontained-volume',
					message: `${entity.id}.${volume.id} reaches ${nearest.overshoot.toFixed(3)} m outside ${entity.id}.${nearest.id}`,
					entities: [entity.id],
				});
			}
		}
	}

	const supportRoles: readonly SpatialRole[] = ['support', 'walkable', 'decorative-covering'];
	for (const entity of entities) {
		if (!entity.placement.requiresSupport) continue;
		const supported = entity.volumes.some((volume) => {
			const bottom = geometryBounds(volume.geometry).minY;
			return entities.some(
				(candidate) =>
					candidate.id !== entity.id &&
					candidate.volumes.some((support) => {
						if (!supportRoles.includes(support.role)) return false;
						const top = geometryBounds(support.geometry).maxY;
						return top >= bottom - 0.05 && top <= bottom + 0.05 && horizontalOverlap(volume.geometry, support.geometry);
					}),
			);
		});
		if (!supported) {
			problems.push({
				code: 'unsupported-placement',
				message: `${entity.id} requires a support surface at its authored position`,
				entities: [entity.id],
			});
		}
	}
	return problems;
}

export function receiverAccepts(emitter: InteractionEmitter, receiver: InteractionReceiver): boolean {
	const selector = emitter.targets;
	return (
		selector.mobility.includes(receiver.mobility) &&
		selector.requireTags.every((tag) => receiver.tags.includes(tag)) &&
		selector.excludeTags.every((tag) => !receiver.tags.includes(tag)) &&
		selector.requireChannels.every((channel) => receiver.channels.includes(channel)) &&
		receiver.channels.includes(emitter.channel)
	);
}
