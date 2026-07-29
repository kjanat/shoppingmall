import './style.css';
import { App } from './app/App';

const canvasRoot = document.querySelector<HTMLElement>('#canvas-root');
const uiRoot = document.querySelector<HTMLElement>('#ui-root');

if (!canvasRoot || !uiRoot) {
	throw new Error('Missing #canvas-root or #ui-root');
}

new App(canvasRoot, uiRoot);
