import type { Vec2, Vec3 } from '#/data/spatial';
import { half, midpoint, span } from '#/util/math';

export type CardinalSide = 'north' | 'south' | 'west' | 'east';
export type RectangleCorner = 'north-west' | 'north-east' | 'south-west' | 'south-east';

const CARDINAL_SIDES = ['north', 'south', 'west', 'east'] as const satisfies readonly CardinalSide[];
const RECTANGLE_CORNERS = ['north-west', 'north-east', 'south-west', 'south-east'] as const satisfies readonly RectangleCorner[];

export type CardinalPanelSpec = Readonly<{
	id: CardinalSide;
	center: Vec2;
	size: Readonly<{ width: number; depth: number }>;
}>;

export type CardinalPanelLayout = Readonly<{
	center: Vec2;
	offset: Vec2;
	span: Readonly<{ width: number; depth: number }>;
	thickness: number;
	sides?: readonly CardinalSide[];
}>;

export type RectangleCornerPoint = Readonly<{
	id: RectangleCorner;
	center: Vec2;
}>;

export type RectangleCornerLayout = Readonly<{
	center: Vec2;
	offset: Vec2;
}>;

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

function cardinalPanel(layout: CardinalPanelLayout, side: CardinalSide): CardinalPanelSpec {
	const { center, offset, span: panelSpan, thickness } = layout;
	switch (side) {
		case 'north':
			return { id: side, center: { x: center.x, z: center.z - offset.z }, size: { width: panelSpan.width, depth: thickness } };
		case 'south':
			return { id: side, center: { x: center.x, z: center.z + offset.z }, size: { width: panelSpan.width, depth: thickness } };
		case 'west':
			return { id: side, center: { x: center.x - offset.x, z: center.z }, size: { width: thickness, depth: panelSpan.depth } };
		case 'east':
			return { id: side, center: { x: center.x + offset.x, z: center.z }, size: { width: thickness, depth: panelSpan.depth } };
	}
}

/** Expands selected named sides of a rectangle into horizontal wall panels. */
export function cardinalWallPanels(layout: CardinalPanelLayout): readonly CardinalPanelSpec[] {
	return (layout.sides ?? CARDINAL_SIDES).map((side) => cardinalPanel(layout, side));
}

function rectangleCorner(layout: RectangleCornerLayout, corner: RectangleCorner): RectangleCornerPoint {
	const west = corner.endsWith('west');
	const north = corner.startsWith('north');
	return {
		id: corner,
		center: {
			x: layout.center.x + (west ? -layout.offset.x : layout.offset.x),
			z: layout.center.z + (north ? -layout.offset.z : layout.offset.z),
		},
	};
}

/** Expands a rectangle into its four named corner points. */
export function rectangleCornerPoints(layout: RectangleCornerLayout): readonly RectangleCornerPoint[] {
	return RECTANGLE_CORNERS.map((corner) => rectangleCorner(layout, corner));
}

/** Expands one rectangular-shell fact into its four named wall boxes. */
export function rectangularPerimeterWalls({
	footprint,
	vertical,
	thickness,
	capOverlap = 0,
}: RectangularPerimeterSpec): readonly BoxStructureSpec[] {
	const y = midpoint(vertical.min, vertical.max);
	const height = span(vertical.min, vertical.max);
	return cardinalWallPanels({
		center: { x: 0, z: 0 },
		offset: { x: half(footprint.width), z: half(footprint.depth) },
		span: { width: footprint.width + capOverlap * 2, depth: footprint.depth },
		thickness,
	}).map(({ id, center, size }) => ({ id, position: { ...center, y }, size: { ...size, height } }));
}
