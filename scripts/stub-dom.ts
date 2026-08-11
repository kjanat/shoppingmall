/**
 * De browserstubs die de controlescripts nodig hebben om de scene kaal in Bun te
 * bouwen. Stonden eerst alleen in check-world; check-lights bouwt dezelfde
 * bouwers en heeft ze dus ook nodig, en twee kopieën van een stub lopen net zo
 * hard uit elkaar als twee kopieën van een getal.
 */

/**
 * Onbekende velden én onbekende methodes geven de stub zelf terug, zodat elke
 * ketting blijft lopen. Het doel is een functie en niet een object: WebAudio
 * schrijft `osc.frequency.setValueAtTime(...)`, dus wat uit een `get` komt moet
 * tegelijk aan te roepen zijn én zelf weer velden hebben.
 */
function zelfherhalendeStub(velden: Record<string | symbol, unknown> = {}): unknown {
	let stub: unknown;
	const doel = function stubFn(): unknown {
		return stub;
	};
	// Een stub die zichzelf teruggeeft is geen getal en geen tekst, en dan klapt
	// `ctx.currentTime + 0.1` er op met "Symbol.toPrimitive returned an object".
	// Nul en de lege string zijn hier goed genoeg: niemand meet iets aan een stub.
	const primitief: Record<string | symbol, unknown> = {
		valueOf: () => 0,
		toString: () => '',
		[Symbol.toPrimitive]: (hint: string) => (hint === 'string' ? '' : 0),
	};
	stub = new Proxy(doel, {
		apply: () => stub,
		get: (_doel, sleutel) => {
			if (sleutel in velden) return velden[sleutel];
			if (sleutel in primitief) return primitief[sleutel];
			return stub;
		},
		set: (_doel, sleutel, waarde) => {
			velden[sleutel] = waarde;
			return true;
		},
	});
	return stub;
}

/**
 * Wat de stub voor één teken teruggeeft. Ruimer dan een echte monospace op de maten
 * die de kaart gebruikt (11 px geeft ~6,6), dus wie hier past, past in de browser ook.
 */
const STUB_GLYPH_WIDTH = 8;

/** De tekstmeter van de stub, los, voor wie alleen wil weten of een label past. */
export function stubTextMeasure(): { font: string; measureText: (tekst: string) => { width: number } } {
	return { font: '', measureText: (tekst: string) => ({ width: tekst.length * STUB_GLYPH_WIDTH }) };
}

/**
 * Canvasstub. Onbekende methodes geven de stub zelf terug, zodat ketens als
 * createLinearGradient().addColorStop() niet op undefined stuklopen.
 */
export function stubDocument(): void {
	const ctx = zelfherhalendeStub({
		measureText: stubTextMeasure().measureText,
	});
	(globalThis as unknown as { document: unknown }).document = {
		createElement: (tag: string) => (tag === 'canvas' ? { width: 1, height: 1, getContext: () => ctx } : {}),
	};
}

/** Wat een sessie in het geheugen onthoudt, met de vier methodes die de opslag gebruikt. */
export type SessieOpslag = {
	getItem: (sleutel: string) => string | null;
	setItem: (sleutel: string, waarde: string) => void;
	removeItem: (sleutel: string) => void;
	clear: () => void;
};

/**
 * `sessionStorage` in het geheugen, zodat de laadgrens van een opgeslagen spel
 * headless te bevragen is met precies wat een tab erin kan hebben staan.
 */
export function stubSessionStorage(): SessieOpslag {
	const inhoud = new Map<string, string>();
	const opslag: SessieOpslag = {
		getItem: (sleutel) => inhoud.get(sleutel) ?? null,
		setItem: (sleutel, waarde) => {
			inhoud.set(sleutel, waarde);
		},
		removeItem: (sleutel) => {
			inhoud.delete(sleutel);
		},
		clear: () => inhoud.clear(),
	};
	(globalThis as unknown as { sessionStorage: unknown }).sessionStorage = opslag;
	return opslag;
}

/**
 * WebAudio + de `window`-timers. De disco start muziek zodra je hem aanzet, en
 * de controle op het aantal echte lampen moet hem juist wél kunnen aanzetten.
 */
export function stubAudio(): void {
	const ctx = zelfherhalendeStub({ state: 'running' });
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
