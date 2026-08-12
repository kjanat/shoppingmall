import { join, resolve } from 'node:path';

/**
 * Grepping our own source with the text blanked out.
 *
 * Comments, string, template and regex literals become runs of spaces of the same
 * length, so prose about π/2 and a check's own messages do not count as hits and every
 * index still lands on its original line. Expressions inside `${...}` stay, because
 * that is code.
 *
 * Regex literals belong here since the world check tripped over itself:
 * `/data-level="([^"]+)"/` holds three quotes, and without that knowledge one of them
 * opened a string that closed much later. Everything after it read code as string
 * content and back.
 */

export const ROOT = resolve(import.meta.dir, '..', '..');

export type Hit = { index: number; message: string };
export type Exemption = { path: string; fragment: string; reason: string };
export type ExemptFile = { path: string; reason: string };

export type Grep = {
	files: readonly string[];
	exemptFiles: readonly ExemptFile[];
	exemptions: readonly Exemption[];
	hits: (code: string, path: string) => Hit[];
};

/** Every .ts file under `dir`, as a path from the repo root. */
export async function filesIn(dir: string): Promise<string[]> {
	const out: string[] = [];
	for await (const name of new Bun.Glob('**/*.ts').scan({ cwd: join(ROOT, dir) })) out.push(join(dir, name));
	return out.sort();
}

export function read(path: string): Promise<string> {
	return Bun.file(join(ROOT, path)).text();
}

function blankRange(text: string, out: string[], from: number, to: number): void {
	for (let i = from; i < to && i < out.length; i++) {
		if (text[i] !== '\n') out[i] = ' ';
	}
}

/** After these a `/` opens a pattern; after a name, a number or a closing paren it divides. */
const PATTERN_AFTER_CHAR = new Set([
	'(',
	',',
	'=',
	':',
	'[',
	'!',
	'&',
	'|',
	'?',
	'{',
	'}',
	';',
	'+',
	'-',
	'*',
	'%',
	'^',
	'~',
	'<',
	'>',
]);
const PATTERN_AFTER_WORD = /(?:^|[^\w$])(?:return|typeof|case|in|of|new|delete|instanceof|do|else|void|yield|await)$/;
const PATTERN_FLAG = /^[dgimsuvy]$/;

/** The last few non-space characters of code: enough to tell what a `/` means. */
function rememberCode(tail: string, char: string): string {
	if (char === ' ' || char === '\t' || char === '\n' || char === '\r') return tail;
	return (tail + char).slice(-12);
}

function opensPattern(tail: string): boolean {
	if (tail === '') return true;
	return PATTERN_AFTER_CHAR.has(tail.slice(-1)) || PATTERN_AFTER_WORD.test(tail);
}

/**
 * Blank a literal from its opening quote; returns the index past the closing quote. A
 * `${` inside a template jumps back into code.
 */
function blankLiteral(text: string, out: string[], start: number, quote: string): number {
	out[start] = ' ';
	let i = start + 1;
	while (i < text.length) {
		const char = text[i];
		if (char === '\\') {
			blankRange(text, out, i, i + 2);
			i += 2;
			continue;
		}
		if (char === quote) {
			out[i] = ' ';
			return i + 1;
		}
		if (quote === '`' && text.startsWith('${', i)) {
			blankRange(text, out, i, i + 2);
			i = codeInTemplate(text, out, i + 2);
			continue;
		}
		blankRange(text, out, i, i + 1);
		i++;
	}
	return i;
}

/**
 * Blank a regex literal from its opening slash; returns the index past the flags. If the
 * slash runs into a line break it was a division, and the index comes back just past the
 * slash with nothing blanked.
 */
function blankPattern(text: string, out: string[], start: number): number {
	let i = start + 1;
	let inClass = false;
	let closed = false;
	while (i < text.length) {
		const char = text[i];
		if (char === '\n') break;
		if (char === '\\') {
			i += 2;
			continue;
		}
		if (char === '[') inClass = true;
		else if (char === ']') inClass = false;
		else if (char === '/' && !inClass) {
			i++;
			closed = true;
			break;
		}
		i++;
	}
	if (!closed) return start + 1;
	while (i < text.length && PATTERN_FLAG.test(text[i] ?? '')) i++;
	blankRange(text, out, start, i);
	return i;
}

/** Leave the expression in `${...}` intact and return its closing brace. */
function codeInTemplate(text: string, out: string[], start: number): number {
	let depth = 1;
	let i = start;
	let tail = '';
	while (i < text.length) {
		const char = text[i];
		if (char === "'" || char === '"' || char === '`') {
			i = blankLiteral(text, out, i, char);
			tail = rememberCode(tail, 'x');
			continue;
		}
		if (char === '/' && opensPattern(tail)) {
			const after = blankPattern(text, out, i);
			if (after > i + 1) {
				i = after;
				tail = rememberCode(tail, 'x');
				continue;
			}
		}
		if (char === '{') depth++;
		else if (char === '}') {
			depth--;
			if (depth === 0) {
				out[i] = ' ';
				return i + 1;
			}
		}
		if (char !== undefined) tail = rememberCode(tail, char);
		i++;
	}
	return i;
}

/** The same text, same length and same line breaks, without comments and literals. */
export function withoutText(text: string): string {
	// split('') and not [...text]: the spread counts codepoints, so one emoji in a string
	// shifts every index after it away from the regex position.
	const out = text.split('');
	let i = 0;
	let tail = '';
	while (i < text.length) {
		if (text.startsWith('//', i)) {
			const end = text.indexOf('\n', i);
			const to = end < 0 ? text.length : end;
			blankRange(text, out, i, to);
			i = to;
			continue;
		}
		if (text.startsWith('/*', i)) {
			const end = text.indexOf('*/', i + 2);
			const to = end < 0 ? text.length : end + 2;
			blankRange(text, out, i, to);
			i = to;
			continue;
		}
		const char = text[i];
		if (char === "'" || char === '"' || char === '`') {
			i = blankLiteral(text, out, i, char);
			tail = rememberCode(tail, 'x');
			continue;
		}
		if (char === '/' && opensPattern(tail)) {
			const after = blankPattern(text, out, i);
			if (after > i + 1) {
				i = after;
				tail = rememberCode(tail, 'x');
				continue;
			}
		}
		if (char !== undefined) tail = rememberCode(tail, char);
		i++;
	}
	return out.join('');
}

/** The body of a class method, from its opening brace to the matching close. */
export function methodBody(text: string, name: string): string {
	const head = text.indexOf(`private ${name}(`);
	if (head < 0) throw new Error(`no method ${name} in the source any more — renamed or rewritten?`);
	const open = text.indexOf('{', head);
	if (open < 0) throw new Error(`method ${name} has no body`);
	let depth = 0;
	for (let i = open; i < text.length; i++) {
		const char = text[i];
		if (char === '{') depth++;
		else if (char === '}') {
			depth--;
			if (depth === 0) return text.slice(open + 1, i);
		}
	}
	throw new Error(`the body of ${name} never closes`);
}

/** The arguments of every call `pattern` finds, split at depth one. */
export function callArguments(text: string, pattern: RegExp): { name: string; args: string[]; index: number }[] {
	const out: { name: string; args: string[]; index: number }[] = [];
	for (const match of text.matchAll(pattern)) {
		const name = match[1];
		if (name === undefined) continue;
		const args: string[] = [];
		let arg = '';
		let depth = 1;
		for (let i = match.index + match[0].length; i < text.length; i++) {
			const char = text[i];
			if (char === undefined) break;
			if (char === '(' || char === '[') depth++;
			else if (char === ')' || char === ']') {
				depth--;
				if (depth === 0) break;
			}
			if (depth === 1 && char === ',') {
				args.push(arg.trim());
				arg = '';
				continue;
			}
			arg += char;
		}
		args.push(arg.trim());
		out.push({ name, args, index: match.index });
	}
	return out;
}

/**
 * One grep with its tables around it: an exempt file has to exist, an exemption has to
 * match something, and a complaint carries the line number and the line itself.
 */
export async function grep(job: Grep): Promise<string[]> {
	const complaints: string[] = [];
	const used = new Set<string>();

	for (const exempt of job.exemptFiles) {
		if (!job.files.includes(exempt.path)) complaints.push(`exempt file ${exempt.path} no longer exists`);
	}

	for (const path of job.files) {
		if (job.exemptFiles.some((exempt) => exempt.path === path)) continue;
		const code = withoutText(await read(path));
		const lines = code.split('\n');
		// One definition sometimes matches two shapes at once — `function roundRect(…) {` is
		// also the method shape. The same message on the same line is one complaint.
		const reported = new Set<string>();
		for (const hit of job.hits(code, path)) {
			const lineNr = code.slice(0, hit.index).split('\n').length;
			const line = lines[lineNr - 1] ?? '';
			const exemption = job.exemptions.find((candidate) => candidate.path === path && line.includes(candidate.fragment));
			if (exemption) {
				used.add(`${exemption.path}|${exemption.fragment}`);
				continue;
			}
			const complaint = `${lineNr}|${hit.message}`;
			if (reported.has(complaint)) continue;
			reported.add(complaint);
			complaints.push(`${path}:${lineNr} ${hit.message} — \`${line.trim()}\``);
		}
	}

	for (const exemption of job.exemptions) {
		if (!used.has(`${exemption.path}|${exemption.fragment}`)) {
			complaints.push(`the exemption for \`${exemption.fragment}\` in ${exemption.path} no longer matches anything`);
		}
	}

	return complaints;
}
