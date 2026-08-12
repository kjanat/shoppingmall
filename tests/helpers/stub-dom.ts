/**
 * The browser stubs the headless tests need to build the scene bare in Bun.
 *
 * They started out inside the world check; the light tests build the same builders and
 * need them too, and two copies of a stub drift apart just as fast as two copies of a
 * number.
 */

/**
 * Unknown fields and unknown methods return the stub itself, so every chain keeps
 * running. The target is a function and not an object: WebAudio writes
 * `osc.frequency.setValueAtTime(...)`, so whatever comes out of a `get` has to be
 * callable and carry fields of its own.
 */
function selfRepeatingStub(fields: Record<string | symbol, unknown> = {}): unknown {
	let stub: unknown;
	const target = function stubFn(): unknown {
		return stub;
	};
	// A stub that returns itself is neither a number nor a string, and then
	// `ctx.currentTime + 0.1` throws "Symbol.toPrimitive returned an object". Zero and the
	// empty string are good enough here: nobody measures anything on a stub.
	const primitive: Record<string | symbol, unknown> = {
		valueOf: () => 0,
		toString: () => '',
		[Symbol.toPrimitive]: (hint: string) => (hint === 'string' ? '' : 0),
	};
	stub = new Proxy(target, {
		apply: () => stub,
		get: (_target, key) => {
			if (key in fields) return fields[key];
			if (key in primitive) return primitive[key];
			return stub;
		},
		set: (_target, key, value) => {
			fields[key] = value;
			return true;
		},
	});
	return stub;
}

/**
 * What the stub reports for one glyph. Wider than a real monospace at the sizes the map
 * uses (11 px gives ~6.6), so whatever fits here fits in the browser too.
 */
const STUB_GLYPH_WIDTH = 8;

/** The stub's text metric on its own, for anyone who only wants to know if a label fits. */
export function stubTextMeasure(): { font: string; measureText: (text: string) => { width: number } } {
	return { font: '', measureText: (text: string) => ({ width: text.length * STUB_GLYPH_WIDTH }) };
}

/**
 * Canvas stub. Unknown methods return the stub itself, so chains like
 * createLinearGradient().addColorStop() do not break on undefined.
 */
export function stubDocument(): void {
	const ctx = selfRepeatingStub({ measureText: stubTextMeasure().measureText });
	(globalThis as unknown as { document: unknown }).document = {
		createElement: (tag: string) => (tag === 'canvas' ? { width: 1, height: 1, getContext: () => ctx } : {}),
	};
}

/** What a session remembers in memory, with the four methods the storage boundary uses. */
export type SessionStorage = {
	getItem: (key: string) => string | null;
	setItem: (key: string, value: string) => void;
	removeItem: (key: string) => void;
	clear: () => void;
};

function memoryStorage(): SessionStorage {
	const contents = new Map<string, string>();
	return {
		getItem: (key) => contents.get(key) ?? null,
		setItem: (key, value) => {
			contents.set(key, value);
		},
		removeItem: (key) => {
			contents.delete(key);
		},
		clear: () => contents.clear(),
	};
}

/**
 * `sessionStorage` in memory, so the load boundary of a saved game can be questioned
 * headlessly with exactly what a tab can hold.
 */
export function stubSessionStorage(): SessionStorage {
	const storage = memoryStorage();
	(globalThis as unknown as { sessionStorage: unknown }).sessionStorage = storage;
	return storage;
}

/** The same in memory for `localStorage`, which is where the graphics preferences live. */
export function stubLocalStorage(): SessionStorage {
	const storage = memoryStorage();
	(globalThis as unknown as { localStorage: unknown }).localStorage = storage;
	return storage;
}

/**
 * WebAudio plus the `window` timers. The disco starts music the moment you switch it on,
 * and the light count test has to be able to switch it on.
 */
export function stubAudio(): void {
	const ctx = selfRepeatingStub({ state: 'running' });
	(globalThis as unknown as { AudioContext: unknown }).AudioContext = function AudioContextStub(): unknown {
		return ctx;
	};
	(globalThis as unknown as { window: unknown }).window = {
		setInterval: () => 0,
		clearInterval: () => {},
		setTimeout: () => 0,
		clearTimeout: () => {},
	};
}
