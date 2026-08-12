import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * check-lights en check-props zijn scripts met een exit-code, geen testbestanden,
 * dus de testrunner zag ze niet: groen terwijl de wereld rood kon staan. Hier
 * draaien ze als subprocess mee. De wereldcontroles staan in [wereld](tests/wereld.ts)
 * en zijn losse tests, dus die horen hier niet meer bij.
 */
function draaiScript(relatiefPad: string): void {
	const script = fileURLToPath(new URL(relatiefPad, import.meta.url));
	const uit = spawnSync(process.execPath, [script], { encoding: 'utf8' });
	assert.equal(uit.status, 0, `${relatiefPad} faalde (exit ${uit.status}):\n${uit.stdout}\n${uit.stderr}`);
}

const SCRIPT_TIMEOUT = 120_000;

describe('de scriptcontroles draaien mee onder de testrunner', () => {
	test('check-lights is groen', { timeout: SCRIPT_TIMEOUT }, () => {
		draaiScript('$/scripts/check-lights.ts');
	});
	test('check-props is groen', { timeout: SCRIPT_TIMEOUT }, () => {
		draaiScript('$/scripts/check-props.ts');
	});
});
