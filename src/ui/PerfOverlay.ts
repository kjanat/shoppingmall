import { ctx2d, qs } from '@/util/dom';

const OPEN_KEY = 'mallsim.perfhud.v1';
/** Frames kept for the percentiles. ~5 s at 60 fps, much longer when it hurts. */
const HISTORY = 320;
/** Redraw cadence. Numbers at half this, or they blur into an unreadable smear. */
const TICK_MS = 250;
const GRAPH_W = 168;
const GRAPH_H = 34;
/** Anything past this in the graph is off the top; also the "smooth" reference line. */
const GRAPH_MAX_MS = 50;
const VSYNC_MS = 1000 / 60;

/** Every value row, in order. The markup and the lookup both read this. Two
 * copies of the list drifted apart the moment a row was added, and the panel
 * threw on a missing element. */
const ROWS: [id: string, label: string][] = [
	['fps', 'fps'],
	['low', '1% laag'],
	['ms', 'frametijd'],
	['cpu', 'cpu'],
	['phases', 'logica/batch/sub'],
	['p95', 'p95'],
	['worst', 'slechtste'],
	['hitch', 'hikken/s'],
	['draws', 'draw calls'],
	['tris', 'driehoeken'],
	['batches', 'batches'],
	['lights', 'lichten'],
	['res', 'resolutie'],
	['programs', "programma's"],
	['mem', 'geheugen'],
];

/** What the frame loop hands over once per frame. */
export type PerfFrame = {
	/** Unclamped wall time since the previous frame. */
	frameMs: number;
	drawCalls: number;
	triangles: number;
	programs: number;
	geometries: number;
	textures: number;
	/** Drawing-buffer pixels, i.e. after the quality tier and dynamic resolution. */
	bufferWidth: number;
	bufferHeight: number;
	/** Dynamic-resolution step, 1 = native for the current quality tier. */
	renderScale: number;
	/** Main-thread time for the whole frame callback, and its three phases. */
	cpuMs: number;
	logicMs: number;
	batchMs: number;
	submitMs: number;
	/** Pool slots with a light in them, out of the fixed total. */
	lightsUsed: number;
	lightsTotal: number;
	batches: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

/**
 * Chrome-only and behind a flag for real precision, so it is shown when present
 * and simply left out otherwise rather than faked.
 */
function heapMb(): number | null {
	const perf: unknown = performance;
	if (!isRecord(perf)) return null;
	const memory = perf['memory'];
	if (!isRecord(memory)) return null;
	const used = memory['usedJSHeapSize'];
	return typeof used === 'number' ? used / (1024 * 1024) : null;
}

/**
 * A frame-time HUD, because the plain fps number is the one metric that hides
 * exactly what you feel: an average of 60 with one 200 ms frame per second
 * reads as smooth and plays as a stutter. So this shows the distribution: the
 * worst 1% of frames, the worst single frame, and the last few seconds as a
 * graph, next to what the frame is actually made of.
 *
 * Every frame counts, however slow. Tab switches never reach here: App breaks
 * its timestamp chain on `visibilitychange`, because no size threshold can
 * tell a hidden tab from a genuinely terrible frame.
 */
export class PerfOverlay {
	private readonly host: HTMLElement;
	private readonly chip: HTMLElement;
	private readonly panel: HTMLElement;
	private readonly graph: HTMLCanvasElement;
	private readonly values = new Map<string, HTMLElement>();

	/** Ring of frame times; `count` keeps the percentiles honest before it fills. */
	private readonly frames = new Float32Array(HISTORY);
	private cursor = 0;
	private count = 0;
	/** Reused by the percentile sort so a HUD does not allocate every tick. */
	private readonly sorted = new Float32Array(HISTORY);

	private sinceTick = 0;
	private framesSinceText = 0;
	private msSinceText = 0;
	private textTurn = false;
	private open: boolean;
	private last: PerfFrame | null = null;
	/** Main-thread blocks of 50 ms or more (GC pauses and the like) in the last second. */
	private longTasks: number[] = [];

	constructor(root: HTMLElement) {
		this.open = PerfOverlay.loadOpen();
		this.host = document.createElement('div');
		this.host.className = 'perf-hud';
		this.host.innerHTML = `
      <button type="button" class="perf-chip" id="perf-chip" title="Prestaties (I)">— fps</button>
      <div class="perf-panel" id="perf-panel">
        <canvas class="perf-graph" id="perf-graph" width="${GRAPH_W}" height="${GRAPH_H}"></canvas>
        <div class="perf-graph-key"><span>frametijd</span><span>${GRAPH_MAX_MS} ms</span></div>
        ${ROWS.map(
					([id, label]) =>
						`<div class="perf-row"><span class="perf-label">${label}</span><b class="perf-value" id="perf-${id}">—</b></div>`,
				).join('')}
        <div class="perf-hint">I = aan/uit</div>
      </div>
    `;
		root.appendChild(this.host);

		this.chip = qs(this.host, '#perf-chip');
		this.panel = qs(this.host, '#perf-panel');
		this.graph = qs<HTMLCanvasElement>(this.host, '#perf-graph');
		for (const [id] of ROWS) this.values.set(id, qs(this.host, `#perf-${id}`));

		this.chip.addEventListener('click', () => this.toggle());
		window.addEventListener('keydown', (e) => {
			const el = e.target;
			if (el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
			if (e.key === 'i' || e.key === 'I') this.toggle();
		});
		this.observeLongTasks();
		this.applyOpen();
	}

	private static loadOpen(): boolean {
		try {
			return localStorage.getItem(OPEN_KEY) === '1';
		} catch {
			return false;
		}
	}

	/**
	 * Long tasks are the browser's own name for "the main thread was blocked",
	 * which in a garbage-collected language is the stutter you cannot see in an
	 * average. Not every browser reports them; absence just hides the row.
	 */
	private observeLongTasks(): void {
		try {
			const observer = new PerformanceObserver((list) => {
				const now = performance.now();
				for (let i = 0; i < list.getEntries().length; i++) this.longTasks.push(now);
			});
			observer.observe({ entryTypes: ['longtask'] });
		} catch {
			// Not supported, so the row stays at 0 rather than lying.
		}
	}

	toggle(force?: boolean): void {
		this.open = force === undefined ? !this.open : force;
		try {
			localStorage.setItem(OPEN_KEY, this.open ? '1' : '0');
		} catch {
			/* private mode */
		}
		this.applyOpen();
	}

	private applyOpen(): void {
		this.panel.classList.toggle('hidden', !this.open);
	}

	/** Called once per frame, after the render, with the frame's own numbers. */
	update(frame: PerfFrame): void {
		if (frame.frameMs <= 0) return;
		this.last = frame;
		this.frames[this.cursor] = frame.frameMs;
		this.cursor = (this.cursor + 1) % HISTORY;
		if (this.count < HISTORY) this.count++;

		this.framesSinceText++;
		this.msSinceText += frame.frameMs;
		this.sinceTick += frame.frameMs;
		if (this.sinceTick < TICK_MS) return;
		this.sinceTick = 0;

		// The chip is always live; the rest only when it is on screen.
		const fps = this.framesSinceText > 0 ? Math.round((this.framesSinceText * 1000) / this.msSinceText) : 0;
		this.textTurn = !this.textTurn;
		if (this.textTurn) {
			this.chip.textContent = `${fps} fps`;
			this.chip.style.color = fps >= 45 ? '#22c55e' : fps >= 25 ? '#f59e0b' : '#ef4444';
			if (this.open) this.writeNumbers(fps);
			this.framesSinceText = 0;
			this.msSinceText = 0;
		}
		if (this.open) this.drawGraph();
	}

	private writeNumbers(fps: number): void {
		const frame = this.last;
		if (!frame) return;
		const avgMs = this.framesSinceText > 0 ? this.msSinceText / this.framesSinceText : 0;
		const n = this.count;
		for (let i = 0; i < n; i++) this.sorted[i] = this.frames[i] ?? 0;
		const window = this.sorted.subarray(0, n);
		window.sort();

		// The worst 1% averaged, not the single sample at the 99th percentile:
		// one outlier should not be the whole figure, and the mean of the bucket
		// is what "1% low" means in the tools people compare against.
		const worstCount = Math.max(1, Math.round(n * 0.01));
		let worstSum = 0;
		for (let i = n - worstCount; i < n; i++) worstSum += window[i] ?? 0;
		const lowMs = worstSum / worstCount;
		const p95 = window[Math.min(n - 1, Math.floor(n * 0.95))] ?? 0;
		const worst = window[n - 1] ?? 0;

		const now = performance.now();
		this.longTasks = this.longTasks.filter((t) => now - t < 1000);

		const set = (id: string, text: string): void => {
			const el = this.values.get(id);
			if (el) el.textContent = text;
		};
		set('fps', `${fps}`);
		set('low', n >= 60 ? `${Math.round(1000 / Math.max(lowMs, 0.01))} fps` : '—');
		set('ms', `${avgMs.toFixed(1)} ms`);
		// cpu vs frametijd is de hele diagnose: bijna gelijk = de main thread is
		// de rem, ver eronder = de GPU (of vsync) bepaalt het tempo.
		const cpuShare = avgMs > 0 ? Math.round((frame.cpuMs / avgMs) * 100) : 0;
		set('cpu', `${frame.cpuMs.toFixed(1)} ms · ${cpuShare}%`);
		set('phases', `${frame.logicMs.toFixed(1)}/${frame.batchMs.toFixed(1)}/${frame.submitMs.toFixed(1)}`);
		set('p95', `${p95.toFixed(1)} ms`);
		set('worst', `${worst.toFixed(0)} ms`);
		set('hitch', `${this.longTasks.length}`);
		set('draws', `${frame.drawCalls}`);
		set('tris', frame.triangles >= 1000 ? `${Math.round(frame.triangles / 1000)}k` : `${frame.triangles}`);
		set('batches', `${frame.batches}`);
		set('lights', `${frame.lightsUsed}/${frame.lightsTotal}`);
		set('res', `${frame.bufferWidth}×${frame.bufferHeight} · ${frame.renderScale.toFixed(2)}×`);
		set('programs', `${frame.programs} · ${frame.geometries}g ${frame.textures}t`);
		const mb = heapMb();
		set('mem', mb === null ? 'n/b' : `${Math.round(mb)} MB`);
	}

	/**
	 * Oldest to newest, one bar per frame, clipped at GRAPH_MAX_MS. The vsync
	 * line is the thing to read it against: bars poking above it are the frames
	 * that cost you a refresh, and a ragged skyline is stutter even when the
	 * average is fine.
	 */
	private drawGraph(): void {
		const ctx = ctx2d(this.graph);
		ctx.clearRect(0, 0, GRAPH_W, GRAPH_H);
		ctx.fillStyle = 'rgba(148, 163, 184, 0.14)';
		ctx.fillRect(0, 0, GRAPH_W, GRAPH_H);

		const n = this.count;
		const bars = Math.min(n, GRAPH_W);
		for (let i = 0; i < bars; i++) {
			// Walk back from the newest sample so the graph scrolls left.
			const age = bars - 1 - i;
			const index = (this.cursor - 1 - age + HISTORY * 2) % HISTORY;
			const ms = this.frames[index] ?? 0;
			const h = Math.max(1, Math.min(GRAPH_H, (ms / GRAPH_MAX_MS) * GRAPH_H));
			ctx.fillStyle = ms <= VSYNC_MS * 1.2 ? '#22c55e' : ms <= 33 ? '#f59e0b' : '#ef4444';
			ctx.fillRect(i, GRAPH_H - h, 1, h);
		}

		const y = GRAPH_H - (VSYNC_MS / GRAPH_MAX_MS) * GRAPH_H;
		ctx.strokeStyle = 'rgba(226, 232, 240, 0.55)';
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.moveTo(0, y + 0.5);
		ctx.lineTo(GRAPH_W, y + 0.5);
		ctx.stroke();
	}
}
