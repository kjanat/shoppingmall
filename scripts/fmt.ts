#!/usr/bin/env bun
/** Format the given files: biome for safe lint fixes and import order, dprint for the layout. */
import { error } from 'node:console';
import { dirname } from 'node:path';
import { exit } from 'node:process';
import { $, argv, stderr } from 'bun';

const ROOT = dirname(import.meta.dir);
const files = argv.slice(2);

if (files.length === 0) {
	error('usage: fmt.ts <file>...');
	exit(2);
}

await stderr.write(`${ROOT}: ${files.join(' ')}\n`);

await $`bunx biome check --fix ${files}`.cwd(ROOT).nothrow();
await $`bunx dprint fmt ${files}`.cwd(ROOT);
