import { describe, expect, test } from 'bun:test';
import { join, resolve } from 'node:path';

/**
 * A shebang and the execute bit are one promise, and it has two halves.
 *
 * Without the bit, `./scripts/thing.ts` answers "permission denied" and the shebang is
 * decoration. Without the shebang, the bit hands the file to whatever the shell feels
 * like. Git stores the bit, so both halves travel to a fresh clone.
 */

const ROOT = resolve(import.meta.dir, '..');
const DIRS = ['scripts', 'src', 'server', 'tests'];

type SourceFile = { path: string; shebang: boolean; executable: boolean };

async function sourceFiles(): Promise<SourceFile[]> {
	const out: SourceFile[] = [];
	for (const dir of DIRS) {
		for await (const name of new Bun.Glob('**/*.ts').scan({ cwd: join(ROOT, dir) })) {
			const path = join(dir, name);
			const file = Bun.file(join(ROOT, path));
			out.push({
				path,
				shebang: (await file.text()).startsWith('#!'),
				executable: ((await file.stat()).mode & 0o111) !== 0,
			});
		}
	}
	return out.sort((a, b) => a.path.localeCompare(b.path));
}

const FILES = await sourceFiles();
const WITH_SHEBANG = FILES.filter((file) => file.shebang).map((file) => file.path);
const EXECUTABLE = FILES.filter((file) => file.executable).map((file) => file.path);

describe('a shebang promises you can start the file', () => {
	test.each(WITH_SHEBANG)('%s', (path) => {
		const file = FILES.find((candidate) => candidate.path === path);
		expect(file?.executable, `${path} has no execute bit: chmod +x ${path}`).toBeTrue();
	});
});

describe('an executable file says how to start it', () => {
	test.each(EXECUTABLE)('%s', (path) => {
		const file = FILES.find((candidate) => candidate.path === path);
		expect(file?.shebang, `${path} is executable but carries no shebang, so the shell picks the interpreter`).toBeTrue();
	});
});
