import { defineConfig, loadEnv } from 'vite';
import { djBartekPlugin } from './server/djMiddleware';

export default defineConfig(({ mode }) => {
	// loadEnv with '' loads ALL keys from .env / .env.local / .env.[mode]
	// (not only VITE_*). Force-assign so a key added mid-session works after restart.
	const env = loadEnv(mode, process.cwd(), '');
	for (const [k, v] of Object.entries(env)) {
		process.env[k] = v;
	}

	const hasEleven =
		!!(process.env.ELEVENLABS_API_KEY || process.env.ELEVEN_API_KEY || process.env.VITE_ELEVENLABS_API_KEY);
	const hasYt = !!(process.env.YOUTUBE_API_KEY || process.env.YT_API_KEY);
	const hasOr = !!(process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_KEY);
	console.log(
		`[Mall] env: ELEVENLABS=${hasEleven ? 'yes' : 'NO'} · YOUTUBE=${hasYt ? 'yes' : 'NO'} · OPENROUTER=${
			hasOr ? 'yes' : 'NO'
		} · mode=${mode}`,
	);

	return {
		// Relative asset URLs: the same build works from a repo sub-path
		// (kjanat.github.io/shoppingmall/) and from a domain root.
		base: './',
		plugins: [djBartekPlugin()],
		server: {
			host: true,
			allowedHosts: true,
		},
		build: {
			target: 'es2023',
			chunkSizeWarningLimit: 1200,
		},
	};
});
