#!/usr/bin/env bun
/**
 * Kale three-scene om GLB-assets naast elkaar te inspecteren, zonder de hele
 * wereld te bouwen: origineel links, gecomprimeerd rechts. `?zoom` zet de
 * camera op wielhoogte.
 *
 *   fixtures/glb-viewer/serve.ts        en open de geprinte URL
 */
import { resolve } from 'node:path';
import { file, serve } from 'bun';

const REPO = resolve(import.meta.dir, '..', '..');

const server = serve({
	port: 0,
	hostname: '127.0.0.1',
	fetch(request) {
		const path = decodeURIComponent(new URL(request.url).pathname);
		if (path === '/') return new Response(file(`${import.meta.dir}/index.html`));
		if (path === '/orig.glb') {
			return new Response(file(`${REPO}/models/motorcycle.glb`), { headers: { 'content-type': 'model/gltf-binary' } });
		}
		if (path === '/comp.glb') {
			return new Response(file(`${REPO}/public/models/motorcycle-compressed.glb`), {
				headers: { 'content-type': 'model/gltf-binary' },
			});
		}
		return new Response('not found', { status: 404 });
	},
});

console.log(`FIXTURE_URL http://127.0.0.1:${server.port}/`);
