/**
 * Shared plumbing for the perf scripts: serve the built game, open it in a real
 * Chrome with the probe installed, and read the probe's answers back as typed
 * values.
 *
 * `dist/static` is served rather than `dist/mall`, for two reasons. The compiled
 * server holds a lock on its own executable on Windows, so a rebuild between two
 * runs fails; and /api is irrelevant to anything measured here — the DJ booth and
 * the voices do not draw pixels.
 */
import { existsSync } from 'node:fs';
import { join, normalize, resolve, sep } from 'node:path';
import { Browser, isRecord, readArray, readBoolean, readNumber, readString } from './cdp.ts';
import type { Environment, PassTiming, Sample } from './probe.ts';
import { probeSource } from './probe.ts';

const STATIC_DIR = resolve(import.meta.dir, '../../dist/static');

export type StaticServer = { url: string; stop: () => Promise<void> };

export function serveGame(): StaticServer {
	if (!existsSync(join(STATIC_DIR, 'index.html'))) {
		throw new Error(`no build in ${STATIC_DIR} — run \`bun run build\` first`);
	}
	const server = Bun.serve({
		port: 0,
		async fetch(request) {
			const path = new URL(request.url).pathname;
			// Keep the resolved path inside the build directory: this server is a
			// dev tool, but a dev tool that will happily read ../../.env is a bad one.
			const wanted = normalize(join(STATIC_DIR, path === '/' ? 'index.html' : path));
			if (wanted !== STATIC_DIR && !wanted.startsWith(STATIC_DIR + sep)) {
				return new Response('no', { status: 403 });
			}
			const file = Bun.file(wanted);
			if (await file.exists()) return new Response(file);
			return new Response(Bun.file(join(STATIC_DIR, 'index.html')));
		},
	});
	return {
		url: `http://127.0.0.1:${server.port}/`,
		stop: async () => {
			await server.stop(true);
		},
	};
}

export type GameSession = {
	browser: Browser;
	server: StaticServer;
	/** Load the game and wait until it is genuinely running and settled. */
	boot: (options?: { settleQuietMs?: number }) => Promise<{ readyMs: number; settleMs: number }>;
	sample: (durationMs: number) => Promise<Sample>;
	environment: () => Promise<Environment>;
	setViewport: (width: number, height: number) => Promise<void>;
	close: () => Promise<void>;
};

/** Reused between runs so Chrome's compiled-shader cache survives; see Browser.launch. */
const PROFILE_DIR = resolve(import.meta.dir, '../../.perf/chrome-profile');

/**
 * `url` points the run at a deployed site instead of the local build, which is
 * the only way to check that a fix actually shipped: the probe reports
 * `programInfoLogCalls`, and on a correct production build that is zero.
 * Frame timings stay local — the network decides load time, not frame time.
 */
export async function openGame(width: number, height: number, freshProfile = false, url?: string): Promise<GameSession> {
	const server: StaticServer = url ? { url, stop: async () => {} } : serveGame();
	// A little taller than the viewport: Chrome's own chrome eats some of it, and
	// a viewport override is applied afterwards anyway.
	const browser = await Browser.launch(width, height + 120, freshProfile ? undefined : PROFILE_DIR);
	await browser.attachToPage();
	await browser.onNewDocument(probeSource());
	await browser.setViewport(width, height);

	const session: GameSession = {
		browser,
		server,
		boot: async (options) => {
			await browser.navigate(server.url);
			const readyMs = readNumber({ v: await browser.evaluate('__mallProbe.ready(120000)') }, 'v');
			const settleMs = readNumber(
				{ v: await browser.evaluate(`__mallProbe.settle(${options?.settleQuietMs ?? 5000}, 120000)`) },
				'v',
			);
			return { readyMs, settleMs };
		},
		sample: async (durationMs) => parseSample(await browser.evaluate(`__mallProbe.sample(${durationMs})`, durationMs + 60_000)),
		environment: async () => parseEnvironment(await browser.evaluate('__mallProbe.environment()')),
		setViewport: (w, h) => browser.setViewport(w, h),
		close: async () => {
			await browser.close();
			await server.stop();
		},
	};
	return session;
}

// ── parsing the probe's answers ────────────────────────────────────────────

function parsePasses(value: unknown): PassTiming[] {
	return readArray({ v: value }, 'v').flatMap((entry) => {
		if (!isRecord(entry)) return [];
		return [
			{
				pass: readString(entry, 'pass', '?'),
				msPerFrame: readNumber(entry, 'msPerFrame'),
				drawsPerFrame: readNumber(entry, 'drawsPerFrame'),
			},
		];
	});
}

export function parseSample(value: unknown): Sample {
	if (!isRecord(value)) throw new Error('probe returned no sample — is the probe installed?');
	return {
		frames: readNumber(value, 'frames'),
		wallMsMedian: readNumber(value, 'wallMsMedian'),
		wallMsP90: readNumber(value, 'wallMsP90'),
		wallMsMean: readNumber(value, 'wallMsMean'),
		gpuMsPerFrame: readNumber(value, 'gpuMsPerFrame'),
		passes: parsePasses(value['passes']),
		drawsPerFrame: readNumber(value, 'drawsPerFrame'),
		texUploadsPerFrame: readNumber(value, 'texUploadsPerFrame'),
		texUploadKbPerFrame: readNumber(value, 'texUploadKbPerFrame'),
		drawCoverage: readNumber(value, 'drawCoverage'),
		disjointDrops: readNumber(value, 'disjointDrops'),
		linksDuringSample: readNumber(value, 'linksDuringSample'),
	};
}

export function parseEnvironment(value: unknown): Environment {
	if (!isRecord(value)) throw new Error('probe returned no environment — is the probe installed?');
	return {
		renderer: readString(value, 'renderer', 'unknown'),
		vendor: readString(value, 'vendor', 'unknown'),
		parallelShaderCompile: readBoolean(value, 'parallelShaderCompile'),
		timerQuery: readBoolean(value, 'timerQuery'),
		canvas: readString(value, 'canvas', '?'),
		megapixels: readNumber(value, 'megapixels'),
		devicePixelRatio: readNumber(value, 'devicePixelRatio', 1),
		programsLinked: readNumber(value, 'programsLinked'),
		shaderCount: readNumber(value, 'shaderCount'),
		shaderKbTotal: readNumber(value, 'shaderKbTotal'),
		largestShaderKb: readNumber(value, 'largestShaderKb'),
		numPointLights: readNumber(value, 'numPointLights'),
		numDirLights: readNumber(value, 'numDirLights'),
		numSpotLights: readNumber(value, 'numSpotLights'),
		programInfoLogCalls: readNumber(value, 'programInfoLogCalls'),
		shaderInfoLogCalls: readNumber(value, 'shaderInfoLogCalls'),
	};
}

// ── shared reporting ───────────────────────────────────────────────────────

export function bar(label: string, value: string): string {
	return `  ${label.padEnd(26)} ${value}`;
}

/**
 * A sample is only worth printing if the probe covered the whole frame, the GPU
 * did not report a disjoint, and nothing was still linking. Each of these was a
 * measurement that looked plausible and was not.
 */
export function sampleWarnings(sample: Sample): string[] {
	const warnings: string[] = [];
	if (sample.drawCoverage < 0.99) {
		warnings.push(`only ${(sample.drawCoverage * 100).toFixed(1)}% of draws were timed — GPU figures are incomplete`);
	}
	if (sample.disjointDrops > 0) warnings.push(`${sample.disjointDrops} GPU timer queries dropped as disjoint`);
	// A slow trickle is normal and unavoidable: materials keep appearing as sims
	// speak and signs are built, so a handful of links is the steady state rather
	// than a sign the sample started too early.
	if (sample.linksDuringSample > 4) {
		warnings.push(`${sample.linksDuringSample} shader programs linked during the sample — it was not settled`);
	}
	if (sample.frames < 20) warnings.push(`only ${sample.frames} frames sampled — too few to trust the median`);
	return warnings;
}
