#!/usr/bin/env node
/**
 * Traverse the same camera route repeatedly and report where frame cost changes.
 * Each lap repeats identical segments, so a hot spot and machine drift can be
 * separated instead of being collapsed into one whole-run average.
 */
import { spawnSync } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { bar, openGame, sampleWarnings } from './harness.ts';
import { trimToColumns } from './out.ts';
import { isSoftwareHeadless } from './playwright.ts';
import type { RoutePose, Sample } from './probe.ts';
import { FULL_MALL_ROUTE, profileRoute } from './routes.ts';
import { median } from './stats.ts';
import { isRecord, readArray, readNumber, readString } from './values.ts';

const softwareHeadless = isSoftwareHeadless();
const WIDTH = softwareHeadless ? 800 : 1600;
const HEIGHT = softwareHeadless ? 450 : 900;
const DRIFT_TOLERANCE = 0.15;
const OUTPUT_DIR = resolve(import.meta.dirname, '../../.perf/routes');

function flagValue(name: string): string | undefined {
	const index = process.argv.indexOf(name);
	return index < 0 ? undefined : process.argv[index + 1];
}

function positiveNumber(name: string, fallback: number): number {
	const value = Number(flagValue(name) ?? fallback);
	if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
	return value;
}

function uint32(name: string, value: string): number {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 0 || parsed > 0xffff_ffff) {
		throw new Error(`${name} must be an integer from 0 through 4294967295`);
	}
	return parsed;
}

function distance(a: RoutePose, b: RoutePose): number {
	return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

type SegmentResult = { id: string; from: string; to: string; lap: number; durationMs: number; sample: Sample };
type RouteArtifact = {
	format: 1;
	createdAt: string;
	build: string;
	target: string;
	route: string;
	description: string;
	gpu: string;
	canvas: string;
	batchMode: string;
	speedMetersPerSecond: number;
	laps: number;
	seed: number | null;
	simulationFrozen: boolean;
	segments: SegmentResult[];
};
type RouteBaseline = {
	build: string;
	gpu: string;
	canvas: string;
	batchMode: string;
	segments: Map<string, number>;
};

function localBuild(): string {
	const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: resolve(import.meta.dirname, '../..'), encoding: 'utf8' });
	return result.status === 0 ? result.stdout.trim() : 'unknown';
}

async function buildIdentity(url?: string): Promise<string> {
	if (!url) return localBuild();
	try {
		const response = await fetch(`${new URL(url).origin}/api/statusz`);
		const body: unknown = await response.json();
		return isRecord(body) ? readString(body, 'version', 'unknown') : 'unknown';
	} catch {
		return 'unknown';
	}
}

function segmentChange(first: SegmentResult, repeated: SegmentResult): number {
	return (repeated.sample.wallMsMedian - first.sample.wallMsMedian) / Math.max(first.sample.wallMsMedian, 0.001);
}

function safeName(value: string): string {
	return value.replaceAll(/[^a-zA-Z0-9._-]/g, '-');
}

function aggregateSegments(segments: readonly SegmentResult[]): Map<string, number> {
	const values = new Map<string, number[]>();
	for (const segment of segments) {
		const existing = values.get(segment.id);
		if (existing) existing.push(segment.sample.wallMsMedian);
		else values.set(segment.id, [segment.sample.wallMsMedian]);
	}
	return new Map([...values].map(([id, samples]) => [id, median(samples)]));
}

async function readBaseline(name: string): Promise<RouteBaseline | null> {
	let source: string;
	try {
		source = await readFile(resolve(OUTPUT_DIR, `${safeName(name)}.json`), 'utf8');
	} catch (error) {
		if (isRecord(error) && readString(error, 'code') === 'ENOENT') return null;
		throw error;
	}
	const parsed: unknown = JSON.parse(source);
	if (!isRecord(parsed)) return null;
	const values = new Map<string, number[]>();
	for (const entry of readArray(parsed, 'segments')) {
		if (!isRecord(entry) || !isRecord(entry['sample'])) continue;
		const id = readString(entry, 'id');
		const wall = readNumber(entry['sample'], 'wallMsMedian', Number.NaN);
		if (!id || !Number.isFinite(wall)) continue;
		const existing = values.get(id);
		if (existing) existing.push(wall);
		else values.set(id, [wall]);
	}
	return {
		build: readString(parsed, 'build', 'unknown'),
		gpu: readString(parsed, 'gpu', 'unknown'),
		canvas: readString(parsed, 'canvas', 'unknown'),
		batchMode: readString(parsed, 'batchMode', 'unknown'),
		segments: new Map([...values].map(([id, samples]) => [id, median(samples)])),
	};
}

const targetUrl = flagValue('--url');
const batchOverride = flagValue('--batch-mode');
const laps = Math.max(1, Math.floor(positiveNumber('--laps', 2)));
const speed = positiveNumber('--speed', softwareHeadless ? 30 : 4.5);
const saveName = flagValue('--save');
const compareName = flagValue('--compare');
const randomRoute = process.argv.includes('--random');
const seedValue = flagValue('--seed');
if (randomRoute && seedValue !== undefined) throw new Error('use either --random or --seed, not both');
const seed = randomRoute ? randomInt(0, 0x1_0000_0000) : seedValue === undefined ? null : uint32('--seed', seedValue);
const route = profileRoute(flagValue('--route') ?? FULL_MALL_ROUTE.id, seed);
const startPoint = route.points[0];
if (!startPoint) throw new Error(`route '${route.id}' has no points`);
const freezeSimulation = !process.argv.includes('--live-sim');
const session = await openGame(WIDTH, HEIGHT, process.argv.includes('--fresh-profile'), targetUrl, batchOverride);
const results: SegmentResult[] = [];
let artifact: RouteArtifact;

try {
	const { readyMs, settleMs } = await session.boot({ settleQuietMs: 3000 });
	await session.setFrozen(freezeSimulation);
	await session.setPose(startPoint.pose);
	await session.waitFrames(10);
	const env = await session.environment();
	const build = await buildIdentity(targetUrl);

	console.log(`\n${trimToColumns('── route profile ───────────────────────────────────────────')}`);
	console.log(bar('target', targetUrl ?? 'local dist/static'));
	console.log(bar('build', build));
	console.log(bar('GPU', env.renderer));
	console.log(bar('canvas', env.canvas));
	console.log(bar('route', `${route.id}: ${route.description}`));
	console.log(bar('route seed', route.seed === null ? 'deterministic authored order' : String(route.seed)));
	console.log(
		bar(
			'configuration',
			`${laps} laps, ${speed} m/s, ${env.batchMode} batches, simulation ${freezeSimulation ? 'frozen' : 'live'}`,
		),
	);
	console.log(bar('startup', `${(readyMs / 1000).toFixed(1)} s + ${(settleMs / 1000).toFixed(1)} s settle`));

	for (let lap = 1; lap <= laps; lap++) {
		console.log(`\n  lap ${lap}/${laps}`);
		for (let i = 0; i + 1 < route.points.length; i++) {
			const from = route.points[i];
			const to = route.points[i + 1];
			if (!from || !to) continue;
			const id = `${from.name}->${to.name}`;
			const durationMs = Math.max(750, Math.round((distance(from.pose, to.pose) / speed) * 1000));
			const sample = await session.routeSegment(from.pose, to.pose, durationMs);
			const result = { id, from: from.name, to: to.name, lap, durationMs, sample };
			results.push(result);
			console.log(
				`    ${id.padEnd(38)} ${sample.wallMsMedian.toFixed(1).padStart(7)} ms wall  ${sample.wallMsP90.toFixed(1).padStart(7)} p90  ${sample.gpuMsPerFrame.toFixed(1).padStart(7)} GPU  ${sample.drawsPerFrame.toFixed(0).padStart(4)} draws  ${Math.round(
					sample.trianglesPerFrame / 1000,
				)
					.toString()
					.padStart(4)}k tris`,
			);
			for (const warning of sampleWarnings(sample)) console.log(`      warning: ${warning}`);
		}
	}

	artifact = {
		format: 1,
		createdAt: new Date().toISOString(),
		build,
		target: targetUrl ?? 'local dist/static',
		route: route.id,
		description: route.description,
		gpu: env.renderer,
		canvas: env.canvas,
		batchMode: env.batchMode,
		speedMetersPerSecond: speed,
		laps,
		seed: route.seed,
		simulationFrozen: freezeSimulation,
		segments: results,
	};
} finally {
	await session.close();
}

console.log(`\n${trimToColumns('── route hotspots ──────────────────────────────────────────')}`);
for (const result of [...results].sort((a, b) => b.sample.wallMsP90 - a.sample.wallMsP90).slice(0, 5)) {
	console.log(
		bar(
			result.id,
			`${result.sample.wallMsP90.toFixed(1)} ms p90, ${result.sample.gpuMsPerFrame.toFixed(1)} GPU, ${result.sample.cpuLogicMsMean.toFixed(1)}/${result.sample.cpuBatchMsMean.toFixed(1)}/${result.sample.cpuSubmitMsMean.toFixed(1)} ms CPU`,
		),
	);
}

if (laps > 1) {
	console.log(`\n${trimToColumns('── repeated-checkpoint drift ───────────────────────────────')}`);
	const firstLap = results.filter((result) => result.lap === 1);
	const lastLap = results.filter((result) => result.lap === laps);
	const changes: number[] = [];
	for (const first of firstLap) {
		const repeated = lastLap.find((result) => result.id === first.id);
		if (!repeated) continue;
		const change = segmentChange(first, repeated);
		changes.push(change);
		const stable = Math.abs(change) <= DRIFT_TOLERANCE;
		console.log(bar(first.id, `${change >= 0 ? '+' : ''}${(change * 100).toFixed(1)}% ${stable ? 'stable' : 'DRIFTING'}`));
	}
	const routeDrift = median(changes);
	console.log(bar('median route drift', `${routeDrift >= 0 ? '+' : ''}${(routeDrift * 100).toFixed(1)}%`));
}

if (compareName) {
	console.log(`\n${trimToColumns('── saved-run comparison ────────────────────────────────────')}`);
	const baseline = await readBaseline(compareName);
	if (!baseline) {
		console.log(`  missing baseline '${compareName}'; create it with --save ${compareName}`);
		process.exitCode = 1;
	} else {
		console.log(bar('baseline build', baseline.build));
		const comparable =
			baseline.gpu === artifact.gpu && baseline.canvas === artifact.canvas && baseline.batchMode === artifact.batchMode;
		if (!comparable) {
			console.log('  configuration differs in GPU, canvas, or batch mode; percentages are informational only');
			process.exitCode = 1;
		}
		const current = aggregateSegments(results);
		for (const [id, wall] of current) {
			const before = baseline.segments.get(id);
			if (before === undefined) continue;
			const change = (wall - before) / Math.max(before, 0.001);
			console.log(
				bar(id, `${change >= 0 ? '+' : ''}${(change * 100).toFixed(1)}% (${before.toFixed(1)} -> ${wall.toFixed(1)} ms)`),
			);
		}
	}
}

await mkdir(OUTPUT_DIR, { recursive: true });
const timestamp = artifact.createdAt.replaceAll(/[:.]/g, '-');
const automaticPath = resolve(OUTPUT_DIR, `${timestamp}-${artifact.build.slice(0, 12)}.json`);
await writeFile(automaticPath, `${JSON.stringify(artifact, null, '\t')}\n`);
console.log(`\n  artifact: ${automaticPath}`);
if (saveName) {
	const namedPath = resolve(OUTPUT_DIR, `${safeName(saveName)}.json`);
	await writeFile(namedPath, `${JSON.stringify(artifact, null, '\t')}\n`);
	console.log(`  saved as: ${namedPath}`);
}
console.log('');
