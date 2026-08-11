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

/**
 * Een hele wereld controleren duurt langer dan de vijf seconden die `bun test`
 * een test standaard geeft: `doorstroming` alleen al laat een menigte vier
 * minuten lopen. De timeout hoort bij wat het script doet en niet bij wat een
 * unittest gewoonlijk kost.
 */
const SCRIPT_TIMEOUT = 120_000;

describe('de scriptcontroles draaien mee onder de testrunner', () => {
	test('check-world is groen', { timeout: SCRIPT_TIMEOUT }, () => {
		draaiScript('./check-world.ts');
	});
	test('check-lights is groen', { timeout: SCRIPT_TIMEOUT }, () => {
		draaiScript('./check-lights.ts');
	});
});
