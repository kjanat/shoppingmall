#!/usr/bin/env bun
/** Format the given files: biome for safe lint fixes and import order, dprint for the layout. */
import { dirname } from 'node:path';
import { $, argv } from 'bun';

const ROOT = dirname(import.meta.dir);
const files = argv.slice(2);

if (files.length === 0) {
	console.error('usage: fmt.ts <file>...');
	process.exit(2);
}

await Bun.stderr.write(`${ROOT}: ${files.join(' ')}\n`);

await $`bunx biome check --fix ${files}`.cwd(ROOT).nothrow();
await $`bunx dprint fmt ${files}`.cwd(ROOT);
