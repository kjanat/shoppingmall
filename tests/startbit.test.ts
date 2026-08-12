import { join, resolve } from 'node:path';
import { describe, expect, test } from 'bun:test';

/**
 * Een shebang belooft dat het bestand zelf te starten is; zonder x-bit is dat gelogen.
 *
 * `./scripts/dinges.ts` geeft dan "permission denied" en de shebang staat er puur voor
 * de sier. Git bewaart het bit, dus het gaat ook mee naar een verse kloon.
 */

const WORTEL = resolve(import.meta.dir, '..');
const MAPPEN = ['scripts', 'src', 'server', 'tests'];

/** De bestanden die zeggen dat je ze kunt starten; die belofte is wat hier getest wordt. */
async function metShebang(): Promise<string[]> {
	const uit: string[] = [];
	for (const map of MAPPEN) {
		for await (const naam of new Bun.Glob('**/*.ts').scan({ cwd: join(WORTEL, map) })) {
			const pad = join(map, naam);
			if ((await Bun.file(join(WORTEL, pad)).text()).startsWith('#!')) uit.push(pad);
		}
	}
	return uit.sort();
}

const SHEBANGS = await metShebang();

describe('een shebang belooft dat je het bestand kunt starten', () => {
	test.each(SHEBANGS)('%s', async (pad) => {
		const bits = (await Bun.file(join(WORTEL, pad)).stat()).mode;
		expect(bits & 0o111, `${pad} heeft geen uitvoerrecht: chmod +x ${pad}`).toBeGreaterThan(0);
	});
});
