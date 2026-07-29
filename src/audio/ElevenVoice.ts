/**
 * DJ Bartek voice: ElevenLabs via /api/tts, browser speechSynthesis fallback.
 * Also can play pre-baked booth lines from public/dj-music/.
 */

export type SpeakResult = {
	source: 'elevenlabs' | 'browser' | 'file' | 'silent';
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
	window.speechSynthesis?.cancel();
}

function playElement(el: HTMLAudioElement, volume: number): Promise<number> {
	return new Promise((resolve) => {
		el.volume = volume;
		const done = () => {
			const ms = Number.isFinite(el.duration) ? el.duration * 1000 : 2500;
			resolve(ms);
		};
		el.onended = done;
		el.onerror = () => resolve(0);
		void el.play().then(() => {
			// duration may be NaN until metadata
			if (el.readyState >= 1 && Number.isFinite(el.duration)) {
				/* ok */
			}
		}).catch(() => resolve(0));
		// safety cap
		setTimeout(() => resolve(Math.min(20000, (el.duration || 4) * 1000)), 20000);
	});
}

/** Play a local mp3 under /dj-music/ (pre-generated Bartek lines) */
export async function playBoothFile(
	file: string,
	volume = 0.95,
): Promise<SpeakResult> {
	stopCurrent();
	audioEl = new Audio(`/dj-music/${encodeURIComponent(file)}`);
	const ms = await playElement(audioEl, volume);
	return { source: ms > 0 ? 'file' : 'silent', durationMs: ms };
}

/**
 * Speak any line via ElevenLabs (shared by Bartek, Youssef, other keepers).
 * Does NOT cut off a line already playing if `queue` — default cuts previous.
 */
export async function speakLine(
	text: string,
	opts: { voiceId?: string; volume?: number; interrupt?: boolean } = {},
): Promise<SpeakResult> {
	const volume = opts.volume ?? 0.95;
	if (opts.interrupt !== false) stopCurrent();

	try {
		const res = await fetch('/api/tts', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ text, voiceId: opts.voiceId }),
		});
		if (res.ok && res.headers.get('content-type')?.includes('audio')) {
			const blob = await res.blob();
			objectUrl = URL.createObjectURL(blob);
			audioEl = new Audio(objectUrl);
			const ms = await playElement(audioEl, volume);
			return { source: 'elevenlabs', durationMs: ms };
		}
		const err = await res.json().catch(() => ({}));
		const browser = speakBrowser(text, volume);
		return {
			source: browser ? 'browser' : 'silent',
			error: (err as { error?: string }).error ?? `tts ${res.status}`,
			durationMs: browser ? Math.min(12000, text.length * 55) : 0,
		};
	} catch (e) {
		const browser = speakBrowser(text, volume);
		return {
			source: browser ? 'browser' : 'silent',
			error: String(e),
			durationMs: browser ? Math.min(12000, text.length * 55) : 0,
		};
	}
}

/** @deprecated use speakLine — kept for Bartek call sites */
export async function speakBartek(
	text: string,
	opts: { voiceId?: string; volume?: number } = {},
): Promise<SpeakResult> {
	return speakLine(text, opts);
}

function speakBrowser(text: string, volume: number): boolean {
	if (!window.speechSynthesis) return false;
	const u = new SpeechSynthesisUtterance(text);
	u.volume = volume;
	u.rate = 1.05;
	u.pitch = 0.95;
	const voices = window.speechSynthesis.getVoices();
	const pick = voices.find((v) => /dutch|nl-NL|nederlands/i.test(v.lang + v.name))
		|| voices.find((v) => /en-GB|en-US/i.test(v.lang) && /male|daniel|google uk/i.test(v.name))
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
