/**
 * A Chrome DevTools Protocol client small enough to keep in the repo.
 *
 * Playwright would do this in three lines, but it also drags in a few hundred
 * megabytes of browsers for a project whose entire dependency list is six
 * packages. The protocol itself is a WebSocket that takes `{id, method, params}`
 * and answers `{id, result}`, which is all the perf scripts need.
 *
 * Chrome must be a real, GPU-backed Chrome: the whole point of these scripts is
 * to measure a driver, and a headless software rasteriser cannot show a win that
 * only exists when shaders compile in parallel. Hence `--headless=new` is *not*
 * used and the window is genuinely shown.
 */
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ── untyped JSON, read at the boundary ─────────────────────────────────────

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readNumber(source: Record<string, unknown>, key: string, fallback = 0): number {
	const value = source[key];
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function readString(source: Record<string, unknown>, key: string, fallback = ''): string {
	const value = source[key];
	return typeof value === 'string' ? value : fallback;
}

export function readBoolean(source: Record<string, unknown>, key: string): boolean {
	return source[key] === true;
}

export function readArray(source: Record<string, unknown>, key: string): unknown[] {
	const value = source[key];
	return Array.isArray(value) ? value : [];
}

// ── finding a browser ──────────────────────────────────────────────────────

/**
 * Deliberately not exhaustive. If the guess is wrong the caller gets a clear
 * error naming CHROME_PATH, which beats a silent fallback to some other engine
 * whose numbers would not mean the same thing.
 */
function findChrome(): string {
	const override = process.env['CHROME_PATH'];
	if (override) {
		if (!existsSync(override)) throw new Error(`CHROME_PATH points at nothing: ${override}`);
		return override;
	}
	const candidates: string[] = [];
	if (process.platform === 'win32') {
		for (const root of [process.env['PROGRAMFILES'], process.env['PROGRAMFILES(X86)'], process.env['LOCALAPPDATA']]) {
			if (root) candidates.push(join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'));
		}
	} else if (process.platform === 'darwin') {
		candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
	} else {
		candidates.push('/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser');
	}
	const found = candidates.find((path) => existsSync(path));
	if (!found) throw new Error(`could not find Chrome (looked in ${candidates.join(', ')}) — set CHROME_PATH`);
	return found;
}

async function freePort(): Promise<number> {
	const server = Bun.serve({ port: 0, fetch: () => new Response('') });
	const port = server.port;
	await server.stop(true);
	if (port === undefined) throw new Error('could not reserve a port for the debugging connection');
	return port;
}

// ── the client ─────────────────────────────────────────────────────────────

type Pending = { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void };

export class Browser {
	private readonly socket: WebSocket;
	private readonly process: Bun.Subprocess;
	private readonly profileDir: string;
	private readonly disposableProfile: boolean;
	private readonly pending = new Map<number, Pending>();
	private nextId = 1;

	private constructor(socket: WebSocket, child: Bun.Subprocess, profileDir: string, disposableProfile: boolean) {
		this.socket = socket;
		this.process = child;
		this.profileDir = profileDir;
		this.disposableProfile = disposableProfile;
		this.socket.addEventListener('message', (event) => {
			if (typeof event.data !== 'string') return;
			const parsed: unknown = JSON.parse(event.data);
			if (!isRecord(parsed)) return;
			const id = parsed['id'];
			if (typeof id !== 'number') return; // an event, not a reply
			const waiting = this.pending.get(id);
			if (!waiting) return;
			this.pending.delete(id);
			const error = parsed['error'];
			if (isRecord(error)) waiting.reject(new Error(readString(error, 'message', 'CDP error')));
			else waiting.resolve(isRecord(parsed['result']) ? parsed['result'] : {});
		});
	}

	/**
	 * `profileDir` is worth reusing between runs: Chrome keeps its compiled-shader
	 * cache there, and this scene links 105 programs of up to 125 KB. Cold, that is
	 * a hundred seconds before the game is playable; warm, a fraction of it. Pass
	 * nothing for a throwaway profile when the cold path is the thing under test.
	 */
	static async launch(windowWidth: number, windowHeight: number, profile?: string): Promise<Browser> {
		const port = await freePort();
		const profileDir = profile ?? (await mkdtemp(join(tmpdir(), 'mall-perf-')));
		const disposable = profile === undefined;
		const child = Bun.spawn(
			[
				findChrome(),
				`--remote-debugging-port=${port}`,
				`--user-data-dir=${profileDir}`,
				`--window-size=${windowWidth},${windowHeight}`,
				'--no-first-run',
				'--no-default-browser-check',
				'--disable-extensions',
				'--disable-background-timer-throttling',
				'--disable-renderer-backgrounding',
				'--disable-backgrounding-occluded-windows',
				// The frame loop must run flat out; vsync would quantise every
				// measurement to the refresh rate and hide everything under 16.7 ms.
				'--disable-frame-rate-limit',
				'--disable-gpu-vsync',
				'about:blank',
			],
			{ stdout: 'ignore', stderr: 'ignore' },
		);

		const deadline = Date.now() + 30_000;
		let webSocketUrl = '';
		while (Date.now() < deadline && !webSocketUrl) {
			try {
				const response = await fetch(`http://127.0.0.1:${port}/json/version`);
				const body: unknown = await response.json();
				if (isRecord(body)) webSocketUrl = readString(body, 'webSocketDebuggerUrl');
			} catch {
				await Bun.sleep(150);
			}
		}
		if (!webSocketUrl) {
			child.kill();
			throw new Error('Chrome started but never opened a debugging port');
		}

		const socket = new WebSocket(webSocketUrl);
		await new Promise<void>((resolve, reject) => {
			socket.addEventListener('open', () => resolve(), { once: true });
			socket.addEventListener('error', () => reject(new Error('could not attach to Chrome')), { once: true });
		});
		return new Browser(socket, child, profileDir, disposable);
	}

	send(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
		const id = this.nextId++;
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
			this.socket.send(JSON.stringify({ id, method, params, sessionId: this.sessionId }));
		});
	}

	private sessionId: string | undefined;

	/** Attach to the first page target; every later call runs against it. */
	async attachToPage(): Promise<void> {
		const targets = await this.send('Target.getTargets');
		const infos = readArray(targets, 'targetInfos');
		const page = infos.find((info) => isRecord(info) && readString(info, 'type') === 'page');
		if (!isRecord(page)) throw new Error('Chrome has no page target to attach to');
		const attached = await this.send('Target.attachToTarget', { targetId: readString(page, 'targetId'), flatten: true });
		this.sessionId = readString(attached, 'sessionId');
		await this.send('Page.enable');
		await this.send('Runtime.enable');
	}

	/** Run before every future document, i.e. ahead of the game's own scripts. */
	async onNewDocument(source: string): Promise<void> {
		await this.send('Page.addScriptToEvaluateOnNewDocument', { source });
	}

	async navigate(url: string): Promise<void> {
		await this.send('Page.navigate', { url });
	}

	/** Resize the rendering surface without touching the OS window. */
	async setViewport(width: number, height: number): Promise<void> {
		await this.send('Emulation.setDeviceMetricsOverride', {
			width,
			height,
			deviceScaleFactor: 1,
			mobile: false,
		});
	}

	/**
	 * Evaluate an expression and return its value. Promises are awaited browser
	 * side, so a caller can hand over `__mallProbe.sample(4000)` and simply wait.
	 */
	async evaluate(expression: string, timeoutMs = 180_000): Promise<unknown> {
		const result = await Promise.race([
			this.send('Runtime.evaluate', {
				expression,
				awaitPromise: true,
				returnByValue: true,
				timeout: timeoutMs,
			}),
			Bun.sleep(timeoutMs).then(() => {
				throw new Error(`evaluate timed out after ${timeoutMs} ms: ${expression.slice(0, 60)}`);
			}),
		]);
		const thrown = result['exceptionDetails'];
		if (isRecord(thrown)) throw new Error(`page threw: ${readString(thrown, 'text', 'unknown error')}`);
		const value = result['result'];
		return isRecord(value) ? value['value'] : undefined;
	}

	async close(): Promise<void> {
		this.socket.close();
		this.process.kill();
		await this.process.exited;
		// A reused profile is kept: its shader cache is the reason the next run is fast.
		if (this.disposableProfile) await rm(this.profileDir, { recursive: true, force: true });
	}
}
