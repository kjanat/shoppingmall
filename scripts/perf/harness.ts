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
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join, normalize, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { blue, space } from 'ansispeck/safe';
import { PROFILE_DIR, STATIC_DIR } from './paths.ts';
import type { PerfBrowser } from './playwright.ts';
import { isSoftwareHeadless, launchPerfBrowser } from './playwright.ts';
import type { BatchOwnerTiming, Environment, PassTiming, RoutePose, Sample } from './probe.ts';
import { probeSource } from './probe.ts';
import { isRecord, readArray, readBoolean, readNumber, readString } from './values.ts';

export type StaticServer = { url: string; stop: () => Promise<void> };

function contentType(path: string): string {
	if (path.endsWith('.html')) return 'text/html; charset=utf-8';
	if (path.endsWith('.js')) return 'text/javascript; charset=utf-8';
	if (path.endsWith('.css')) return 'text/css; charset=utf-8';
	if (path.endsWith('.json')) return 'application/json; charset=utf-8';
	if (path.endsWith('.svg')) return 'image/svg+xml';
	if (path.endsWith('.png')) return 'image/png';
	if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
	if (path.endsWith('.webp')) return 'image/webp';
	if (path.endsWith('.mp3')) return 'audio/mpeg';
	if (path.endsWith('.ogg')) return 'audio/ogg';
	if (path.endsWith('.wav')) return 'audio/wav';
	if (path.endsWith('.woff2')) return 'font/woff2';
	return 'application/octet-stream';
}

async function readStaticFile(path: string): Promise<Buffer | null> {
	try {
		return await readFile(path);
	} catch (error) {
		if (isRecord(error) && readString(error, 'code') === 'ENOENT') return null;
		throw error;
	}
}

export async function serveGame(): Promise<StaticServer> {
	if (!existsSync(join(STATIC_DIR, 'index.html'))) {
		throw new Error(`no build in ${STATIC_DIR} — run ${blue`bun run build`} first`);
	}
	const server = createServer(async (request, response) => {
		try {
			const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
			// Keep the resolved path inside the build directory: this server is a
			// dev tool, but a dev tool that will happily read ../../.env is a bad one.
			const wanted = normalize(join(STATIC_DIR, path === '/' ? 'index.html' : path));
			if (wanted !== STATIC_DIR && !wanted.startsWith(STATIC_DIR + sep)) {
				response.writeHead(403).end('no');
				return;
			}
			const file = await readStaticFile(wanted);
			const body = file ?? (await readFile(join(STATIC_DIR, 'index.html')));
			response.writeHead(200, { 'content-type': contentType(file ? wanted : 'index.html') }).end(body);
		} catch (error) {
			response.writeHead(500).end(error instanceof Error ? error.message : 'static server error');
		}
	});
	await new Promise<void>((resolveListen, rejectListen) => {
		const onError = (error: Error): void => rejectListen(error);
		server.once('error', onError);
		server.listen(0, '127.0.0.1', () => {
			server.off('error', onError);
			resolveListen();
		});
	});
	const address = server.address();
	if (!address || typeof address === 'string') {
		server.close();
		throw new Error('static server did not expose a TCP port');
	}
	return {
		url: `http://127.0.0.1:${address.port}/`,
		stop: async () => {
			await new Promise<void>((resolveClose, rejectClose) => {
				server.close((error) => (error ? rejectClose(error) : resolveClose()));
			});
		},
	};
}

export type GameSession = {
	server: StaticServer;
	/** Load the game and wait until it is genuinely running and settled. */
	boot: (options?: { settleQuietMs?: number }) => Promise<{ readyMs: number; settleMs: number }>;
	sample: (durationMs: number) => Promise<Sample>;
	routeSegment: (from: RoutePose, to: RoutePose, durationMs: number) => Promise<Sample>;
	setPose: (pose: RoutePose) => Promise<void>;
	setFrozen: (frozen: boolean) => Promise<void>;
	waitFrames: (count: number) => Promise<void>;
	environment: () => Promise<Environment>;
	setViewport: (width: number, height: number) => Promise<void>;
	close: () => Promise<void>;
};

/**
 * `url` points the run at a deployed site instead of the local build, which is
 * the only way to check that a fix actually shipped: the probe reports
 * `programInfoLogCalls`, and on a correct production build that is zero.
 * Frame timings stay local — the network decides load time, not frame time.
 */
export async function openGame(
	width: number,
	height: number,
	freshProfile = false,
	url?: string,
	batchOverride?: string,
): Promise<GameSession> {
	const server: StaticServer = url ? { url, stop: async () => {} } : await serveGame();
	// A little taller than the viewport: Chrome's own chrome eats some of it, and
	// a viewport override is applied afterwards anyway.
	let browser: PerfBrowser;
	try {
		browser = await launchPerfBrowser(width, height, freshProfile ? undefined : PROFILE_DIR);
	} catch (error) {
		await server.stop();
		throw error;
	}
	try {
		await browser.page.addInitScript({ content: probeSource(batchOverride) });
	} catch (error) {
		try {
			await browser.close();
		} finally {
			await server.stop();
		}
		throw error;
	}

	async function evaluate(expression: string, timeoutMs = 180_000): Promise<unknown> {
		const timeoutController = new AbortController();
		try {
			return await Promise.race([
				browser.page.evaluate(expression),
				delay(timeoutMs, undefined, { signal: timeoutController.signal }).then(() => {
					throw new Error(`page evaluation timed out after ${timeoutMs} ms: ${expression.slice(0, 60)}`);
				}),
			]);
		} finally {
			timeoutController.abort();
		}
	}

	const session: GameSession = {
		server,
		boot: async (options) => {
			await browser.page.goto(server.url, { waitUntil: 'commit' });
			const readyMs = readNumber({ v: await evaluate('__mallProbe.ready(120000)') }, 'v');
			const settleMs = readNumber({ v: await evaluate(`__mallProbe.settle(${options?.settleQuietMs ?? 5000}, 120000)`) }, 'v');
			return { readyMs, settleMs };
		},
		sample: async (durationMs) => parseSample(await evaluate(`__mallProbe.sample(${durationMs})`, durationMs + 60_000)),
		routeSegment: async (from, to, durationMs) =>
			parseSample(
				await evaluate(
					`__mallProbe.routeSegment(${JSON.stringify(from)}, ${JSON.stringify(to)}, ${durationMs})`,
					durationMs + 60_000,
				),
			),
		setPose: async (pose) => {
			await evaluate(`__mallProbe.setPose(${JSON.stringify(pose)})`);
		},
		setFrozen: async (frozen) => {
			await evaluate(`__mallProbe.setFrozen(${JSON.stringify(frozen)})`);
		},
		waitFrames: async (count) => {
			await evaluate(`__mallProbe.waitFrames(${Math.max(1, Math.floor(count))})`);
		},
		environment: async () => parseEnvironment(await evaluate('__mallProbe.environment()')),
		setViewport: async (w, h) => {
			await browser.page.setViewportSize({ width: w, height: h });
			// The first frames after a resize allocate a fresh composer target chain.
			// Keep that one-time work outside the steady-state sample.
			await evaluate('__mallProbe.waitFrames(10)');
		},
		close: async () => {
			try {
				await browser.close();
			} finally {
				await server.stop();
			}
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
	const sample: Sample = {
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
		queriesIssued: readNumber(value, 'queriesIssued'),
		queriesResolved: readNumber(value, 'queriesResolved'),
		linksDuringSample: readNumber(value, 'linksDuringSample'),
		cpuLogicMsMean: readNumber(value, 'cpuLogicMsMean'),
		cpuBatchMsMean: readNumber(value, 'cpuBatchMsMean'),
		cpuSubmitMsMean: readNumber(value, 'cpuSubmitMsMean'),
		trianglesPerFrame: readNumber(value, 'trianglesPerFrame'),
	};
	// Chrome can claim the document is visible and focused while Windows has put
	// its occluded window on an exact 1 Hz compositor cadence. A genuinely 1 FPS
	// render would also have comparable GPU or CPU work; a cheap render followed
	// by ~900 ms of nothing is the throttling signature and must never be printed
	// as game performance.
	const cpuMs = sample.cpuLogicMsMean + sample.cpuBatchMsMean + sample.cpuSubmitMsMean;
	if (
		sample.frames >= 3 &&
		sample.wallMsMedian >= 850 &&
		sample.wallMsMedian <= 1150 &&
		sample.gpuMsPerFrame < 500 &&
		cpuMs < 500
	) {
		throw new Error(
			'Chrome rAF is throttled to about 1 Hz while render work is below 500 ms; discard this run and use hardware headless Chrome',
		);
	}
	return sample;
}

export function parseEnvironment(value: unknown): Environment {
	if (!isRecord(value)) throw new Error('probe returned no environment — is the probe installed?');
	const batchOwners: BatchOwnerTiming[] = readArray(value, 'batchOwners').flatMap((entry) => {
		if (!isRecord(entry)) return [];
		return [
			{
				name: readString(entry, 'name', '?'),
				dynamic: readBoolean(entry, 'dynamic'),
				sources: readNumber(entry, 'sources'),
				batches: readNumber(entry, 'batches'),
				triangles: readNumber(entry, 'triangles'),
				largestRadius: readNumber(entry, 'largestRadius'),
			},
		];
	});
	const environment: Environment = {
		renderer: readString(value, 'renderer', 'unknown'),
		vendor: readString(value, 'vendor', 'unknown'),
		parallelShaderCompile: readBoolean(value, 'parallelShaderCompile'),
		timerQuery: readBoolean(value, 'timerQuery'),
		canvas: readString(value, 'canvas', '?'),
		megapixels: readNumber(value, 'megapixels'),
		devicePixelRatio: readNumber(value, 'devicePixelRatio', 1),
		batchMode: readString(value, 'batchMode', 'unknown'),
		batchSourceMeshes: readNumber(value, 'batchSourceMeshes'),
		batchDynamicSources: readNumber(value, 'batchDynamicSources'),
		batchDrawCalls: readNumber(value, 'batchDrawCalls'),
		batchLargestRadius: readNumber(value, 'batchLargestRadius'),
		batchOwners,
		warmupPrograms: readNumber(value, 'warmupPrograms'),
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
	const structuralSoftwareRun = isSoftwareHeadless();
	if (!structuralSoftwareRun && /SwiftShader|llvmpipe|software raster/i.test(environment.renderer)) {
		throw new Error(`normal performance run started a software renderer: ${environment.renderer}`);
	}
	return environment;
}

// ── shared reporting ───────────────────────────────────────────────────────

export function bar(label: string, value: string): string {
	return `${space(2)}${label.padEnd(26)} ${value}`;
}

/**
 * Which side of the frame is accounted for, in the shape GamersNexus uses for
 * GPU Busy / GPU Wait: compare each side's busy time against the frame instead
 * of reading one total and guessing. A frame nobody accounts for is being paced
 * by something outside the game.
 */
export type FrameAccount = {
	frameMs: number;
	/** Logic and batching. The driver cannot block inside either. */
	appCpuMs: number;
	/** Submission. App.ts documents that the driver blocks in here when behind. */
	submitMs: number;
	gpuBusyMs: number;
	gpuWaitMs: number;
	cpuWaitMs: number;
	accounted: 'gpu' | 'app-cpu' | 'submit' | 'nothing';
};

/** Share of the frame a side must reach before it explains the frame. */
const PARITY = 0.9;

export function frameAccount(sample: Sample): FrameAccount {
	const frameMs = sample.wallMsMean;
	const appCpuMs = sample.cpuLogicMsMean + sample.cpuBatchMsMean;
	const submitMs = sample.cpuSubmitMsMean;
	const gpuBusyMs = sample.gpuMsPerFrame;
	const share = (value: number): number => (frameMs > 0 ? value / frameMs : 0);
	const accounted =
		share(gpuBusyMs) >= PARITY
			? 'gpu'
			: share(appCpuMs) >= PARITY
				? 'app-cpu'
				: share(appCpuMs + submitMs) >= PARITY
					? 'submit'
					: 'nothing';
	return {
		frameMs,
		appCpuMs,
		submitMs,
		gpuBusyMs,
		gpuWaitMs: Math.max(0, frameMs - gpuBusyMs),
		cpuWaitMs: Math.max(0, frameMs - appCpuMs - submitMs),
		accounted,
	};
}

/**
 * A sample is only worth printing if the probe covered the whole frame, the GPU
 * did not report a disjoint, and nothing was still linking. Each of these was a
 * measurement that looked plausible and was not.
 */
export function sampleWarnings(sample: Sample): string[] {
	const warnings: string[] = [];
	// Presenting the frame is one fullscreen blit. Headless Chromium on ANGLE's
	// Vulkan backend billed 13.42 ms of a 37.1 ms frame to that single draw while
	// headful GL billed 0.09 ms for the same blit: TIME_ELAPSED_EXT reports
	// elapsed time including idle, so waiting for the next frame slot lands here.
	const present = sample.passes.find((pass) => pass.pass.startsWith('default '));
	if (present && present.drawsPerFrame <= 2 && present.msPerFrame >= 3 && sample.gpuMsPerFrame > 0) {
		const share = present.msPerFrame / sample.gpuMsPerFrame;
		if (share >= 0.2) {
			warnings.push(
				`${present.msPerFrame.toFixed(2)} ms of GPU time sits on ${present.drawsPerFrame.toFixed(0)} present draw (${(share * 100).toFixed(0)}% of the frame's GPU time) — the frame is waiting to be shown, and every millisecond here is pacing rather than work`,
			);
		}
	}
	if (sample.drawCoverage < 0.99) {
		warnings.push(`only ${(sample.drawCoverage * 100).toFixed(1)}% of draws were timed — GPU figures are incomplete`);
	}
	if (sample.disjointDrops > 0) warnings.push(`${sample.disjointDrops} GPU timer queries dropped as disjoint`);
	if (sample.queriesIssued !== sample.queriesResolved) {
		warnings.push(`${sample.queriesResolved}/${sample.queriesIssued} GPU timer queries resolved`);
	}
	// A slow trickle is normal and unavoidable: materials keep appearing as sims
	// speak and signs are built, so a handful of links is the steady state rather
	// than a sign the sample started too early.
	if (sample.linksDuringSample > 4) {
		warnings.push(`${sample.linksDuringSample} shader programs linked during the sample — it was not settled`);
	}
	if (sample.frames < 20) warnings.push(`only ${sample.frames} frames sampled — too few to trust the median`);
	return warnings;
}
