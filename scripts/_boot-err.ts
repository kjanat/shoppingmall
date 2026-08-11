import { serveGame } from './perf/harness.ts';
import { launchPerfBrowser } from './perf/playwright.ts';

const server = await serveGame();
const browser = await launchPerfBrowser(900, 600);
const errs: string[] = [];
browser.page.on('console', (m) => {
	if (m.type() === 'error' || m.type() === 'warning') errs.push(`[${m.type()}] ${m.text()}`);
});
browser.page.on('pageerror', (e) => errs.push(`[pageerror] ${e.message}\n${e.stack ?? ''}`));
try {
	await browser.page.goto(server.url, { waitUntil: 'commit' });
	await new Promise((r) => setTimeout(r, 6000));
} finally {
	try {
		await browser.close();
	} finally {
		await server.stop();
	}
}
console.log(errs.slice(0, 20).join('\n---\n') || 'no errors');
process.exit(0);
