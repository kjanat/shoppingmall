import { type EscalatorAppearance, type EscalatorSpec, validateEscalatorSpec } from '#/data/connectors';
import { levelY } from '#/data/levels';
import { ESCALATOR } from '#/data/world';
import { half, midpoint } from '#/util/math';

export type EscalatorGeometry = Readonly<{
	rise: number;
	step: EscalatorAppearance['step'];
	nose: EscalatorAppearance['nose'];
	skirt: EscalatorAppearance['skirt'] & Readonly<{ centerX: number; outerX: number }>;
	balustrade: EscalatorAppearance['balustrade'] & Readonly<{ glassRadius: number; glassCenterY: number }>;
	handrail: EscalatorAppearance['handrail'] & Readonly<{ newelRadius: number; centerY: number }>;
	opening: Readonly<{ farEdgeZ: number }>;
}>;

/** Values derived from the authored connector and its appearance model. */
export function deriveEscalatorGeometry(connector: EscalatorSpec): EscalatorGeometry {
	const problems = validateEscalatorSpec(connector);
	if (problems.length > 0) throw new Error(`invalid escalator '${connector.id}': ${problems.join('; ')}`);
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
		opening: {
			farEdgeZ: connector.opening.center.z - Math.sign(connector.zBottom - connector.zTop) * half(connector.opening.size.depth),
		},
	} as const;
}

export const ESCALATOR_GEOMETRY = deriveEscalatorGeometry(ESCALATOR);
