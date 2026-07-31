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

const pages = !!Bun.env['GITHUB_ACTIONS'] || Bun.argv.includes('--static');

const shared = {
	minify: true,
	sourcemap: 'linked',
	define: {
		'process.env.NODE_ENV': '"production"',
	},
} as const;

const out = pages
	? await Bun.build({
			...shared,
			entrypoints: ['index.html'],
			outdir: 'dist/pages',
		})
	: await Bun.build({
			...shared,
			// index.html rides along via the import in server/main.ts
			entrypoints: ['server/main.ts'],
			outdir: 'dist/server',
			target: 'bun',
			naming: {
				// Flat, because the HTML entry's [dir] is `..` relative to server/ —
				// it would be written over the source index.html. Chunks and assets
				// keep the default content hash.
				entry: '[name].[ext]',
			},
		});

for (const artifact of out.outputs) {
	const kb = (artifact.size / 1024).toFixed(1).padStart(9);
	console.log(`${kb} KB  ${artifact.kind.padEnd(11)} ${artifact.path.replace(process.cwd(), '.')}`);
}

// Both targets ship public/ so the output runs on its own: Pages has no server
// to hand it out, and the server resolves it one level above the bundle — same
// spot as in the repo. Minus the crates: 115 MB that live outside the build
// (a bind mount in the container).
await cp('public', pages ? 'dist/pages' : 'dist/public', {
	recursive: true,
	filter: (src) => !src.includes('public/dj-music'),
});
console.log(`           public/     → ./dist/${pages ? 'pages' : 'public'}  (minus dj-music)`);
