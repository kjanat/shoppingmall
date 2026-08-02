/**
 * The whole server: bundled game + /api, dev and production.
 *   dev   bun --hot server/main.ts   bundles index.html on demand, HMR
 *   prod  dist/mall                  same import, baked into the binary
 * public/ is read from the working directory in both.
 */

import type { Dirent } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { execArgv } from 'node:process';
import { link } from 'ansispeck';
import { env, serve } from 'bun';
import index from '$/index.html';
import { handleApi } from './api.ts';

const PUBLIC = resolve('public');
const DIST_STATIC = resolve('dist/static');

/**
 * HMR and console forwarding are opt-in. The Dockerfile and `bun start` do set
 * NODE_ENV=production, but a bare `./mall` does not, and on `!== 'production'`
 * that one quietly served a dev server. `bun --hot` is the dev script and Bun
 * leaves NODE_ENV unset there, so that one says so through argv.
 */
const dev = env.NODE_ENV === 'development' || execArgv.includes('--hot');
const notFound = () => new Response('not found', { status: 404 });

async function serveStatic(req: Request): Promise<Response> {
	const path = decodeURIComponent(new URL(req.url).pathname);
	const full = resolve(join(PUBLIC, path));
	if (!full.startsWith(PUBLIC + sep)) return notFound();

	const file = Bun.file(full);
	if (!(await file.exists())) return notFound();

	const headers: Record<string, string> = {
		'Accept-Ranges': 'bytes',
		// Public files are stable media/images. JSON remains revalidated because
		// playlist/status manifests can change without a filename change.
		'Cache-Control': /\.(?:json|html?)$/i.test(path) ? 'no-cache' : 'public, max-age=86400, stale-while-revalidate=604800',
	};

	// <audio> seeks with range requests; a plain 200 stalls long tracks
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
}

/**
 * The HTML bundle answers every path it is routed on, asset paths included, so
 * each public/ entry needs a route of its own. Derived from the directory, so a
 * new folder can't silently start serving the game document instead of a file.
 */
async function publicRoutes(): Promise<Record<string, (req: Request) => Promise<Response>>> {
	const out: Record<string, (req: Request) => Promise<Response>> = {};
	for (const entry of await readdir(PUBLIC, { withFileTypes: true })) {
		out[entry.isDirectory() ? `/${entry.name}/*` : `/${entry.name}`] = serveStatic;
	}
	return out;
}

async function builtAssetRoutes(dir = DIST_STATIC, relative = ''): Promise<Record<string, (req: Request) => Promise<Response>>> {
	const out: Record<string, (req: Request) => Promise<Response>> = {};
	let entries: Dirent[] = [];
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return out;
	}
	for (const entry of entries) {
		const rel = relative ? `${relative}/${entry.name}` : entry.name;
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			Object.assign(out, await builtAssetRoutes(full, rel));
			continue;
		}
		if (rel === 'index.html') continue;
		out[`/${rel}`] = async () =>
			new Response(Bun.file(full), {
				headers: {
					// Bun's HTML build fingerprints these filenames. They can safely
					// live in browser/proxy caches for a year.
					'Cache-Control': 'public, max-age=31536000, immutable',
				},
			});
	}
	return out;
}

async function serveAppShell(): Promise<Response> {
	const file = Bun.file(join(DIST_STATIC, 'index.html'));
	if (!(await file.exists())) return notFound();
	return new Response(file, { headers: { 'Cache-Control': 'no-cache' } });
}

const server = serve({
	port: env['PORT'] ?? 5174,
	hostname: '0.0.0.0',
	idleTimeout: 60,
	development: dev && { hmr: true, console: true },

	routes: {
		...(await publicRoutes()),
		...(!dev ? await builtAssetRoutes() : {}),
		'/api/*': (req, server) => {
			// yt-dlp + ElevenLabs + OpenRouter run for minutes without writing a
			// byte; the idle timer would drop the connection mid-request.
			server.timeout(req, 0);
			return handleApi(req, server.requestIP(req)?.address ?? 'unknown');
		},
		'/*': dev ? index : serveAppShell,
	},

	error(err) {
		console.error('[Mall]', err);
		return new Response('internal error', { status: 500 });
	},
});

console.log(
	`\
[Mall] game + /api on ${link(server.url)}
\tDEV=${dev}
\tELEVENLABS=${!!env['ELEVENLABS_API_KEY']}
\tYOUTUBE=${!!env['YOUTUBE_API_KEY']}
\tOPENROUTER=${!!env['OPENROUTER_API_KEY']}`,
);
