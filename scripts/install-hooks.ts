#!/usr/bin/env bun
/**
 * Zet de gedeelde hooks aan. Draait als `prepare`, dus op elke `bun install`.
 *
 * In bun in plaats van shell: bun's eigen shell op Windows kent `test` niet en
 * `sh` staat daar niet op PATH. Geen git-repo (image-build) betekent stil niets
 * doen.
 */
import { $ } from 'bun';

const inRepo = await $`git rev-parse --git-dir`.nothrow().quiet();
if (inRepo.exitCode !== 0) process.exit(0);

const raw = await $`git version`.nothrow().quiet().text();
const parts = /^git version (\d+)\.(\d+)/.exec(raw.trim());
if (!parts?.[1] || !parts[2]) process.exit(0);
const major = Number(parts[1]);
const minor = Number(parts[2]);

// Nooit allebei tegelijk: na een git-upgrade zou anders elke hook dubbel draaien.
if (major > 2 || (major === 2 && minor >= 54)) {
	await $`git config --unset-all core.hooksPath`.nothrow().quiet();
	await $`git config include.path ../hooks.gitconfig`;
} else if (major === 2 && minor >= 9) {
	await $`git config --unset-all include.path`.nothrow().quiet();
	await $`git config core.hooksPath .githooks`;
} else {
	console.error(`hooks: git ${major}.${minor} heeft geen core.hooksPath (2.9+), overgeslagen`);
}
