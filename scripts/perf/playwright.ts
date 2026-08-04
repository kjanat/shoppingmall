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
import { join } from 'node:path';
import { env } from 'node:process';
import { blue } from 'ansispeck';
import { dim, red } from 'ansispeck/safe';
import { type BrowserContext, chromium, type Page } from 'playwright';
import { BROWSER_LOCK_PATH as LOCK_PATH, PERF_DIR, PROFILE_DIR as PERF_PROFILE_FRAGMENT } from './paths.ts';
import { isRecord, readString } from './values.ts';

const MCP_PROFILE_FRAGMENT = String.raw`\.cache\chrome-devtools-mcp\chrome-profile`;

export type PerfBrowser = {
	context: BrowserContext;
	page: Page;
	close: () => Promise<void>;
};

export function isSoftwareHeadless(): boolean {
	return env['MALL_PERF_SOFTWARE'] === '1';
}

/** ANGLE backends this project has measured on. */
type AngleBackend = 'vulkan' | 'gl' | 'd3d11';

const SOFTWARE_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage'];

function requestedBackend(): AngleBackend | null {
	const raw = env['MALL_PERF_ANGLE'];
	if (raw === undefined || raw === '') return null;
	if (raw === 'vulkan' || raw === 'gl' || raw === 'd3d11') return raw;
	throw new Error(`MALL_PERF_ANGLE must be vulkan, gl or d3d11; got ${blue(raw)}`);
}

function defaultBackend(headless: boolean): AngleBackend | null {
	// Headless Chromium on Linux answers with SwiftShader when no backend is named, which parseEnvironment refuses. Headful reaches the driver unaided.
	if (process.platform === 'win32') return 'd3d11';
	return headless ? 'vulkan' : null;
}

/**
 * The backend is part of what a measurement is about. On one RTX 4080 SUPER the
 * same scene reported 36.89 ms in the scene pass under GL, and 21.66 ms plus a
 * 13.42 ms single-draw present under Vulkan, at the same 37 ms wall time.
 */
function hardwareArgs(headless: boolean): string[] {
	const backend = requestedBackend() ?? defaultBackend(headless);
	const args: string[] = [];
	if (backend) args.push(`--use-angle=${backend}`);
	if (backend === 'vulkan') args.push('--enable-features=Vulkan');
	if (process.platform === 'win32') args.push('--enable-gpu-rasterization');
	// Ozone chooses the window system. A headful run handed the headless backend
	// gets no window while Playwright still omits --headless.
	if (headless && process.platform !== 'win32') args.push('--use-gl=angle', '--ozone-platform=headless');
	return args;
}

function browserExecutable(): string {
	const override = env['CHROME_PATH'];
	if (override) {
		if (!existsSync(override)) throw new Error(`CHROME_PATH points at nothing: ${blue(override)}`);
		return override;
	}
	const managed = chromium.executablePath();
	if (!existsSync(managed))
		throw new Error(`Playwright Chromium is missing; run ${red`npx ${dim`-y`} playwright install chromium`}`);
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
					`performance browser already active in process ${blue(owner)}; diagnose, bench and profile must run one at a time`,
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
		const headless = env['CHROME_HEADFUL'] !== '1';
		const gpuArgs = softwareHeadless ? SOFTWARE_ARGS : hardwareArgs(headless);
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
