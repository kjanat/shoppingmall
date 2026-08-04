/**
 * GPU time for the render itself, so the panel can say whether the frame is
 * held up by the main thread or by the card.
 *
 * Without this the only clue is the time spent inside `composer.render()`, and
 * that number lies in a specific way: the driver blocks there once its queue is
 * full, so GPU pressure shows up as CPU time and a frame that is entirely the
 * card's fault reads as 88% CPU.
 *
 * Scope matters. `probe.ts` warns that wrapping a whole *frame* in one
 * TIME_ELAPSED_EXT query measures elapsed GPU wall time including idle, which
 * reports ~100% busy no matter what. This wraps the render submission only, so
 * the idle gap between frames is outside the query.
 *
 * Results arrive a frame or two late because the query cannot be read until the
 * GPU is done with it. For a number that updates twice a second that is fine.
 */
type TimerExt = { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number };

function readExt(value: unknown): TimerExt | null {
	if (typeof value !== 'object' || value === null) return null;
	if (!('TIME_ELAPSED_EXT' in value) || !('GPU_DISJOINT_EXT' in value)) return null;
	const { TIME_ELAPSED_EXT, GPU_DISJOINT_EXT } = value;
	if (typeof TIME_ELAPSED_EXT !== 'number' || typeof GPU_DISJOINT_EXT !== 'number') return null;
	return { TIME_ELAPSED_EXT, GPU_DISJOINT_EXT };
}

export class GpuTimer {
	private readonly gl: WebGL2RenderingContext;
	private readonly ext: TimerExt | null;
	/** Queries handed to the driver, oldest first, waiting to be readable. */
	private readonly pending: WebGLQuery[] = [];
	private active: WebGLQuery | null = null;
	private lastMs = 0;

	constructor(gl: WebGL2RenderingContext) {
		this.gl = gl;
		this.ext = readExt(gl.getExtension('EXT_disjoint_timer_query_webgl2'));
	}

	/** Zero when the extension is missing, which is common on mobile and in software renderers. */
	get supported(): boolean {
		return this.ext !== null;
	}

	/** Milliseconds the GPU spent on the last render it finished. */
	get ms(): number {
		return this.lastMs;
	}

	begin(): void {
		if (!this.ext || this.active) return;
		const query = this.gl.createQuery();
		if (!query) return;
		this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, query);
		this.active = query;
	}

	end(): void {
		if (!this.ext || !this.active) return;
		this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
		// Three in flight is plenty: the oldest is normally readable by now, and
		// a longer queue only delays a number nobody reads more than twice a second.
		this.pending.push(this.active);
		this.active = null;
		if (this.pending.length > 3) {
			const dropped = this.pending.shift();
			if (dropped) this.gl.deleteQuery(dropped);
		}
		this.collect();
	}

	private collect(): void {
		if (!this.ext) return;
		const oldest = this.pending[0];
		if (!oldest) return;
		// A disjoint means the GPU was interrupted (power state, another client)
		// and every outstanding result is garbage rather than merely late.
		if (this.gl.getParameter(this.ext.GPU_DISJOINT_EXT)) {
			for (const query of this.pending) this.gl.deleteQuery(query);
			this.pending.length = 0;
			return;
		}
		if (!this.gl.getQueryParameter(oldest, this.gl.QUERY_RESULT_AVAILABLE)) return;
		this.lastMs = this.gl.getQueryParameter(oldest, this.gl.QUERY_RESULT) / 1e6;
		this.gl.deleteQuery(oldest);
		this.pending.shift();
	}
}
