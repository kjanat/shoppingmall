import { mkdir } from 'node:fs/promises';
import { LEVELS_BOTTOM_UP } from '#/data/levels';
import { serveGame } from './harness.ts';
import { launchPerfBrowser } from './playwright.ts';
import { probeSource } from './probe.ts';

const OUT = process.argv[2] ?? '.perf/shots';
await mkdir(OUT, { recursive: true });

const server = await serveGame();
const browser = await launchPerfBrowser(1500, 1100);
await browser.page.addInitScript({ content: probeSource() });

await browser.page.goto(server.url, { waitUntil: 'commit' });
await browser.page.evaluate('__mallProbe.ready(180000)');
await browser.page.evaluate('__mallProbe.settle(3000, 120000)');
await browser.page.evaluate('__mallProbe.setFrozen(true)');

await browser.page.keyboard.press('KeyM');
await browser.page.waitForSelector('#bigmap:not(.hidden)', { timeout: 20_000 });

const tabs = await browser.page.$$('#bigmap-tabs .bigmap-tab');
console.log(`tabbladen: ${tabs.length}`);
for (const tab of tabs) console.log(`  ${await tab.textContent()}`);

for (const [index, deck] of LEVELS_BOTTOM_UP.entries()) {
	const tab = tabs[index];
	if (!tab) {
		console.log(`GEEN TABBLAD voor ${deck.id}`);
		continue;
	}
	await tab.evaluate((element: HTMLElement) => element.click());
	await browser.page.waitForTimeout(900);
	await browser.page.screenshot({ path: `${OUT}/plattegrond-${deck.id}.png`, animations: 'disabled', timeout: 120_000 });
	console.log(`geschreven: ${OUT}/plattegrond-${deck.id}.png`);
}

await browser.page.keyboard.press('KeyM');
await browser.page.waitForTimeout(600);
await browser.page.screenshot({ path: `${OUT}/minimap-hud.png`, animations: 'disabled', timeout: 120_000 });
console.log(`geschreven: ${OUT}/minimap-hud.png`);

await browser.close();
await server.stop();
