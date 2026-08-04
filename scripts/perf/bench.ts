#!/usr/bin/env node
/**
 * "Did my change help?" — with the machine itself under suspicion.
 *
 * A single before/after pair is worthless on a laptop. Measuring this game on
 * one produced 38.8 → 65.5 → 87.6 → 106.4 ms across four samples of *identical*
 * configurations: every toggle looked like a catastrophic regression, and all of
 * it was thermal and memory drift. A conclusion was drawn from it, and it was
 * wrong.
 *
 * So this script never reports a number without also reporting whether the
 * machine held still while it was measured. It takes several samples in a row,
 * fits the trend across them, and refuses to call a comparison meaningful when
 * the drift is larger than the difference being claimed.
 *
 * Usage:  bun run bench                        measure, report stability
 *         bun run bench --save before          store the result
 *         bun run bench --compare before       measure and diff against it
 *         bun run bench --samples 8
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { argv } from 'node:process';
import { median } from '#/util/math';
import { bar, openGame, sampleWarnings } from './harness.ts';
import { trimToColumns } from './out.ts';
import { BASELINE_DIR } from './paths.ts';
import type { Sample } from './probe.ts';

const WIDTH = 1600;
const HEIGHT = 900;
const SAMPLE_MS = 5000;
/** Drift beyond this and the run is reported as untrustworthy, not as a result. */
const DRIFT_TOLERANCE = 0.1;
/**
 * Opening samples are not steady state. Five samples of identical configuration
 * on an idle RTX 4080 SUPER ran 48.9, 49.3, 38.7, 29.3, 23.5 ms, and the trend
 * fit then called a run that was settling down a machine that would not hold
 * still. These are printed and excluded from the median and the fit.
 */
const WARMUP_SAMPLES = 2;

function flagValue(name: string): string | undefined {
	const index = argv.indexOf(name);
	if (index < 0) return undefined;
	return argv[index + 1];
}

const saveAs = flagValue('--save');
const compareTo = flagValue('--compare');
const sampleCount = Math.max(WARMUP_SAMPLES + 3, Number(flagValue('--samples') ?? 5));

type Run = {
	gpu: string;
	canvas: string;
	megapixels: number;
	pointLights: number;
	wallMsMedian: number;
	gpuMsPerFrame: number;
	drawsPerFrame: number;
	/** Slope of wall time across the measured samples, as a fraction of the median. */
	driftFraction: number;
	/** Every sample taken, warm-up first. */
	samples: number[];
	warmupSamples: number;
};

/**
 * Least-squares slope over the samples, normalised by the median, so it reads as
 * "the machine got N% slower per sample" regardless of the absolute scale.
 */
function driftFraction(values: number[]): number {
	const n = values.length;
	if (n < 2) return 0;
	const meanX = (n - 1) / 2;
	const meanY = values.reduce((a, b) => a + b, 0) / n;
	let numerator = 0;
	let denominator = 0;
	for (let i = 0; i < n; i++) {
		const y = values[i];
		if (y === undefined) continue;
		numerator += (i - meanX) * (y - meanY);
		denominator += (i - meanX) ** 2;
	}
	if (denominator === 0 || meanY === 0) return 0;
	return numerator / denominator / meanY;
}

async function readBaseline(name: string): Promise<Run | null> {
	let source: string;
	try {
		source = await readFile(resolve(BASELINE_DIR, `${name}.json`), 'utf8');
	} catch (error) {
		if (typeof error === 'object' && error !== null && Reflect.get(error, 'code') === 'ENOENT') return null;
		throw error;
	}
	const parsed: unknown = JSON.parse(source);
	if (typeof parsed !== 'object' || parsed === null) return null;
	const read = (key: string, fallback: number): number => {
		const value = Reflect.get(parsed, key);
		return typeof value === 'number' ? value : fallback;
	};
	const readText = (key: string): string => {
		const value = Reflect.get(parsed, key);
		return typeof value === 'string' ? value : '?';
	};
	const rawSamples = Reflect.get(parsed, 'samples');
	return {
		gpu: readText('gpu'),
		canvas: readText('canvas'),
		megapixels: read('megapixels', 0),
		pointLights: read('pointLights', 0),
		wallMsMedian: read('wallMsMedian', 0),
		gpuMsPerFrame: read('gpuMsPerFrame', 0),
		drawsPerFrame: read('drawsPerFrame', 0),
		driftFraction: read('driftFraction', 0),
		samples: Array.isArray(rawSamples) ? rawSamples.filter((v): v is number => typeof v === 'number') : [],
		warmupSamples: read('warmupSamples', 0),
	};
}

const session = await openGame(WIDTH, HEIGHT, argv.includes('--fresh-profile'), undefined, flagValue('--batch-mode'));
let run: Run;
const warnings: string[] = [];

try {
	const { readyMs, settleMs } = await session.boot();
	const env = await session.environment();
	console.log(`\n${env.renderer}`);
	console.log(
		`${env.canvas} · ${env.numPointLights} point lights · ready in ${(readyMs / 1000).toFixed(1)}s (+${(settleMs / 1000).toFixed(1)}s settle)\n`,
	);

	const taken: Sample[] = [];
	for (let i = 0; i < sampleCount; i++) {
		const sample = await session.sample(SAMPLE_MS);
		taken.push(sample);
		const warmup = i < WARMUP_SAMPLES;
		console.log(
			`  sample ${i + 1}/${sampleCount}  ${sample.wallMsMedian.toFixed(1).padStart(7)} ms wall  ${sample.gpuMsPerFrame.toFixed(1).padStart(7)} ms GPU  ${sample.frames} frames${warmup ? '   warm-up, not counted' : ''}`,
		);
		if (warmup) continue;
		for (const warning of sampleWarnings(sample)) warnings.push(`sample ${i + 1}: ${warning}`);
	}

	const measured = taken.slice(WARMUP_SAMPLES);
	const walls = measured.map((s) => s.wallMsMedian);
	run = {
		gpu: env.renderer,
		canvas: env.canvas,
		megapixels: env.megapixels,
		pointLights: env.numPointLights,
		wallMsMedian: median(walls),
		gpuMsPerFrame: median(measured.map((s) => s.gpuMsPerFrame)),
		drawsPerFrame: median(measured.map((s) => s.drawsPerFrame)),
		driftFraction: driftFraction(walls),
		samples: taken.map((s) => s.wallMsMedian),
		warmupSamples: WARMUP_SAMPLES,
	};
} finally {
	await session.close();
}

const driftPercent = run.driftFraction * 100;
const stable = Math.abs(run.driftFraction) <= DRIFT_TOLERANCE;

console.log(`\n${trimToColumns('── result ──────────────────────────────────────────────────')}`);
console.log(
	bar('wall time', `${run.wallMsMedian.toFixed(1)} ms  (${(1000 / Math.max(run.wallMsMedian, 0.001)).toFixed(1)} fps)`),
);
console.log(bar('GPU time', `${run.gpuMsPerFrame.toFixed(1)} ms`));
console.log(bar('draw calls', run.drawsPerFrame.toFixed(0)));
console.log(
	bar('drift per sample', `${driftPercent >= 0 ? '+' : ''}${driftPercent.toFixed(1)}%  ${stable ? '✓ stable' : '✗ DRIFTING'}`),
);

if (!stable && run.driftFraction > 0) {
	console.log('');
	console.log('  ✗ This machine did not hold still. Frame time rose consistently across');
	console.log('    identical samples, so any comparison against another run is noise.');
	console.log('    Let it cool, close other work, and measure again, or measure elsewhere.');
}
if (!stable && run.driftFraction < 0) {
	console.log('');
	console.log(`  ✗ Frame time was still falling after ${WARMUP_SAMPLES} warm-up samples, so this run never`);
	console.log('    reached steady state and its median is an average of a moving target.');
	console.log(`    Measure again with more samples: bun run bench --samples ${sampleCount + 3}`);
}
for (const warning of warnings) console.log(`  ⚠ ${warning}`);

if (compareTo) {
	const baseline = await readBaseline(compareTo);
	console.log(`\n${trimToColumns('── comparison ──────────────────────────────────────────────')}`);
	if (!baseline) {
		console.log(`  ✗ no stored baseline called '${compareTo}' — run \`bun run bench --save ${compareTo}\` first`);
		process.exitCode = 1;
	} else {
		const change = (run.wallMsMedian - baseline.wallMsMedian) / Math.max(baseline.wallMsMedian, 0.001);
		console.log(bar('baseline', `${baseline.wallMsMedian.toFixed(1)} ms on ${baseline.gpu}`));
		console.log(bar('now', `${run.wallMsMedian.toFixed(1)} ms`));
		console.log(bar('change', `${change >= 0 ? '+' : ''}${(change * 100).toFixed(1)}%  ${change < 0 ? 'faster' : 'slower'}`));

		if (baseline.gpu !== run.gpu || baseline.canvas !== run.canvas) {
			console.log('  ✗ different GPU or canvas size than the baseline — not comparable');
			process.exitCode = 1;
		} else if (baseline.pointLights !== run.pointLights) {
			console.log(`  · light count changed ${baseline.pointLights} → ${run.pointLights}, which is most likely the cause`);
		}
		// The honest bar: a change smaller than the machine's own wobble is not a
		// result, however much one would like it to be.
		const wobble = Math.max(Math.abs(run.driftFraction), Math.abs(baseline.driftFraction));
		if (Math.abs(change) < wobble) {
			console.log(
				`  ⚠ the change (${(Math.abs(change) * 100).toFixed(1)}%) is smaller than the measurement drift (${(wobble * 100).toFixed(1)}%) — inconclusive`,
			);
		}
	}
}

if (saveAs) {
	await mkdir(BASELINE_DIR, { recursive: true });
	await writeFile(resolve(BASELINE_DIR, `${saveAs}.json`), `${JSON.stringify(run, null, '\t')}\n`);
	console.log(`\n  saved as '${saveAs}'${stable ? '' : ' (drifting — treat with suspicion)'}`);
}
console.log('');
