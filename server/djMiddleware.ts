/**
 * Vite dev middleware: DJ Bartek booth backend.
 * - POST /api/tts          → ElevenLabs (or 503 if no key)
 * - GET  /api/dj/playlist  → list public/dj-music/*
 * - POST /api/dj/request   → yt-dlp search + download mp3
 * - GET  /api/dj/status    → health + key presence
 */
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import type { Connect, Plugin, ViteDevServer } from 'vite';

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
				url: `./dj-music/${encodeURIComponent(f)}`,
				bytes: st.size,
			};
		})
		.sort((a, b) => a.title.localeCompare(b.title));
}

function readBody(req: Connect.IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		req.on('data', (c) => chunks.push(Buffer.from(c)));
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

async function elevenLabsTts(text: string, voiceId?: string): Promise<Buffer | null> {
	const key = resolveElevenKey();
	if (!key) return null;

	const voice = voiceId
		|| process.env.ELEVENLABS_VOICE_ID?.trim()
		// Adam — clear energetic male (public ElevenLabs voice)
		|| 'pNInz6obpgDQGcFmaJgB';

	const url = `https://api.elevenlabs.io/v1/text-to-speech/${voice}`;
	const res = await fetch(url, {
		method: 'POST',
		headers: {
			'xi-api-key': key,
			'Content-Type': 'application/json',
			Accept: 'audio/mpeg',
		},
		body: JSON.stringify({
			text: text.slice(0, 800),
			model_id: 'eleven_multilingual_v2',
			voice_settings: {
				stability: 0.35,
				similarity_boost: 0.8,
				style: 0.55,
				use_speaker_boost: true,
			},
		}),
	});
	if (!res.ok) {
		const err = await res.text();
		throw new Error(`ElevenLabs ${res.status}: ${err.slice(0, 200)}`);
	}
	const ab = await res.arrayBuffer();
	return Buffer.from(ab);
}

function runYtDlp(query: string): Promise<{ ok: boolean; log: string; file?: string }> {
	return new Promise((resolve) => {
		ensureMusicDir();
		const bin = findYtDlp();
		// Sanitize: treat as ytsearch, strip shell metacharacters
		const clean = query.replace(/[^\w\s\-'.!&()áéíóúäëïöüàèìòùñç]/gi, ' ').trim().slice(0, 80);
		if (!clean) {
			resolve({ ok: false, log: 'empty query' });
			return;
		}
		const outTpl = join(MUSIC_DIR, '%(title).80s.%(ext)s');
		const args = [
			'-x',
			'--audio-format',
			'mp3',
			'--audio-quality',
			'5',
			'--no-playlist',
			'--max-downloads',
			'1',
			// Full sets are often >7min — take first ~3 min instead of skipping
			'--download-sections',
			'*0:00-3:00',
			'--force-keyframes-at-cuts',
			'-o',
			outTpl,
			`ytsearch1:${clean}`,
		];
		const child = spawn(bin, args, { cwd: process.cwd(), env: process.env });
		let log = '';
		child.stdout.on('data', (d) => {
			log += d.toString();
		});
		child.stderr.on('data', (d) => {
			log += d.toString();
		});
		child.on('error', (e) => resolve({ ok: false, log: String(e) }));
		child.on('close', (code) => {
			const list = listPlaylist();
			// Prefer newest file
			const sorted = list
				.map((t) => ({ ...t, mtime: statSync(join(MUSIC_DIR, t.file)).mtimeMs }))
				.sort((a, b) => b.mtime - a.mtime);
			const file = sorted[0]?.file;
			resolve({
				ok: code === 0 || code === 101 || !!file, // 101 = max downloads reached
				log: log.slice(-2000),
				file,
			});
		});
	});
}

function djMiddleware(): Connect.NextHandleFunction {
	return async (req, res, next) => {
		const url = req.url?.split('?')[0] ?? '';
		if (!url.startsWith('/api/')) return next();

		try {
			if (url === '/api/dj/status' && req.method === 'GET') {
				const hasKey = !!resolveElevenKey();
				return json(res, 200, {
					ok: true,
					elevenlabs: hasKey,
					tracks: listPlaylist().length,
					booth: 'DJ Bartek · Trap-gat · Prairie Lakes',
					voice: process.env.ELEVENLABS_VOICE_ID?.trim() || 'pNInz6obpgDQGcFmaJgB',
				});
			}

			if (url === '/api/dj/playlist' && req.method === 'GET') {
				return json(res, 200, { tracks: listPlaylist() });
			}

			if (url === '/api/dj/request' && req.method === 'POST') {
				const raw = await readBody(req);
				const body = JSON.parse(raw || '{}') as { query?: string };
				const query = (body.query ?? '').trim();
				if (!query) return json(res, 400, { ok: false, error: 'query required' });
				const result = await runYtDlp(query);
				return json(res, result.ok ? 200 : 500, {
					ok: result.ok,
					file: result.file,
					tracks: listPlaylist(),
					log: result.log.slice(-500),
				});
			}

			if (url === '/api/tts' && req.method === 'POST') {
				const raw = await readBody(req);
				const body = JSON.parse(raw || '{}') as { text?: string; voiceId?: string };
				const text = (body.text ?? '').trim();
				if (!text) return json(res, 400, { error: 'text required' });
				try {
					const audio = await elevenLabsTts(text, body.voiceId);
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

			// Serve a track by name (fallback if static fails)
			if (url.startsWith('/api/dj/file/') && req.method === 'GET') {
				const name = decodeURIComponent(url.replace('/api/dj/file/', ''));
				const safe = basename(name);
				const full = join(MUSIC_DIR, safe);
				if (!existsSync(full)) return json(res, 404, { error: 'not found' });
				res.statusCode = 200;
				res.setHeader('Content-Type', 'audio/mpeg');
				createReadStream(full).pipe(res);
				return;
			}

			return next();
		} catch (e) {
			return json(res, 500, { error: String(e) });
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
	};
}
