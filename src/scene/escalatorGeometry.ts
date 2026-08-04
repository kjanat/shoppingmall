import type { EscalatorAppearance, EscalatorSpec } from '#/data/connectors';
import { levelY } from '#/data/levels';
import { half, midpoint } from '#/util/math';

export type EscalatorGeometry = Readonly<{
	rise: number;
	step: EscalatorAppearance['step'];
	nose: EscalatorAppearance['nose'];
	skirt: EscalatorAppearance['skirt'] & Readonly<{ centerX: number; outerX: number }>;
	balustrade: EscalatorAppearance['balustrade'] & Readonly<{ glassRadius: number; glassCenterY: number }>;
	handrail: EscalatorAppearance['handrail'] & Readonly<{ newelRadius: number; centerY: number }>;
	structure: EscalatorAppearance['structure'];
	landing: EscalatorAppearance['landing'];
	newel: EscalatorAppearance['newel'];
	guard: EscalatorAppearance['guard'];
	sign: EscalatorAppearance['sign'];
	opening: Readonly<{ farEdgeZ: number }>;
}>;

/** Values derived from the authored connector and its appearance model. */
export function deriveEscalatorGeometry(connector: EscalatorSpec): EscalatorGeometry {
	const { appearance } = connector;
	const rise = levelY(connector.to) - levelY(connector.from);
	const glassRadius = half(appearance.balustrade.glassTop - appearance.balustrade.glassBottom);
	const glassCenterY = midpoint(appearance.balustrade.glassBottom, appearance.balustrade.glassTop);
	const newelRadius = glassRadius + appearance.handrail.glassGap + appearance.handrail.radius;
	const skirtCenterX = half(connector.width) + appearance.skirt.treadGap;

	return {
		rise,
		step: appearance.step,
		nose: appearance.nose,
		skirt: {
			...appearance.skirt,
			centerX: skirtCenterX,
			outerX: skirtCenterX + half(appearance.skirt.panelThickness),
		},
		balustrade: {
			...appearance.balustrade,
			glassRadius,
			glassCenterY,
		},
		handrail: {
			...appearance.handrail,
			newelRadius,
			centerY: glassCenterY + newelRadius,
		},
		structure: appearance.structure,
		landing: appearance.landing,
		newel: appearance.newel,
		guard: appearance.guard,
		sign: appearance.sign,
		opening: {
			farEdgeZ: connector.opening.center.z - Math.sign(connector.zBottom - connector.zTop) * half(connector.opening.size.depth),
		},
	} as const;
}
