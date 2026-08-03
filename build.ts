#!/usr/bin/env bun
import { cp } from 'node:fs/promises';
/**
 * Production build. Same settings, two targets — CI picks the second:
 *
 *   local / docker    server + the game it serves  → dist/server
 *   GitHub Actions    the game alone               → dist/pages
 *
 * The Pages build has no /api, so DJ Bartek and the voices are dead there.
 * `bun run build` runs tsc first — the bundler does not typecheck.
 */
import { $, argv, build, env } from 'bun';

await $`rm -rf dist`.cwd(import.meta.dir);

const pages = !!env['GITHUB_ACTIONS'] || argv.includes('--static');

/**
 * Versie voor /api/healthz. Uit GIT_DESCRIBE als die er is: in de image
 * bestaat geen git-repo, dus daar komt hij als build-arg binnen. Zonder tags
 * faalt `describe`, dan de volle SHA.
 */
const version =
	env['GIT_DESCRIBE']?.trim() ||
	(await $`git describe --tags --dirty`.nothrow().quiet().text()).trim() ||
	(await $`git rev-parse HEAD`.nothrow().quiet().text()).trim() ||
	'unknown';

const shared = {
	minify: true,
	root: '.',
	publicPath: '/',
	splitting: true,
	define: { __GIT_DESCRIBE__: JSON.stringify(version) },
} as const;

const [out1, out2] = await Promise.all([
	build({
		...shared,
		entrypoints: ['index.html'],
		outdir: 'dist/static',
		target: 'browser',
		sourcemap: 'linked',
	}),
	build({
		...shared,
		entrypoints: ['server/main.ts'],
		compile: { outfile: 'dist/mall' },
		target: 'bun',
		sourcemap: 'inline',
	}),
]);

for (const artifact of [out1.outputs, out2.outputs].flat()) {
	const kb = (artifact.size / 1024).toFixed(1).padStart(9);
	console.log(`${kb} KB  ${artifact.kind.padEnd(11)} ${artifact.path.replace(process.cwd(), '.')}`);
}

if (pages) {
	await cp('public', 'dist/static', {
		recursive: true,
		filter: (src) => !src.includes('public/dj-music'),
	});
}
