import { defineConfig } from 'vite';

export default defineConfig({
	// Relative asset URLs: the same build works from a repo sub-path
	// (kjanat.github.io/shoppingmall/) and from a domain root.
	base: './',
	server: {
		host: true,
		allowedHosts: true,
	},
	build: {
		target: 'es2023',
		chunkSizeWarningLimit: 1200,
	},
});
