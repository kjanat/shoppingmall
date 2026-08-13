#!/usr/bin/env bun
/**
 * Zet de gedeelde hooks aan. Draait als `prepare`, dus op elke `bun install`.
 *
 * In bun in plaats van shell: bun's eigen shell op Windows kent `test` niet en
 * `sh` staat daar niet op PATH. Geen git-repo (image-build) betekent stil niets
 * doen.
 */

import { error } from 'node:console';
import { exit } from 'node:process';
import { $ } from 'bun';

type GitVersion = Readonly<{ major: number; minor: number }>;

const INCLUDE_CONFIG_MINIMUM: GitVersion = { major: 2, minor: 54 };
const HOOKS_PATH_MINIMUM: GitVersion = { major: 2, minor: 9 };

function supports(current: GitVersion, minimum: GitVersion): boolean {
	return current.major > minimum.major || (current.major === minimum.major && current.minor >= minimum.minor);
}

function formatVersion(value: GitVersion): string {
	return `${value.major}.${value.minor}`;
}

const inRepo = await $`git rev-parse --git-dir`.nothrow().quiet();
if (inRepo.exitCode !== 0) exit(0);

const raw = await $`git version`.nothrow().quiet().text();
const parts = /^git version (?<major>\d+)\.(?<minor>\d+)/.exec(raw.trim());
const major = Number(parts?.groups?.['major']);
const minor = Number(parts?.groups?.['minor']);
if (!(Number.isInteger(major) && Number.isInteger(minor))) exit(0);
const version: GitVersion = { major, minor };

// Nooit allebei tegelijk: na een git-upgrade zou anders elke hook dubbel draaien.
if (supports(version, INCLUDE_CONFIG_MINIMUM)) {
	await $`git config --unset-all core.hooksPath`.nothrow().quiet();
	await $`git config include.path ../hooks.gitconfig`;
} else if (supports(version, HOOKS_PATH_MINIMUM)) {
	await $`git config --unset-all include.path`.nothrow().quiet();
	await $`git config core.hooksPath .githooks`;
} else {
	error(`hooks: git ${formatVersion(version)} heeft geen core.hooksPath (${formatVersion(HOOKS_PATH_MINIMUM)}+), overgeslagen`);
}
