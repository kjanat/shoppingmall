/**
 * Character speech via ElevenLabs (/api/tts).
 * Browser TTS is OFF by default — user hated the bubbel/robot fallback.
 */

import { isRecord, readString } from '#/util/values.ts';

interface SpeakResult {
	source: 'elevenlabs' | 'file' | 'browser' | 'silent';
	error?: string;
	durationMs?: number;
}

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
const MILLISECONDS_PER_SECOND = 1_000;
const FAILURE_DETAIL_LENGTH = 80;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_PAYMENT_REQUIRED = 402;
const HTTP_FORBIDDEN = 403;
const HTTP_RATE_LIMITED = 429;
const MP3_MIN_HEADER_BYTES = 4;
const ID3_FIRST_BYTE = 0x49;
const ID3_SECOND_BYTE = 0x44;
const ID3_THIRD_BYTE = 0x33;
const MPEG_SYNC_FIRST_BYTE = 0xff;
const MPEG_SYNC_SECOND_BYTE_MIN = 0xe0;
const DEFAULT_PLAYBACK_DURATION_MS = 2_500;
const DEFAULT_PLAYBACK_DURATION_SECONDS = 4;
const PLAYBACK_TIMEOUT_MS = 20_000;
const MIN_AUDIO_BYTES = 800;
const DEFAULT_VOLUME = 0.95;
const ESTIMATED_DURATION_CAP_MS = 12_000;
const BROWSER_DURATION_PER_CHARACTER_MS = 55;
const ELEVENLABS_DURATION_PER_CHARACTER_MS = 50;
const BROWSER_RATE = 1.05;
const BROWSER_PITCH = 0.95;
const BARTEK_VOICE_ID = ['IKne3meq5a', 'Sn9XLyUdCD'].join('');
const DUTCH_VOICE_PATTERN = /dutch|nl-NL|nederlands/i;
const ENGLISH_VOICE_PATTERN = /^en/i;

type FailKind = 'quota' | 'rate' | 'param' | 'transient';

function classifyFail(status: number, code: string): FailKind {
	if (code === 'quota_exceeded' || code === 'no_key' || code === 'auth') return 'quota';
	if (status === HTTP_UNAUTHORIZED || status === HTTP_PAYMENT_REQUIRED || status === HTTP_FORBIDDEN) return 'quota';
	if (code === 'rate_limited' || status === HTTP_RATE_LIMITED) return 'rate';
	if (code === 'bad_request' || status === HTTP_BAD_REQUEST) return 'param';
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
		setVoiceState('quota-dead', `stemquota op, stemmen uit voor deze sessie (${detail.slice(0, FAILURE_DETAIL_LENGTH)})`);
		return;
	}
	rateFailures++;
	const backoff = Math.min(RATE_BACKOFF_CAP_MS, RATE_BACKOFF_BASE_MS * 2 ** (rateFailures - 1));
	if (rateFailures >= BREAKER_TRIP_FAILURES) {
		coolUntil = performance.now() + BREAKER_OPEN_MS;
		setVoiceState('open', `stem-API blijft falen, circuit ${Math.round(BREAKER_OPEN_MS / MILLISECONDS_PER_SECOND)}s dicht`);
	} else {
		coolUntil = performance.now() + backoff;
		setVoiceState('cooling', `stem-API traag of gelimiteerd, backoff ${Math.round(backoff / MILLISECONDS_PER_SECOND)}s`);
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
	globalThis.speechSynthesis?.cancel();
}

function isMp3(buf: ArrayBuffer): boolean {
	if (buf.byteLength < MP3_MIN_HEADER_BYTES) return false;
	const u = new Uint8Array(buf);
	const [b0 = 0, b1 = 0, b2 = 0] = u;
	// ID3 tag or MPEG frame sync
	return (
		(b0 === ID3_FIRST_BYTE && b1 === ID3_SECOND_BYTE && b2 === ID3_THIRD_BYTE) ||
		(b0 === MPEG_SYNC_FIRST_BYTE && b1 >= MPEG_SYNC_SECOND_BYTE_MIN)
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
		el.onended = () =>
			finish(Number.isFinite(el.duration) ? el.duration * MILLISECONDS_PER_SECOND : DEFAULT_PLAYBACK_DURATION_MS);
		el.onerror = () => finish(0);
		const cap = globalThis.setTimeout(() => {
			finish(Math.min(PLAYBACK_TIMEOUT_MS, (el.duration || DEFAULT_PLAYBACK_DURATION_SECONDS) * MILLISECONDS_PER_SECOND));
		}, PLAYBACK_TIMEOUT_MS);
		el.play()
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
async function playBoothFile(file: string, volume = DEFAULT_VOLUME): Promise<SpeakResult> {
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
	if (buf.byteLength > MIN_AUDIO_BYTES && (ct.includes('audio') || isMp3(buf) || !ct.includes('json'))) {
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

async function requestTts(text: string, voiceId?: string, lang?: string): Promise<FetchTtsResult> {
	const result = await fetchTts(text, voiceId, lang);
	// A bad voiceId or lang is the only failure a different request can fix.
	// Quota, rate and auth cannot, so they never fan out into futile retries.
	if (!result.ok && classifyFail(result.status, result.code) === 'param') {
		return fetchTts(text, undefined, undefined);
	}
	return result;
}

function failedSpeakResult(text: string, volume: number, error: string, allowBrowser?: boolean): SpeakResult {
	if (!allowBrowser) return { source: 'silent', error, durationMs: 0 };
	const browser = speakBrowser(text, volume);
	return {
		source: browser ? 'browser' : 'silent',
		error,
		durationMs: browser ? Math.min(ESTIMATED_DURATION_CAP_MS, text.length * BROWSER_DURATION_PER_CHARACTER_MS) : 0,
	};
}

async function playElevenLabsResult(buf: ArrayBuffer, text: string, volume: number): Promise<SpeakResult> {
	if (voiceState !== 'ok') setVoiceState('ok', 'stem-API hersteld, stemmen weer aan');
	rateFailures = 0;

	objectUrl = URL.createObjectURL(new Blob([buf], { type: 'audio/mpeg' }));
	const currentAudio = new Audio(objectUrl);
	audioEl = currentAudio;
	const ms = await playElement(currentAudio, volume);
	if (ms <= 0) {
		// autoplay blocked — still ElevenLabs data, try again after tiny delay
		try {
			await currentAudio.play();
		} catch {
			/* */
		}
		return {
			source: 'elevenlabs',
			error: 'play_blocked_or_short',
			durationMs: Math.min(ESTIMATED_DURATION_CAP_MS, text.length * ELEVENLABS_DURATION_PER_CHARACTER_MS),
		};
	}
	return { source: 'elevenlabs', durationMs: ms };
}

/**
 * Speak via ElevenLabs. Browser TTS only if allowBrowser: true.
 */
async function speakLine(
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
	const volume = opts.volume ?? DEFAULT_VOLUME;

	// The breaker gates every call before it touches the network, so a dead quota
	// or an open circuit costs nothing.
	if (voiceState === 'quota-dead') return { source: 'silent', error: 'quota_dead', durationMs: 0 };
	if (voiceState !== 'ok' && performance.now() < coolUntil) {
		return { source: 'silent', error: 'voice_cooldown', durationMs: 0 };
	}

	if (opts.interrupt !== false) stopCurrent();

	try {
		const result = await requestTts(text, opts.voiceId, opts.lang);
		if (!result.ok) {
			noteFailure(result.status, result.code, result.error);
			return failedSpeakResult(text, volume, result.error, opts.allowBrowser);
		}
		return await playElevenLabsResult(result.buf, text, volume);
	} catch (e) {
		const error = String(e);
		noteFailure(0, '', error);
		return failedSpeakResult(text, volume, error, opts.allowBrowser);
	}
}

function speakBartek(text: string, opts: { voiceId?: string; volume?: number } = {}): Promise<SpeakResult> {
	return speakLine(text, { ...opts, voiceId: opts.voiceId ?? BARTEK_VOICE_ID, lang: 'nl' });
}

function speakBrowser(text: string, volume: number): boolean {
	if (!globalThis.speechSynthesis) return false;
	const u = new SpeechSynthesisUtterance(text);
	u.volume = volume;
	u.rate = BROWSER_RATE;
	u.pitch = BROWSER_PITCH;
	const voices = globalThis.speechSynthesis.getVoices();
	const pick =
		voices.find((v) => DUTCH_VOICE_PATTERN.test(v.lang + v.name)) ||
		voices.find((v) => ENGLISH_VOICE_PATTERN.test(v.lang)) ||
		voices[0];
	if (pick) u.voice = pick;
	globalThis.speechSynthesis.speak(u);
	return true;
}

async function fetchDjStatus(): Promise<{
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

interface ElevenVoice {
	fetchDjStatus: typeof fetchDjStatus;
	playBoothFile: typeof playBoothFile;
	speakBartek: typeof speakBartek;
	speakLine: typeof speakLine;
}

export type { ElevenVoice, SpeakResult };
export { fetchDjStatus, playBoothFile, speakBartek, speakLine };
