import './style.css';
import { guardAccidentalClose } from './app/closeGuard';

const canvasRoot = document.querySelector<HTMLElement>('#canvas-root');
const uiRoot = document.querySelector<HTMLElement>('#ui-root');

if (!canvasRoot || !uiRoot) {
	throw new Error('Missing #canvas-root or #ui-root');
}

const boot = async () => {
	try {
		const { App } = await import('./app/App');
		// Vóór de constructor: de SceneBatcher bakt daarin, dus een model dat later
		// aankomt zou naast zijn eigen batch-kopie komen te staan.
		const { preloadMotorcycleModel } = await import('./scene/motorcycleModel');
		try {
			await preloadMotorcycleModel();
		} catch (error) {
			console.warn('[Mall] motor-model laadt niet, procedurele motor rijdt', error);
		}
		const app = new App(canvasRoot, uiRoot);
		// Hold the loading screen until the shaders are linked. The alternative is
		// handing the player a mall that stutters its way through the first minute.
		await app.ready;
		document.querySelector('#app-loading')?.remove();
	} catch (error) {
		const loading = document.querySelector<HTMLElement>('#app-loading');
		if (loading) loading.textContent = 'Mall kon niet worden geopend';
		throw error;
	}
};

guardAccidentalClose();

if (new URLSearchParams(window.location.search).has('perf-probe')) {
	void boot();
} else {
	// Commit the HTML-native loading screen before constructing the sizeable
	// Three.js world on the main thread.
	requestAnimationFrame(() => requestAnimationFrame(() => void boot()));
}
