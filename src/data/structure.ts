import type { Vec3 } from '#/data/spatial';
import { half, midpoint, span } from '#/util/math';

export type CardinalSide = 'north' | 'south' | 'west' | 'east';

export type BoxStructureSpec = Readonly<{
	id: string;
	position: Vec3;
	size: Readonly<{ width: number; height: number; depth: number }>;
}>;

export type RectangularPerimeterSpec = Readonly<{
	footprint: Readonly<{ width: number; depth: number }>;
	vertical: Readonly<{ min: number; max: number }>;
	thickness: number;
	/** Extra length on each end of the north and south caps, so corners stay closed. */
	capOverlap?: number;
}>;

/** Expands one rectangular-shell fact into its four named wall boxes. */
export function rectangularPerimeterWalls({
	footprint,
	vertical,
	thickness,
	capOverlap = 0,
}: RectangularPerimeterSpec): readonly BoxStructureSpec[] {
	const y = midpoint(vertical.min, vertical.max);
	const height = span(vertical.min, vertical.max);
	const capWidth = footprint.width + capOverlap * 2;
	return [
		{
			id: 'north',
			position: { x: 0, y, z: -half(footprint.depth) },
			size: { width: capWidth, height, depth: thickness },
		},
		{
			id: 'south',
			position: { x: 0, y, z: half(footprint.depth) },
			size: { width: capWidth, height, depth: thickness },
		},
		{
			id: 'west',
			position: { x: -half(footprint.width), y, z: 0 },
			size: { width: thickness, height, depth: footprint.depth },
		},
		{
			id: 'east',
			position: { x: half(footprint.width), y, z: 0 },
			size: { width: thickness, height, depth: footprint.depth },
		},
	];
}
