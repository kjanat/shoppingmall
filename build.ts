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
import { $, build } from 'bun';
import { flag, readFlags } from 'dreamcli';
import { assertValidVerticalConnectorRegistry } from '#/data/connectors';
import { assertCanonicalLevelRegistry } from '#/data/levelSchema';
import { VERTICAL_CONNECTORS } from '#/data/world';

assertCanonicalLevelRegistry();
assertValidVerticalConnectorRegistry(VERTICAL_CONNECTORS);

await $`rm -rf dist`.cwd(import.meta.dir);

/**
 * De vlaggen van deze build, getypeerd en met hun herkomst op één plek.
 *
 * Alles kwam hiervoor uit losse `argv.includes`-regels en directe env-reads,
 * en dat faalt stil: `--no-perf-hudd` leverde gewoon de volledige bundle op.
 * Nu is een onbekende vlag een parse-fout met een suggestie erbij, en levert
 * `--feature` meteen de lijst die Bun.build wil, in dezelfde spelling als
 * `bun build --feature`.
 */
const flags = await readFlags({
	static: flag.boolean().env('GITHUB_ACTIONS').default(false).describe('Pages-doel: de game alleen, zonder /api'),
	feature: flag
		.array(flag.enum(['NO_PERF_HUD', 'FORCE_LAMBERT']))
		.split({ cli: ',' })
		.env('MALL_FEATURES')
		.describe('Build-time vlaggen: --feature NO_PERF_HUD,FORCE_LAMBERT'),
	gitDescribe: flag.string().env('GIT_DESCRIBE').describe('Versie voor /api/statusz; in de image is er geen git'),
});

const pages = flags.static;

/**
 * Versie voor /api/statusz. Uit GIT_DESCRIBE als die er is: in de image
 * bestaat geen git-repo, dus daar komt hij als build-arg binnen. Zonder tags
 * faalt `describe`, dan de volle SHA.
 */
const version =
	flags.gitDescribe?.trim() ||
	(await $`git describe --tags --dirty`.nothrow().quiet().text()).trim() ||
	(await $`git rev-parse HEAD`.nothrow().quiet().text()).trim() ||
	'unknown';

/**
 * Build-time vlaggen. Ze verwijderen code, dus een niet-gezette vlag levert de
 * volledige build op: dat is ook wat de dev-server geeft, die geen vlaggen kan
 * meegeven. Zie src/bun-features.d.ts voor wat elke vlag precies weghaalt.
 */
if (flags.feature.length > 0) console.log(`features: ${flags.feature.join(', ')}`);

const shared = {
	minify: true,
	root: '.',
	publicPath: '/',
	splitting: true,
	features: flags.feature,
	define: {
		__GIT_DESCRIBE__: JSON.stringify(version),
		__MALL_FEATURES__: JSON.stringify(flags.feature),
	},
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
