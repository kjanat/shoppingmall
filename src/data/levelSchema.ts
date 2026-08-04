import * as z from 'zod';
import { WORLD_VIEW_DISTANCE } from '#/data/layout';
import { LEVELS } from '#/data/levels';

/** Authoring policy for the ordered vertical registry. All distances are metres. */
export const LEVEL_LIMITS = {
	registrySize: { min: 2, max: 32 },
	elevation: { min: -WORLD_VIEW_DISTANCE, max: WORLD_VIEW_DISTANCE },
	deckGap: { min: 2.4, max: 32 },
	idLength: { min: 1, max: 32 },
	codeLength: { min: 1, max: 8 },
	nameLength: { min: 1, max: 64 },
	hintLength: { min: 1, max: 160 },
} as const;

const AuthoredTextSchema = (limits: Readonly<{ min: number; max: number }>) =>
	z
		.string()
		.min(limits.min)
		.max(limits.max)
		.refine((value) => value === value.trim(), { error: 'authored text cannot start or end with whitespace' });

export const LevelSchema = z.strictObject({
	id: AuthoredTextSchema(LEVEL_LIMITS.idLength).regex(/^[a-z][a-z0-9-]*$/, {
		error: 'level id must use lower-case kebab syntax',
	}),
	y: z.number().min(LEVEL_LIMITS.elevation.min).max(LEVEL_LIMITS.elevation.max),
	code: AuthoredTextSchema(LEVEL_LIMITS.codeLength).regex(/^[A-Z0-9]+$/, {
		error: 'level code must contain only upper-case letters and digits',
	}),
	name: AuthoredTextSchema(LEVEL_LIMITS.nameLength),
	hint: AuthoredTextSchema(LEVEL_LIMITS.hintLength),
});

export type LevelRecord = Readonly<z.output<typeof LevelSchema>>;

export const LevelRegistrySchema = z
	.array(LevelSchema)
	.min(LEVEL_LIMITS.registrySize.min)
	.max(LEVEL_LIMITS.registrySize.max)
	.superRefine((levels, context) => {
		const ids = new Set<string>();
		const codes = new Set<string>();
		const elevations = new Set<number>();
		for (const [index, current] of levels.entries()) {
			if (ids.has(current.id)) {
				context.addIssue({ code: 'custom', message: `duplicate level id '${current.id}'`, path: [index, 'id'] });
			}
			ids.add(current.id);
			if (codes.has(current.code)) {
				context.addIssue({ code: 'custom', message: `duplicate level code '${current.code}'`, path: [index, 'code'] });
			}
			codes.add(current.code);
			if (elevations.has(current.y)) {
				context.addIssue({ code: 'custom', message: `duplicate deck elevation ${current.y}`, path: [index, 'y'] });
			}
			elevations.add(current.y);

			const above = levels[index - 1];
			if (!above) continue;
			const gap = above.y - current.y;
			if (gap <= 0) {
				context.addIssue({
					code: 'custom',
					message: 'levels must be authored from the physically highest deck to the lowest',
					path: [index, 'y'],
				});
				continue;
			}
			if (gap < LEVEL_LIMITS.deckGap.min || gap > LEVEL_LIMITS.deckGap.max) {
				context.addIssue({
					code: 'custom',
					message: `deck gap ${gap} is outside ${LEVEL_LIMITS.deckGap.min}..${LEVEL_LIMITS.deckGap.max}`,
					path: [index, 'y'],
				});
			}
		}
	});

/** Invalid authored levels are a build error, so this deliberately throws. */
export function assertValidLevelRegistry(input: unknown): void {
	LevelRegistrySchema.parse(input);
}

/** The canonical registry is parsed by builds and headless world checks. */
export function assertCanonicalLevelRegistry(): void {
	assertValidLevelRegistry(LEVELS);
}
