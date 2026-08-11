#!/usr/bin/env node
import { blue, dim } from 'ansispeck/safe';
import { serveGame } from './perf/harness.ts';
import { launchPerfBrowser } from './perf/playwright.ts';
import { probeSource } from './perf/probe.ts';

const OUT = '/home/kjanat/.claude/jobs/8868c721/tmp';
const VIEWPORT = { width: 1500, height: 1100 } as const;
const SHOT_TIMEOUT_MS = 180_000;
const STEP_FRAMES = 30;
const SWEEP = 4;

type Pose = { x: number; y: number; z: number; lookX: number; lookY: number; lookZ: number };

const FRONT: Pose = { x: 32.4, y: 1.5, z: 18, lookX: 32.4, lookY: 1.2, lookZ: 10 };
const BACK: Pose = { x: 32.4, y: 1.5, z: 5, lookX: 32.4, lookY: 1.2, lookZ: 10 };
const EDGE: Pose = { x: 29.5, y: 4.5, z: 6, lookX: 31.05, lookY: 0.34, lookZ: 12 };

const server = await serveGame();
const browser = await launchPerfBrowser(VIEWPORT.width, VIEWPORT.height);
try {
	const page = browser.page;
	await page.addInitScript({ content: probeSource(undefined, false) });
	await page.goto(server.url, { waitUntil: 'commit' });
	await page.evaluate('__mallProbe.ready(180000)');
	await page.evaluate('__mallProbe.settle(3000, 120000)');
	await page.waitForSelector('#app-loading', { state: 'detached', timeout: 120_000 });

	// Sluit de kiosk / start het spel: klik in het scène-gebied (rechts-midden, geen paneel).
	await page.mouse.click(1120, 560);
	await page.waitForTimeout(600);

	const status = (): Promise<string> => page.evaluate(() => document.getElementById('status')?.textContent ?? '');
	await page.evaluate(`__mallProbe.setPose(${JSON.stringify(FRONT)})`);
	await page.evaluate('__mallProbe.setFrozen(true)');

	const shoot = async (name: string, pose: Pose): Promise<void> => {
		await page.evaluate(`__mallProbe.setPose(${JSON.stringify(pose)})`);
		await page.evaluate('__mallProbe.waitFrames(6)');
		await page.waitForTimeout(1200);
		const path = `${OUT}/${name}.png`;
		await page.screenshot({ path, animations: 'disabled', timeout: SHOT_TIMEOUT_MS });
		console.log(blue`${path}`);
	};

	console.log(dim`na klik: ${await status()}`);
	for (let i = 0; i < SWEEP; i++) {
		await page.evaluate('__mallProbe.setFrozen(false)');
		await page.evaluate(`__mallProbe.waitFrames(${STEP_FRAMES})`);
		await page.evaluate('__mallProbe.setFrozen(true)');
		console.log(dim`stap ${i}: ${await status()}`);
		await page.evaluate(`{ const ui = document.getElementById('ui-root'); if (ui) ui.style.display = 'none'; }`);
		await shoot(`catwalk-front-${i}`, FRONT);
		await shoot(`catwalk-back-${i}`, BACK);
		await page.evaluate(`{ const ui = document.getElementById('ui-root'); if (ui) ui.style.display = ''; }`);
	}
	await page.evaluate(`{ const ui = document.getElementById('ui-root'); if (ui) ui.style.display = 'none'; }`);
	await shoot('catwalk-led-edge', EDGE);
} finally {
	await browser.close();
	await server.stop();
}
