/**
 * The single browser lifecycle used by diagnose, bench and profile.
 *
 * Playwright owns the browser process and protocol. This file only chooses the
 * executable and GPU flags, enforces exclusive measurement, and manages the
 * persistent shader-cache profile shared by repeated runs.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, open, readFile, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { type BrowserContext, chromium, type Page } from 'playwright';
import { isRecord, readString } from './values.ts';

const PERF_DIR = resolve(import.meta.dirname, '../../.perf');
const LOCK_PATH = join(PERF_DIR, 'browser.lock');
const MCP_PROFILE_FRAGMENT = String.raw`\.cache\chrome-devtools-mcp\chrome-profile`;
const PERF_PROFILE_FRAGMENT = join(PERF_DIR, 'chrome-profile');

export type PerfBrowser = {
	context: BrowserContext;
	page: Page;
	close: () => Promise<void>;
};

export function isSoftwareHeadless(): boolean {
	return process.env['MALL_PERF_SOFTWARE'] === '1';
}

function browserExecutable(): string {
	const override = process.env['CHROME_PATH'];
	if (override) {
		if (!existsSync(override)) throw new Error(`CHROME_PATH points at nothing: ${override}`);
		return override;
	}
	const managed = chromium.executablePath();
	if (!existsSync(managed)) throw new Error('Playwright Chromium is missing; run `bunx playwright install chromium`');
	return managed;
}

function processExists(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

async function acquirePerfLock(): Promise<() => Promise<void>> {
	await mkdir(PERF_DIR, { recursive: true });
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			const handle = await open(LOCK_PATH, 'wx');
			await handle.writeFile(`${process.pid}\n`);
			let released = false;
			return async () => {
				if (released) return;
				released = true;
				await handle.close();
				await unlink(LOCK_PATH).catch(() => {});
			};
		} catch (error) {
			if (!isRecord(error) || readString(error, 'code') !== 'EEXIST') throw error;
			const owner = Number((await readFile(LOCK_PATH, 'utf8').catch(() => '')).trim());
			if (Number.isInteger(owner) && owner > 0 && processExists(owner)) {
				throw new Error(
					`performance browser already active in process ${owner}; diagnose, bench and profile must run one at a time`,
				);
			}
			await unlink(LOCK_PATH).catch(() => {});
		}
	}
	throw new Error('could not acquire the performance browser lock');
}

function assertNoOtherMeasurementChrome(): void {
	if (process.platform !== 'win32') return;
	const script = [
		`$mcp = '${MCP_PROFILE_FRAGMENT.replaceAll("'", "''")}'`,
		`$perf = '${PERF_PROFILE_FRAGMENT.replaceAll("'", "''")}'`,
		"$chrome = Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('chrome.exe', 'chrome-headless-shell.exe') }",
		'$mcpActive = $chrome | Where-Object { $_.CommandLine -like "*$mcp*" }',
		"$perfActive = $chrome | Where-Object { $_.CommandLine -like \"*$perf*\" -or $_.CommandLine -like '*mall-perf-*' -or $_.CommandLine -like '*playwright_chromiumdev_profile-*' }",
		'if ($mcpActive) { exit 17 }',
		'if ($perfActive) { exit 18 }',
	].join('; ');
	const check = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
		encoding: 'utf8',
		stdio: ['ignore', 'ignore', 'pipe'],
		windowsHide: true,
	});
	if (check.status === 17) {
		throw new Error(
			'the MCP DevTools Chrome is open; close it before running diagnose, bench or profile so the GPU has one measurement client',
		);
	}
	if (check.status === 18) {
		throw new Error('an orphaned Playwright Chromium is still running; close it before starting another performance run');
	}
	if (check.status !== 0) {
		throw new Error(
			`could not verify that MCP Chrome is closed: ${check.stderr.trim() || check.error?.message || `exit ${check.status}`}`,
		);
	}
}

/** Launch one Playwright-owned Chrome and keep its shader cache between runs. */
export async function launchPerfBrowser(width: number, height: number, persistentProfile?: string): Promise<PerfBrowser> {
	const releaseLock = await acquirePerfLock();
	let profileDir = persistentProfile;
	let disposableProfile = false;
	let context: BrowserContext | undefined;
	try {
		assertNoOtherMeasurementChrome();
		if (!profileDir) {
			profileDir = await mkdtemp(join(tmpdir(), 'mall-perf-'));
			disposableProfile = true;
		}
		const softwareHeadless = isSoftwareHeadless();
		const headless = process.env['CHROME_HEADFUL'] !== '1';
		const windowsHardwareHeadless = process.platform === 'win32' && !softwareHeadless && headless;
		const gpuArgs = softwareHeadless
			? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage']
			: windowsHardwareHeadless
				? ['--use-angle=d3d11', '--enable-gpu-rasterization']
				: [];
		context = await chromium.launchPersistentContext(profileDir, {
			executablePath: browserExecutable(),
			headless,
			chromiumSandbox: !softwareHeadless,
			viewport: { width, height },
			screen: { width, height: height + 120 },
			deviceScaleFactor: 1,
			locale: 'en-GB',
			args: [
				...gpuArgs,
				`--window-size=${width},${height + 120}`,
				'--no-first-run',
				'--no-default-browser-check',
				'--disable-translate',
				'--disable-features=Translate,TranslateUI',
				'--disable-session-crashed-bubble',
				'--hide-crash-restore-bubble',
				'--disable-extensions',
				'--disable-background-timer-throttling',
				'--disable-renderer-backgrounding',
				'--disable-backgrounding-occluded-windows',
				'--disable-frame-rate-limit',
				'--disable-gpu-vsync',
			],
		});
		const page = context.pages()[0] ?? (await context.newPage());
		page.setDefaultNavigationTimeout(120_000);
		let closed = false;
		return {
			context,
			page,
			close: async () => {
				if (closed) return;
				closed = true;
				try {
					await context?.close();
				} finally {
					if (disposableProfile && profileDir) await rm(profileDir, { recursive: true, force: true });
					await releaseLock();
				}
			},
		};
	} catch (error) {
		await context?.close().catch(() => {});
		if (disposableProfile && profileDir) await rm(profileDir, { recursive: true, force: true });
		await releaseLock();
		throw error;
	}
}
