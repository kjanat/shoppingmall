import { describe, expect, test } from 'bun:test';
import type { ExemptFile, Exemption, Hit } from './helpers/source-scan.ts';
import { callArguments, filesIn, grep, read, withoutText } from './helpers/source-scan.ts';

/**
 * A second copy of a measurement is what the world check was started for, and a second
 * copy of `half` is spelled `x / 2`. util/math and util/geometry2 already existed while
 * half the project computed past them: dividing by two by hand, clamping with a nested
 * Math.max/Math.min, or calling THREE.MathUtils next to our own clamp and lerp.
 *
 * Dividing by two is always halving, so it is rejected everywhere. Only `Math.PI / 2`
 * stays, because that is a quarter turn. Multiplying by 0.5 gets no such exemption:
 * `Math.PI * 0.5` was rewritten to `Math.PI / 2` throughout the tree, so every `* 0.5`
 * in code is a hit. A tuning factor becomes a named constant at the top of its file.
 */

const OWNER = 'src/util/math.ts';

/** Files that cannot import a helper at all. */
const EXEMPT_FILES: ExemptFile[] = [
	{
		path: 'scripts/perf/probe.ts',
		reason: 'installProbe is stringified and handed to addScriptToEvaluateOnNewDocument, where no import exists',
	},
];

/**
 * Places where the shape matches but the meaning does not. Every row is one judgement
 * about one place. If the fragment is gone from its file, the grep reports that the
 * exemption can go.
 */
const EXEMPTIONS: Exemption[] = [
	{ path: 'src/scene/Americans.ts', fragment: 'Math.floor(id / 2)', reason: 'maps an id to an index, not a measurement' },
	{
		path: 'src/scene/Americans.ts',
		fragment: 'Math.min(lead.pathI, Math.max(0, lead.path.length - 1))',
		reason: 'the inner max computes the upper bound, it does not clamp the value',
	},
	{
		path: 'src/audio/DJPlayer.ts',
		fragment: 'Math.min(seekTo, Math.max(0, this.audio.duration - 0.5))',
		reason: 'the inner max floors the duration, the outer min bounds a different value',
	},
	{ path: 'src/scene/PoolPeople.ts', fragment: 'RECLINE / 2', reason: 'halves an angle; half() is about a measurement' },
	{ path: 'src/scene/PrayerRoom.ts', fragment: '(phrase - 6) / 2', reason: 'scales a two-beat window to 0..1' },
	{ path: 'src/scene/PrayerRoom.ts', fragment: '(phrase - 14) / 2', reason: 'the same window, second line' },
	{ path: 'src/scene/RoofIsland.ts', fragment: 'Math.abs(sum) / 2', reason: 'the constant of the shoelace formula itself' },
	{
		path: 'src/scene/Walkways.ts',
		fragment: 'tex.repeat.set(1, len / 2)',
		reason: 'a tile count over a two-metre tile',
	},
];

const DIVIDE_BY_TWO = /(?<!\\)\/\s*2(?![\w.])/g;
const QUARTER_TURN = /Math\s*\.\s*PI\s*$/;
const TIMES_HALF = /\*\s*0\.5(?![\w.])/g;
const MATHUTILS = /\bMathUtils\s*\./g;
const CLAMP_CALL = /\b(Math\s*\.\s*(?:max|min))\s*\(/g;
const CLAMP_INNER_MIN = /^Math\s*\.\s*min\s*\(/;
const CLAMP_INNER_MAX = /^Math\s*\.\s*max\s*\(/;

/** Whether the whole argument is one call, and not a call inside a sum or a division. */
function isWholeCall(arg: string): boolean {
	const open = arg.indexOf('(');
	if (open < 0) return false;
	let depth = 0;
	for (let i = open; i < arg.length; i++) {
		if (arg[i] === '(') depth++;
		else if (arg[i] === ')') {
			depth--;
			if (depth === 0) return i === arg.length - 1;
		}
	}
	return false;
}

function hits(code: string): Hit[] {
	const out: Hit[] = [];

	for (const match of code.matchAll(DIVIDE_BY_TWO)) {
		if (QUARTER_TURN.test(code.slice(0, match.index))) continue;
		out.push({ index: match.index, message: 'divides by two itself. Use half() from util/math' });
	}

	for (const match of code.matchAll(TIMES_HALF)) {
		out.push({
			index: match.index,
			message:
				'multiplies by a bare 0.5. A quarter turn is written `Math.PI / 2`, a measurement is halved with half() from util/math, and a tuning factor becomes a named constant at the top of the file',
		});
	}

	for (const match of code.matchAll(MATHUTILS)) {
		out.push({
			index: match.index,
			message:
				'calls MathUtils. clamp and lerp live in util/math with the same argument order; if you need damp or mapLinear, add them there or ask for an exemption',
		});
	}

	for (const call of callArguments(code, CLAMP_CALL)) {
		if (call.args.length !== 2) continue;
		const inner = call.name.includes('max') ? CLAMP_INNER_MIN : CLAMP_INNER_MAX;
		if (!call.args.some((arg) => inner.test(arg) && isWholeCall(arg))) continue;
		out.push({ index: call.index, message: 'clamps with a nested Math.max/Math.min. Use clamp() or clamp01() from util/math' });
	}

	return out;
}

/** Both partitions computed past the same helpers, so both are grepped. */
const FILES = [...(await filesIn('src')), ...(await filesIn('scripts')), ...(await filesIn('tests'))];

describe('nothing computes past the shared math helpers', () => {
	test('no second copy of half, clamp or lerp anywhere', async () => {
		const complaints = await grep({
			files: FILES,
			exemptFiles: EXEMPT_FILES,
			exemptions: EXEMPTIONS,
			hits: (code, path) => (path === OWNER ? [] : hits(code)),
		});
		expect(complaints, complaints.join('\n')).toBeEmpty();
	});

	// The grep above sees only what the tables allow; if the owner stops holding the
	// arithmetic, the whole check quietly passes on an empty world.
	test('util/math still holds halving and clamping itself', async () => {
		const owner = withoutText(await read(OWNER));
		expect(hits(owner), `${OWNER} no longer halves or clamps; was it renamed or moved?`).not.toBeEmpty();
	});
});
