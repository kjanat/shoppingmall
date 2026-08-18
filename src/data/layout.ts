type Footprint = Readonly<{
	width: number;
	depth: number;
}>;

function footprint(width: number, depth: number): Footprint {
	return { width, depth };
}

function expanded(source: Footprint, margin: number): Footprint {
	return footprint(source.width + margin * 2, source.depth + margin * 2);
}

/** Walkable mall slabs and the store ring they support. */
const MALL_FOOTPRINT = footprint(72, 48);
/** Outside face of the 0.5 m perimeter wall around the mall slabs. */
const MALL_SHELL = expanded(MALL_FOOTPRINT, 0.5);
/** The V1 floor opening and roof skylight centered on world origin. */
const ATRIUM_VOID = footprint(16, 12);
/** Collision guard around the open V1 slab edge. */
const ATRIUM_BARRIER = expanded(ATRIUM_VOID, 0.5);
/** Underground parking shell centered under the mall. */
const PARKING_FOOTPRINT = footprint(64, 42);
/**
 * Far clip for authored city content.
 * Must clear the fur-con far corner (CON_LOT ~ x 500) and the expanded SW city (mountain/favela).
 */
const WORLD_VIEW_DISTANCE = 720;

export { MALL_FOOTPRINT, MALL_SHELL, ATRIUM_VOID, ATRIUM_BARRIER, PARKING_FOOTPRINT, WORLD_VIEW_DISTANCE };
export type { Footprint };
