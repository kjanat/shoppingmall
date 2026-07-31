/**
 * Dev-only glue: mounts the API on vite's connect stack by adapting
 * IncomingMessage/ServerResponse to the Request/Response handler in api.ts.
 * Production does not go through this — see server/main.ts (Bun.serve).
 */
import type { Connect, Plugin, PreviewServer, ViteDevServer } from 'vite';
import { ensureMusicDir, handleApi } from './api.ts';

function readBody(req: Connect.IncomingMessage): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		req.on('data', (c) => chunks.push(Buffer.from(c)));
		req.on('end', () => resolve(Buffer.concat(chunks)));
		req.on('error', reject);
	});
}

function djMiddleware(): Connect.NextHandleFunction {
	return async (req, res, next) => {
		const path = req.url?.split('?')[0] ?? '';
		if (!path.startsWith('/api/')) return next();

		const raw = (req as unknown as {
			headers?: Record<string, string | undefined>;
		}).headers ?? {};
		const headers = new Headers();
		for (const [k, v] of Object.entries(raw)) if (typeof v === 'string') headers.set(k, v);

		const method = req.method ?? 'GET';
		const request = new Request(`http://${raw.host ?? 'localhost'}${req.url}`, {
			method,
			headers,
			body: method === 'GET' || method === 'HEAD' ? undefined : await readBody(req),
		});

		const out = await handleApi(request, req.socket?.remoteAddress ?? 'unknown');
		if (!out) return next();

		res.statusCode = out.status;
		out.headers.forEach((v, k) => res.setHeader(k, v));
		res.end(Buffer.from(await out.arrayBuffer()));
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
