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
import { resolve } from 'node:path';
import { arg, CLIError, cli, command, flag } from 'dreamcli';
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
const RAY_ROW_BOTTOM = -0.6;
const RAY_ROW_LOWER_MIDDLE = -0.2;
const RAY_ROW_UPPER_MIDDLE = 0.2;
const RAY_ROW_UPPER = 0.6;
const RAY_ROW_TOP = 0.9;
const RAY_ROWS = [RAY_ROW_BOTTOM, RAY_ROW_LOWER_MIDDLE, RAY_ROW_UPPER_MIDDLE, RAY_ROW_UPPER, RAY_ROW_TOP] as const;

const DEFAULT_SHOT_NAME = 'shot';
const DEFAULT_VIEWPORT_WIDTH = 1280;
const DEFAULT_VIEWPORT_HEIGHT = 720;
const POSE_VALUE_COUNT = 6;

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

function poseCoordinate(raw: string, name: string): number {
	const value = Number(raw.trim());
	if (!Number.isFinite(value)) throw new Error(`${name} moet een eindig getal zijn`);
	return value;
}

function parsePose(raw: unknown): RoutePose {
	if (typeof raw !== 'string') throw new Error('verwacht x,y,z,lookX,lookY,lookZ');
	const values = raw.split(',');
	if (values.length !== POSE_VALUE_COUNT) {
		throw new Error(`verwacht x,y,z,lookX,lookY,lookZ; kreeg ${values.length} waarden`);
	}
	const [x, y, z, lookX, lookY, lookZ] = values;
	if (
		x === undefined ||
		y === undefined ||
		z === undefined ||
		lookX === undefined ||
		lookY === undefined ||
		lookZ === undefined
	) {
		throw new Error('verwacht x,y,z,lookX,lookY,lookZ');
	}
	return {
		x: poseCoordinate(x, 'x'),
		y: poseCoordinate(y, 'y'),
		z: poseCoordinate(z, 'z'),
		lookX: poseCoordinate(lookX, 'lookX'),
		lookY: poseCoordinate(lookY, 'lookY'),
		lookZ: poseCoordinate(lookZ, 'lookZ'),
	};
}

const poseFlag = flag.custom(parsePose).describe('Losse pose als x,y,z,lookX,lookY,lookZ');

function alleStandpunten(): string[] {
	const namen = new Set<string>();
	for (const route of PROFILE_ROUTES) {
		for (const point of route.points) namen.add(point.name);
	}
	return [...namen].sort();
}

const shots = command('shots')
	.description('Maak screenshots van de gebouwde mall vanaf profielstandpunten of een losse pose')
	.arg('names', arg.string().variadic().default([]).describe('Namen van profielstandpunten'))
	.flag('pose', poseFlag)
	.flag('name', flag.string().default(DEFAULT_SHOT_NAME).describe('Bestandsnaam voor een losse pose'))
	.flag('out', flag.path({ type: 'directory', create: true }).default(SHOTS_DIR).describe('Uitvoermap'))
	.flag('width', flag.number({ int: true, min: 1 }).default(DEFAULT_VIEWPORT_WIDTH).describe('Breedte van het browservenster'))
	.flag('height', flag.number({ int: true, min: 1 }).default(DEFAULT_VIEWPORT_HEIGHT).describe('Hoogte van het browservenster'))
	.flag('hud', flag.boolean().describe('Toon de HUD'))
	.flag('live', flag.boolean().describe('Laat de simulatie doorlopen'))
	.flag('list', flag.boolean().describe('Toon alle beschikbare profielstandpunten'))
	.flag('raycast', flag.boolean().describe('Beschrijf raycasttreffers na iedere opname'))
	.derive(({ args, flags }) => {
		const uitvoermap = resolve(flags.out);
		if (flags.list) return { opnames: [], uitvoermap };

		if (flags.pose === undefined && flags.name !== DEFAULT_SHOT_NAME) {
			throw new CLIError('--name hoort bij --pose; een benoemd standpunt levert zijn eigen bestandsnaam.', {
				code: 'INVALID_FLAG_COMBINATION',
			});
		}

		const opnames: { naam: string; pose: RoutePose }[] = flags.pose
			? [{ naam: flags.name, pose: flags.pose }]
			: args.names.map((naam) => ({ naam, pose: profilePoint(naam).pose }));
		if (opnames.length === 0) {
			throw new CLIError('geef een standpunt op, of --pose x,y,z,lookX,lookY,lookZ.', {
				code: 'MISSING_SHOT',
				suggest: 'Gebruik --list om de beschikbare namen te tonen.',
			});
		}
		return { opnames, uitvoermap };
	})
	.action(async ({ ctx, flags, out }) => {
		if (flags.list) {
			for (const naam of alleStandpunten()) out.log(naam);
			return;
		}

		const server = await serveGame();
		const browser = await launchPerfBrowser(flags.width, flags.height);
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
			if (!flags.hud) await page.addStyleTag({ content: '#ui-root { display: none !important; }' });
			if (!flags.live) await page.evaluate('__mallProbe.setFrozen(true)');

			for (const { naam, pose } of ctx.opnames) {
				await page.evaluate(`__mallProbe.setPose(${JSON.stringify(pose)})`);
				await page.evaluate(`__mallProbe.waitFrames(${SETTLE_FRAMES})`);
				await page.waitForTimeout(SETTLE_MS);
				const pad = resolve(ctx.uitvoermap, `${naam}.png`);
				await page.screenshot({ path: pad, timeout: SHOT_TIMEOUT_MS });
				out.log(pad);
				if (flags.raycast) {
					for (const ndcY of RAY_ROWS) {
						const hits = await page.evaluate(`__mallProbe.raycast(0, ${ndcY}, 3)`);
						out.log(`  ndcY ${ndcY.toFixed(2)}: ${beschrijfTreffers(hits)}`);
					}
				}
			}
		} finally {
			await browser.close();
			await server.stop();
		}
	});

await cli('shots').default(shots).run();
