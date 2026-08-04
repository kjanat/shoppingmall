import * as z from 'zod';
import { MALL_FOOTPRINT, WORLD_VIEW_DISTANCE } from '#/data/layout';
import type { LevelId } from '#/data/levels';
import { LEVELS, levelY } from '#/data/levels';
import { half } from '#/util/math';

/** Authoring policy. Values outside these ranges are almost certainly unit or placement mistakes. */
export const CONNECTOR_LIMITS = {
	coordinate: { min: -WORLD_VIEW_DISTANCE, max: WORLD_VIEW_DISTANCE },
	width: { min: 0.8, max: 12 },
	stepCount: { min: 2, max: 200 },
	postInterval: { min: 1, max: 200 },
	apron: { min: 0, max: 8 },
	identifierLength: { min: 1, max: 96 },
	connectedLevels: { min: 1, max: LEVELS.length },
	opening: {
		width: { min: 0.8, max: MALL_FOOTPRINT.width },
		depth: { min: 0.8, max: MALL_FOOTPRINT.depth },
	},
	componentThickness: { min: 0.001, max: 1 },
	componentLength: { min: 0.01, max: 8 },
	componentOffset: { min: 0, max: 4 },
	ratio: { exclusiveMin: 0, max: 1 },
	handrailWidthScale: { min: 0.5, max: 3 },
	carrySpeed: { min: 0.05, max: 3 },
	inclineDegrees: { min: 1, max: 60 },
	alignmentTolerance: { min: 0, max: 0.1 },
	registrySize: { min: 1, max: 128 },
} as const;

function isLevelId(value: unknown): value is LevelId {
	return typeof value === 'string' && LEVELS.some((entry) => entry.id === value);
}

const LevelIdSchema = z.custom<LevelId>(isLevelId, { error: 'unknown level id' });
const CoordinateSchema = z.number().min(CONNECTOR_LIMITS.coordinate.min).max(CONNECTOR_LIMITS.coordinate.max);
const PositiveThicknessSchema = z
	.number()
	.min(CONNECTOR_LIMITS.componentThickness.min)
	.max(CONNECTOR_LIMITS.componentThickness.max);
const ComponentOffsetSchema = z.number().min(CONNECTOR_LIMITS.componentOffset.min).max(CONNECTOR_LIMITS.componentOffset.max);
const ComponentLengthSchema = z.number().min(CONNECTOR_LIMITS.componentLength.min).max(CONNECTOR_LIMITS.componentLength.max);
const RatioSchema = z.number().gt(CONNECTOR_LIMITS.ratio.exclusiveMin).max(CONNECTOR_LIMITS.ratio.max);
const SignedComponentOffsetSchema = z
	.number()
	.min(-CONNECTOR_LIMITS.componentOffset.max)
	.max(CONNECTOR_LIMITS.componentOffset.max);
export const OpeningGuardSchema = z.strictObject({
	height: ComponentLengthSchema,
	glassThickness: PositiveThicknessSchema,
	slabOffset: ComponentOffsetSchema,
	railOverhang: ComponentOffsetSchema,
	railHeight: PositiveThicknessSchema,
});

const OpeningSchema = z.strictObject({
	id: z.string().trim().min(CONNECTOR_LIMITS.identifierLength.min).max(CONNECTOR_LIMITS.identifierLength.max),
	category: z.enum(['atrium', 'escalator', 'stairs', 'elevator']),
	center: z.strictObject({ x: CoordinateSchema, z: CoordinateSchema }),
	size: z.strictObject({
		width: z.number().min(CONNECTOR_LIMITS.opening.width.min).max(CONNECTOR_LIMITS.opening.width.max),
		depth: z.number().min(CONNECTOR_LIMITS.opening.depth.min).max(CONNECTOR_LIMITS.opening.depth.max),
	}),
	connects: z.array(LevelIdSchema).min(CONNECTOR_LIMITS.connectedLevels.min).max(CONNECTOR_LIMITS.connectedLevels.max),
});

const CollisionSchema = z.strictObject({
	minX: CoordinateSchema,
	maxX: CoordinateSchema,
	minZ: CoordinateSchema,
	maxZ: CoordinateSchema,
	openMinZ: CoordinateSchema,
	openMaxZ: CoordinateSchema,
	carrySpeed: z.number().min(CONNECTOR_LIMITS.carrySpeed.min).max(CONNECTOR_LIMITS.carrySpeed.max).optional(),
});

const BaseConnectorShape = {
	id: z.string().trim().min(CONNECTOR_LIMITS.identifierLength.min).max(CONNECTOR_LIMITS.identifierLength.max),
	label: z.string().trim().min(CONNECTOR_LIMITS.identifierLength.min).max(CONNECTOR_LIMITS.identifierLength.max),
	from: LevelIdSchema,
	to: LevelIdSchema,
	x: CoordinateSchema,
	zBottom: CoordinateSchema,
	zTop: CoordinateSchema,
	width: z.number().min(CONNECTOR_LIMITS.width.min).max(CONNECTOR_LIMITS.width.max),
	steps: z.int().min(CONNECTOR_LIMITS.stepCount.min).max(CONNECTOR_LIMITS.stepCount.max),
	apron: z.number().min(CONNECTOR_LIMITS.apron.min).max(CONNECTOR_LIMITS.apron.max),
	opening: OpeningSchema,
	collision: CollisionSchema,
};

export const EscalatorAppearanceSchema = z.strictObject({
	step: z.strictObject({
		minimumSurfaceY: ComponentOffsetSchema,
		treadThickness: PositiveThicknessSchema,
		riserThickness: PositiveThicknessSchema,
		riserHeightExtra: ComponentOffsetSchema,
	}),
	nose: z.strictObject({
		height: PositiveThicknessSchema,
		edgeInset: ComponentOffsetSchema,
		surfaceLift: ComponentOffsetSchema,
		depth: PositiveThicknessSchema,
	}),
	skirt: z.strictObject({
		panelThickness: PositiveThicknessSchema,
		treadGap: ComponentOffsetSchema,
	}),
	balustrade: z.strictObject({
		glassBottom: ComponentOffsetSchema,
		glassTop: ComponentOffsetSchema,
		glassThickness: PositiveThicknessSchema,
	}),
	handrail: z.strictObject({
		radius: PositiveThicknessSchema,
		glassGap: ComponentOffsetSchema,
		textureRepeatLength: PositiveThicknessSchema,
		widthScale: z.number().min(CONNECTOR_LIMITS.handrailWidthScale.min).max(CONNECTOR_LIMITS.handrailWidthScale.max),
	}),
	structure: z.strictObject({
		trussDrop: ComponentOffsetSchema,
		surfaceGap: PositiveThicknessSchema,
		lightStripExtraThickness: PositiveThicknessSchema,
	}),
	landing: z.strictObject({
		lateralOverhang: ComponentOffsetSchema,
		bottomThickness: PositiveThicknessSchema,
		bottomDepthExtension: ComponentOffsetSchema,
		topThickness: PositiveThicknessSchema,
		combDepthExtension: ComponentOffsetSchema,
		combThickness: PositiveThicknessSchema,
		combSurfaceLift: ComponentOffsetSchema,
	}),
	newel: z.strictObject({
		heightAboveGlassCenter: ComponentOffsetSchema,
		thickness: PositiveThicknessSchema,
		depth: ComponentLengthSchema,
	}),
	guard: OpeningGuardSchema,
	sign: z.strictObject({
		gantryHeight: ComponentLengthSchema,
		widthMargin: ComponentOffsetSchema,
		postRadius: PositiveThicknessSchema,
		verticalGap: ComponentOffsetSchema,
	}),
});

export const StairAppearanceSchema = z.strictObject({
	surfaceOffset: ComponentOffsetSchema,
	step: z.strictObject({
		widthInset: ComponentOffsetSchema,
		treadThickness: PositiveThicknessSchema,
		treadDepthRatio: RatioSchema,
		riserThickness: PositiveThicknessSchema,
		riserHeightRatio: RatioSchema,
		riserDepthRatio: RatioSchema,
	}),
	landing: z
		.strictObject({
			widthExtra: ComponentOffsetSchema,
			bottomDepth: ComponentLengthSchema,
			bottomOffset: ComponentOffsetSchema,
			topDepth: ComponentLengthSchema,
			topOffset: ComponentOffsetSchema,
		})
		.optional(),
	rail: z.strictObject({
		sideOffsetFromEdge: SignedComponentOffsetSchema,
		height: ComponentLengthSchema,
		postCenterDrop: ComponentOffsetSchema,
		postRadius: PositiveThicknessSchema,
		postEverySteps: z.int().min(CONNECTOR_LIMITS.postInterval.min).max(CONNECTOR_LIMITS.postInterval.max),
		segmentThickness: PositiveThicknessSchema,
	}),
	guard: OpeningGuardSchema,
	stringer: z
		.strictObject({
			width: PositiveThicknessSchema,
			heightExtra: ComponentOffsetSchema,
			depthRatio: RatioSchema,
		})
		.optional(),
	sign: z
		.strictObject({
			width: ComponentLengthSchema,
			height: ComponentLengthSchema,
			centerY: ComponentLengthSchema,
			approachOffset: ComponentOffsetSchema,
		})
		.optional(),
	serviceEntrance: z
		.strictObject({
			door: z.strictObject({
				width: ComponentLengthSchema,
				height: ComponentLengthSchema,
				thickness: PositiveThicknessSchema,
				lateralOffset: SignedComponentOffsetSchema,
				verticalOffset: SignedComponentOffsetSchema,
				depthOffset: SignedComponentOffsetSchema,
			}),
			sign: z.strictObject({
				width: ComponentLengthSchema,
				height: ComponentLengthSchema,
				lateralOffset: SignedComponentOffsetSchema,
				verticalOffset: SignedComponentOffsetSchema,
				depthOffset: SignedComponentOffsetSchema,
			}),
		})
		.optional(),
});

const EscalatorObjectSchema = z.strictObject({
	...BaseConnectorShape,
	kind: z.literal('escalator'),
	appearance: EscalatorAppearanceSchema,
	constraints: z.strictObject({
		inclineDegrees: z.strictObject({
			min: z.number().min(CONNECTOR_LIMITS.inclineDegrees.min).max(CONNECTOR_LIMITS.inclineDegrees.max),
			max: z.number().min(CONNECTOR_LIMITS.inclineDegrees.min).max(CONNECTOR_LIMITS.inclineDegrees.max),
		}),
		alignmentTolerance: z.number().min(CONNECTOR_LIMITS.alignmentTolerance.min).max(CONNECTOR_LIMITS.alignmentTolerance.max),
	}),
});

const StairObjectSchema = z.strictObject({
	...BaseConnectorShape,
	kind: z.literal('stairs'),
	presentation: z.enum(['mall-flight', 'helipad-flight']),
	appearance: StairAppearanceSchema,
});

export type OpeningDef = Readonly<z.output<typeof OpeningSchema>>;
export type OpeningGuard = Readonly<z.output<typeof OpeningGuardSchema>>;
export type EscalatorAppearance = Readonly<z.output<typeof EscalatorAppearanceSchema>>;
export type StairAppearance = Readonly<z.output<typeof StairAppearanceSchema>>;
export type EscalatorSpec = Readonly<z.output<typeof EscalatorObjectSchema>>;
export type StairSpec = Readonly<z.output<typeof StairObjectSchema>>;
export type VerticalConnector = EscalatorSpec | StairSpec;

type ConnectorProblem = Readonly<{ message: string; path: (string | number)[] }>;

function commonConnectorProblems(spec: VerticalConnector): readonly ConnectorProblem[] {
	const problems: ConnectorProblem[] = [];
	const tolerance = spec.kind === 'escalator' ? spec.constraints.alignmentTolerance : CONNECTOR_LIMITS.alignmentTolerance.max;
	const rise = levelY(spec.to) - levelY(spec.from);
	const flightMinX = spec.x - half(spec.width);
	const flightMaxX = spec.x + half(spec.width);
	const flightMinZ = Math.min(spec.zBottom, spec.zTop);
	const flightMaxZ = Math.max(spec.zBottom, spec.zTop);
	const openingMinX = spec.opening.center.x - half(spec.opening.size.width);
	const openingMaxX = spec.opening.center.x + half(spec.opening.size.width);
	const openingMinZ = spec.opening.center.z - half(spec.opening.size.depth);
	const openingMaxZ = spec.opening.center.z + half(spec.opening.size.depth);

	if (spec.from === spec.to || rise <= 0) {
		problems.push({ message: 'destination level must be physically above the origin level', path: ['to'] });
	}
	if (!spec.opening.connects.includes(spec.from) || !spec.opening.connects.includes(spec.to)) {
		problems.push({ message: 'floor opening must declare both connected levels', path: ['opening', 'connects'] });
	}
	if (new Set(spec.opening.connects).size !== spec.opening.connects.length) {
		problems.push({ message: 'floor opening contains duplicate connected levels', path: ['opening', 'connects'] });
	}
	if (openingMinX > flightMinX + tolerance || openingMaxX < flightMaxX - tolerance) {
		problems.push({ message: 'floor opening is narrower than the flight', path: ['opening', 'size', 'width'] });
	}
	if (spec.zTop < openingMinZ - tolerance || spec.zTop > openingMaxZ + tolerance) {
		problems.push({ message: 'floor opening does not contain the upper landing', path: ['opening', 'center', 'z'] });
	}
	if (
		spec.collision.minX >= spec.collision.maxX ||
		spec.collision.minZ >= spec.collision.maxZ ||
		spec.collision.openMinZ >= spec.collision.openMaxZ
	) {
		problems.push({ message: 'collision bounds must have positive spans', path: ['collision'] });
	}
	if (
		spec.collision.minX > flightMinX + tolerance ||
		spec.collision.maxX < flightMaxX - tolerance ||
		spec.collision.minZ > flightMinZ + tolerance ||
		spec.collision.maxZ < flightMaxZ - tolerance
	) {
		problems.push({ message: 'collision bounds do not contain the complete flight', path: ['collision'] });
	}
	if (
		Math.abs(spec.collision.openMinZ - openingMinZ) > tolerance ||
		Math.abs(spec.collision.openMaxZ - openingMaxZ) > tolerance
	) {
		problems.push({ message: 'collision opening bounds differ from the authored floor opening', path: ['collision'] });
	}

	return problems;
}

function escalatorProblems(spec: EscalatorSpec): readonly ConnectorProblem[] {
	const problems: ConnectorProblem[] = [];
	const { appearance, constraints } = spec;
	const rise = levelY(spec.to) - levelY(spec.from);
	const run = Math.abs(spec.zTop - spec.zBottom);
	const stepDepth = run / spec.steps;
	const inclineDegrees = (Math.atan2(rise, run) * 180) / Math.PI;

	if (constraints.inclineDegrees.max < constraints.inclineDegrees.min) {
		problems.push({ message: 'maximum incline must be at least the minimum incline', path: ['constraints', 'inclineDegrees'] });
	} else if (
		inclineDegrees < constraints.inclineDegrees.min - constraints.alignmentTolerance ||
		inclineDegrees > constraints.inclineDegrees.max + constraints.alignmentTolerance
	) {
		problems.push({
			message: `incline ${inclineDegrees.toFixed(2)} degrees is outside ${constraints.inclineDegrees.min}..${constraints.inclineDegrees.max}`,
			path: ['constraints', 'inclineDegrees'],
		});
	}
	if (appearance.nose.edgeInset >= half(spec.width)) {
		problems.push({ message: 'nose inset must leave a positive visible strip', path: ['appearance', 'nose', 'edgeInset'] });
	}
	if (appearance.balustrade.glassTop <= appearance.balustrade.glassBottom) {
		problems.push({
			message: 'balustrade glass top must sit above its non-negative bottom',
			path: ['appearance', 'balustrade', 'glassTop'],
		});
	}
	if (appearance.step.riserThickness >= stepDepth) {
		problems.push({
			message: 'riser thickness must be smaller than one step depth',
			path: ['appearance', 'step', 'riserThickness'],
		});
	}
	if (appearance.landing.combSurfaceLift > appearance.landing.combThickness) {
		problems.push({
			message: 'comb surface lift cannot exceed comb thickness',
			path: ['appearance', 'landing', 'combSurfaceLift'],
		});
	}
	if (spec.collision.carrySpeed === undefined) {
		problems.push({ message: 'escalator collision must define a carry speed', path: ['collision', 'carrySpeed'] });
	}

	return problems;
}

function stairProblems(spec: StairSpec): readonly ConnectorProblem[] {
	const problems: ConnectorProblem[] = [];
	const rise = levelY(spec.to) - levelY(spec.from) - spec.appearance.surfaceOffset;
	const stepRise = rise / spec.steps;
	const stepDepth = Math.abs(spec.zTop - spec.zBottom) / spec.steps;
	if (spec.appearance.step.widthInset >= spec.width) {
		problems.push({ message: 'step width inset must leave a positive tread width', path: ['appearance', 'step', 'widthInset'] });
	}
	if (spec.appearance.step.treadThickness >= stepRise) {
		problems.push({
			message: 'tread thickness must be smaller than one step rise',
			path: ['appearance', 'step', 'treadThickness'],
		});
	}
	if (spec.appearance.step.riserThickness >= stepDepth) {
		problems.push({
			message: 'riser thickness must be smaller than one step depth',
			path: ['appearance', 'step', 'riserThickness'],
		});
	}
	if (spec.appearance.rail.postEverySteps > spec.steps) {
		problems.push({
			message: 'rail post interval cannot exceed the number of steps',
			path: ['appearance', 'rail', 'postEverySteps'],
		});
	}
	if (
		spec.appearance.landing &&
		(spec.appearance.landing.bottomOffset > half(spec.appearance.landing.bottomDepth) ||
			spec.appearance.landing.topOffset > half(spec.appearance.landing.topDepth))
	) {
		problems.push({
			message: 'landing offset must keep its landing over the flight endpoint',
			path: ['appearance', 'landing'],
		});
	}
	if (
		spec.presentation === 'mall-flight' &&
		(spec.appearance.landing === undefined || spec.appearance.stringer === undefined || spec.appearance.sign === undefined)
	) {
		problems.push({
			message: 'mall-flight stairs require landing, stringer, and sign presentation data',
			path: ['appearance'],
		});
	}
	if (spec.presentation === 'helipad-flight' && spec.appearance.serviceEntrance === undefined) {
		problems.push({
			message: 'helipad-flight stairs require service-entrance presentation data',
			path: ['appearance', 'serviceEntrance'],
		});
	}
	if (spec.appearance.rail.postCenterDrop > spec.appearance.rail.height) {
		problems.push({
			message: 'rail post center drop cannot exceed the post height',
			path: ['appearance', 'rail', 'postCenterDrop'],
		});
	}
	return problems;
}

function addConnectorProblems(spec: VerticalConnector, context: z.RefinementCtx): void {
	const problems = [
		...commonConnectorProblems(spec),
		...(spec.kind === 'escalator' ? escalatorProblems(spec) : stairProblems(spec)),
	];
	for (const problem of problems) context.addIssue({ code: 'custom', message: problem.message, path: problem.path });
}

export const EscalatorSchema = EscalatorObjectSchema.superRefine((spec, context) => addConnectorProblems(spec, context));
export const StairSchema = StairObjectSchema.superRefine((spec, context) => addConnectorProblems(spec, context));
export const VerticalConnectorSchema = z
	.discriminatedUnion('kind', [EscalatorObjectSchema, StairObjectSchema])
	.superRefine((spec, context) => addConnectorProblems(spec, context));

export const VerticalConnectorRegistrySchema = z
	.array(VerticalConnectorSchema)
	.min(CONNECTOR_LIMITS.registrySize.min)
	.max(CONNECTOR_LIMITS.registrySize.max)
	.superRefine((connectors, context) => {
		const connectorIds = new Set<string>();
		const openingIds = new Set<string>();
		for (const [index, connector] of connectors.entries()) {
			if (connectorIds.has(connector.id)) {
				context.addIssue({ code: 'custom', message: `duplicate connector id '${connector.id}'`, path: [index, 'id'] });
			}
			connectorIds.add(connector.id);
			if (openingIds.has(connector.opening.id)) {
				context.addIssue({
					code: 'custom',
					message: `duplicate connector opening id '${connector.opening.id}'`,
					path: [index, 'opening', 'id'],
				});
			}
			openingIds.add(connector.opening.id);
		}
	});

/** Parses authored connector data once. Invalid world data aborts checks and builds immediately. */
export function parseVerticalConnectorRegistry(input: unknown): readonly VerticalConnector[] {
	return VerticalConnectorRegistrySchema.parse(input);
}

export function assertValidVerticalConnectorRegistry(input: unknown): void {
	VerticalConnectorRegistrySchema.parse(input);
}

/** Compatibility surface for focused tests; validation itself lives in EscalatorSchema. */
export function validateEscalatorSpec(spec: unknown): readonly string[] {
	const result = EscalatorSchema.safeParse(spec);
	return result.success ? [] : result.error.issues.map((issue) => issue.message);
}
