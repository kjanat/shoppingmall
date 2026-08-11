import { serveGame } from './perf/harness.ts';
import { launchPerfBrowser } from './perf/playwright.ts';
import { probeSource } from './perf/probe.ts';

const UIT = process.env['SHOT_DIR'] ?? '/home/kjanat/.claude/jobs/8868c721/tmp';
const server = await serveGame();
const browser = await launchPerfBrowser(1280, 720);

async function shot(name: string, pose: Record<string, number>, frames = 90): Promise<void> {
	await browser.page.evaluate(`__mallProbe.setPose(${JSON.stringify(pose)})`);
	await browser.page.evaluate(`__mallProbe.waitFrames(${frames})`);
	await browser.page.screenshot({ path: `${UIT}/${name}.png` });
	console.log('shot', name);
}

try {
	await browser.page.addInitScript({ content: probeSource() });
	await browser.page.goto(server.url, { waitUntil: 'commit' });
	await browser.page.evaluate('__mallProbe.ready(120000)');
	await browser.page.evaluate('__mallProbe.settle(3000, 120000)');

	// #23 — na de glijbaan: zwem-standpose (voeten 12.9, camera ~14.36) en de release-dip (camera 13.7).
	await shot('t23-zwem-oost', { x: -22.3, y: 14.36, z: 0.9, lookX: 40, lookY: 12, lookZ: 0.9 });
	await shot('t23-zwem-ingang', { x: -22.3, y: 14.36, z: 0.9, lookX: -50, lookY: 8, lookZ: 0.9 });
	await shot('t23-dip-ingang', { x: -22.3, y: 13.7, z: 0.9, lookX: -50, lookY: 8, lookZ: 0.9 });
	await shot('t23-dip-omlaag', { x: -22.3, y: 13.7, z: 0.9, lookX: -22.3, lookY: 6, lookZ: 20 });

	// #29 — V1-balustrade omlaag kijkend naar V0 door het atriumgat, heading-sweep.
	await shot('t29-omlaag-noord', { x: 0, y: 7.7, z: 7.5, lookX: 0, lookY: 0, lookZ: 0 });
	await shot('t29-omlaag-west', { x: 7, y: 7.7, z: 0, lookX: 0, lookY: 0, lookZ: 0 });
	await shot('t29-roltrap', { x: 6, y: 7.7, z: -8, lookX: 0, lookY: 0, lookZ: 2 });

	// #28 — foodcourt (0, 6, 11.5): sims lopen door, dus even wachten en meerdere frames.
	await shot('t28-foodcourt-a', { x: 0, y: 7.6, z: 4, lookX: 0, lookY: 6.2, lookZ: 11.5 }, 240);
	await shot('t28-foodcourt-b', { x: -6, y: 7.6, z: 6, lookX: 2, lookY: 6.2, lookZ: 12 }, 240);
	await shot('t28-foodcourt-laag', { x: 0, y: 6.9, z: 6, lookX: 0, lookY: 6.4, lookZ: 12 }, 240);
} finally {
	try {
		await browser.close();
	} finally {
		await server.stop();
	}
}
console.log('done');
