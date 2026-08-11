#!/usr/bin/env node
import { mkdir } from 'node:fs/promises';
import { argv } from 'node:process';
import { blue } from 'ansispeck/safe';
import { serveGame } from './perf/harness.ts';
import { launchPerfBrowser } from './perf/playwright.ts';
import { probeSource } from './perf/probe.ts';

const VIEWPORT = { width: 1500, height: 1100 } as const;
const SHOT_TIMEOUT_MS = 300_000;
const REPAINT_MS = 900;

const POSES = [
	{ name: 'c1-midtribune', x: 0, y: 10.5, z: 133, lookX: 0, lookY: 7, lookZ: 74 },
	{ name: 'c2-arenafloor', x: 0, y: 2.5, z: 114, lookX: 0, lookY: 12, lookZ: 80 },
] as const;

const outputDir = argv[2] ?? '/home/kjanat/.claude/jobs/8868c721/tmp';
await mkdir(outputDir, { recursive: true });

const server = await serveGame();
const browser = await launchPerfBrowser(VIEWPORT.width, VIEWPORT.height);
try {
	await browser.page.addInitScript({ content: probeSource() });
	await browser.page.goto(server.url, { waitUntil: 'commit' });
	await browser.page.evaluate('__mallProbe.ready(180000)');
	await browser.page.evaluate('__mallProbe.settle(3000, 120000)');
	await browser.page.evaluate('__mallProbe.setFrozen(true)');
	await browser.page.waitForSelector('#app-loading', { state: 'detached', timeout: 120_000 });
	await browser.page.addStyleTag({ content: '#ui-root{display:none!important}' });

	for (const pose of POSES) {
		await browser.page.evaluate(`__mallProbe.setPose(${JSON.stringify(pose)})`);
		await browser.page.evaluate('__mallProbe.waitFrames(10)');
		await browser.page.waitForTimeout(REPAINT_MS);
		const path = `${outputDir}/colosseum-${pose.name}.png`;
		await browser.page.screenshot({ path, animations: 'disabled', timeout: SHOT_TIMEOUT_MS });
		console.log(blue`${path}`);
	}
} finally {
	await browser.close();
	await server.stop();
}
