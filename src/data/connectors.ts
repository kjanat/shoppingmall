import type { LevelId } from '#/data/levels';
import { levelY } from '#/data/levels';
import { half } from '#/util/math';

export type OpeningDef = Readonly<{
	id: string;
	category: 'atrium' | 'escalator' | 'stairs' | 'elevator';
	center: Readonly<{ x: number; z: number }>;
	size: Readonly<{ width: number; depth: number }>;
	connects: readonly LevelId[];
}>;

export type VerticalConnector<Kind extends 'stairs' | 'escalator' = 'stairs' | 'escalator'> = Readonly<{
	id: string;
	label: string;
	kind: Kind;
	from: LevelId;
	to: LevelId;
	x: number;
	zBottom: number;
	zTop: number;
	width: number;
	steps: number;
	apron: number;
	opening: OpeningDef;
	collision: Readonly<{
		minX: number;
		maxX: number;
		minZ: number;
		maxZ: number;
		openMinZ: number;
		openMaxZ: number;
		carrySpeed?: number;
	}>;
}>;

export type EscalatorAppearance = Readonly<{
	step: Readonly<{
		minimumSurfaceY: number;
		treadThickness: number;
		riserThickness: number;
	}>;
	nose: Readonly<{
		height: number;
		edgeInset: number;
		surfaceLift: number;
		depth: number;
	}>;
	skirt: Readonly<{
		panelThickness: number;
		treadGap: number;
	}>;
	balustrade: Readonly<{
		glassBottom: number;
		glassTop: number;
		glassThickness: number;
	}>;
	handrail: Readonly<{
		radius: number;
		glassGap: number;
		textureRepeatLength: number;
	}>;
}>;

export type EscalatorSpec = VerticalConnector<'escalator'> &
	Readonly<{
		appearance: EscalatorAppearance;
		constraints: Readonly<{
			inclineDegrees: Readonly<{ min: number; max: number }>;
			alignmentTolerance: number;
		}>;
	}>;

export type StairSpec = VerticalConnector<'stairs'> &
	Readonly<{
		presentation: 'mall-flight' | 'helipad-flight';
	}>;

function positive(value: number): boolean {
	return Number.isFinite(value) && value > 0;
}

/** Static authoring checks for connectivity, containment, angle, and component fit. */
export function validateEscalatorSpec(spec: EscalatorSpec): readonly string[] {
	const problems: string[] = [];
	const { appearance, collision, constraints, opening } = spec;
	const tolerance = constraints.alignmentTolerance;
	const rise = levelY(spec.to) - levelY(spec.from);
	const run = Math.abs(spec.zTop - spec.zBottom);
	const inclineDegrees = (Math.atan2(rise, run) * 180) / Math.PI;
	const flightMinX = spec.x - half(spec.width);
	const flightMaxX = spec.x + half(spec.width);
	const flightMinZ = Math.min(spec.zBottom, spec.zTop);
	const flightMaxZ = Math.max(spec.zBottom, spec.zTop);
	const openingMinX = opening.center.x - half(opening.size.width);
	const openingMaxX = opening.center.x + half(opening.size.width);
	const openingMinZ = opening.center.z - half(opening.size.depth);
	const openingMaxZ = opening.center.z + half(opening.size.depth);

	if (spec.from === spec.to || rise <= 0) problems.push('destination level must be physically above the origin level');
	if (!positive(spec.width)) problems.push('flight width must be positive');
	if (!Number.isInteger(spec.steps) || spec.steps < 2) problems.push('step count must be an integer of at least two');
	if (!positive(run)) problems.push('flight must have a horizontal run');
	if (!Number.isFinite(spec.apron) || spec.apron < 0) problems.push('apron must be finite and non-negative');
	if (!Number.isFinite(tolerance) || tolerance < 0) problems.push('alignment tolerance must be finite and non-negative');
	if (
		!positive(constraints.inclineDegrees.min) ||
		constraints.inclineDegrees.max < constraints.inclineDegrees.min ||
		inclineDegrees < constraints.inclineDegrees.min - tolerance ||
		inclineDegrees > constraints.inclineDegrees.max + tolerance
	) {
		problems.push(
			`incline ${inclineDegrees.toFixed(2)} degrees is outside ${constraints.inclineDegrees.min}..${constraints.inclineDegrees.max}`,
		);
	}
	if (!opening.connects.includes(spec.from) || !opening.connects.includes(spec.to)) {
		problems.push('floor opening must declare both connected levels');
	}
	if (openingMinX > flightMinX + tolerance || openingMaxX < flightMaxX - tolerance) {
		problems.push('floor opening is narrower than the flight');
	}
	if (openingMaxZ < flightMinZ - tolerance || openingMinZ > flightMaxZ + tolerance) {
		problems.push('floor opening does not overlap the flight');
	}
	if (
		collision.minX > flightMinX + tolerance ||
		collision.maxX < flightMaxX - tolerance ||
		collision.minZ > flightMinZ + tolerance ||
		collision.maxZ < flightMaxZ - tolerance
	) {
		problems.push('collision bounds do not contain the complete flight');
	}
	if (Math.abs(collision.openMinZ - openingMinZ) > tolerance || Math.abs(collision.openMaxZ - openingMaxZ) > tolerance) {
		problems.push('collision opening bounds differ from the authored floor opening');
	}

	const positiveParts = [
		['step tread thickness', appearance.step.treadThickness],
		['step riser thickness', appearance.step.riserThickness],
		['nose height', appearance.nose.height],
		['nose depth', appearance.nose.depth],
		['skirt panel thickness', appearance.skirt.panelThickness],
		['balustrade glass thickness', appearance.balustrade.glassThickness],
		['handrail radius', appearance.handrail.radius],
		['handrail texture repeat length', appearance.handrail.textureRepeatLength],
	] as const;
	for (const [label, value] of positiveParts) {
		if (!positive(value)) problems.push(`${label} must be positive`);
	}
	if (appearance.step.minimumSurfaceY < 0) problems.push('minimum step surface must be non-negative');
	if (appearance.nose.edgeInset < 0 || appearance.nose.edgeInset * 2 >= spec.width) {
		problems.push('nose inset must leave a positive visible strip');
	}
	if (appearance.nose.surfaceLift < 0) problems.push('nose surface lift must be non-negative');
	if (appearance.skirt.treadGap < 0) problems.push('skirt tread gap must be non-negative');
	if (appearance.balustrade.glassBottom < 0 || appearance.balustrade.glassTop <= appearance.balustrade.glassBottom) {
		problems.push('balustrade glass top must sit above its non-negative bottom');
	}
	if (appearance.handrail.glassGap < 0) problems.push('handrail glass gap must be non-negative');

	return problems;
}
