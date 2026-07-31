/**
 * Vite dev middleware: DJ Bartek + mall sim brain.
 * - POST /api/tts          → ElevenLabs
 * - POST /api/sim/chat     → OpenRouter (sims talk to each other)
 * - GET  /api/dj/playlist  → list public/dj-music/*
 * - POST /api/dj/request   → YouTube API search + yt-dlp download
 * - GET  /api/dj/status    → health + key presence
 */
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import type { Connect, Plugin, PreviewServer, ViteDevServer } from 'vite';

const MUSIC_DIR = join(process.cwd(), 'public', 'dj-music');
const AUDIO_EXT = new Set(['.mp3', '.m4a', '.ogg', '.webm', '.wav', '.opus']);

function ensureMusicDir(): void {
	if (!existsSync(MUSIC_DIR)) mkdirSync(MUSIC_DIR, { recursive: true });
}

function listPlaylist(): { file: string; title: string; url: string; bytes: number }[] {
	ensureMusicDir();
	return readdirSync(MUSIC_DIR)
		.filter((f) => AUDIO_EXT.has(extname(f).toLowerCase()))
		.map((f) => {
			const full = join(MUSIC_DIR, f);
			const st = statSync(full);
			return {
				file: f,
				title: basename(f, extname(f)).replace(/[_-]+/g, ' '),
				// Stream via the API, not `./dj-music/…`: static serving reads the
				// dist/ copy in preview, which doesn't contain tracks downloaded
				// after the build — the API always reads live from public/.
				url: `/api/dj/file/${encodeURIComponent(f)}`,
				bytes: st.size,
			};
		})
		.sort((a, b) => a.title.localeCompare(b.title));
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
function crossSite(req: Connect.IncomingMessage): boolean {
	// `server/` is outside the tsconfig include and has no @types/node, so read
	// the headers structurally rather than leaning on the Node typings.
	const headers = (req as unknown as {
		headers?: Record<string, string | undefined>;
	}).headers ?? {};
	const origin = headers.origin;
	if (!origin) return false; // same-origin fetch, curl, or the app itself
	try {
		return new URL(origin).host !== headers.host;
	} catch {
		return true;
	}
}

function readBody(req: Connect.IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let size = 0;
		req.on('data', (c) => {
			size += c.length;
			if (size > BODY_LIMIT) {
				req.destroy();
				reject(new Error('body_too_large'));
				return;
			}
			chunks.push(Buffer.from(c));
		});
		req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
		req.on('error', reject);
	});
}

function json(res: Connect.ServerResponse, code: number, data: unknown): void {
	res.statusCode = code;
	res.setHeader('Content-Type', 'application/json');
	res.end(JSON.stringify(data));
}

function findYtDlp(): string {
	const candidates = [
		join(process.env.HOME ?? '', '.local/bin/yt-dlp'),
		'yt-dlp',
		'yt-dlp.exe',
	];
	for (const c of candidates) {
		if (c.includes('/') && existsSync(c)) return c;
	}
	return 'yt-dlp';
}

function resolveElevenKey(): string | null {
	const raw = process.env.ELEVENLABS_API_KEY
		|| process.env.ELEVEN_API_KEY
		|| process.env.VITE_ELEVENLABS_API_KEY
		|| process.env.ELEVENLABS_KEY
		|| '';
	const key = raw.trim().replace(/^["']|["']$/g, '');
	return key.length > 10 ? key : null;
}

async function elevenLabsTts(
	text: string,
	voiceId?: string,
	lang?: string,
): Promise<Buffer | null> {
	const key = resolveElevenKey();
	if (!key) return null;

	const voice = voiceId
		|| process.env.ELEVENLABS_VOICE_ID?.trim()
		// Charlie — energetic (good default DJ energy)
		|| 'IKne3meq5aSn9XLyUdCD';

	const url = `https://api.elevenlabs.io/v1/text-to-speech/${voice}`;
	const body: Record<string, unknown> = {
		text: text.slice(0, 800),
		model_id: 'eleven_multilingual_v2',
		voice_settings: {
			stability: lang === 'nl' ? 0.42 : 0.32,
			similarity_boost: 0.82,
			style: lang === 'nl' ? 0.35 : 0.55,
			use_speaker_boost: true,
		},
	};
	// Multilingual language hint when supported
	if (lang) body.language_code = lang;

	const post = async (payload: Record<string, unknown>) => {
		const res = await fetch(url, {
			method: 'POST',
			headers: {
				'xi-api-key': key,
				'Content-Type': 'application/json',
				Accept: 'audio/mpeg',
			},
			body: JSON.stringify(payload),
		});
		return res;
	};

	let res = await post(body);
	// language_code can 400 on some accounts — retry bare
	if (!res.ok && body.language_code) {
		const { language_code: _lc, ...bare } = body;
		void _lc;
		res = await post(bare);
	}
	if (!res.ok) {
		const err = await res.text();
		throw new Error(`ElevenLabs ${res.status}: ${err.slice(0, 200)}`);
	}
	const ab = await res.arrayBuffer();
	return Buffer.from(ab);
}

function resolveYoutubeKey(): string | null {
	const raw = process.env.YOUTUBE_API_KEY
		|| process.env.YT_API_KEY
		|| process.env.GOOGLE_API_KEY
		|| '';
	const key = raw.trim().replace(/^["']|["']$/g, '');
	return key.length > 10 ? key : null;
}

function resolveOpenRouterKey(): string | null {
	const raw = process.env.OPENROUTER_API_KEY
		|| process.env.OPENROUTER_KEY
		|| process.env.OR_API_KEY
		|| '';
	const key = raw.trim().replace(/^["']|["']$/g, '');
	return key.length > 10 ? key : null;
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

/** Two mall guests exchange short lines via OpenRouter */
async function simChatExchange(
	a: SimPersona,
	b: SimPersona,
	context?: string,
): Promise<{ a: string; b: string } | { error: string }> {
	const key = resolveOpenRouterKey();
	if (!key) return { error: 'no_openrouter_key' };

	// Grok only (no Google). Fast sassy default; override via OPENROUTER_MODEL
	const model = process.env.OPENROUTER_MODEL?.trim() || 'x-ai/grok-4.20';

	const meanA = a.unhappiness >= 55;
	const meanB = b.unhappiness >= 55;
	const system = `Je schrijft korte mall-dialoog voor dikke Amerikaanse shoppers (Prairie Lakes SIM).
Regels:
- ALLEEN JSON: {"a":"...","b":"..."}
- Max 14 woorden per regel, spreektaal NL + bit of English mall slang
- Geen corporate woke filter: jaloers, snarky, roast-y is OK
- GEEN haat over etniciteit/religie/seksuele oriëntatie — wel schelden over: looks, thicc, mood, slechte deals, trage benen, pageant-snobs, vitamine-nerds, hangry, lost
- Als unhappiness hoog: ze ROASTEN elkaar harder (kut, lul, loser, basic, whatever — mall trash talk)
- Als unhappiness laag: milder gezeur of flirten
- Kids: kinderachtig gezeur, geen echt grove scheld
- Brad = vitamine-obsessed; Miss = hot/snob/pageant; koppels mogen ruzie/liefde
- Ze praten TEGEN elkaar, reageren op elkaars vibe`;

	const user = `A: ${a.name} · mood=${a.mood} · "${a.lifeLine}" · → ${a.targetShop} · ☹${Math.round(a.unhappiness)}%${
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

	try {
		const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${key}`,
				'Content-Type': 'application/json',
				'HTTP-Referer': 'http://localhost:5173',
				'X-Title': 'Mall SIM · sim chat',
			},
			body: JSON.stringify({
				model,
				temperature: 1.05,
				max_tokens: 100,
				messages: [
					{ role: 'system', content: system },
					{ role: 'user', content: user },
				],
			}),
		});
		if (!res.ok) {
			const err = await res.text();
			return { error: `openrouter ${res.status}: ${err.slice(0, 200)}` };
		}
		const data = (await res.json()) as {
			choices?: Array<{ message?: { content?: string } }>;
		};
		const raw = data.choices?.[0]?.message?.content?.trim() ?? '';
		// Prefer strict JSON; else scrape A:/B: style from freeform Grok
		const m = raw.match(/\{[\s\S]*\}/);
		if (m) {
			try {
				const parsed = JSON.parse(m[0]) as { a?: string; b?: string };
				const lineA = (parsed.a ?? '').trim().slice(0, 60);
				const lineB = (parsed.b ?? '').trim().slice(0, 60);
				if (lineA && lineB) return { a: lineA, b: lineB };
			} catch {
				/* fall through */
			}
		}
		const aMatch = raw.match(/A[:\s]+["']?(.+?)["']?(?:\n|$)/i);
		const bMatch = raw.match(/B[:\s]+["']?(.+?)["']?(?:\n|$)/i);
		if (aMatch && bMatch) {
			return {
				a: aMatch[1].replace(/[*_]/g, '').trim().slice(0, 60),
				b: bMatch[1].replace(/[*_]/g, '').trim().slice(0, 60),
			};
		}
		return { error: `bad_json: ${raw.slice(0, 100)}` };
	} catch (e) {
		return { error: String(e) };
	}
}

/** Official YouTube Data API search — more reliable than yt-dlp ytsearch */
async function youtubeSearch(
	query: string,
): Promise<{ videoId: string; title: string } | { error: string }> {
	const key = resolveYoutubeKey();
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

function newestMusicFile(beforeMs: number): string | undefined {
	const list = listPlaylist()
		.map((t) => ({
			...t,
			mtime: statSync(join(MUSIC_DIR, t.file)).mtimeMs,
		}))
		.filter((t) => t.mtime >= beforeMs - 500)
		.sort((a, b) => b.mtime - a.mtime);
	return list[0]?.file;
}

function runYtDlpUrl(
	watchUrl: string,
): Promise<{ ok: boolean; log: string; file?: string }> {
	return new Promise((resolve) => {
		ensureMusicDir();
		const bin = findYtDlp();
		const before = Date.now();
		const outTpl = join(MUSIC_DIR, '%(title).80s.%(ext)s');
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
			// Prefer clients that still get media (ytsearch was the flaky bit)
			'--extractor-args',
			'youtube:player_client=android,web',
			watchUrl,
		];
		const child = spawn(bin, args, {
			cwd: process.cwd(),
			env: { ...process.env, PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}` },
		});
		let log = '';
		child.stdout.on('data', (d) => {
			log += d.toString();
		});
		child.stderr.on('data', (d) => {
			log += d.toString();
		});
		child.on('error', (e) => resolve({ ok: false, log: String(e) }));
		child.on('close', (code) => {
			const file = newestMusicFile(before);
			resolve({
				ok: (code === 0 || code === 101) && !!file,
				log: log.slice(-2500),
				file,
			});
		});
	});
}

/** Search (YouTube API) → download (yt-dlp by URL). Fallback: ytsearch. */
async function requestTrack(
	query: string,
): Promise<{ ok: boolean; log: string; file?: string; title?: string; videoId?: string }> {
	const clean = query.replace(/[^\w\s\-'.!&()áéíóúäëïöüàèìòùñç]/gi, ' ').trim().slice(0, 100);
	if (!clean) return { ok: false, log: 'empty query' };

	ensureMusicDir();
	let watchUrl = '';
	let title: string | undefined;
	let videoId: string | undefined;
	let log = '';

	// Prefer official API search when key is present
	const ytKey = resolveYoutubeKey();
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

function djMiddleware(): Connect.NextHandleFunction {
	return async (req, res, next) => {
		const url = req.url?.split('?')[0] ?? '';
		if (!url.startsWith('/api/')) return next();

		if (crossSite(req)) return json(res, 403, { error: 'cross_site_blocked' });
		const ip = req.socket?.remoteAddress ?? 'unknown';
		if (rateLimited(ip, url)) {
			return json(res, 429, { error: 'rate_limited', hint: 'even chillen' });
		}

		try {
			if (url === '/api/dj/status' && req.method === 'GET') {
				const hasKey = !!resolveElevenKey();
				return json(res, 200, {
					ok: true,
					elevenlabs: hasKey,
					youtubeApi: !!resolveYoutubeKey(),
					openrouter: !!resolveOpenRouterKey(),
					tracks: listPlaylist().length,
					booth: 'DJ Bartek · Trap-gat · Prairie Lakes',
					voice: process.env.ELEVENLABS_VOICE_ID?.trim() || 'pNInz6obpgDQGcFmaJgB',
				});
			}

			if (url === '/api/sim/chat' && req.method === 'POST') {
				const raw = await readBody(req);
				const body = JSON.parse(raw || '{}') as {
					a?: SimPersona;
					b?: SimPersona;
					context?: string;
				};
				if (!body.a?.name || !body.b?.name) {
					return json(res, 400, { error: 'a and b personas required' });
				}
				const result = await simChatExchange(body.a, body.b, body.context);
				if ('error' in result) {
					return json(res, 502, { ok: false, error: result.error });
				}
				return json(res, 200, { ok: true, ...result });
			}

			if (url === '/api/dj/playlist' && req.method === 'GET') {
				return json(res, 200, { tracks: listPlaylist() });
			}

			if (url === '/api/dj/request' && req.method === 'POST') {
				const raw = await readBody(req);
				const body = JSON.parse(raw || '{}') as { query?: string };
				const query = (body.query ?? '').trim();
				if (!query) return json(res, 400, { ok: false, error: 'query required' });
				const result = await requestTrack(query);
				return json(res, result.ok ? 200 : 500, {
					ok: result.ok,
					file: result.file,
					title: result.title,
					videoId: result.videoId,
					tracks: listPlaylist(),
					log: result.log.slice(-800),
					error: result.ok ? undefined : 'download_failed',
				});
			}

			if (url === '/api/tts' && req.method === 'POST') {
				const raw = await readBody(req);
				const body = JSON.parse(raw || '{}') as {
					text?: string;
					voiceId?: string;
					lang?: string;
				};
				const text = (body.text ?? '').trim();
				if (!text) return json(res, 400, { error: 'text required' });
				try {
					const audio = await elevenLabsTts(text, body.voiceId, body.lang);
					if (!audio) {
						return json(res, 503, {
							error: 'no_elevenlabs_key',
							hint: 'envctl set .env ELEVENLABS_API_KEY sk_…',
						});
					}
					res.statusCode = 200;
					res.setHeader('Content-Type', 'audio/mpeg');
					res.setHeader('Cache-Control', 'no-store');
					res.end(audio);
					return;
				} catch (e) {
					return json(res, 502, { error: String(e) });
				}
			}

			// Primary track route — live from public/dj-music, works in dev + preview.
			// Speaks HTTP Range: <audio> switches to range-requests on long tracks
			// (and on every seek); answering those with a plain 200 stalls playback
			// partway through — which made the 24-minute tracks "not quite work".
			if (url.startsWith('/api/dj/file/') && req.method === 'GET') {
				const name = decodeURIComponent(url.replace('/api/dj/file/', ''));
				const safe = basename(name);
				const full = join(MUSIC_DIR, safe);
				if (!existsSync(full)) return json(res, 404, { error: 'not found' });

				const size = statSync(full).size;
				const mime = AUDIO_MIME[extname(safe).toLowerCase()] ?? 'audio/mpeg';
				res.setHeader('Content-Type', mime);
				res.setHeader('Accept-Ranges', 'bytes');

				const headers = (req as unknown as {
					headers?: Record<string, string | undefined>;
				}).headers ?? {};
				const range = headers.range;
				const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;

				if (m && (m[1] !== '' || m[2] !== '')) {
					// bytes=a-b | bytes=a- | bytes=-suffix
					let start = m[1] === '' ? size - Number(m[2]) : Number(m[1]);
					let end = m[1] !== '' && m[2] !== '' ? Number(m[2]) : size - 1;
					start = Math.max(0, start);
					end = Math.min(end, size - 1);
					if (start > end || start >= size) {
						res.statusCode = 416;
						res.setHeader('Content-Range', `bytes */${size}`);
						res.end();
						return;
					}
					res.statusCode = 206;
					res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
					res.setHeader('Content-Length', String(end - start + 1));
					createReadStream(full, { start, end }).pipe(res);
					return;
				}

				res.statusCode = 200;
				res.setHeader('Content-Length', String(size));
				createReadStream(full).pipe(res);
				return;
			}

			return next();
		} catch (e) {
			const msg = String(e);
			if (msg.includes('body_too_large')) {
				return json(res, 413, { error: 'body_too_large' });
			}
			return json(res, 500, { error: msg });
		}
	};
}

export function djBartekPlugin(): Plugin {
	return {
		name: 'dj-bartek-api',
		configureServer(server: ViteDevServer) {
			ensureMusicDir();
			server.middlewares.use(djMiddleware());
			console.log('[DJ Bartek] API ready · /api/tts · /api/dj/* · music → public/dj-music/');
		},
		// `vite preview` only runs THIS hook, not configureServer — without it the
		// whole /api/* surface 404s and the booth reports empty crates.
		configurePreviewServer(server: PreviewServer) {
			ensureMusicDir();
			server.middlewares.use(djMiddleware());
			console.log('[DJ Bartek] API ready (preview) · /api/tts · /api/dj/*');
		},
	};
}
