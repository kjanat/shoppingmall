import { resolve } from 'node:path';

const ROOT_DIR = resolve(import.meta.dirname, '..', '..');
const BASELINE_DIR = resolve(ROOT_DIR, '.perf');
const DIST_DIR = resolve(ROOT_DIR, 'dist');
const PERF_DIR = BASELINE_DIR;

const STATIC_DIR = resolve(DIST_DIR, 'static');

const ROUTES_DIR = resolve(BASELINE_DIR, 'routes');
const PROFILE_DIR = resolve(BASELINE_DIR, 'chrome-profile');
const BROWSER_LOCK_PATH = resolve(BASELINE_DIR, 'browser.lock');

export { BASELINE_DIR, BROWSER_LOCK_PATH, PERF_DIR, PROFILE_DIR, ROOT_DIR, ROUTES_DIR, STATIC_DIR };
