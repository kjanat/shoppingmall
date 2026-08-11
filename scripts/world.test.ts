#!/usr/bin/env node
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Wereldcontrole } from './check-world.ts';
import { controles, draaiControle } from './check-world.ts';

/**
 * Elke wereldcontrole als eigen test.
 *
 * check-world draaide als los script met één exit-code, dus onder de testrunner waren
 * al zijn controles samen één regel: een arm erbij liet het testaantal ongemoeid, en
 * een rode wereld was één rode test waarvan je de stdout moest lezen om te zien wélke.
 * De controles staan hier niet nóg een keer; dit leest hun eigen lijst.
 */

/**
 * De wereld opbouwen en er een menigte doorheen laten lopen duurt langer dan de vijf
 * seconden die `bun test` een test standaard geeft; `doorstroming` alleen al simuleert
 * vier minuten.
 */
const CONTROLE_TIMEOUT = 120_000;

function meldFouten(controle: Wereldcontrole, fouten: readonly string[]): string {
	return `${controle.naam} meldt ${fouten.length} ${fouten.length === 1 ? 'probleem' : 'problemen'}:\n  ✗ ${fouten.join(
		'\n  ✗ ',
	)}`;
}

describe('de wereld klopt', () => {
	for (const controle of controles) {
		test(controle.naam, { timeout: CONTROLE_TIMEOUT }, async () => {
			const fouten = await draaiControle(controle);
			assert.deepEqual(fouten, [], fouten.length ? meldFouten(controle, fouten) : undefined);
		});
	}
});
