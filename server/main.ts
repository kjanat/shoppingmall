import { join, resolve, sep } from 'node:path';
import { handleApi } from './api.ts';

const DIST = resolve(process.cwd(), 'dist');
const notFound = () => new Response('not found', { status: 404 });

const server = Bun.serve({
	port: Number(Bun.env.PORT ?? 5174),
	hostname: '0.0.0.0',
	idleTimeout: 60,

	routes: {
		'/api/*': (req, server) => {
			// yt-dlp + ElevenLabs + OpenRouter run for minutes without writing a
			// byte; the idle timer would drop the connection mid-request.
			server.timeout(req, 0);
			return handleApi(req, server.requestIP(req)?.address ?? 'unknown') as Promise<Response>;
		},
	},

	async fetch(req) {
		const path = decodeURIComponent(new URL(req.url).pathname);
		const full = resolve(join(DIST, path === '/' ? '/index.html' : path));
		if (!full.startsWith(DIST + sep)) return notFound();

		const file = Bun.file(full);
		if (!(await file.exists())) return notFound();

		// Hashed bundles are immutable; index.html must revalidate on deploy
		const headers: Record<string, string> = {
			'Accept-Ranges': 'bytes',
			'Cache-Control': full.includes(`${sep}assets${sep}`)
				? 'public, max-age=31536000, immutable'
				: 'no-cache',
		};

		// Prebaked voice lines and prayer music get seeked like any <audio> source
		const range = req.headers.get('range');
		const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
		if (m && (m[1] !== '' || m[2] !== '')) {
			const size = file.size;
			let start = m[1] === '' ? size - Number(m[2]) : Number(m[1]);
			let end = m[1] !== '' && m[2] !== '' ? Number(m[2]) : size - 1;
			start = Math.max(0, start);
			end = Math.min(end, size - 1);
			if (start > end || start >= size) {
				return new Response(null, {
					status: 416,
					headers: { ...headers, 'Content-Range': `bytes */${size}` },
				});
			}
			return new Response(file.slice(start, end + 1), {
				status: 206,
				headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}` },
			});
		}

		return new Response(file, { headers });
	},

	error(err) {
		console.error('[Mall]', err);
		return new Response('internal error', { status: 500 });
	},
});

console.log(
	`[Mall] dist/ + /api on ${server.url} · ELEVENLABS=${!!Bun.env.ELEVENLABS_API_KEY} · YOUTUBE=${!!Bun.env
		.YOUTUBE_API_KEY} · OPENROUTER=${!!Bun.env.OPENROUTER_API_KEY}`,
);
