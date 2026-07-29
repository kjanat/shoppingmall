/**
 * Character speech via ElevenLabs (/api/tts).
 * Browser TTS is OFF by default — user hated the bubbel/robot fallback.
 */

export type SpeakResult = {
	source: 'elevenlabs' | 'file' | 'browser' | 'silent';
	error?: string;
	durationMs?: number;
};

let audioEl: HTMLAudioElement | null = null;
let objectUrl: string | null = null;

function stopCurrent(): void {
	if (audioEl) {
		audioEl.pause();
		audioEl.onended = null;
		audioEl = null;
	}
	if (objectUrl) {
		URL.revokeObjectURL(objectUrl);
		objectUrl = null;
	}
	// Always kill browser TTS so it never stacks under real audio
	window.speechSynthesis?.cancel();
}

function isMp3(buf: ArrayBuffer): boolean {
	if (buf.byteLength < 4) return false;
	const u = new Uint8Array(buf);
	// ID3 tag or MPEG frame sync
	return (
		(u[0] === 0x49 && u[1] === 0x44 && u[2] === 0x33)
		|| (u[0] === 0xff && (u[1] & 0xe0) === 0xe0)
	);
}

function playElement(el: HTMLAudioElement, volume: number): Promise<number> {
	return new Promise((resolve) => {
		let done = false;
		const finish = (ms: number) => {
			if (done) return;
			done = true;
			resolve(ms);
		};
		el.volume = volume;
		el.onended = () => finish(Number.isFinite(el.duration) ? el.duration * 1000 : 2500);
		el.onerror = () => finish(0);
		const cap = window.setTimeout(() => {
			finish(Math.min(20000, (el.duration || 4) * 1000));
		}, 20000);
		void el
			.play()
			.then(() => {
				/* playing */
			})
			.catch(() => {
				clearTimeout(cap);
				finish(0);
			});
	});
}

/** Local mp3 under /dj-music/ */
export async function playBoothFile(
	file: string,
	volume = 0.95,
): Promise<SpeakResult> {
	stopCurrent();
	audioEl = new Audio(`/dj-music/${encodeURIComponent(file)}`);
	const ms = await playElement(audioEl, volume);
	return { source: ms > 0 ? 'file' : 'silent', durationMs: ms };
}

async function fetchTts(
	text: string,
	voiceId?: string,
	lang?: string,
): Promise<{ ok: true; buf: ArrayBuffer } | { ok: false; error: string; status: number }> {
	const res = await fetch('/api/tts', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ text, voiceId, lang }),
	});
	const ct = (res.headers.get('content-type') || '').toLowerCase();
	if (!res.ok) {
		const err = await res.json().catch(() => ({}));
		return {
			ok: false,
			status: res.status,
			error: (err as { error?: string }).error ?? `tts ${res.status}`,
		};
	}
	const buf = await res.arrayBuffer();
	// Accept audio even if content-type is wrong (some proxies strip it)
	if (buf.byteLength > 800 && (ct.includes('audio') || isMp3(buf) || !ct.includes('json'))) {
		if (ct.includes('json')) {
			// actually json body with 200? parse
			try {
				const j = JSON.parse(new TextDecoder().decode(buf)) as { error?: string };
				return { ok: false, status: 200, error: j.error ?? 'json_body' };
			} catch {
				/* treat as audio */
			}
		}
		return { ok: true, buf };
	}
	return { ok: false, status: res.status, error: `bad_audio ct=${ct} bytes=${buf.byteLength}` };
}

/**
 * Speak via ElevenLabs. Browser TTS only if allowBrowser: true.
 */
export async function speakLine(
	text: string,
	opts: {
		voiceId?: string;
		lang?: string;
		volume?: number;
		interrupt?: boolean;
		/** default false — never fall back to robot browser voice for NPCs */
		allowBrowser?: boolean;
	} = {},
): Promise<SpeakResult> {
	const volume = opts.volume ?? 0.95;
	if (opts.interrupt !== false) stopCurrent();

	try {
		// 1) with lang  2) without lang (if first fails)  3) default voice
		let result = await fetchTts(text, opts.voiceId, opts.lang);
		if (!result.ok && opts.lang) {
			result = await fetchTts(text, opts.voiceId, undefined);
		}
		if (!result.ok && opts.voiceId) {
			result = await fetchTts(text, undefined, opts.lang);
		}
		if (!result.ok) {
			console.warn('[ElevenVoice] TTS failed:', result.error);
			if (opts.allowBrowser) {
				const browser = speakBrowser(text, volume);
				return {
					source: browser ? 'browser' : 'silent',
					error: result.error,
					durationMs: browser ? Math.min(12000, text.length * 55) : 0,
				};
			}
			return { source: 'silent', error: result.error, durationMs: 0 };
		}

		objectUrl = URL.createObjectURL(new Blob([result.buf], { type: 'audio/mpeg' }));
		audioEl = new Audio(objectUrl);
		const ms = await playElement(audioEl, volume);
		if (ms <= 0) {
			// autoplay blocked — still ElevenLabs data, try again after tiny delay
			try {
				await audioEl.play();
			} catch {
				/* */
			}
			return {
				source: 'elevenlabs',
				error: 'play_blocked_or_short',
				durationMs: Math.min(12000, text.length * 50),
			};
		}
		return { source: 'elevenlabs', durationMs: ms };
	} catch (e) {
		console.warn('[ElevenVoice] exception:', e);
		if (opts.allowBrowser) {
			const browser = speakBrowser(text, volume);
			return {
				source: browser ? 'browser' : 'silent',
				error: String(e),
				durationMs: browser ? Math.min(12000, text.length * 55) : 0,
			};
		}
		return { source: 'silent', error: String(e), durationMs: 0 };
	}
}

export async function speakBartek(
	text: string,
	opts: { voiceId?: string; volume?: number } = {},
): Promise<SpeakResult> {
	return speakLine(text, { ...opts, voiceId: opts.voiceId ?? 'IKne3meq5aSn9XLyUdCD', lang: 'nl' });
}

function speakBrowser(text: string, volume: number): boolean {
	if (!window.speechSynthesis) return false;
	const u = new SpeechSynthesisUtterance(text);
	u.volume = volume;
	u.rate = 1.05;
	u.pitch = 0.95;
	const voices = window.speechSynthesis.getVoices();
	const pick = voices.find((v) => /dutch|nl-NL|nederlands/i.test(v.lang + v.name))
		|| voices.find((v) => /^en/i.test(v.lang))
		|| voices[0];
	if (pick) u.voice = pick;
	window.speechSynthesis.speak(u);
	return true;
}

export async function fetchDjStatus(): Promise<{
	ok: boolean;
	elevenlabs: boolean;
	tracks: number;
}> {
	try {
		const r = await fetch('/api/dj/status');
		return await r.json();
	} catch {
		return { ok: false, elevenlabs: false, tracks: 0 };
	}
}
