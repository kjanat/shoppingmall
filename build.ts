#!/usr/bin/env bun
/**
 * Production build. Same settings, two targets — CI picks the second:
 *
 *   local / docker    server + the game it serves  → dist/server
 *   GitHub Actions    the game alone               → dist/pages
 *
 * The Pages build has no /api, so DJ Bartek and the voices are dead there.
 * `bun run build` runs tsc first — the bundler does not typecheck.
 */
import { cp } from 'node:fs/promises';

await Bun.$`rm -rf dist`.cwd(import.meta.dir);

const pages = !!Bun.env['GITHUB_ACTIONS'] || Bun.argv.includes('--static');

const shared = {
	minify: true,
	root: '.',
	publicPath: '/',
	define: {
		'process.env.NODE_ENV': '"production"',
	},
} as const;

const [out1, out2] = await Promise.all([
	Bun.build({
		...shared,
		entrypoints: ['index.html'],
		outdir: 'dist/static',
		target: 'browser',
		sourcemap: 'linked',
	}),
	Bun.build({
		...shared,
		entrypoints: ['server/main.ts'],
		compile: { outfile: 'dist/mall' },
		target: 'bun',
		// Goes into the binary, zstd'd, so stack traces point at source.
		// Bun writes loose .map copies next to it too; nothing reads those
		// and the image doesn't copy them.
		sourcemap: 'inline',
	}),
]);

for (const artifact of [out1.outputs, out2.outputs].flat()) {
	const kb = (artifact.size / 1024).toFixed(1).padStart(9);
	console.log(`${kb} KB  ${artifact.kind.padEnd(11)} ${artifact.path.replace(process.cwd(), '.')}`);
}

// Pages has no server, so public/ ships inside the artifact. The binary reads
// it from the working directory instead, so there is nothing to copy there.
// The music directory stays out: 115 MB, and it's a bind mount in the container.
if (pages) {
	await cp('public', 'dist/static', {
		recursive: true,
		filter: (src) => !src.includes('public/dj-music'),
	});
}
