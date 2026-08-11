#!/usr/bin/env bun
import { describe, expect, test } from 'bun:test';
import { controles, draaiControle } from './check-world.ts';

/**
 * Elke wereldcontrole als eigen test.
 *
 * check-world draaide als los script met één exit-code, dus onder de testrunner waren
 * al zijn controles samen één regel: een arm erbij liet het testaantal ongemoeid, en
 * een rode wereld was één rode test waarvan je de stdout moest lezen om te zien wélke.
 *
 * `bun:test` en niet `node:test`, want `test.each` bestaat alleen daar; node:test heeft
 * op v26.7.0 geen `.each` en dwingt een handgeschreven lus af.
 */

/**
 * De wereld opbouwen en er een menigte doorheen laten lopen duurt langer dan de vijf
 * seconden die een test standaard krijgt; `doorstroming` alleen al simuleert vier
 * minuten.
 */
const CONTROLE_TIMEOUT = 120_000;

describe('de wereld klopt', () => {
	test.each(controles)(
		'$naam',
		async (controle) => {
			expect(await draaiControle(controle)).toBeEmpty();
		},
		CONTROLE_TIMEOUT,
	);
});
