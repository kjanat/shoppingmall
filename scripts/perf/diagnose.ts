#!/usr/bin/env bun
/**
 * What is a frame of this game actually made of?
 *
 * Answers the questions that cost the most time to answer by hand, in the order
 * they matter:
 *
 *   1. Which GPU is Chrome on? A laptop with a discrete card will happily run
 *      the integrated one, and then every later number is about the wrong chip.
 *   2. Is this a production build? `checkShaderErrors` is left on in dev on
 *      purpose, and it costs four CPU-GPU syncs per program. Benchmarking the
 *      dev server measures a configuration nobody ships.
 *   3. Where does the GPU time go? Per render target, so the shadow map and the
 *      postprocessing chain can be dismissed with a number instead of a hunch.
 *   4. How much of the frame is fill? With `--sweep`, by rendering the same
 *      scene at two sizes and solving `fixed + perMegapixel * mpix`. Fill is
 *      what light count and resolution buy back; the fixed part is not.
 *
 * Usage:  bun run diagnose            (needs `bun run build` first)
 *         bun run diagnose --sweep
 */
import { isRecord, readNumber, readString } from './cdp.ts';
import { bar, openGame, sampleWarnings } from './harness.ts';
import type { Sample } from './probe.ts';

const softwareHeadless = process.env['CHROME_PATH']?.endsWith('chrome-headless.sh') === true;
// Structural checks do not need 1.44 million software-rasterized pixels. Keep
// the same aspect ratio so frustum coverage stays representative.
const SAMPLE_MS = softwareHeadless ? 3000 : 6000;
const WIDTH = softwareHeadless ? 800 : 1600;
const HEIGHT = softwareHeadless ? 450 : 900;
/** Small enough that fill is nearly nothing, large enough that Chrome allows it. */
const SMALL_WIDTH = 512;
const SMALL_HEIGHT = 288;
/** Two samples of the same config further apart than this are not comparable. */
const DRIFT_TOLERANCE = 0.15;

const sweep = process.argv.includes('--sweep');
const urlIndex = process.argv.indexOf('--url');
const targetUrl = urlIndex < 0 ? undefined : process.argv[urlIndex + 1];
const batchIndex = process.argv.indexOf('--batch-mode');
const batchOverride = batchIndex < 0 ? undefined : process.argv[batchIndex + 1];
const notes: string[] = [];

function note(message: string): void {
	notes.push(message);
}

/**
 * Which build produced these numbers?
 *
 * A perf snapshot with no commit attached cannot be compared against anything
 * later, which makes it decoration rather than data. The server answers this on
 * /api/healthz, so a `--url` run identifies its own target instead of trusting
 * whoever writes the result down.
 */
async function deployedBuild(url: string): Promise<{ version: string; uptimeSeconds: number } | null> {
	try {
		const response = await fetch(`${new URL(url).origin}/api/healthz`);
		if (!response.ok) return null;
		const body: unknown = await response.json();
		if (!isRecord(body)) return null;
		const version = readString(body, 'version');
		return version ? { version, uptimeSeconds: readNumber(body, 'uptime') } : null;
	} catch {
		return null;
	}
}

function passTable(sample: Sample): string {
	const rows = sample.passes.slice(0, 8).map((p) => {
		const share = sample.gpuMsPerFrame > 0 ? (p.msPerFrame / sample.gpuMsPerFrame) * 100 : 0;
		return `    ${p.pass.padEnd(24)} ${p.msPerFrame.toFixed(2).padStart(8)} ms  ${share.toFixed(1).padStart(5)}%  ${p.drawsPerFrame.toFixed(0).padStart(5)} draws`;
	});
	return rows.join('\n');
}

const session = await openGame(WIDTH, HEIGHT, process.argv.includes('--fresh-profile'), targetUrl, batchOverride);
try {
	const { readyMs, settleMs } = await session.boot();
	const env = await session.environment();
	const main = await session.sample(SAMPLE_MS);

	console.log('\n── environment ─────────────────────────────────────────────');
	console.log(bar('target', targetUrl ?? 'local dist/static'));
	if (targetUrl) {
		const build = await deployedBuild(targetUrl);
		if (build) {
			console.log(bar('deployed build', `${build.version.slice(0, 12)} (up ${Math.round(build.uptimeSeconds / 60)} min)`));
		} else {
			note('could not read /api/healthz — the measured build is unidentified.');
			note('  Record which commit this was, or the numbers cannot be compared against anything later.');
		}
	}
	console.log(bar('GPU', env.renderer));
	console.log(bar('canvas', `${env.canvas} (${env.megapixels} Mpix, DPR ${env.devicePixelRatio})`));
	console.log(bar('parallel shader compile', env.parallelShaderCompile ? 'yes' : 'NO — links will stall'));
	console.log(bar('GPU timer queries', env.timerQuery ? 'yes' : 'NO — no per-pass timing'));
	console.log(bar('time to playable', `${(readyMs / 1000).toFixed(1)} s (+${(settleMs / 1000).toFixed(1)} s to settle)`));
	console.log(bar('batch mode', env.batchMode));

	if (/(Intel|AMD).*(Graphics|Vega|Radeon\(TM\) Graphics)/i.test(env.renderer) && !/RTX|GTX|Arc/i.test(env.renderer)) {
		note(`Chrome is on what looks like an integrated GPU (${env.renderer}).`);
		note('  If this machine has a discrete card, Chrome is not using it, and these numbers are about the wrong chip.');
		note('  Windows: Settings → Display → Graphics → Chrome → High performance.');
	}

	console.log('\n── shaders ─────────────────────────────────────────────────');
	console.log(bar('programs linked', String(env.programsLinked)));
	console.log(bar('shader source', `${env.shaderKbTotal} KB total, largest ${env.largestShaderKb} KB`));
	console.log(bar('lights in shader', `${env.numPointLights} point, ${env.numDirLights} directional, ${env.numSpotLights} spot`));
	console.log(bar('programs warmed', String(env.warmupPrograms)));

	console.log('\n── batching ────────────────────────────────────────────────');
	console.log(bar('source meshes', `${env.batchSourceMeshes} (${env.batchDynamicSources} dynamic)`));
	console.log(bar('batch draw calls', String(env.batchDrawCalls)));
	console.log(bar('largest batch radius', `${env.batchLargestRadius} m`));

	if (env.programInfoLogCalls > 0 || env.shaderInfoLogCalls > 0) {
		note(
			`checkShaderErrors is ON (${env.programInfoLogCalls} getProgramInfoLog, ${env.shaderInfoLogCalls} getShaderInfoLog calls).`,
		);
		note('  Each is a blocking CPU-GPU sync. This is a dev build; production numbers will differ.');
	}
	if (env.numPointLights > 12) {
		note(`${env.numPointLights} point lights are unrolled into every fragment shader.`);
		note(`  That is why the largest shader is ${env.largestShaderKb} KB. Fill cost scales with this number.`);
	}

	console.log('\n── frame ───────────────────────────────────────────────────');
	console.log(
		bar(
			'wall time',
			`${main.wallMsMedian} ms median, ${main.wallMsMean} ms mean, ${main.wallMsP90} ms p90  (${(1000 / Math.max(main.wallMsMedian, 0.001)).toFixed(1)} fps)`,
		),
	);
	console.log(
		bar(
			'GPU time',
			`${main.gpuMsPerFrame} ms  (${((main.gpuMsPerFrame / Math.max(main.wallMsMean, 0.001)) * 100).toFixed(0)}% of the frame)`,
		),
	);
	console.log(bar('draw calls', String(main.drawsPerFrame)));
	console.log(bar('texture uploads', `${main.texUploadsPerFrame}/frame, ${main.texUploadKbPerFrame} KB`));
	console.log(
		bar('CPU phases', `${main.cpuLogicMsMean} ms logic, ${main.cpuBatchMsMean} ms batch, ${main.cpuSubmitMsMean} ms submit`),
	);
	console.log('\n  GPU time by render target:');
	console.log(passTable(main));

	for (const warning of sampleWarnings(main)) note(warning);

	if (sweep) {
		console.log('\n── fill vs fixed ───────────────────────────────────────────');
		// A-B-A: the second full-size sample is a control. If the machine drifted
		// between them, the two-point solve below is meaningless and says so.
		await session.setViewport(SMALL_WIDTH, SMALL_HEIGHT);
		const small = await session.sample(SAMPLE_MS);
		await session.setViewport(WIDTH, HEIGHT);
		const control = await session.sample(SAMPLE_MS);

		const drift = Math.abs(control.gpuMsPerFrame - main.gpuMsPerFrame) / Math.max(main.gpuMsPerFrame, 0.001);
		console.log(bar('large', `${env.megapixels} Mpix → ${main.gpuMsPerFrame} ms GPU`));
		console.log(bar('small', `${(SMALL_WIDTH * SMALL_HEIGHT) / 1e6} Mpix → ${small.gpuMsPerFrame} ms GPU`));
		console.log(bar('large again (control)', `${control.gpuMsPerFrame} ms GPU — ${(drift * 100).toFixed(1)}% drift`));

		if (drift > DRIFT_TOLERANCE) {
			note(`The control differed from the first sample by ${(drift * 100).toFixed(1)}%.`);
			note('  This machine is drifting (thermal, memory pressure, background load). The split below is not reliable.');
		}
		const smallMpix = (SMALL_WIDTH * SMALL_HEIGHT) / 1e6;
		const span = env.megapixels - smallMpix;
		if (span > 0.01) {
			const perMegapixel = (main.gpuMsPerFrame - small.gpuMsPerFrame) / span;
			const fixed = small.gpuMsPerFrame - smallMpix * perMegapixel;
			console.log('');
			console.log(bar('→ model', `${fixed.toFixed(1)} ms fixed + ${perMegapixel.toFixed(1)} ms/Mpix`));
			console.log(
				bar('  at this resolution', `${fixed.toFixed(1)} ms fixed, ${(perMegapixel * env.megapixels).toFixed(1)} ms fill`),
			);
			note('Fixed cost is per-draw and geometry work: resolution and light count will not touch it.');
		}
	}

	if (notes.length > 0) {
		console.log('\n── notes ───────────────────────────────────────────────────');
		for (const message of notes) console.log(`  ${message.startsWith(' ') ? message : `⚠ ${message}`}`);
	}
	console.log('');
} finally {
	await session.close();
}
