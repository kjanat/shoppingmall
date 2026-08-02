import './style.css';

const canvasRoot = document.querySelector<HTMLElement>('#canvas-root');
const uiRoot = document.querySelector<HTMLElement>('#ui-root');

if (!canvasRoot || !uiRoot) {
	throw new Error('Missing #canvas-root or #ui-root');
}

const boot = async () => {
	try {
		const { App } = await import('./app/App');
		new App(canvasRoot, uiRoot);
		document.querySelector('#app-loading')?.remove();
	} catch (error) {
		const loading = document.querySelector<HTMLElement>('#app-loading');
		if (loading) loading.textContent = 'Mall kon niet worden geopend';
		throw error;
	}
};

if (new URLSearchParams(window.location.search).has('perf-probe')) {
	void boot();
} else {
	// Commit the HTML-native loading screen before constructing the sizeable
	// Three.js world on the main thread.
	requestAnimationFrame(() => requestAnimationFrame(() => void boot()));
}
