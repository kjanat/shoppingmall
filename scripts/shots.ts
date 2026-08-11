#!/usr/bin/env bun
/**
 * Schermafdrukken van de gebouwde mall, vanaf een benoemd of opgegeven standpunt.
 *
 * Dit bestaat omdat elke visuele controle hetzelfde wegwerpscript opleverde: serveer
 * dist/static, start de perf-browser, wacht tot het spel er echt staat, zet een pose,
 * schiet een plaatje. Die scripts werden na één gebruik weggegooid en de volgende
 * controle begon weer bij nul, inclusief dezelfde valkuilen: `ready` lost eerder op
 * dan het laadscherm verdwijnt, het eerste frame na een pose is nog niet gerenderd,
 * en de HUD dekt op een smal venster de halve scène af.
 *
 *   run shots v0-entrance-street
 *   run shots --pose 0,7.7,120,0,2,104 --name colosseum-arena
 *   run shots roof-middle v0-center --hud --live --width 1600 --height 900
 *
 * Standpunten zonder `--pose` komen uit de profielroutes, dus dezelfde namen die
 * `run profile` gebruikt. `run shots --list` toont ze.
 */
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { serveGame } from './perf/harness.ts';
import { SHOTS_DIR } from './perf/paths.ts';
import { launchPerfBrowser } from './perf/playwright.ts';
import type { RoutePose } from './perf/probe.ts';
import { probeSource } from './perf/probe.ts';
import { PROFILE_ROUTES, profilePoint } from './perf/routes.ts';

/** Frames tussen pose en opname: het eerste frame erna toont nog de vorige stand. */
const SETTLE_FRAMES = 8;

/** Wachttijd erbovenop (ms). De softwarerasterizer heeft er meer dan één nodig. */
const SETTLE_MS = 1200;

/** Een screenshot op SwiftShader duurt minuten; de standaard van 30 s haalt dat nooit. */
const SHOT_TIMEOUT_MS = 300_000;

/** Beeldhoogtes waarlangs `--raycast` prikt: van onder in beeld tot bovenin. */
const RAY_ROWS = [-0.6, -0.2, 0.2, 0.6, 0.9] as const;

function beschrijfTreffers(hits: unknown): string {
	if (!Array.isArray(hits) || hits.length === 0) return 'lucht (geen treffer)';
	return hits
		.map((hit) => {
			if (typeof hit !== 'object' || hit === null) return '?';
			const lees = (key: string): string => String(Reflect.get(hit, key) ?? '?');
			const afstand = Number(Reflect.get(hit, 'distance') ?? 0);
			return `${lees('owner')} · ${lees('geometry')}/${lees('material')} op ${afstand.toFixed(1)} m (${Number(
				Reflect.get(hit, 'x') ?? 0,
			).toFixed(1)}, ${Number(Reflect.get(hit, 'y') ?? 0).toFixed(1)}, ${Number(Reflect.get(hit, 'z') ?? 0).toFixed(1)})`;
		})
		.join('  |  ');
}

type Options = {
	names: string[];
	pose: RoutePose | null;
	shotName: string;
	out: string;
	width: number;
	height: number;
	hud: boolean;
	frozen: boolean;
	list: boolean;
	raycast: boolean;
};

function getal(waarde: string | undefined, veld: string): number {
	const n = Number(waarde);
	if (!Number.isFinite(n)) throw new Error(`${veld} is geen getal: ${waarde ?? '(leeg)'}`);
	return n;
}

function parsePose(raw: string): RoutePose {
	const delen = raw.split(',').map((deel) => deel.trim());
	if (delen.length !== 6) throw new Error(`--pose wil x,y,z,lookX,lookY,lookZ, kreeg ${delen.length} waarden`);
	return {
		x: getal(delen[0], 'pose.x'),
		y: getal(delen[1], 'pose.y'),
		z: getal(delen[2], 'pose.z'),
		lookX: getal(delen[3], 'pose.lookX'),
		lookY: getal(delen[4], 'pose.lookY'),
		lookZ: getal(delen[5], 'pose.lookZ'),
	};
}

function parseArgs(argv: readonly string[]): Options {
	const options: Options = {
		names: [],
		pose: null,
		shotName: 'shot',
		out: SHOTS_DIR,
		width: 1280,
		height: 720,
		hud: false,
		frozen: true,
		list: false,
		raycast: false,
	};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === undefined) continue;
		if (arg === '--list') options.list = true;
		else if (arg === '--raycast') options.raycast = true;
		else if (arg === '--hud') options.hud = true;
		else if (arg === '--live') options.frozen = false;
		else if (arg === '--pose') options.pose = parsePose(argv[++i] ?? '');
		else if (arg === '--name') options.shotName = argv[++i] ?? options.shotName;
		else if (arg === '--out') options.out = resolve(argv[++i] ?? options.out);
		else if (arg === '--width') options.width = getal(argv[++i], '--width');
		else if (arg === '--height') options.height = getal(argv[++i], '--height');
		else if (arg.startsWith('--')) throw new Error(`onbekende vlag ${arg}`);
		else options.names.push(arg);
	}
	return options;
}

function alleStandpunten(): string[] {
	const namen = new Set<string>();
	for (const route of PROFILE_ROUTES) {
		for (const point of route.points) namen.add(point.name);
	}
	return [...namen].sort();
}

const options = parseArgs(process.argv.slice(2));

if (options.list) {
	for (const naam of alleStandpunten()) console.log(naam);
	process.exit(0);
}

if (options.pose === null && options.shotName !== 'shot') {
	console.error('--name hoort bij --pose; een benoemd standpunt levert zijn eigen bestandsnaam.');
	process.exit(1);
}

const opnames: { naam: string; pose: RoutePose }[] = options.pose
	? [{ naam: options.shotName, pose: options.pose }]
	: options.names.map((naam) => ({ naam, pose: profilePoint(naam).pose }));

if (opnames.length === 0) {
	console.error('geef een standpunt op, of --pose x,y,z,lookX,lookY,lookZ. `--list` toont de namen.');
	process.exit(1);
}

await mkdir(options.out, { recursive: true });

const server = await serveGame();
const browser = await launchPerfBrowser(options.width, options.height);
try {
	const page = browser.page;
	await page.addInitScript({ content: probeSource() });
	await page.goto(server.url, { waitUntil: 'commit' });
	await page.evaluate('__mallProbe.ready(120000)');
	await page.evaluate('__mallProbe.settle(3000, 120000)');
	// `ready` kijkt naar het laadscherm en lost op zodra de eerste frames lopen; het
	// element zelf verdwijnt pas als App.ready klaar is, en tot dat moment vult het
	// elke opname.
	await page.waitForSelector('#app-loading', { state: 'detached', timeout: 120_000 });
	if (!options.hud) await page.addStyleTag({ content: '#ui-root { display: none !important; }' });
	if (options.frozen) await page.evaluate('__mallProbe.setFrozen(true)');

	for (const { naam, pose } of opnames) {
		await page.evaluate(`__mallProbe.setPose(${JSON.stringify(pose)})`);
		await page.evaluate(`__mallProbe.waitFrames(${SETTLE_FRAMES})`);
		await page.waitForTimeout(SETTLE_MS);
		const pad = resolve(options.out, `${naam}.png`);
		await page.screenshot({ path: pad, timeout: SHOT_TIMEOUT_MS });
		console.log(pad);
		if (options.raycast) {
			for (const ndcY of RAY_ROWS) {
				const hits = await page.evaluate(`__mallProbe.raycast(0, ${ndcY}, 3)`);
				console.log(`  ndcY ${ndcY.toFixed(2)}: ${beschrijfTreffers(hits)}`);
			}
		}
	}
} finally {
	await browser.close();
	await server.stop();
}
