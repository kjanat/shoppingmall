/**
 * DJ Bartek + mall sim brain. Web-standard `Request → Response`, mounted by
 * Bun.serve in server/main.ts. Bun-native I/O throughout: nothing here may
 * block the event loop while a track streams.
 * - POST /api/tts          → ElevenLabs
 * - POST /api/sim/chat     → OpenRouter SDK (sims talk; Broadcast user/session/trace)
 * - GET  /api/dj/playlist  → list public/dj-music/*
 * - POST /api/dj/request   → YouTube API search + yt-dlp download
 * - GET  /api/dj/status    → health + key presence
 */

import { mkdir } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import type { ElevenLabs } from '@elevenlabs/elevenlabs-js';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { OpenRouter } from '@openrouter/sdk';

/** Music library. public/ is read from the working directory, like public/ in main.ts. */
const MUSIC_DIR = resolve('public/dj-music');
const AUDIO_EXT = new Set(['.mp3', '.m4a', '.ogg', '.webm', '.wav', '.opus']);

export async function ensureMusicDir(): Promise<void> {
	await mkdir(MUSIC_DIR, { recursive: true });
}

export type TrackMeta = {
	file: string;
	title: string;
	url: string;
	bytes: number;
	/** From the yt-dlp sidecar, when the track came in through a request. */
	artist?: string;
	seconds?: number;
	videoId?: string;
	sourceUrl?: string;
};

/**
 * yt-dlp's `--write-info-json` sidecar. The filename mangles the title
 * (slashes and quotes get replaced), so the real one lives here.
 */
async function readInfoJson(audioFile: string): Promise<Partial<TrackMeta>> {
	const sidecar = Bun.file(join(MUSIC_DIR, `${basename(audioFile, extname(audioFile))}.info.json`));
	try {
		if (!(await sidecar.exists())) return {};
		const info = (await sidecar.json()) as {
			title?: string;
			track?: string;
			artist?: string;
			uploader?: string;
			duration?: number;
			id?: string;
			webpage_url?: string;
		};
		return {
			title: info.track ?? info.title,
			artist: info.artist ?? info.uploader,
			seconds: typeof info.duration === 'number' ? Math.round(info.duration) : undefined,
			videoId: info.id,
			sourceUrl: info.webpage_url,
		};
	} catch {
		return {};
	}
}

async function listPlaylist(): Promise<TrackMeta[]> {
	await ensureMusicDir();
	const names: string[] = [];
	for await (const name of new Bun.Glob('*').scan({ cwd: MUSIC_DIR, onlyFiles: true })) {
		if (AUDIO_EXT.has(extname(name).toLowerCase())) names.push(name);
	}
	return (
		await Promise.all(
			names.map(async (f) => {
				const [meta, stat] = await Promise.all([readInfoJson(f), Bun.file(join(MUSIC_DIR, f)).stat()]);
				return {
					file: f,
					title: meta.title ?? basename(f, extname(f)).replace(/[_-]+/g, ' '),
					// Stream via the API, not `./dj-music/…`: static serving reads the dist/ copy in preview,
					// which doesn't contain tracks downloaded after the build — the API always reads live from public/.
					url: `/api/dj/file/${encodeURIComponent(f)}`,
					bytes: stat.size,
					...(meta.artist ? { artist: meta.artist } : {}),
					...(meta.seconds ? { seconds: meta.seconds } : {}),
					...(meta.videoId ? { videoId: meta.videoId } : {}),
					...(meta.sourceUrl ? { sourceUrl: meta.sourceUrl } : {}),
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
const BODY_LIMIT = 64 * 1024;
const RATE_LIMITS: Record<string, { max: number; windowMs: number }> = {
	'/api/tts': { max: 30, windowMs: 60_000 },
	'/api/sim/chat': { max: 40, windowMs: 60_000 },
	'/api/dj/request': { max: 6, windowMs: 60_000 },
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
 * https://elevenlabs.io/docs/api-reference/introduction
 */
type TtsResult = {
	audio: ReadableStream<Uint8Array>;
	characterCost: number;
	requestId: string | null;
	traceId: string | null;
};

/** Characters billed since boot — surfaced on /api/dj/status */
let ttsCharacters = 0;
let elevenClient: ElevenLabsClient | null = null;

async function elevenLabsTts(text: string, voiceId?: string, lang?: string): Promise<TtsResult | null> {
	if (!process.env['ELEVENLABS_API_KEY']) return null;

	const voice =
		voiceId ||
		process.env['ELEVENLABS_VOICE_ID']?.trim() ||
		// Charlie — energetic (good default DJ energy)
		'IKne3meq5aSn9XLyUdCD';

	// The SDK reads ELEVENLABS_API_KEY itself
	elevenClient ??= new ElevenLabsClient();
	const client = elevenClient;

	const request: ElevenLabs.StreamTextToSpeechRequest = {
		text: text.slice(0, 800),
		// Flash v2.5: ~75ms latency and half the credits per character, 32 langs
		// incl. NL. Mall one-liners don't need multilingual_v2's long-form
		// fidelity — set ELEVENLABS_MODEL_ID to go back.
		modelId: process.env['ELEVENLABS_MODEL_ID']?.trim() || 'eleven_flash_v2_5',
		voiceSettings: {
			stability: lang === 'nl' ? 0.42 : 0.32,
			similarityBoost: 0.82,
			style: lang === 'nl' ? 0.35 : 0.55,
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
				if (e?.statusCode !== 400) throw e;
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
	const httpReferer = (
		process.env['OPENROUTER_HTTP_REFERER'] ||
		process.env['OPENROUTER_SITE_URL'] ||
		'https://prairie-lakes-mall.local'
	).trim();
	const appTitle = (
		process.env['OPENROUTER_APP_TITLE'] ||
		process.env['OPENROUTER_TITLE'] ||
		'Prairie Lakes Mall SIM'
	).trim();
	const appCategories = (process.env['OPENROUTER_APP_CATEGORIES'] || 'game,roleplay')
		.trim()
		.toLowerCase()
		.replace(/\s+/g, '');
	return { httpReferer, appTitle, appCategories };
}

/** Lazy singleton OpenRouter client with app attribution baked in */
let openRouterClient: OpenRouter | null = null;
function getOpenRouter(): OpenRouter | null {
	if (!process.env['OPENROUTER_API_KEY']) return null;
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
		.replace(/[^\w.:\-@/]/g, '')
		.slice(0, 128);
	return cleaned.length >= 4 ? cleaned : undefined;
}

function sanitizeSessionId(raw: unknown): string | undefined {
	if (typeof raw !== 'string') return undefined;
	const cleaned = raw
		.trim()
		.replace(/[^\w.:\-@/]/g, '')
		.slice(0, 256);
	return cleaned.length >= 4 ? cleaned : undefined;
}

export type SimPersona = {
	name: string;
	mood: string;
	lifeLine: string;
	targetShop: string;
	unhappiness: number;
	partnerName?: string | null;
	isKid?: boolean;
	isBrad?: boolean;
	isMiss?: boolean;
};

/**
 * Two mall guests exchange short lines via @openrouter/sdk.
 * Browser supplies user + sessionId; we attach Broadcast `trace` metadata.
 */
async function simChatExchange(
	a: SimPersona,
	b: SimPersona,
	context?: string,
	sessionId?: string,
	userId?: string,
): Promise<{ a: string; b: string } | { error: string }> {
	const openrouter = getOpenRouter();
	if (!openrouter) return { error: 'no_openrouter_key' };

	// Grok only (no Google). Fast sassy default; override via OPENROUTER_MODEL
	const model = process.env['OPENROUTER_MODEL']?.trim() || 'x-ai/grok-4.20';

	const meanA = a.unhappiness >= 55;
	const meanB = b.unhappiness >= 55;
	const system = `\
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

	const prompt = `A: ${a.name} · mood=${a.mood} · "${a.lifeLine}" · → ${a.targetShop} · ☹${Math.round(a.unhappiness)}%${
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

	const ctxLabel = (context ?? 'corridor botsing').trim().slice(0, 64) || 'corridor';

	try {
		const completion = await openrouter.chat.send({
			chatRequest: {
				model,
				temperature: 1.05,
				maxTokens: 100,
				stream: false,
				// Schema-constrained output — no prompt-begging for JSON, no
				// scraping A:/B: out of freeform Grok.
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
				// Broadcast optional trace data
				// https://openrouter.ai/docs/guides/features/broadcast
				...(userId ? { user: userId } : {}),
				...(sessionId ? { sessionId } : {}),
				trace: {
					traceName: 'Prairie Lakes Mall SIM',
					spanName: 'sim-chat',
					generationName: 'guest-banter',
					additionalProperties: {
						feature: 'sim-chat',
						environment: process.env.NODE_ENV ?? 'development',
						context: ctxLabel,
						mean_mode: meanA || meanB,
						unhappiness_a: Math.round(a.unhappiness),
						unhappiness_b: Math.round(b.unhappiness),
						persona_a: a.name.split(' ')[0] ?? a.name,
						persona_b: b.name.split(' ')[0] ?? b.name,
						is_kid_a: !!a.isKid,
						is_kid_b: !!b.isKid,
					},
				},
				messages: [
					{ role: 'system', content: system },
					{ role: 'user', content: prompt },
				],
			},
		});

		// Non-streaming ChatResult
		if (!('choices' in completion) || !completion.choices?.length) {
			return { error: 'openrouter_empty_choices' };
		}
		const content = completion.choices[0]?.message?.content;
		const raw = (
			typeof content === 'string'
				? content
				: Array.isArray(content)
					? content
							.map((p) =>
								typeof p === 'object' && p && 'text' in p ? String((p as { text?: string }).text ?? '') : '',
							)
							.join('')
					: ''
		).trim();

		try {
			const parsed = JSON.parse(raw) as { a?: string; b?: string };
			const lineA = (parsed.a ?? '').trim().slice(0, 60);
			const lineB = (parsed.b ?? '').trim().slice(0, 60);
			if (lineA && lineB) return { a: lineA, b: lineB };
		} catch {
			/* schema violated — report it instead of guessing */
		}
		return { error: `bad_json: ${raw.slice(0, 100)}` };
	} catch (e) {
		return { error: String(e) };
	}
}

/** Official YouTube Data API search — more reliable than yt-dlp ytsearch */
async function youtubeSearch(query: string): Promise<{ videoId: string; title: string } | { error: string }> {
	const key = process.env['YOUTUBE_API_KEY'];
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
		return { error: `youtube_search ${res.status}: ${err.slice(0, 180)}` };
	}
	const data = (await res.json()) as {
		items?: Array<{ id?: { videoId?: string }; snippet?: { title?: string } }>;
	};
	const hit = data.items?.find((it) => it.id?.videoId);
	if (!hit?.id?.videoId) return { error: 'no_results' };
	return {
		videoId: hit.id.videoId,
		title: hit.snippet?.title ?? hit.id.videoId,
	};
}

async function newestMusicFile(beforeMs: number): Promise<string | undefined> {
	const tracks = await listPlaylist();
	const stamped = await Promise.all(
		tracks.map(async (t) => ({
			file: t.file,
			mtime: Bun.file(join(MUSIC_DIR, t.file)).lastModified,
		})),
	);
	return stamped.filter((t) => t.mtime >= beforeMs - 500).sort((a, b) => b.mtime - a.mtime)[0]?.file;
}

async function runYtDlpUrl(watchUrl: string): Promise<{ ok: boolean; log: string; file?: string }> {
	await ensureMusicDir();
	const before = Date.now();
	const outTpl = join(MUSIC_DIR, '%(title).80s.%(ext)s');
	{
		// Direct URL — no ytsearch. Audio-only from the start: `-f bestaudio`
		// stops yt-dlp from ever pulling a video stream just to strip it again,
		// which is most of the download time and bandwidth.
		const args = [
			'-f',
			'bestaudio/best',
			'-x',
			'--audio-format',
			'mp3',
			'--audio-quality',
			'5',
			'--no-playlist',
			'--no-warnings',
			'--no-progress',
			'--no-mtime',
			// NB: no `--no-part` — with .part suffixes an interrupted download never
			// carries an audio extension, so half files can't show up in the crates.
			// Refuse absurd inputs instead of filling the disk: ≤ 150 MB and ≤ 1 h
			// (DJ sets are long; bartek_deep_house alone is 66 MB).
			'--max-filesize',
			'150M',
			'--match-filter',
			'duration<=3600',
			// One retry, fail fast — the request endpoint already rate-limits
			'--retries',
			'1',
			'--socket-timeout',
			'15',
			'-o',
			outTpl,
			// Sidecar with the real title, uploader and duration — the filename
			// mangles all three (slashes, quotes, 80-char cap). One track, so no
			// playlist metafiles; --clean-info-json is on by default.
			'--write-info-json',
			'--no-write-playlist-metafiles',
			// Prefer clients that still get media (ytsearch was the flaky bit)
			'--extractor-args',
			'youtube:player_client=android,web',
			watchUrl,
		];
		try {
			const proc = Bun.spawn(['yt-dlp', ...args], {
				cwd: process.cwd(),
				stdout: 'pipe',
				stderr: 'pipe',
			});
			const [out, err, code] = await Promise.all([
				new Response(proc.stdout).text(),
				new Response(proc.stderr).text(),
				proc.exited,
			]);
			const file = await newestMusicFile(before);
			return {
				// 101 = --match-filter rejected it; still not a crash
				ok: (code === 0 || code === 101) && !!file,
				log: `${out}${err}`.slice(-2500),
				file,
			};
		} catch (e) {
			return { ok: false, log: String(e) };
		}
	}
}

/** Search (YouTube API) → download (yt-dlp by URL). Fallback: ytsearch. */
async function requestTrack(
	query: string,
): Promise<{ ok: boolean; log: string; file?: string; title?: string; videoId?: string }> {
	const clean = query
		.replace(/[^\w\s\-'.!&()áéíóúäëïöüàèìòùñç]/gi, ' ')
		.trim()
		.slice(0, 100);
	if (!clean) return { ok: false, log: 'empty query' };

	await ensureMusicDir();
	let watchUrl = '';
	let title: string | undefined;
	let videoId: string | undefined;
	let log = '';

	// Prefer official API search when key is present
	const ytKey = process.env['YOUTUBE_API_KEY'];
	if (ytKey) {
		const hit = await youtubeSearch(clean);
		if ('error' in hit) {
			log += `[youtube-api] ${hit.error}\n`;
		} else {
			videoId = hit.videoId;
			title = hit.title;
			watchUrl = `https://www.youtube.com/watch?v=${hit.videoId}`;
			log += `[youtube-api] ${hit.videoId} · ${hit.title}\n`;
		}
	}

	// Fallback: yt-dlp's own search (often flaky / 403)
	if (!watchUrl) {
		watchUrl = `ytsearch1:${clean}`;
		log += '[fallback] ytsearch1 (no API hit)\n';
	}

	const dl = await runYtDlpUrl(watchUrl);
	log += dl.log;
	return {
		ok: dl.ok,
		log: log.slice(-3000),
		file: dl.file,
		title,
		videoId,
	};
}

/** Returns null when the request is not an API route (caller serves static). */
export async function handleApi(req: Request, ip: string): Promise<Response> {
	const url = new URL(req.url).pathname;

	if (crossSite(req)) return json(403, { error: 'cross_site_blocked' });
	if (rateLimited(ip, url)) {
		return json(429, { error: 'rate_limited', hint: 'even chillen' });
	}

	try {
		if (url === '/api/dj/status' && req.method === 'GET') {
			const hasKey = !!process.env['ELEVENLABS_API_KEY'];
			return json(200, {
				ok: true,
				elevenlabs: hasKey,
				youtubeApi: !!process.env['YOUTUBE_API_KEY'],
				openrouter: !!process.env['OPENROUTER_API_KEY'],
				openrouterSdk: true,
				openrouterApp: openRouterAppMeta().appTitle,
				openrouterCategories: openRouterAppMeta().appCategories,
				openrouterReferer: openRouterAppMeta().httpReferer,
				/** Broadcast optional fields sent on /api/sim/chat */
				openrouterBroadcast: ['user', 'session_id', 'trace'],
				tracks: (await listPlaylist()).length,
				ttsCharacters,
				booth: 'DJ Bartek · Trap-gat · Prairie Lakes',
				voice: process.env['ELEVENLABS_VOICE_ID']?.trim() || 'pNInz6obpgDQGcFmaJgB',
			});
		}

		if (url === '/api/sim/chat' && req.method === 'POST') {
			const body = await readJson<{
				a?: SimPersona;
				b?: SimPersona;
				context?: string;
				/** End-user id for OpenRouter Broadcast `user` (≤128) */
				user?: string;
				userId?: string;
				user_id?: string;
				/** Browser tab session for sticky routing + session grouping (≤256) */
				sessionId?: string;
				session_id?: string;
			}>(req);
			if (!body.a?.name || !body.b?.name) {
				return json(400, { error: 'a and b personas required' });
			}
			const sessionId = sanitizeSessionId(body.sessionId ?? body.session_id);
			const userId = sanitizeUserId(body.user ?? body.userId ?? body.user_id);
			const result = await simChatExchange(body.a, body.b, body.context, sessionId, userId);
			if ('error' in result) {
				return json(502, { ok: false, error: result.error });
			}
			return json(200, {
				ok: true,
				...result,
				user: userId ?? null,
				sessionId: sessionId ?? null,
			});
		}

		if (url === '/api/dj/playlist' && req.method === 'GET') {
			return json(200, { tracks: await listPlaylist() });
		}

		if (url === '/api/dj/request' && req.method === 'POST') {
			const body = await readJson<{ query?: string }>(req);
			const query = (body.query ?? '').trim();
			if (!query) return json(400, { ok: false, error: 'query required' });
			const result = await requestTrack(query);
			return json(result.ok ? 200 : 500, {
				ok: result.ok,
				file: result.file,
				title: result.title,
				videoId: result.videoId,
				tracks: await listPlaylist(),
				log: result.log.slice(-800),
				error: result.ok ? undefined : 'download_failed',
			});
		}

		if (url === '/api/tts' && req.method === 'POST') {
			const body = await readJson<{
				text?: string;
				voiceId?: string;
				lang?: string;
			}>(req);
			const text = (body.text ?? '').trim();
			if (!text) return json(400, { error: 'text required' });
			try {
				const tts = await elevenLabsTts(text, body.voiceId, body.lang);
				if (!tts) {
					return json(503, {
						error: 'no_elevenlabs_key',
						hint: 'envctl set .env ELEVENLABS_API_KEY sk_…',
					});
				}
				return new Response(tts.audio, {
					headers: {
						'Content-Type': 'audio/mpeg',
						'Cache-Control': 'no-store',
						// Billing + debug ids straight from ElevenLabs
						'Character-Cost': String(tts.characterCost),
						'Character-Cost-Total': String(ttsCharacters),
						...(tts.requestId ? { 'Request-Id': tts.requestId } : {}),
						...(tts.traceId ? { 'X-Trace-Id': tts.traceId } : {}),
					},
				});
			} catch (e) {
				return json(502, { error: String(e) });
			}
		}

		// Primary track route — live from public/dj-music, works in dev + preview.
		// Speaks HTTP Range: <audio> switches to range-requests on long tracks
		// (and on every seek); answering those with a plain 200 stalls playback
		// partway through — which made the 24-minute tracks "not quite work".
		if (url.startsWith('/api/dj/file/') && req.method === 'GET') {
			const name = decodeURIComponent(url.replace('/api/dj/file/', ''));
			const safe = basename(name);
			const track = Bun.file(join(MUSIC_DIR, safe));
			if (!(await track.exists())) return json(404, { error: 'not found' });

			const size = track.size;
			const base = {
				'Content-Type': AUDIO_MIME[extname(safe).toLowerCase()] ?? 'audio/mpeg',
				'Accept-Ranges': 'bytes',
			};
			const range = req.headers.get('range');
			const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;

			if (m && (m[1] !== '' || m[2] !== '')) {
				// bytes=a-b | bytes=a- | bytes=-suffix
				let start = m[1] === '' ? size - Number(m[2]) : Number(m[1]);
				let end = m[1] !== '' && m[2] !== '' ? Number(m[2]) : size - 1;
				start = Math.max(0, start);
				end = Math.min(end, size - 1);
				if (start > end || start >= size) {
					return new Response(null, {
						status: 416,
						headers: { ...base, 'Content-Range': `bytes */${size}` },
					});
				}
				return new Response(track.slice(start, end + 1), {
					status: 206,
					headers: {
						...base,
						'Content-Range': `bytes ${start}-${end}/${size}`,
						'Content-Length': String(end - start + 1),
					},
				});
			}

			return new Response(track, {
				headers: { ...base, 'Content-Length': String(size) },
			});
		}

		return json(404, { error: 'unknown_route' });
	} catch (e) {
		const msg = String(e);
		if (msg.includes('body_too_large')) {
			return json(413, { error: 'body_too_large' });
		}
		return json(500, { error: msg });
	}
}
