import { STANDING_PEDESTRIAN } from '#/data/character';
import {
	CON_ADULT_GATE,
	CON_BASE_Y,
	CON_CEILING_Y,
	CON_DARKROOM,
	CON_DEALERS,
	CON_DOOR_BAY,
	CON_ENVELOPE,
	CON_FLOOR_Y,
	CON_FOOTPRINT,
	CON_HALL_HEIGHT,
	CON_HOTEL,
	CON_HOTEL_FLOOR_H,
	CON_HOTEL_FLOORS,
	CON_LABEL,
	CON_PORTAL,
	CON_STAGE,
	CON_STUDIO,
	CON_WALL_T,
	CON_ZONE_VOLUME,
	rectCenter,
	rectInterior,
} from '#/data/conPlan';
import type { LevelId } from '#/data/levels';
import type { Bounds2, Bounds3, SpatialVolume } from '#/data/spatial';
import { geometryBounds, NOT_A_PORTAL_TAG } from '#/data/spatial';
import type { FacadePanel, MallWorldCategory, MallWorldEntity } from '#/data/world';
import { half, midpoint, span } from '#/util/math';

type WorldCollider = Bounds3 & Readonly<{ label: string }>;

const ZERO_ROTATION = { yaw: 0, pitch: 0, roll: 0 } as const;
const STRUCTURAL_OVERLAP = ['structure', 'fixture', 'connector'] as const;
/** Shoulder-to-shoulder width of one standing pedestrian. */
const STANDING_PASS = STANDING_PEDESTRIAN.radius * 2;

function prism(
	id: string,
	box: Bounds3,
	role: SpatialVolume['role'] = 'solid',
	blocksMovement = role === 'solid',
): SpatialVolume {
	return {
		id,
		role,
		geometry: {
			kind: 'prism',
			plan: {
				kind: 'rectangle',
				center: { x: midpoint(box.minX, box.maxX), z: midpoint(box.minZ, box.maxZ) },
				width: span(box.minX, box.maxX),
				depth: span(box.minZ, box.maxZ),
				yaw: 0,
			},
			minY: box.minY,
			maxY: box.maxY,
			holes: [],
		},
		blocksMovement,
		clearance: blocksMovement || role === 'support' ? { kind: 'fixed-obstruction' } : { kind: 'clear' },
		allowsOverlapFrom: STRUCTURAL_OVERLAP,
		tags: ['con', 'authored-geometry'],
	};
}

function clearance(id: string, box: Bounds3, role: 'opening-clearance' | 'connector-clearance'): SpatialVolume {
	return {
		id,
		role,
		geometry: {
			kind: 'prism',
			plan: {
				kind: 'rectangle',
				center: { x: midpoint(box.minX, box.maxX), z: midpoint(box.minZ, box.maxZ) },
				width: span(box.minX, box.maxX),
				depth: span(box.minZ, box.maxZ),
				yaw: 0,
			},
			minY: box.minY,
			maxY: box.maxY,
			holes: [],
		},
		blocksMovement: false,
		clearance: { kind: 'clear' },
		allowsOverlapFrom: ['connector'],
		tags: ['con', role],
	};
}

function entity(
	id: string,
	label: string,
	category: MallWorldCategory,
	volumes: readonly SpatialVolume[],
	tags: readonly string[],
	mapLabel?: string,
	mapPriority = 80,
): MallWorldEntity {
	const c = rectCenter(CON_FOOTPRINT);
	return {
		id,
		label,
		category,
		levels: ['v0'] as readonly LevelId[],
		transform: { position: { x: c.x, y: CON_FLOOR_Y, z: c.z }, rotation: ZERO_ROTATION },
		volumes: [...volumes],
		ports: [],
		placement: { class: 'structure', requiresSupport: false, mayCover: [], mayBeCoveredBy: ['covering', 'clutter'] },
		kinematics: { kind: 'static' },
		mechanisms: [],
		receiver: {
			mobility: 'static',
			mass: null,
			tags: ['anchored'],
			channels: [],
			responses: { translation: 'none', rotation: 'none' },
		},
		emitters: [],
		map: mapLabel
			? { visible: true, layer: 'structure', priority: mapPriority, label: mapLabel }
			: { visible: true, layer: 'structure', priority: mapPriority },
		tags: ['con', ...tags],
	};
}

const outer = CON_FOOTPRINT;
const t = CON_WALL_T;
const y0 = CON_BASE_Y;
const y1 = CON_HALL_HEIGHT + CON_HOTEL_FLOORS * CON_HOTEL_FLOOR_H;
const doorLo = CON_DOOR_BAY.minZ;
const doorHi = CON_DOOR_BAY.maxZ;

/** Outer shell with west main door. */
function outerShell(): SpatialVolume[] {
	return [
		// west split around portal
		prism('shell-w-n', { minX: outer.minX, maxX: outer.minX + t, minZ: outer.minZ, maxZ: doorLo, minY: y0, maxY: y1 }),
		prism('shell-w-s', { minX: outer.minX, maxX: outer.minX + t, minZ: doorHi, maxZ: outer.maxZ, minY: y0, maxY: y1 }),
		prism('shell-w-lintel', {
			minX: outer.minX,
			maxX: outer.minX + t,
			minZ: doorLo,
			maxZ: doorHi,
			minY: CON_FLOOR_Y + CON_PORTAL.headY,
			maxY: y1,
		}),
		prism('shell-e', { minX: outer.maxX - t, maxX: outer.maxX, minZ: outer.minZ, maxZ: outer.maxZ, minY: y0, maxY: y1 }),
		prism('shell-n', {
			minX: outer.minX + t,
			maxX: outer.maxX - t,
			minZ: outer.minZ,
			maxZ: outer.minZ + t,
			minY: y0,
			maxY: y1,
		}),
		prism('shell-s', {
			minX: outer.minX + t,
			maxX: outer.maxX - t,
			minZ: outer.maxZ - t,
			maxZ: outer.maxZ,
			minY: y0,
			maxY: y1,
		}),
		prism('shell-roof', {
			minX: outer.minX,
			maxX: outer.maxX,
			minZ: outer.minZ,
			maxZ: outer.maxZ,
			minY: CON_CEILING_Y,
			maxY: CON_HALL_HEIGHT,
		}),
	];
}

/** Interior partitions sit on the floor top so they never cut the walkable slab. */
function partitions(): SpatialVolume[] {
	const h = CON_HALL_HEIGHT;
	const fy = CON_FLOOR_Y;
	const doorHead = fy + CON_ADULT_GATE.headY * 1.4;
	const adultCeil = fy + CON_ADULT_GATE.headY * 2.05;
	const adultRoofLo = adultCeil - 0.7;
	const vols: SpatialVolume[] = [];

	// Opening width between halls ≈ 6 body-widths of traffic.
	const pass = STANDING_PASS * 6;

	const dsZ = CON_DEALERS.maxZ;
	const dealersDoorCx = midpoint(CON_DEALERS.minX, CON_DEALERS.maxX);
	const dDoorLo = dealersDoorCx - half(pass);
	const dDoorHi = dealersDoorCx + half(pass);
	vols.push(
		prism('part-dealers-s-w', {
			minX: outer.minX + t,
			maxX: dDoorLo,
			minZ: dsZ,
			maxZ: dsZ + t,
			minY: fy,
			maxY: h,
		}),
		prism('part-dealers-s-e', {
			minX: dDoorHi,
			maxX: Math.min(CON_DEALERS.maxX, outer.maxX - t),
			minZ: dsZ,
			maxZ: dsZ + t,
			minY: fy,
			maxY: h,
		}),
		prism('part-dealers-s-lintel', {
			minX: dDoorLo,
			maxX: dDoorHi,
			minZ: dsZ,
			maxZ: dsZ + t,
			minY: doorHead,
			maxY: h,
		}),
	);

	const seX = CON_STAGE.maxX;
	const stageDoorCz = midpoint(CON_STAGE.minZ, CON_STAGE.maxZ);
	const sDoorLo = stageDoorCz - half(pass);
	const sDoorHi = stageDoorCz + half(pass);
	vols.push(
		prism('part-stage-e-n', {
			minX: seX,
			maxX: seX + t,
			minZ: CON_STAGE.minZ,
			maxZ: sDoorLo,
			minY: fy,
			maxY: h,
		}),
		prism('part-stage-e-s', {
			minX: seX,
			maxX: seX + t,
			minZ: sDoorHi,
			maxZ: CON_STAGE.maxZ - t,
			minY: fy,
			maxY: h,
		}),
		prism('part-stage-e-lintel', {
			minX: seX,
			maxX: seX + t,
			minZ: sDoorLo,
			maxZ: sDoorHi,
			minY: doorHead,
			maxY: h,
		}),
	);

	const hwX = CON_HOTEL.minX;
	const hotelDoorCz = midpoint(CON_HOTEL.minZ, CON_HOTEL.maxZ);
	const hDoorLo = hotelDoorCz - half(pass);
	const hDoorHi = hotelDoorCz + half(pass);
	vols.push(
		prism('part-hotel-w-n', {
			minX: hwX - t,
			maxX: hwX,
			minZ: CON_HOTEL.minZ,
			maxZ: hDoorLo,
			minY: fy,
			maxY: y1,
		}),
		prism('part-hotel-w-s', {
			minX: hwX - t,
			maxX: hwX,
			minZ: hDoorHi,
			maxZ: CON_HOTEL.maxZ - t,
			minY: fy,
			maxY: y1,
		}),
		prism('part-hotel-w-lintel', {
			minX: hwX - t,
			maxX: hwX,
			minZ: hDoorLo,
			maxZ: hDoorHi,
			minY: doorHead,
			maxY: y1,
		}),
	);

	const gLo = CON_ADULT_GATE.minZ;
	const gHi = CON_ADULT_GATE.maxZ;
	const dark = CON_DARKROOM;
	const studio = CON_STUDIO;
	vols.push(
		prism('dark-n', { minX: dark.minX, maxX: dark.maxX, minZ: dark.minZ, maxZ: dark.minZ + t, minY: fy, maxY: adultCeil }),
		prism('dark-s', { minX: dark.minX, maxX: dark.maxX, minZ: dark.maxZ - t, maxZ: dark.maxZ, minY: fy, maxY: adultCeil }),
		prism('dark-e-n', { minX: dark.maxX - t, maxX: dark.maxX, minZ: dark.minZ + t, maxZ: gLo, minY: fy, maxY: adultCeil }),
		prism('dark-e-s', { minX: dark.maxX - t, maxX: dark.maxX, minZ: gHi, maxZ: dark.maxZ - t, minY: fy, maxY: adultCeil }),
		prism('dark-e-lintel', {
			minX: dark.maxX - t,
			maxX: dark.maxX,
			minZ: gLo,
			maxZ: gHi,
			minY: fy + CON_ADULT_GATE.headY,
			maxY: adultCeil,
		}),
		prism('dark-w-n', { minX: dark.minX, maxX: dark.minX + t, minZ: dark.minZ + t, maxZ: gLo, minY: fy, maxY: adultCeil }),
		prism('dark-w-s', { minX: dark.minX, maxX: dark.minX + t, minZ: gHi, maxZ: dark.maxZ - t, minY: fy, maxY: adultCeil }),
		prism('dark-w-lintel', {
			minX: dark.minX,
			maxX: dark.minX + t,
			minZ: gLo,
			maxZ: gHi,
			minY: fy + CON_ADULT_GATE.headY,
			maxY: adultCeil,
		}),
		prism('dark-roof', {
			minX: dark.minX,
			maxX: dark.maxX,
			minZ: dark.minZ,
			maxZ: dark.maxZ,
			minY: adultRoofLo,
			maxY: adultCeil,
		}),
	);
	vols.push(
		prism('studio-n', {
			minX: studio.minX,
			maxX: studio.maxX,
			minZ: studio.minZ,
			maxZ: studio.minZ + t,
			minY: fy,
			maxY: adultCeil,
		}),
		prism('studio-s', {
			minX: studio.minX,
			maxX: studio.maxX,
			minZ: studio.maxZ - t,
			maxZ: studio.maxZ,
			minY: fy,
			maxY: adultCeil,
		}),
		prism('studio-e', {
			minX: studio.maxX - t,
			maxX: studio.maxX,
			minZ: studio.minZ + t,
			maxZ: studio.maxZ - t,
			minY: fy,
			maxY: adultCeil,
		}),
		prism('studio-w-n', {
			minX: studio.minX,
			maxX: studio.minX + t,
			minZ: studio.minZ + t,
			maxZ: gLo,
			minY: fy,
			maxY: adultCeil,
		}),
		prism('studio-w-s', {
			minX: studio.minX,
			maxX: studio.minX + t,
			minZ: gHi,
			maxZ: studio.maxZ - t,
			minY: fy,
			maxY: adultCeil,
		}),
		prism('studio-w-lintel', {
			minX: studio.minX,
			maxX: studio.minX + t,
			minZ: gLo,
			maxZ: gHi,
			minY: fy + CON_ADULT_GATE.headY,
			maxY: adultCeil,
		}),
		prism('studio-roof', {
			minX: studio.minX,
			maxX: studio.maxX,
			minZ: studio.minZ,
			maxZ: studio.maxZ,
			minY: adultRoofLo,
			maxY: adultCeil,
		}),
	);
	vols.push(
		prism('link-n', {
			minX: dark.maxX,
			maxX: studio.minX,
			minZ: gLo - t,
			maxZ: gLo,
			minY: fy,
			maxY: adultCeil,
		}),
		prism('link-s', {
			minX: dark.maxX,
			maxX: studio.minX,
			minZ: gHi,
			maxZ: gHi + t,
			minY: fy,
			maxY: adultCeil,
		}),
	);
	return vols;
}

const hotelInner = rectInterior(CON_HOTEL);
const stageInner = rectInterior(CON_STAGE);

export const CON_SHELL_ENTITY = entity(
	'con-shell',
	'Prairie Fur Con shell',
	'wall',
	[...outerShell(), ...partitions()],
	['wall', 'structural'],
	CON_LABEL,
	90,
);

export const CON_HALL_ENTITY = entity(
	'con-halls',
	'Prairie Fur Con halls',
	'facility',
	[
		prism(
			'con-floor',
			{
				minX: outer.minX + t,
				maxX: outer.maxX - t,
				minZ: outer.minZ + t,
				maxZ: outer.maxZ - t,
				minY: y0,
				maxY: CON_FLOOR_Y,
			},
			'walkable',
			false,
		),
		prism(
			'threshold-floor',
			{
				minX: CON_PORTAL.outerX,
				maxX: CON_PORTAL.innerX,
				minZ: doorLo,
				maxZ: doorHi,
				minY: y0,
				maxY: CON_FLOOR_Y,
			},
			'walkable',
			false,
		),
		prism(
			'stage-riser',
			{
				minX: stageInner.minX + 4,
				maxX: stageInner.maxX - 4,
				minZ: stageInner.minZ + 2,
				maxZ: stageInner.minZ + 12,
				minY: y0,
				maxY: CON_FLOOR_Y + 1.1,
			},
			'walkable',
			false,
		),
		...Array.from({ length: CON_HOTEL_FLOORS }, (_, i) => {
			const y = CON_FLOOR_Y + (i + 1) * CON_HOTEL_FLOOR_H;
			return prism(`hotel-slab-${i + 1}`, { ...hotelInner, minY: y - 0.2, maxY: y }, 'walkable', false);
		}),
	],
	['structural'],
	undefined,
	70,
);

/**
 * West portal: straddles outer face so stad and con share the clearance.
 * outreach west into plaza (stad), inreach into dealers (con).
 */
export const CON_ENTRANCE_ENTITY = entity(
	'con-entrance',
	'Fur Con main entrance',
	'opening',
	[
		clearance(
			'threshold',
			{
				minX: CON_PORTAL.outerX - 2.8,
				maxX: CON_PORTAL.innerX + 2.5,
				minZ: doorLo,
				maxZ: doorHi,
				minY: CON_FLOOR_Y,
				maxY: CON_FLOOR_Y + CON_PORTAL.headY,
			},
			'opening-clearance',
		),
	],
	['portal', 'entrance'],
	undefined,
	60,
);

/** Adult gate is internal only — not a zone portal. */
export const CON_ADULT_PORTAL_ENTITY = entity(
	'con-adult-portal',
	'Adult wing gate',
	'opening',
	[
		clearance(
			'adult-threshold',
			{
				minX: CON_DARKROOM.minX - 0.5,
				maxX: CON_DARKROOM.minX + CON_WALL_T + 0.5,
				minZ: CON_ADULT_GATE.minZ,
				maxZ: CON_ADULT_GATE.maxZ,
				minY: CON_FLOOR_Y,
				maxY: CON_FLOOR_Y + CON_ADULT_GATE.headY,
			},
			'opening-clearance',
		),
	],
	['portal', 'adult', NOT_A_PORTAL_TAG],
	undefined,
	20,
);

export const CON_ENTITIES: readonly MallWorldEntity[] = [
	CON_SHELL_ENTITY,
	CON_HALL_ENTITY,
	CON_ENTRANCE_ENTITY,
	CON_ADULT_PORTAL_ENTITY,
];

export function conColliders(): readonly (WorldCollider & Readonly<{ seeThrough: boolean }>)[] {
	return CON_ENTITIES.flatMap((ent) =>
		ent.volumes.flatMap((volume) =>
			volume.blocksMovement ? [{ ...geometryBounds(volume.geometry), label: `${ent.id}_${volume.id}`, seeThrough: false }] : [],
		),
	);
}

export function conSurfaces(): readonly Readonly<Bounds2 & { y: number; label: string }>[] {
	return CON_ENTITIES.flatMap((ent) =>
		ent.volumes.flatMap((volume) => {
			if (volume.role !== 'walkable') return [];
			const bounds = geometryBounds(volume.geometry);
			return [
				{
					minX: bounds.minX,
					maxX: bounds.maxX,
					minZ: bounds.minZ,
					maxZ: bounds.maxZ,
					y: bounds.maxY,
					label: volume.id,
				},
			];
		}),
	);
}

export { CON_ENVELOPE, CON_ZONE_VOLUME };

export function conOpeningWithin(side: 'north' | 'south' | 'west' | 'east', face: FacadePanel): FacadePanel | null {
	if (side !== 'west') return null;
	const minU = Math.max(face.minU, doorLo);
	const maxU = Math.min(face.maxU, doorHi);
	if (maxU <= minU) return null;
	const minY = Math.max(face.minY, CON_FLOOR_Y);
	const maxY = Math.min(face.maxY, CON_FLOOR_Y + CON_PORTAL.headY);
	if (maxY <= minY) return null;
	return { minU, maxU, minY, maxY };
}
