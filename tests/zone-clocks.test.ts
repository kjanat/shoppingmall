import { describe, expect, test } from 'bun:test';
import { filesIn, grep } from './helpers/source-scan.ts';

/**
 * A tick clock asks about its own actors, never about a deck somebody typed.
 *
 * Every `sees(...)` in the frame loop used to write its deck down a second time: the
 * thief, the protest, the rat, Wei, the penguins and the catwalk all sat hard on
 * 'mall-v0' and the city block on 'stad'. Nothing held that against where those things
 * actually stood, so Wei riding the escalator and a car driving into the trench kept
 * ticking on a deck they had left.
 *
 * `withoutText` blanks a literal including its quotes, so a visibility question whose
 * whole argument was text survives as an empty pair of parentheses. That is exactly the
 * shape this forbids.
 */

const TYPED_ZONE = /\bsees[A-Za-z]*\s*\(\s*\)/g;

const FILES = await filesIn('src');

describe('a tick clock derives its zone', () => {
	test('no visibility question is asked about a written-down zone', async () => {
		const complaints = await grep({
			files: FILES,
			exemptFiles: [],
			exemptions: [],
			hits: (code) =>
				[...code.matchAll(TYPED_ZONE)].map((match) => ({
					index: match.index,
					message: 'asks about a written-down zone. Derive it from where the system stands',
				})),
		});
		expect(complaints, complaints.join('\n')).toBeEmpty();
	});
});
