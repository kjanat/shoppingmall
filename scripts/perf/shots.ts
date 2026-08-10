#!/usr/bin/env node
/**
 * Rendert de plattegrond van elk dek, plus de HUD met de ronde minimap, uit de
 * gebouwde game.
 *
 * check-world dwingt af dat een plek geometrie heeft en dat elk dek een tabblad
 * krijgt. Het kan niet zien hoe het eruitziet. Alle 17 controles stonden groen
 * terwijl het woord DAK in het atriumgat stond, GEBEDSRUIMTE dwars over zijn
 * eigen muren liep, de parkeeruitrit door de kaartrand werd afgesneden en de
 * autohelling een roltrapicoon droeg. Vier fouten die alleen zichtbaar zijn op
 * een plaatje, dus is er een plaatje.
 *
 * De scene wordt bevroren voordat er geschoten wordt: op de softwarerasterizer
 * duurt een frame lang genoeg dat Playwright zijn eigen screenshot-timeout haalt.
 *
 *   bun scripts/perf/shots.ts [uitvoermap]
 *   MALL_PERF_SOFTWARE=1 bun scripts/perf/shots.ts    # zonder GPU
 */
import { mkdir } from 'node:fs/promises';
import { argv } from 'node:process';
import { blue, dim } from 'ansispeck/safe';
import { LEVELS_BOTTOM_UP } from '#/data/levels';
import { serveGame } from './harness.ts';
import { SHOTS_DIR } from './paths.ts';
import { launchPerfBrowser } from './playwright.ts';
import { probeSource } from './probe.ts';
import { profilePoint } from './routes.ts';

/**
 * Standpunten in 3D. Elke plattegrond hier is 2D, dus reparaties die alleen in 3D
 * te zien zijn bleven onbewezen: de dekplaat van de helipad en de zandplaat lagen
 * allebei mét hun bovenkant ín de dakplaat en flikkerden daar over tientallen
 * vierkante meters mee. De eerste twee kijken op die naad. Het derde staat op de
 * stoep voor de hoofdingang, want een portaal, een luifel en een gevelbelettering
 * zijn op een plattegrond samen één streep.
 */
const SCENE_VIEWS = ['roof-helipad', 'roof-west', 'v0-entrance-street'] as const;

const VIEWPORT = { width: 1500, height: 1100 } as const;
/** Ruim boven een frame op de softwarerasterizer, waar een schot anders afbreekt. */
const SHOT_TIMEOUT_MS = 120_000;
/** Na een tabwissel herschildert de kaart op de volgende frame. */
const REPAINT_MS = 900;

const outputDir = argv[2] ?? SHOTS_DIR;
await mkdir(outputDir, { recursive: true });

const server = await serveGame();
const browser = await launchPerfBrowser(VIEWPORT.width, VIEWPORT.height);
try {
	await browser.page.addInitScript({ content: probeSource() });
	await browser.page.goto(server.url, { waitUntil: 'commit' });
	await browser.page.evaluate('__mallProbe.ready(180000)');
	await browser.page.evaluate('__mallProbe.settle(3000, 120000)');
	await browser.page.evaluate('__mallProbe.setFrozen(true)');

	await browser.page.keyboard.press('KeyM');
	await browser.page.waitForSelector('#bigmap:not(.hidden)', { timeout: 20_000 });

	const tabs = await browser.page.$$('#bigmap-tabs .bigmap-tab');
	console.log(dim`${tabs.length} tabbladen voor ${LEVELS_BOTTOM_UP.length} dekken`);

	for (const [index, deck] of LEVELS_BOTTOM_UP.entries()) {
		const tab = tabs[index];
		if (!tab) {
			// Precies hoe P1 van de kaart verdween: het dek bestaat, het tabblad niet.
			console.log(`${deck.code} heeft geen tabblad — dit dek is onvindbaar voor de speler`);
			continue;
		}
		const label = await tab.textContent();
		if (label?.trim() !== deck.name) {
			console.log(`tabblad ${index} heet "${label?.trim()}" maar staat op de plek van ${deck.name}`);
		}
		// Playwright's eigen click() wacht daarna op navigatie die nooit komt en valt
		// in zijn timeout; de handler zelf aanroepen doet wat de speler doet.
		await tab.evaluate((element: HTMLElement) => element.click());
		await browser.page.waitForTimeout(REPAINT_MS);
		const path = `${outputDir}/plattegrond-${deck.id}.png`;
		await browser.page.screenshot({ path, animations: 'disabled', timeout: SHOT_TIMEOUT_MS });
		console.log(blue`${path}`);
	}

	await browser.page.keyboard.press('KeyM');
	await browser.page.waitForTimeout(REPAINT_MS);
	const hudPath = `${outputDir}/minimap-hud.png`;
	await browser.page.screenshot({ path: hudPath, animations: 'disabled', timeout: SHOT_TIMEOUT_MS });
	console.log(blue`${hudPath}`);

	for (const name of SCENE_VIEWS) {
		const { pose } = profilePoint(name);
		await browser.page.evaluate(`__mallProbe.setPose(${JSON.stringify(pose)})`);
		await browser.page.waitForTimeout(REPAINT_MS);
		const path = `${outputDir}/${name}.png`;
		await browser.page.screenshot({ path, animations: 'disabled', timeout: SHOT_TIMEOUT_MS });
		console.log(blue`${path}`);
	}
} finally {
	await browser.close();
	await server.stop();
}
