export type Footprint = Readonly<{
	width: number;
	depth: number;
	halfWidth: number;
	halfDepth: number;
}>;

function footprint(width: number, depth: number): Footprint {
	return { width, depth, halfWidth: width / 2, halfDepth: depth / 2 };
}

function expanded(source: Footprint, margin: number): Footprint {
	return footprint(source.width + margin * 2, source.depth + margin * 2);
}

/** Walkable mall slabs and the store ring they support. */
export const MALL_FOOTPRINT = footprint(72, 48);
/** Outside face of the 0.5 m perimeter wall around the mall slabs. */
export const MALL_SHELL = expanded(MALL_FOOTPRINT, 0.5);
/** The V1 floor opening and roof skylight centered on world origin. */
export const ATRIUM_VOID = footprint(16, 12);
/** Collision guard around the open V1 slab edge. */
export const ATRIUM_BARRIER = expanded(ATRIUM_VOID, 0.5);
/** Underground parking shell centered under the mall. */
export const PARKING_FOOTPRINT = footprint(64, 42);
/** Everything authored in the city must fit inside the gameplay camera. */
export const WORLD_VIEW_DISTANCE = 200;
