/**
 * DJ Bartek + mall sim brain. Web-standard `Request → Response`, mounted by
 * Bun.serve in server/main.ts. Bun-native I/O throughout: nothing here may
 * block the event loop while a track streams.
 * - POST /api/tts          → ElevenLabs
 * - POST /api/sim/chat     → OpenRouter SDK (sims talk; Broadcast user/session/trace)
 * - GET  /api/dj/playlist  → list private DJ audio storage
 * - POST /api/dj/request   → YouTube API search + yt-dlp download
 * - GET  /api/dj/status    → DJ state + key presence
 * - GET  /api/healthz      → minimale liveness voor Docker
 * - GET  /api/statusz      → runtime- en buildinformatie; details alleen voor eigen afzenders
 */

import { mkdir } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { cwd } from 'node:process';
import type { ElevenLabs } from '@elevenlabs/elevenlabs-js';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { OpenRouter } from '@openrouter/sdk';
import { env } from 'bun';
import { isRecord, readNumber, readString } from '#/util/values.ts';
import type { LibraryTrack } from './djLibrary.ts';
import {
	AUDIO_EXTENSIONS,
	DjLibrary,
	importLegacySidecars,
	isAudioFileName,
	parseYtDlpOutput,
	YT_DLP_META_PRINT,
} from './djLibrary.ts';
import { clientIp, isOurs } from './net.ts';

const BOOT = Date.now();

const HTTP_OK = 200;
const HTTP_PARTIAL_CONTENT = 206;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_PAYMENT_REQUIRED = 402;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_CONTENT_TOO_LARGE = 413;
const HTTP_RANGE_NOT_SATISFIABLE = 416;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_INTERNAL_SERVER_ERROR = 500;
const HTTP_BAD_GATEWAY = 502;
const HTTP_SERVICE_UNAVAILABLE = 503;
const MILLISECONDS_PER_SECOND = 1_000;
const THIRTY_SECONDS_MS = 30_000;
const MINUTE_MS = 60_000;
const TTS_TEXT_MAX_LENGTH = 800;
const TTS_NL_STABILITY = 0.42;
const TTS_DEFAULT_STABILITY = 0.32;
const TTS_SIMILARITY_BOOST = 0.82;
const TTS_NL_STYLE = 0.35;
const TTS_DEFAULT_STYLE = 0.55;
const BROADCAST_USER_MAX_LENGTH = 128;
const BROADCAST_SESSION_MAX_LENGTH = 256;
const BROADCAST_ID_MIN_LENGTH = 4;
const SIM_MEAN_UNHAPPINESS = 55;
const SIM_CONTEXT_MAX_LENGTH = 64;
const SIM_LINE_MAX_LENGTH = 60;
const SIM_BAD_JSON_PREVIEW_LENGTH = 100;
const SIM_TEMPERATURE = 1.05;
const SIM_MAX_TOKENS = 100;
const YOUTUBE_ERROR_PREVIEW_LENGTH = 180;
const NEW_FILE_CLOCK_TOLERANCE_MS = 500;
const MAX_TRACK_DURATION_SECONDS = 3_600;
const YT_DLP_FILTER_REJECTED_EXIT_CODE = 101;
const YT_DLP_LOG_LENGTH = 2_500;
const TRACK_QUERY_MAX_LENGTH = 100;
const TRACK_REQUEST_LOG_LENGTH = 3_000;
const TRACK_RESPONSE_LOG_LENGTH = 800;
const BROADCAST_MEAN_MODE_KEY = ['mean', 'mode'].join('_');
const BROADCAST_UNHAPPINESS_A_KEY = ['unhappiness', 'a'].join('_');
const BROADCAST_UNHAPPINESS_B_KEY = ['unhappiness', 'b'].join('_');
const BROADCAST_PERSONA_A_KEY = ['persona', 'a'].join('_');
const BROADCAST_PERSONA_B_KEY = ['persona', 'b'].join('_');
const BROADCAST_IS_KID_A_KEY = ['is', 'kid', 'a'].join('_');
const BROADCAST_IS_KID_B_KEY = ['is', 'kid', 'b'].join('_');
const EXTERNAL_USER_ID_KEY = ['user', 'id'].join('_');
const EXTERNAL_SESSION_ID_KEY = ['session', 'id'].join('_');
const CHARLIE_VOICE_ID = ['IKne3meq5a', 'Sn9XLyUdCD'].join('');
const STATUS_VOICE_ID = ['pNInz6obpg', 'DQGcFmaJgB'].join('');
const BYTE_RANGE_PATTERN = /^bytes=(\d*)-(\d*)$/;

function uptimeSeconds(): number {
	return Math.round((Date.now() - BOOT) / MILLISECONDS_PER_SECOND);
}

const DJ_DATA_DIR = resolve('data/dj');
const MUSIC_DIR = join(DJ_DATA_DIR, 'music');
const AUDIO_EXT = new Set<string>(AUDIO_EXTENSIONS);

async function ensureMusicDir(): Promise<void> {
	await mkdir(MUSIC_DIR, { recursive: true });
}

let djLibrary: DjLibrary | undefined;
let legacyImport: Promise<number> | undefined;

async function ensureLibrary(): Promise<DjLibrary> {
	await ensureMusicDir();
	await mkdir(DJ_DATA_DIR, { recursive: true });
	djLibrary ??= new DjLibrary(join(DJ_DATA_DIR, 'library.sqlite'));
	legacyImport ??= importLegacySidecars(MUSIC_DIR, djLibrary);
	await legacyImport;
	return djLibrary;
}

interface TrackMeta {
	file: string;
	title: string;
	url: string;
	bytes: number;
	/** From the DJ library database, when the track came in through a request. */
	artist?: string;
	seconds?: number;
	videoId?: string;
	sourceUrl?: string;
}

async function listPlaylist(): Promise<TrackMeta[]> {
	const library = await ensureLibrary();
	const metadata = new Map(library.allTracks().map((track) => [track.file, track]));
	const names: string[] = [];
	for await (const name of new Bun.Glob('*').scan({ cwd: MUSIC_DIR, onlyFiles: true })) {
		if (AUDIO_EXT.has(extname(name).toLowerCase())) names.push(name);
	}
	return (
		await Promise.all(
			names.map(async (f) => {
				const meta = metadata.get(f);
				const stat = await Bun.file(join(MUSIC_DIR, f)).stat();
				return {
					file: f,
					title: meta?.title ?? basename(f, extname(f)).replace(/[_-]+/g, ' '),
					// Audio storage is private. This API route is its only browser boundary.
					url: `/api/dj/file/${encodeURIComponent(f)}`,
					bytes: stat.size,
					...(meta?.artist ? { artist: meta.artist } : {}),
					...(meta?.durationSeconds === undefined ? {} : { seconds: meta.durationSeconds }),
					...(meta?.youtubeId ? { videoId: meta.youtubeId } : {}),
					...(meta?.sourceUrl ? { sourceUrl: meta.sourceUrl } : {}),
				};
			}),
		)
	).sort((a, b) => a.title.localeCompare(b.title));
}

const AUDIO_MIME: Record<string, string> = {
	'.mp3': 'audio/mpeg',
	'.m4a': 'audio/mp4',
	'.ogg': 'audio/ogg',
	'.webm': 'audio/webm',
	'.wav': 'audio/wav',
	'.opus': 'audio/ogg',
};

/**
 * These routes spend real money (ElevenLabs, OpenRouter, YouTube quota) and write
 * files to disk (yt-dlp), and the dev server binds every interface
 * (`server.host = true`) with `allowedHosts: true`. So: bounded bodies, no
 * cross-site callers, and a ceiling on how fast anyone can burn credits.
 */
const BODY_LIMIT = 65_536; // 64 * 1024
const RATE_LIMITS: Record<string, { max: number; windowMs: number }> = {
	'/api/tts': { max: 30, windowMs: MINUTE_MS },
	'/api/sim/chat': { max: 40, windowMs: MINUTE_MS },
	'/api/dj/request': { max: 6, windowMs: MINUTE_MS },
};
const rateHits = new Map<string, number[]>();

function rateLimited(ip: string, route: string): boolean {
	const cfg = RATE_LIMITS[route];
	if (!cfg) return false;
	const now = Date.now();
	const key = `${ip}|${route}`;
	const bucket = (rateHits.get(key) ?? []).filter((t) => now - t < cfg.windowMs);
	rateHits.set(key, bucket);
	if (bucket.length >= cfg.max) return true;
	bucket.push(now);
	return false;
}

/** A browser on some other site must not be able to drive this API. */
function crossSite(req: Request): boolean {
	const origin = req.headers.get('origin');
	if (!origin) return false; // same-origin fetch, curl, or the app itself
	try {
		return new URL(origin).host !== req.headers.get('host');
	} catch {
		return true;
	}
}

async function readJson<T>(req: Request): Promise<T> {
	if (Number(req.headers.get('content-length') ?? 0) > BODY_LIMIT) {
		throw new Error('body_too_large');
	}
	const raw = await req.text();
	if (raw.length > BODY_LIMIT) throw new Error('body_too_large');
	return JSON.parse(raw || '{}');
}

function json(code: number, data: unknown): Response {
	return Response.json(data, { status: code });
}

/**
 * Generation cost + debug ids come back as response headers.
 * @see https://elevenlabs.io/docs/api-reference/introduction
 */
interface TtsResult {
	audio: ReadableStream<Uint8Array>;
	characterCost: number;
	requestId: string | null;
	traceId: string | null;
}

/** Characters billed since boot — surfaced on /api/dj/status */
let ttsCharacters = 0;
let elevenClient: ElevenLabsClient | null = null;

/**
 * A parsed ElevenLabs failure: a stable `code` the browser can act on without
 * grepping the raw exception text, plus the HTTP status to answer with.
 */
interface TtsErrorInfo {
	status: number;
	code: string;
	message: string;
}

function classifyTtsError(e: unknown): TtsErrorInfo {
	const rec = isRecord(e) ? e : {};
	const statusCode = readNumber(rec, 'statusCode', 0);
	const body = rec['body'];
	const detail = isRecord(body) ? body['detail'] : undefined;
	const detailStatus = isRecord(detail) ? readString(detail, 'status') : '';
	const message = readString(rec, 'message') || String(e);
	const hay = `${detailStatus} ${message}`.toLowerCase();
	if (detailStatus === 'quota_exceeded' || hay.includes('quota')) {
		return { status: HTTP_PAYMENT_REQUIRED, code: 'quota_exceeded', message };
	}
	if (statusCode === HTTP_TOO_MANY_REQUESTS || hay.includes('rate limit') || hay.includes('too many requests')) {
		return { status: HTTP_TOO_MANY_REQUESTS, code: 'rate_limited', message };
	}
	if (
		statusCode === HTTP_UNAUTHORIZED ||
		statusCode === HTTP_FORBIDDEN ||
		hay.includes('api key') ||
		hay.includes('unauthorized')
	) {
		return { status: HTTP_UNAUTHORIZED, code: 'auth', message };
	}
	if (statusCode === HTTP_BAD_REQUEST) return { status: HTTP_BAD_REQUEST, code: 'bad_request', message };
	return { status: HTTP_BAD_GATEWAY, code: 'unknown', message };
}

/**
 * Server-side twin of the browser breaker: once ElevenLabs reports the quota is
 * gone (or the key is bad), stop spending on doomed calls for every client, not
 * just the one that hit it. Time-boxed so a monthly reset reopens without a
 * restart. Quota backs off long, a rate limit briefly.
 */
const TTS_QUOTA_COOLDOWN_MS = 10 * MINUTE_MS;
const TTS_RATE_COOLDOWN_MS = THIRTY_SECONDS_MS;
let ttsBreakerUntil = 0;
let ttsBreakerInfo: TtsErrorInfo | null = null;

function tripTtsBreaker(info: TtsErrorInfo): void {
	if (info.code === 'quota_exceeded' || info.code === 'auth') {
		ttsBreakerUntil = Date.now() + TTS_QUOTA_COOLDOWN_MS;
		ttsBreakerInfo = info;
	} else if (info.code === 'rate_limited') {
		ttsBreakerUntil = Date.now() + TTS_RATE_COOLDOWN_MS;
		ttsBreakerInfo = info;
	}
}

async function elevenLabsTts(text: string, voiceId?: string, lang?: string): Promise<TtsResult | null> {
	if (!env['ELEVENLABS_API_KEY']) return null;

	const voice = voiceId || env['ELEVENLABS_VOICE_ID']?.trim() || CHARLIE_VOICE_ID;

	// The SDK reads ELEVENLABS_API_KEY itself
	elevenClient ??= new ElevenLabsClient();
	const client = elevenClient;

	const request: ElevenLabs.StreamTextToSpeechRequest = {
		text: text.slice(0, TTS_TEXT_MAX_LENGTH),
		// Flash v2.5: ~75ms latency and half the credits per character, 32 langs
		// incl. NL. Mall one-liners don't need multilingual_v2's long-form
		// fidelity — set ELEVENLABS_MODEL_ID to go back.
		modelId: env['ELEVENLABS_MODEL_ID']?.trim() || 'eleven_flash_v2_5',
		voiceSettings: {
			stability: lang === 'nl' ? TTS_NL_STABILITY : TTS_DEFAULT_STABILITY,
			similarityBoost: TTS_SIMILARITY_BOOST,
			style: lang === 'nl' ? TTS_NL_STYLE : TTS_DEFAULT_STYLE,
			useSpeakerBoost: true,
		},
	};

	// `stream` (chunked transfer) over `convert`: the mall hears the first
	// syllables while the rest is still generating. withRawResponse keeps the
	// headers reachable — that's where billing (character-cost) and debug ids live.
	const convert = (payload: typeof request & { languageCode?: string }) =>
		client.textToSpeech.stream(voice, payload).withRawResponse();

	// Multilingual language hint when supported; can 400 on some accounts —
	// retry bare only for that, not for auth/quota (would double-spend).
	const out = await (lang
		? convert({ ...request, languageCode: lang }).catch((e: { statusCode?: number }) => {
				if (e.statusCode !== HTTP_BAD_REQUEST) throw e;
				return convert(request);
			})
		: convert(request));

	const headers = out.rawResponse.headers;
	const characterCost = Number(headers.get('character-cost') ?? 0);
	ttsCharacters += characterCost;

	return {
		audio: out.data,
		characterCost,
		requestId: headers.get('request-id'),
		traceId: headers.get('x-trace-id'),
	};
}

/**
 * OpenRouter app attribution (rankings / activity dashboard).
 * Docs: https://openrouter.ai/docs/app-attribution
 *
 * Env overrides:
 *   OPENROUTER_HTTP_REFERER · OPENROUTER_APP_TITLE · OPENROUTER_APP_CATEGORIES
 */
function openRouterAppMeta(): {
	httpReferer: string;
	appTitle: string;
	appCategories: string;
} {
	const httpReferer = (env['OPENROUTER_HTTP_REFERER'] || env['OPENROUTER_SITE_URL'] || 'https://prairie-lakes-mall.local').trim();
	const appTitle = (env['OPENROUTER_APP_TITLE'] || env['OPENROUTER_TITLE'] || 'Prairie Lakes Mall SIM').trim();
	const appCategories = (env['OPENROUTER_APP_CATEGORIES'] || 'game,roleplay').trim().toLowerCase().replace(/\s+/g, '');
	return { httpReferer, appTitle, appCategories };
}

/** Lazy singleton OpenRouter client with app attribution baked in */
let openRouterClient: OpenRouter | null = null;
function getOpenRouter(): OpenRouter | null {
	if (!env['OPENROUTER_API_KEY']) return null;
	if (!openRouterClient) {
		const meta = openRouterAppMeta();
		// The SDK reads OPENROUTER_API_KEY itself
		openRouterClient = new OpenRouter({
			httpReferer: meta.httpReferer,
			appTitle: meta.appTitle,
			appCategories: meta.appCategories,
		});
	}
	return openRouterClient;
}

/**
 * OpenRouter Broadcast optional trace fields
 * https://openrouter.ai/docs/guides/features/broadcast
 *   user       ≤128  end-user analytics + abuse isolation
 *   session_id ≤256  sticky routing + session grouping
 */
function sanitizeUserId(raw: unknown): string | undefined {
	if (typeof raw !== 'string') return undefined;
	const cleaned = raw
		.trim()
		.replace(/[^\w.:\-#/]/g, '')
		.slice(0, BROADCAST_USER_MAX_LENGTH);
	return cleaned.length >= BROADCAST_ID_MIN_LENGTH ? cleaned : undefined;
}

function sanitizeSessionId(raw: unknown): string | undefined {
	if (typeof raw !== 'string') return undefined;
	const cleaned = raw
		.trim()
		.replace(/[^\w.:\-#/]/g, '')
		.slice(0, BROADCAST_SESSION_MAX_LENGTH);
	return cleaned.length >= BROADCAST_ID_MIN_LENGTH ? cleaned : undefined;
}

interface SimPersona {
	name: string;
	mood: string;
	lifeLine: string;
	targetShop: string;
	unhappiness: number;
	partnerName?: string | null;
	isKid?: boolean;
	isBrad?: boolean;
	isMiss?: boolean;
}

interface SimChatInput {
	a: SimPersona;
	b: SimPersona;
	context?: string;
	sessionId?: string;
	userId?: string;
}

type SimChatResult = { a: string; b: string } | { error: string };

const SIM_SYSTEM_PROMPT = `\
Je schrijft korte mall-dialoog voor dikke Amerikaanse shoppers (Prairie Lakes SIM).

Regels:
- Max 14 woorden per regel, spreektaal NL + bit of English mall slang
- Geen corporate woke filter: jaloers, snarky, roast-y is OK
- Soms haat over etniciteit/religie/seksuele oriëntatie, vaak schelden over: looks, thicc, mood, slechte deals, trage benen, pageant-snobs, vitamine-nerds, hangry, lost
- Als unhappiness hoog: ze ROASTEN elkaar harder (kut, lul, loser, basic, whatever — mall trash talk)
- Als unhappiness laag: milder gezeur of flirten
- Kids: kinderachtig gezeur, geen echt grove scheld
- Brad = vitamine-obsessed; Miss = hot/snob/pageant; koppels mogen ruzie/liefde. Bedenk nog meer van zulke shit, i don't care wat. verzin gewoon shitty dialoog.
- Security is amerikaans en schiet op alles dat los en vast zit.
- Ze praten TEGEN elkaar, reageren op elkaars vibe
`;

function simPrompt(input: SimChatInput, meanA: boolean, meanB: boolean): string {
	const { a, b, context } = input;
	return `A: ${a.name} · mood=${a.mood} · "${a.lifeLine}" · → ${a.targetShop} · ☹${Math.round(a.unhappiness)}%${
		meanA ? ' · MEAN' : ''
	}${a.partnerName ? ` · ❤️ ${a.partnerName}` : ''}${a.isKid ? ' · KID' : ''}${a.isBrad ? ' · BRAD' : ''}${
		a.isMiss ? ' · HOT MISS' : ''
	}
B: ${b.name} · mood=${b.mood} · "${b.lifeLine}" · → ${b.targetShop} · ☹${Math.round(b.unhappiness)}%${
		meanB ? ' · MEAN' : ''
	}${b.partnerName ? ` · ❤️ ${b.partnerName}` : ''}${b.isKid ? ' · KID' : ''}${b.isBrad ? ' · BRAD' : ''}${
		b.isMiss ? ' · HOT MISS' : ''
	}
Context: ${context ?? 'corridor botsing'}
1 zin A, 1 antwoord B. ${meanA || meanB ? 'ROAST mode.' : 'Normaal mall gezeur.'}`;
}

function broadcastProperties(
	input: SimChatInput,
	context: string,
	meanA: boolean,
	meanB: boolean,
): Record<string, string | number | boolean> {
	return {
		feature: 'sim-chat',
		environment: env.NODE_ENV ?? 'development',
		context,
		[BROADCAST_MEAN_MODE_KEY]: meanA || meanB,
		[BROADCAST_UNHAPPINESS_A_KEY]: Math.round(input.a.unhappiness),
		[BROADCAST_UNHAPPINESS_B_KEY]: Math.round(input.b.unhappiness),
		[BROADCAST_PERSONA_A_KEY]: input.a.name.split(' ')[0] ?? input.a.name,
		[BROADCAST_PERSONA_B_KEY]: input.b.name.split(' ')[0] ?? input.b.name,
		[BROADCAST_IS_KID_A_KEY]: !!input.a.isKid,
		[BROADCAST_IS_KID_B_KEY]: !!input.b.isKid,
	};
}

function simChatRequest(input: SimChatInput, meanA: boolean, meanB: boolean): Parameters<OpenRouter['chat']['send']>[0] {
	const context = (input.context ?? 'corridor botsing').trim().slice(0, SIM_CONTEXT_MAX_LENGTH) || 'corridor';
	return {
		chatRequest: {
			model: env['OPENROUTER_MODEL']?.trim() || 'x-ai/grok-4.20',
			temperature: SIM_TEMPERATURE,
			maxTokens: SIM_MAX_TOKENS,
			stream: false,
			responseFormat: {
				type: 'json_schema',
				jsonSchema: {
					name: 'mall_banter',
					strict: true,
					schema: {
						type: 'object',
						properties: {
							a: { type: 'string', description: 'wat A zegt, max 14 woorden' },
							b: { type: 'string', description: 'wat B terugzegt, max 14 woorden' },
						},
						required: ['a', 'b'],
						additionalProperties: false,
					},
				},
			},
			...(input.userId ? { user: input.userId } : {}),
			...(input.sessionId ? { sessionId: input.sessionId } : {}),
			trace: {
				traceName: 'Prairie Lakes Mall SIM',
				spanName: 'sim-chat',
				generationName: 'guest-banter',
				additionalProperties: broadcastProperties(input, context, meanA, meanB),
			},
			messages: [
				{ role: 'system', content: SIM_SYSTEM_PROMPT },
				{ role: 'user', content: simPrompt(input, meanA, meanB) },
			],
		},
	};
}

function chatContentText(content: unknown): string {
	if (typeof content === 'string') return content.trim();
	if (!Array.isArray(content)) return '';
	return content
		.map((part) => (isRecord(part) ? readString(part, 'text') : ''))
		.join('')
		.trim();
}

function parseSimChat(raw: string): SimChatResult {
	try {
		const parsed: unknown = JSON.parse(raw);
		if (isRecord(parsed)) {
			const lineA = readString(parsed, 'a').trim().slice(0, SIM_LINE_MAX_LENGTH);
			const lineB = readString(parsed, 'b').trim().slice(0, SIM_LINE_MAX_LENGTH);
			if (lineA && lineB) return { a: lineA, b: lineB };
		}
	} catch {
		// Schema violation is returned to the caller instead of guessed around.
	}
	return { error: `bad_json: ${raw.slice(0, SIM_BAD_JSON_PREVIEW_LENGTH)}` };
}

/**
 * Two mall guests exchange short lines via @openrouter/sdk.
 * Browser supplies user + sessionId; we attach Broadcast `trace` metadata.
 */
async function simChatExchange(input: SimChatInput): Promise<SimChatResult> {
	const openrouter = getOpenRouter();
	if (!openrouter) return { error: 'no_openrouter_key' };
	const meanA = input.a.unhappiness >= SIM_MEAN_UNHAPPINESS;
	const meanB = input.b.unhappiness >= SIM_MEAN_UNHAPPINESS;

	try {
		const completion = await openrouter.chat.send(simChatRequest(input, meanA, meanB));
		if (!('choices' in completion && completion.choices && completion.choices.length > 0)) {
			return { error: 'openrouter_empty_choices' };
		}
		const content = completion.choices[0]?.message?.content;
		return parseSimChat(chatContentText(content));
	} catch (e) {
		return { error: String(e) };
	}
}

/** Official YouTube Data API search — more reliable than yt-dlp ytsearch */
async function youtubeSearch(query: string): Promise<{ videoId: string; title: string } | { error: string }> {
	const key = env['YOUTUBE_API_KEY'];
	if (!key) return { error: 'no_youtube_api_key' };

	const params = new URLSearchParams({
		part: 'snippet',
		type: 'video',
		maxResults: '5',
		q: query,
		videoEmbeddable: 'true',
		// Prefer music-ish results; still free-form query
		safeSearch: 'none',
		key,
	});
	const url = `https://www.googleapis.com/youtube/v3/search?${params}`;
	const res = await fetch(url);
	if (!res.ok) {
		const err = await res.text();
		return { error: `youtube_search ${res.status}: ${err.slice(0, YOUTUBE_ERROR_PREVIEW_LENGTH)}` };
	}
	const data: unknown = await res.json();
	if (!(isRecord(data) && Array.isArray(data['items']))) return { error: 'no_results' };
	for (const item of data['items']) {
		if (!(isRecord(item) && isRecord(item['id']))) continue;
		const videoId = readString(item['id'], 'videoId');
		if (!videoId) continue;
		const title = isRecord(item['snippet']) ? readString(item['snippet'], 'title') : '';
		return { videoId, title: title || videoId };
	}
	return { error: 'no_results' };
}

async function newestMusicFile(beforeMs: number): Promise<string | undefined> {
	const tracks = await listPlaylist();
	const stamped = await Promise.all(
		tracks.map(async (t) => ({
			file: t.file,
			mtime: Bun.file(join(MUSIC_DIR, t.file)).lastModified,
		})),
	);
	return stamped.filter((t) => t.mtime >= beforeMs - NEW_FILE_CLOCK_TOLERANCE_MS).sort((a, b) => b.mtime - a.mtime)[0]?.file;
}

interface YtDlpResult {
	ok: boolean;
	log: string;
	file?: string;
	metadata?: LibraryTrack;
	dump?: string;
}

function ytDlpArgs(watchUrl: string): string[] {
	// biome-ignore format: leave me alone
	return [
		'-f', 'bestaudio/best',
		'-x',
		'--audio-format', 'mp3',
		'--audio-quality', '5',
		'--no-playlist',
		'--no-warnings',
		'--no-progress',
		'--no-mtime',
		// Part suffixes keep interrupted downloads out of the audio library.
		'--max-filesize', '150M',
		'--match-filter', `duration<=${MAX_TRACK_DURATION_SECONDS}`,
		'--retries', '1',
		'--socket-timeout', '15',
		'-o', join(MUSIC_DIR, '%(title).80s [%(id)s].%(ext)s'),
		'--no-write-info-json',
		'--print', YT_DLP_META_PRINT,
		'--extractor-args', 'youtube:player_client=android,web',
		watchUrl,
	];
}

async function executeYtDlp(watchUrl: string): Promise<{ out: string; err: string; code: number }> {
	const proc = Bun.spawn(['yt-dlp', ...ytDlpArgs(watchUrl)], { cwd: cwd(), stdout: 'pipe', stderr: 'pipe' });
	const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
	return { out, err, code };
}

function ytDlpLog(out: string, err: string): string {
	return [out, err]
		.flatMap((stream) => stream.split('\n'))
		.filter((line) => !line.trim().startsWith('MALLMETA:'))
		.join('\n')
		.slice(-YT_DLP_LOG_LENGTH);
}

async function runYtDlpUrl(watchUrl: string): Promise<YtDlpResult> {
	await ensureMusicDir();
	const before = Date.now();
	try {
		const { out, err, code } = await executeYtDlp(watchUrl);
		const fileFromDisk = await newestMusicFile(before);
		const capture = parseYtDlpOutput(out, fileFromDisk) ?? parseYtDlpOutput(err, fileFromDisk);
		const capturedFile = capture?.track.file;
		const capturedFileExists = capturedFile ? await Bun.file(join(MUSIC_DIR, capturedFile)).exists() : false;
		const file = capturedFileExists ? capturedFile : fileFromDisk;
		return {
			ok: (code === 0 || code === YT_DLP_FILTER_REJECTED_EXIT_CODE) && !!file,
			log: ytDlpLog(out, err),
			file,
			...(capture ? { metadata: capture.track, dump: capture.dump } : {}),
		};
	} catch (e) {
		return { ok: false, log: String(e) };
	}
}

interface TrackRequestResult {
	ok: boolean;
	log: string;
	file?: string;
	title?: string;
	videoId?: string;
}

interface TrackSearch {
	watchUrl: string;
	log: string;
	title?: string;
	videoId?: string;
}

async function resolveTrackSearch(clean: string): Promise<TrackSearch> {
	if (!env['YOUTUBE_API_KEY']) return { watchUrl: `ytsearch1:${clean}`, log: '[fallback] ytsearch1 (no API hit)\n' };
	const hit = await youtubeSearch(clean);
	if ('error' in hit) {
		return { watchUrl: `ytsearch1:${clean}`, log: `[youtube-api] ${hit.error}\n[fallback] ytsearch1 (no API hit)\n` };
	}
	return {
		watchUrl: `https://www.youtube.com/watch?v=${hit.videoId}`,
		log: `[youtube-api] ${hit.videoId} · ${hit.title}\n`,
		title: hit.title,
		videoId: hit.videoId,
	};
}

async function existingTrack(library: DjLibrary, search: TrackSearch): Promise<TrackRequestResult | undefined> {
	if (!search.videoId) return undefined;
	const track = library.trackByYoutubeId(search.videoId);
	if (!(track && (await Bun.file(join(MUSIC_DIR, track.file)).exists()))) return undefined;
	return {
		ok: true,
		log: `${search.log}[library] already have ${track.file}\n`.slice(-TRACK_REQUEST_LOG_LENGTH),
		file: track.file,
		title: track.title,
		videoId: search.videoId,
	};
}

/** Search (YouTube API) → download (yt-dlp by URL). Fallback: ytsearch. */
async function requestTrack(query: string): Promise<TrackRequestResult> {
	const clean = query
		.replace(/[^\w\s\-'.!&()áéíóúäëïöüàèìòùñç]/gi, ' ')
		.trim()
		.slice(0, TRACK_QUERY_MAX_LENGTH);
	if (!clean) return { ok: false, log: 'empty query' };

	const library = await ensureLibrary();
	const search = await resolveTrackSearch(clean);
	const existing = await existingTrack(library, search);
	if (existing) return existing;
	const dl = await runYtDlpUrl(search.watchUrl);
	if (dl.ok && dl.file) {
		const metadata = dl.metadata ?? {
			file: dl.file,
			title: search.title ?? basename(dl.file, extname(dl.file)),
			downloadedAt: Date.now(),
			...(search.videoId ? { youtubeId: search.videoId } : {}),
		};
		library.saveTrack({ ...metadata, file: dl.file, requestedQuery: clean, downloadedAt: Date.now() }, dl.dump);
	}
	return {
		ok: dl.ok,
		log: `${search.log}${dl.log}`.slice(-TRACK_REQUEST_LOG_LENGTH),
		file: dl.file,
		title: dl.metadata?.title ?? search.title,
		videoId: dl.metadata?.youtubeId ?? search.videoId,
	};
}

interface SimChatBody extends Record<string, unknown> {
	a?: SimPersona;
	b?: SimPersona;
	context?: string;
	user?: string;
	userId?: string;
	sessionId?: string;
}

async function handleStatus(ip: string): Promise<Response> {
	const body: Record<string, unknown> = { ok: true, uptime: uptimeSeconds() };
	if (await isOurs(ip)) {
		body['version'] = typeof __GIT_DESCRIBE__ === 'undefined' ? 'dev' : __GIT_DESCRIBE__;
		body['features'] = typeof __MALL_FEATURES__ === 'undefined' ? [] : __MALL_FEATURES__;
	}
	return json(HTTP_OK, body);
}

async function handleDjStatus(): Promise<Response> {
	const app = openRouterAppMeta();
	return json(HTTP_OK, {
		ok: true,
		elevenlabs: !!env['ELEVENLABS_API_KEY'],
		youtubeApi: !!env['YOUTUBE_API_KEY'],
		openrouter: !!env['OPENROUTER_API_KEY'],
		openrouterSdk: true,
		openrouterApp: app.appTitle,
		openrouterCategories: app.appCategories,
		openrouterReferer: app.httpReferer,
		openrouterBroadcast: ['user', 'session_id', 'trace'],
		tracks: (await listPlaylist()).length,
		ttsCharacters,
		booth: 'DJ Bartek · Trap-gat · Prairie Lakes',
		voice: env['ELEVENLABS_VOICE_ID']?.trim() || STATUS_VOICE_ID,
	});
}

async function handleSimChat(req: Request): Promise<Response> {
	const body = await readJson<SimChatBody>(req);
	if (!(body.a?.name && body.b?.name)) return json(HTTP_BAD_REQUEST, { error: 'a and b personas required' });
	const sessionId = sanitizeSessionId(body.sessionId ?? body[EXTERNAL_SESSION_ID_KEY]);
	const userId = sanitizeUserId(body.user ?? body.userId ?? body[EXTERNAL_USER_ID_KEY]);
	const result = await simChatExchange({ a: body.a, b: body.b, context: body.context, sessionId, userId });
	if ('error' in result) return json(HTTP_BAD_GATEWAY, { ok: false, error: result.error });
	return json(HTTP_OK, { ok: true, ...result, user: userId ?? null, sessionId: sessionId ?? null });
}

async function handleTrackRequest(req: Request): Promise<Response> {
	const body = await readJson<{ query?: string }>(req);
	const query = (body.query ?? '').trim();
	if (!query) return json(HTTP_BAD_REQUEST, { ok: false, error: 'query required' });
	const result = await requestTrack(query);
	return json(result.ok ? HTTP_OK : HTTP_INTERNAL_SERVER_ERROR, {
		ok: result.ok,
		file: result.file,
		title: result.title,
		videoId: result.videoId,
		tracks: await listPlaylist(),
		log: result.log.slice(-TRACK_RESPONSE_LOG_LENGTH),
		error: result.ok ? undefined : 'download_failed',
	});
}

async function handleTts(req: Request): Promise<Response> {
	const body = await readJson<{ text?: string; voiceId?: string; lang?: string }>(req);
	const text = (body.text ?? '').trim();
	if (!text) return json(HTTP_BAD_REQUEST, { error: 'text required' });
	if (Date.now() < ttsBreakerUntil && ttsBreakerInfo) {
		return json(ttsBreakerInfo.status, { error: ttsBreakerInfo.message, code: ttsBreakerInfo.code, breaker: 'open' });
	}
	try {
		const tts = await elevenLabsTts(text, body.voiceId, body.lang);
		if (!tts) {
			return json(HTTP_SERVICE_UNAVAILABLE, {
				error: 'no_elevenlabs_key',
				code: 'no_key',
				hint: 'envctl set .env ELEVENLABS_API_KEY sk_…',
			});
		}
		return new Response(tts.audio, {
			headers: {
				'Content-Type': 'audio/mpeg',
				'Cache-Control': 'no-store',
				'Character-Cost': String(tts.characterCost),
				'Character-Cost-Total': String(ttsCharacters),
				...(tts.requestId ? { 'Request-Id': tts.requestId } : {}),
				...(tts.traceId ? { 'X-Trace-Id': tts.traceId } : {}),
			},
		});
	} catch (e) {
		const info = classifyTtsError(e);
		tripTtsBreaker(info);
		return json(info.status, { error: info.message, code: info.code });
	}
}

function trackRangeResponse(
	track: ReturnType<typeof Bun.file>,
	size: number,
	base: Record<string, string>,
	match: RegExpExecArray,
): Response {
	const startText = match[1] ?? '';
	const endText = match[2] ?? '';
	let start = startText === '' ? size - Number(endText) : Number(startText);
	let end = startText !== '' && endText !== '' ? Number(endText) : size - 1;
	start = Math.max(0, start);
	end = Math.min(end, size - 1);
	if (start > end || start >= size) {
		return new Response(null, {
			status: HTTP_RANGE_NOT_SATISFIABLE,
			headers: { ...base, 'Content-Range': `bytes */${size}` },
		});
	}
	return new Response(track.slice(start, end + 1), {
		status: HTTP_PARTIAL_CONTENT,
		headers: {
			...base,
			'Content-Range': `bytes ${start}-${end}/${size}`,
			'Content-Length': String(end - start + 1),
		},
	});
}

async function handleTrackFile(req: Request, path: string): Promise<Response> {
	const name = decodeURIComponent(path.replace('/api/dj/file/', ''));
	const safe = basename(name);
	if (!isAudioFileName(name)) return json(HTTP_NOT_FOUND, { error: 'not found' });
	const track = Bun.file(join(MUSIC_DIR, safe));
	if (!(await track.exists())) return json(HTTP_NOT_FOUND, { error: 'not found' });
	const size = track.size;
	const base = {
		'Content-Type': AUDIO_MIME[extname(safe).toLowerCase()] ?? 'audio/mpeg',
		'Accept-Ranges': 'bytes',
	};
	const range = req.headers.get('range');
	const match = range ? BYTE_RANGE_PATTERN.exec(range.trim()) : null;
	const startText = match?.[1] ?? '';
	const endText = match?.[2] ?? '';
	if (match && (startText !== '' || endText !== '')) return trackRangeResponse(track, size, base, match);
	return new Response(track, { headers: { ...base, 'Content-Length': String(size) } });
}

async function dispatchApi(req: Request, path: string): Promise<Response> {
	if (path === '/api/dj/status' && req.method === 'GET') return handleDjStatus();
	if (path === '/api/sim/chat' && req.method === 'POST') return handleSimChat(req);
	if (path === '/api/dj/playlist' && req.method === 'GET') return json(HTTP_OK, { tracks: await listPlaylist() });
	if (path === '/api/dj/request' && req.method === 'POST') return handleTrackRequest(req);
	if (path === '/api/tts' && req.method === 'POST') return handleTts(req);
	if (path.startsWith('/api/dj/file/') && req.method === 'GET') return handleTrackFile(req, path);
	return json(HTTP_NOT_FOUND, { error: 'unknown_route' });
}

/** Returns null when the request is not an API route (caller serves static). */
async function handleApi(req: Request, peer: string): Promise<Response> {
	const path = new URL(req.url).pathname;
	const ip = clientIp(req, peer);
	if (path === '/api/healthz' && req.method === 'GET') return json(HTTP_OK, { ok: true, uptime: uptimeSeconds() });
	if (path === '/api/statusz' && req.method === 'GET') return handleStatus(ip);
	if (crossSite(req)) return json(HTTP_FORBIDDEN, { error: 'cross_site_blocked' });
	if (rateLimited(ip, path)) return json(HTTP_TOO_MANY_REQUESTS, { error: 'rate_limited', hint: 'even chillen' });
	try {
		return await dispatchApi(req, path);
	} catch (e) {
		const message = String(e);
		if (message.includes('body_too_large')) return json(HTTP_CONTENT_TOO_LARGE, { error: 'body_too_large' });
		return json(HTTP_INTERNAL_SERVER_ERROR, { error: message });
	}
}

export type { SimPersona, TrackMeta };
export { ensureMusicDir, handleApi };
