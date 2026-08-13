/**
 * Character speech via ElevenLabs (/api/tts).
 * Browser TTS is OFF by default — user hated the bubbel/robot fallback.
 */

import { isRecord, readString } from '#/util/values.ts';

export type SpeakResult = {
	source: 'elevenlabs' | 'file' | 'browser' | 'silent';
	error?: string;
	durationMs?: number;
};

let audioEl: HTMLAudioElement | null = null;
let objectUrl: string | null = null;

/**
 * ElevenLabs credits do not reset inside a session, so a quota_exceeded is
 * terminal. Every further call is then a wasted request and a wasted frame. A
 * rate limit is temporary, so it backs off and reopens. Without this breaker
 * each voice subsystem kept hammering /api/tts on its own cadence after the
 * quota ran out, 135 requests in two minutes at 0 credits.
 */
type VoiceState = 'ok' | 'cooling' | 'open' | 'quota-dead';
let voiceState: VoiceState = 'ok';
let rateFailures = 0;
let coolUntil = 0;

const RATE_BACKOFF_BASE_MS = 2_000;
const RATE_BACKOFF_CAP_MS = 60_000;
const BREAKER_TRIP_FAILURES = 4;
const BREAKER_OPEN_MS = 120_000;

type FailKind = 'quota' | 'rate' | 'param' | 'transient';

function classifyFail(status: number, code: string): FailKind {
	if (code === 'quota_exceeded' || code === 'no_key' || code === 'auth') return 'quota';
	if (status === 401 || status === 402 || status === 403) return 'quota';
	if (code === 'rate_limited' || status === 429) return 'rate';
	if (code === 'bad_request' || status === 400) return 'param';
	return 'transient';
}

function setVoiceState(next: VoiceState, note: string): void {
	if (voiceState === next) return;
	voiceState = next;
	console.warn(`[ElevenVoice] ${note}`);
}

/** Update the breaker after a failed call: one log line per state change, never per attempt. */
function noteFailure(status: number, code: string, detail: string): void {
	if (classifyFail(status, code) === 'quota') {
		setVoiceState('quota-dead', `stemquota op, stemmen uit voor deze sessie (${detail.slice(0, 80)})`);
		return;
	}
	rateFailures++;
	const backoff = Math.min(RATE_BACKOFF_CAP_MS, RATE_BACKOFF_BASE_MS * 2 ** (rateFailures - 1));
	if (rateFailures >= BREAKER_TRIP_FAILURES) {
		coolUntil = performance.now() + BREAKER_OPEN_MS;
		setVoiceState('open', `stem-API blijft falen, circuit ${Math.round(BREAKER_OPEN_MS / 1000)}s dicht`);
	} else {
		coolUntil = performance.now() + backoff;
		setVoiceState('cooling', `stem-API traag of gelimiteerd, backoff ${Math.round(backoff / 1000)}s`);
	}
}

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
	const [b0 = 0, b1 = 0, b2 = 0] = u;
	// ID3 tag or MPEG frame sync
	return (b0 === 0x49 && b1 === 0x44 && b2 === 0x33) || (b0 === 0xff && (b1 & 0xe0) === 0xe0);
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

/** Local DJ audio served through the API instead of static file hosting. */
export async function playBoothFile(file: string, volume = 0.95): Promise<SpeakResult> {
	stopCurrent();
	audioEl = new Audio(`/api/dj/file/${encodeURIComponent(file)}`);
	const ms = await playElement(audioEl, volume);
	return { source: ms > 0 ? 'file' : 'silent', durationMs: ms };
}

type FetchTtsResult = { ok: true; buf: ArrayBuffer } | { ok: false; error: string; status: number; code: string };

async function fetchTts(text: string, voiceId?: string, lang?: string): Promise<FetchTtsResult> {
	const res = await fetch('/api/tts', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ text, voiceId, lang }),
	});
	const ct = (res.headers.get('content-type') || '').toLowerCase();
	if (!res.ok) {
		const err: unknown = await res.json().catch(() => ({}));
		const body = isRecord(err) ? err : {};
		return {
			ok: false,
			status: res.status,
			error: readString(body, 'error', `tts ${res.status}`),
			code: readString(body, 'code'),
		};
	}
	const buf = await res.arrayBuffer();
	// Accept audio even if content-type is wrong (some proxies strip it)
	if (buf.byteLength > 800 && (ct.includes('audio') || isMp3(buf) || !ct.includes('json'))) {
		if (ct.includes('json')) {
			// actually json body with 200? parse
			try {
				const j: unknown = JSON.parse(new TextDecoder().decode(buf));
				const body = isRecord(j) ? j : {};
				return { ok: false, status: 200, error: readString(body, 'error', 'json_body'), code: readString(body, 'code') };
			} catch {
				/* treat as audio */
			}
		}
		return { ok: true, buf };
	}
	return { ok: false, status: res.status, error: `bad_audio ct=${ct} bytes=${buf.byteLength}`, code: 'bad_audio' };
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

	// The breaker gates every call before it touches the network, so a dead quota
	// or an open circuit costs nothing.
	if (voiceState === 'quota-dead') return { source: 'silent', error: 'quota_dead', durationMs: 0 };
	if (voiceState !== 'ok' && performance.now() < coolUntil) {
		return { source: 'silent', error: 'voice_cooldown', durationMs: 0 };
	}

	if (opts.interrupt !== false) stopCurrent();

	try {
		let result = await fetchTts(text, opts.voiceId, opts.lang);
		// A bad voiceId or lang is the only failure a different request can fix.
		// Quota, rate and auth cannot, so they never fan out into futile retries.
		if (!result.ok && classifyFail(result.status, result.code) === 'param') {
			result = await fetchTts(text, undefined, undefined);
		}
		if (!result.ok) {
			noteFailure(result.status, result.code, result.error);
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

		if (voiceState !== 'ok') setVoiceState('ok', 'stem-API hersteld, stemmen weer aan');
		rateFailures = 0;

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
		noteFailure(0, '', String(e));
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

export async function speakBartek(text: string, opts: { voiceId?: string; volume?: number } = {}): Promise<SpeakResult> {
	return speakLine(text, { ...opts, voiceId: opts.voiceId ?? 'IKne3meq5aSn9XLyUdCD', lang: 'nl' });
}

function speakBrowser(text: string, volume: number): boolean {
	if (!window.speechSynthesis) return false;
	const u = new SpeechSynthesisUtterance(text);
	u.volume = volume;
	u.rate = 1.05;
	u.pitch = 0.95;
	const voices = window.speechSynthesis.getVoices();
	const pick =
		voices.find((v) => /dutch|nl-NL|nederlands/i.test(v.lang + v.name)) || voices.find((v) => /^en/i.test(v.lang)) || voices[0];
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
