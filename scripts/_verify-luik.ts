import { serveGame } from './perf/harness.ts';
import { launchPerfBrowser } from './perf/playwright.ts';
import { probeSource } from './perf/probe.ts';

const UIT = '/home/kjanat/.claude/jobs/8868c721/tmp';
const server = await serveGame();
const browser = await launchPerfBrowser(1280, 720);
try {
	await browser.page.addInitScript({ content: probeSource() });
	await browser.page.goto(server.url, { waitUntil: 'commit' });
	await browser.page.evaluate('__mallProbe.ready(120000)');
	await browser.page.evaluate('__mallProbe.settle(3000, 120000)');

	const kajPose = { x: 25.9, y: 15.6, z: 19.8, lookX: 26, lookY: 14.1, lookZ: 13.5 };
	await browser.page.evaluate(`__mallProbe.setPose(${JSON.stringify(kajPose)})`);
	await browser.page.evaluate('__mallProbe.waitFrames(240)');
	await browser.page.screenshot({ path: `${UIT}/luik-bij-kajpose.png` });

	const ver = { x: 26, y: 15.6, z: 33, lookX: 26, lookY: 14.1, lookZ: 13.5 };
	await browser.page.evaluate(`__mallProbe.setPose(${JSON.stringify(ver)})`);
	await browser.page.evaluate('__mallProbe.waitFrames(300)');
	await browser.page.screenshot({ path: `${UIT}/luik-af-ver.png` });
} finally {
	try {
		await browser.close();
	} finally {
		await server.stop();
	}
}
console.log('screenshots: luik-bij-kajpose.png en luik-af-ver.png');
