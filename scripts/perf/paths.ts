import { resolve } from 'node:path';

const ROOT_DIR = resolve(import.meta.dirname, '..', '..');
const BASELINE_DIR = resolve(ROOT_DIR, '.perf');
const DIST_DIR = resolve(ROOT_DIR, 'dist');
const PERF_DIR = BASELINE_DIR;

const STATIC_DIR = resolve(DIST_DIR, 'static');
/** De echte server leest public/ uit de werkmap; de meetserver hoort hetzelfde te serveren. */
const PUBLIC_DIR = resolve(ROOT_DIR, 'public');

const ROUTES_DIR = resolve(BASELINE_DIR, 'routes');
const PROFILE_DIR = resolve(BASELINE_DIR, 'chrome-profile');
const SHOTS_DIR = resolve(BASELINE_DIR, 'shots');
const BROWSER_LOCK_PATH = resolve(BASELINE_DIR, 'browser.lock');

export { BASELINE_DIR, BROWSER_LOCK_PATH, PERF_DIR, PROFILE_DIR, PUBLIC_DIR, ROOT_DIR, ROUTES_DIR, SHOTS_DIR, STATIC_DIR };
