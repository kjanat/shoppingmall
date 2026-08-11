#!/usr/bin/env node
import { mkdir } from 'node:fs/promises';
import { argv } from 'node:process';
import { blue } from 'ansispeck/safe';
import { serveGame } from './perf/harness.ts';
import { launchPerfBrowser } from './perf/playwright.ts';
import { probeSource } from './perf/probe.ts';

const VIEWPORT = { width: 1500, height: 1100 } as const;
const SHOT_TIMEOUT_MS = 180_000;
const REPAINT_MS = 900;

const POSES = [
	{ name: 'a-ring-eye', x: 0, y: 1.7, z: 46, lookX: 0, lookY: 9, lookZ: 104 },
	{ name: 'b-high-oblique', x: -74, y: 44, z: 38, lookX: 0, lookY: 10, lookZ: 104 },
	{ name: 'c-inside-cavea', x: 0, y: 8, z: 110, lookX: 0, lookY: 11, lookZ: 78 },
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
