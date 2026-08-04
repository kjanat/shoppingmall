import { pointInSegmentStrip2, segmentParameter2 } from '#/util/geometry2';
import { half, midpoint } from '#/util/math';

export type Vec2 = Readonly<{ x: number; z: number }>;
export type Vec3 = Readonly<{ x: number; y: number; z: number }>;

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
	| 'decorative-covering'
	| 'trigger'
	| 'fluid';

export type PlacementClass = 'structure' | 'fixture' | 'furnishing' | 'clutter' | 'covering' | 'connector';

export type SpatialVolume = Readonly<{
	id: string;
	role: SpatialRole;
	geometry: SpatialGeometry;
	/** A solid with this false is visual geometry and does not block bodies. */
	blocksMovement: boolean;
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
	occlusion: Readonly<{
		mode: 'none' | 'solid' | 'line-of-sight';
		blockingTags: readonly string[];
	}>;
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

export type ClearanceMechanism = Readonly<{
	id: string;
	kind: 'sliding' | 'hinged' | 'retracting';
	stateId: string;
	movingVolumeIds: readonly string[];
	triggerVolumeId: string;
	openState: Readonly<{ translation?: Vec3; rotationRadians?: number }>;
	openingSeconds: number;
	failSafe: 'open' | 'closed';
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
		| 'invalid-interaction';
	message: string;
	entities: readonly string[];
}>;

export type Bounds2 = Readonly<{ minX: number; maxX: number; minZ: number; maxZ: number }>;
export type Bounds3 = Bounds2 & Readonly<{ minY: number; maxY: number }>;

const EPSILON = 1e-6;

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
	const extendX = (Math.abs(perpendicularX) * geometry.width) / 2;
	const extendZ = (Math.abs(perpendicularZ) * geometry.width) / 2;
	return {
		minX: Math.min(geometry.start.x, geometry.end.x) - extendX,
		maxX: Math.max(geometry.start.x, geometry.end.x) + extendX,
		minY: Math.min(geometry.start.y, geometry.end.y) - ('thickness' in geometry ? geometry.thickness : 0),
		maxY: Math.max(geometry.start.y, geometry.end.y) + (geometry.kind === 'flight-clearance' ? geometry.height : 0),
		minZ: Math.min(geometry.start.z, geometry.end.z) - extendZ,
		maxZ: Math.max(geometry.start.z, geometry.end.z) + extendZ,
	};
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

function pointInPlan(shape: PlanShape, x: number, z: number): boolean {
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

function prismPlanOverlap(a: PrismGeometry, b: PrismGeometry): boolean {
	return (
		planSamples(a.plan).some((point) => prismContainsPlanPoint(a, point) && prismContainsPlanPoint(b, point)) ||
		planSamples(b.plan).some((point) => prismContainsPlanPoint(a, point) && prismContainsPlanPoint(b, point))
	);
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

function pointInClearancePlan(geometry: FlightClearanceGeometry, x: number, z: number): boolean {
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

function prismFlightClearanceOverlap(prism: PrismGeometry, flight: FlightClearanceGeometry): boolean {
	const flightBounds = geometryBounds(flight);
	const prismBounds = geometryBounds(prism);
	if (!boundsOverlap(flightBounds, prismBounds)) return false;
	const minX = Math.max(flightBounds.minX, prismBounds.minX);
	const maxX = Math.min(flightBounds.maxX, prismBounds.maxX);
	const minZ = Math.max(flightBounds.minZ, prismBounds.minZ);
	const maxZ = Math.min(flightBounds.maxZ, prismBounds.maxZ);
	for (const x of [minX, midpoint(minX, maxX), maxX]) {
		for (const z of [minZ, midpoint(minZ, maxZ), maxZ]) {
			const point = { x, z };
			if (!prismContainsPlanPoint(prism, point) || !pointInClearancePlan(flight, x, z)) continue;
			const surfaceY = flightSurfaceY(flight, x, z);
			if (prism.minY < surfaceY + flight.height - EPSILON && prism.maxY > surfaceY + EPSILON) return true;
		}
	}
	return false;
}

export function geometriesOverlap(a: SpatialGeometry, b: SpatialGeometry): boolean {
	if (!boundsOverlap(geometryBounds(a), geometryBounds(b))) return false;
	if (a.kind === 'prism' && b.kind === 'prism') return prismPlanOverlap(a, b);
	if (a.kind === 'prism' && (b.kind === 'stair-flight' || b.kind === 'ramp')) return prismFlightOverlap(a, b);
	if (b.kind === 'prism' && (a.kind === 'stair-flight' || a.kind === 'ramp')) return prismFlightOverlap(b, a);
	if (a.kind === 'prism' && b.kind === 'flight-clearance') return prismFlightClearanceOverlap(a, b);
	if (b.kind === 'prism' && a.kind === 'flight-clearance') return prismFlightClearanceOverlap(b, a);
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
			if (!volumeIds.has(port.clearanceVolumeId)) {
				problems.push({
					code: 'missing-volume',
					message: `${entity.id}.${port.id} references missing clearance volume ${port.clearanceVolumeId}`,
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

	for (let i = 0; i < entities.length; i++) {
		const a = entities[i];
		if (!a) continue;
		for (let j = i + 1; j < entities.length; j++) {
			const b = entities[j];
			if (!b) continue;
			for (const volumeA of a.volumes) {
				for (const volumeB of b.volumes) {
					if (!geometriesOverlap(volumeA.geometry, volumeB.geometry)) continue;
					const clearanceA = volumeA.role === 'opening-clearance' || volumeA.role === 'connector-clearance';
					const clearanceB = volumeB.role === 'opening-clearance' || volumeB.role === 'connector-clearance';
					if (
						(clearanceA && volumeB.clearance.kind === 'fixed-obstruction') ||
						(clearanceB && volumeA.clearance.kind === 'fixed-obstruction')
					) {
						problems.push({
							code: 'blocked-clearance',
							message: `${a.id}.${volumeA.id} intersects ${b.id}.${volumeB.id}`,
							entities: [a.id, b.id],
						});
					} else if (!overlapAllowed(a, volumeA, b, volumeB) && volumeA.blocksMovement && volumeB.blocksMovement) {
						problems.push({
							code: 'unsupported-placement',
							message: `${a.id}.${volumeA.id} physically overlaps ${b.id}.${volumeB.id}`,
							entities: [a.id, b.id],
						});
					}
				}
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
