import { describe, expect, test } from 'bun:test';
import type { ExemptFile, Exemption, Hit } from './helpers/source-scan.ts';
import { callArguments, filesIn, grep, read, withoutText } from './helpers/source-scan.ts';

/**
 * No second copy of anything util already hands out.
 *
 * `mulberry32` lived in src/scene as well as in scripts/perf, so both partitions are
 * grepped. Three shapes carry no name once written out: the jitter `(r - 0.5) * spread`,
 * the plusMinus `(r * 2 - 1) * extent`, and the ease factor `Math.min(1, rate * dt)`.
 */

const HELPER_DIR = 'src/util';

/** Files that cannot import a helper at all, or that are about them. */
const EXEMPT_FILES: ExemptFile[] = [
	{
		path: 'scripts/perf/probe.ts',
		reason: 'installProbe is stringified into the page, where no import exists',
	},
	{
		path: 'tests/math.test.ts',
		reason: 'the test writes out the expressions the helpers own; writing them out is how it proves them',
	},
];

/** Places where the shape matches but the meaning does not. */
const EXEMPTIONS: Exemption[] = [
	{
		path: 'src/scene/MallBuilder.ts',
		fragment: 'const x = (t - 0.5) * span',
		reason: 't walks the crew in equal steps from 0 to 1; nothing is drawn to scatter around zero',
	},
	{
		path: 'src/scene/Americans.ts',
		fragment: 'Math.min(1, dt * 6 || 1)',
		reason: 'the `|| 1` makes it a different sum: at dt 0 easeFactor gives 0 and this gives 1, and the mouth snaps shut',
	},
];

/** Shapes a helper owns that carry no name once you write them out. */
const OWNED_SHAPES: { helper: string; pattern: RegExp; message: string }[] = [
	{
		helper: 'jitterWith',
		pattern: /-\s*0\.5\s*\)\s*\*/g,
		message: 'writes the jump around zero out by hand. Use jitter() or jitterWith() from util/rand',
	},
	{
		helper: 'plusMinusWith',
		pattern: /\*\s*2\s*-\s*1\s*\)\s*\*/g,
		message: 'writes the mirror around zero out by hand. Use plusMinus() or plusMinusWith() from util/rand',
	},
];

/** The call an ease factor hides in, and the multiplication that gives it away. */
const CLAMP_TO_ONE = /\b(Math\s*\.\s*min)\s*\(/g;
const TIMES_STEP = /\bdt\s*\*|\*\s*dt\b/;

/**
 * The three shapes in which a name is defined again: as a function, as a method, and as
 * an assignment of an arrow or function expression. A call is not one of them, and the
 * arrow has to sit right behind the equals sign: `const pick = voices.find((v) => …)`
 * assigns a result and defines nothing.
 */
function definitionPatterns(name: string): RegExp[] {
	const arrow = '(?:<[^<>]*>)?\\s*(?:\\([^()]*\\)|[A-Za-z_$][\\w$]*)\\s*(?::[^=>{;]*)?=>';
	return [
		new RegExp(`\\bfunction\\s+${name}\\b`, 'g'),
		new RegExp(`\\b${name}\\s*(?:<[^<>]*>)?\\s*\\([^()]*\\)\\s*(?::[^{;=]+)?\\{`, 'g'),
		new RegExp(`\\b${name}\\s*(?::[^=\\n]*)?=\\s*(?:async\\s+)?(?:function\\b|${arrow})`, 'g'),
	];
}

/** Name → the file in util that hands it out. Read from the source, so never stale. */
async function sharedHelpers(files: readonly string[]): Promise<Map<string, string>> {
	const out = new Map<string, string>();
	for (const path of files) {
		if (!path.startsWith(`${HELPER_DIR}/`)) continue;
		const code = withoutText(await read(path));
		for (const match of code.matchAll(/\bexport\s+function\s+([A-Za-z_$][\w$]*)/g)) {
			const name = match[1];
			if (name !== undefined) out.set(name, path);
		}
	}
	return out;
}

function hits(code: string, path: string, helpers: Map<string, string>): Hit[] {
	const out: Hit[] = [];

	for (const [name, owner] of helpers) {
		if (path === owner) continue;
		for (const pattern of definitionPatterns(name)) {
			for (const match of code.matchAll(pattern)) {
				out.push({ index: match.index, message: `defines ${name} again; it lives in ${owner}` });
			}
		}
	}

	for (const shape of OWNED_SHAPES) {
		if (helpers.get(shape.helper) === path) continue;
		for (const match of code.matchAll(shape.pattern)) out.push({ index: match.index, message: shape.message });
	}

	if (helpers.get('easeFactor') !== path) {
		for (const call of callArguments(code, CLAMP_TO_ONE)) {
			const state = call.args[1];
			if (call.args.length !== 2 || call.args[0] !== '1' || state === undefined || !TIMES_STEP.test(state)) continue;
			out.push({
				index: call.index,
				message: 'clamps an ease factor to 1 by hand. Use easeFactor() from util/math, or ease() if the whole step fits',
			});
		}
	}

	return out;
}

const FILES = [...(await filesIn('src')), ...(await filesIn('scripts')), ...(await filesIn('tests'))];
const HELPERS = await sharedHelpers(FILES);

describe('nothing redefines what util already hands out', () => {
	test.each([...OWNED_SHAPES.map((shape) => shape.helper), 'easeFactor'])('%s still has an owner in util', (name) => {
		expect(HELPERS.has(name), `${HELPER_DIR} no longer hands out ${name}, so the shape it owns has no owner`).toBeTrue();
	});

	test('no file defines a second copy', async () => {
		const complaints = await grep({
			files: FILES,
			exemptFiles: EXEMPT_FILES,
			exemptions: EXEMPTIONS,
			hits: (code, path) => hits(code, path, HELPERS),
		});
		expect(complaints, complaints.join('\n')).toBeEmpty();
	});
});
