import { describe, expect, test } from 'bun:test';
import { join, resolve } from 'node:path';

/**
 * A shebang promises the file can be started on its own; without the x bit that is a lie.
 *
 * `./scripts/thing.ts` then answers "permission denied" and the shebang is decoration.
 * Git stores the bit, so it travels to a fresh clone as well.
 */

const ROOT = resolve(import.meta.dir, '..');
const DIRS = ['scripts', 'src', 'server', 'tests'];

/** The files that claim you can start them; that claim is what this tests. */
async function withShebang(): Promise<string[]> {
	const out: string[] = [];
	for (const dir of DIRS) {
		for await (const name of new Bun.Glob('**/*.ts').scan({ cwd: join(ROOT, dir) })) {
			const path = join(dir, name);
			if ((await Bun.file(join(ROOT, path)).text()).startsWith('#!')) out.push(path);
		}
	}
	return out.sort();
}

const SHEBANGS = await withShebang();

describe('a shebang promises you can start the file', () => {
	test.each(SHEBANGS)('%s', async (path) => {
		const mode = (await Bun.file(join(ROOT, path)).stat()).mode;
		expect(mode & 0o111, `${path} has no execute bit: chmod +x ${path}`).toBeGreaterThan(0);
	});
});
