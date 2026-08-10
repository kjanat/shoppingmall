import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * check-world en check-lights zijn scripts met een exit-code, geen testbestanden,
 * dus `bun test` zag ze niet: 26 pass terwijl de wereld rood kon staan. Hier
 * draaien ze als subprocess mee, zodat elke testrunner dezelfde poort bewaakt
 * als `run check`.
 */
function draaiScript(relatiefPad: string): void {
	const script = fileURLToPath(new URL(relatiefPad, import.meta.url));
	const uit = spawnSync(process.execPath, [script], { encoding: 'utf8' });
	assert.equal(uit.status, 0, `${relatiefPad} faalde (exit ${uit.status}):\n${uit.stdout}\n${uit.stderr}`);
}

describe('de scriptcontroles draaien mee onder de testrunner', () => {
	test('check-world is groen', () => {
		draaiScript('./check-world.ts');
	});
	test('check-lights is groen', () => {
		draaiScript('./check-lights.ts');
	});
});
