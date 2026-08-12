import { describe, expect, test } from 'bun:test';
import type { Exemption, Hit } from './helpers/source-scan.ts';
import { filesIn, grep } from './helpers/source-scan.ts';

/**
 * A texture on a plane you can see from both sides reads mirrored from behind.
 *
 * The taxi roof read IXAT, the AL ZUT crew banner TUZ LA, the TIKI BAR sign mirrored
 * from the bar and the WET FLOOR plate on the scrubber did the same. Two planes back to
 * back both read left to right: `backToBackLabel` in util/label.
 *
 * Every material with both a `map` and DoubleSide is measured, because whether the
 * texture holds text cannot be grepped. What holds no text (flags, faces, leaves, water)
 * sits in the table below with its reason, and a row that no longer matches anything is
 * itself a build failure.
 */

const EXEMPTIONS: Exemption[] = [
	{
		path: 'src/scene/ProtestGroupies.ts',
		fragment: 'map: tex,',
		reason: 'the German flag is three colour bands; mirrored it still reads black-red-gold',
	},
	{
		path: 'src/scene/ProtestGroupies.ts',
		fragment: 'map: this.makePrideFlagTex(kind),',
		reason: 'a rainbow flag is striped and reads the same from both sides',
	},
	{
		path: 'src/scene/ProtestGroupies.ts',
		fragment: 'map,',
		reason:
			'the face atlas hangs on one InstancedMesh with its own tile shader; two planes back to back are not planes there but the swarm twice',
	},
];

const DOUBLE_SIDED = /\bTHREE\s*\.\s*DoubleSide\b/g;
/** `map: tex` and the shorthand `map,` are the same property. */
const TEXTURE_PROPERTY = /\bmap\s*[:,}]/;
const TEXTURE_ASSIGNMENT = /\b([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\.map\s*=[^=]/g;
const SIDE_ASSIGNMENT = /\b([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\.side\s*=\s*THREE\s*\.\s*DoubleSide\b/g;

const MESSAGE = 'is a texture on a double-sided plane; from behind it reads mirrored. Put two planes back to back';

/** The object literal containing `index`: the first `{` to the left that is still open. */
function enclosingLiteral(code: string, index: number): { from: number; to: number } | null {
	let depth = 0;
	let from = -1;
	for (let i = index; i >= 0; i--) {
		const char = code[i];
		if (char === '}') depth++;
		else if (char === '{') {
			if (depth === 0) {
				from = i;
				break;
			}
			depth--;
		}
	}
	if (from < 0) return null;
	depth = 0;
	for (let i = from; i < code.length; i++) {
		const char = code[i];
		if (char === '{') depth++;
		else if (char === '}') {
			depth--;
			if (depth === 0) return { from, to: i };
		}
	}
	return null;
}

/** The declaration of this name, up to the semicolon that ends it. */
function declarationOf(code: string, name: string): string | null {
	const pattern = new RegExp(String.raw`\b(?:const|let|var)\s+${name.replaceAll('.', String.raw`\.`)}\b[^;]*`);
	return pattern.exec(code)?.[0] ?? null;
}

/**
 * The two properties need not sit in the same literal: `mat.map = tex` a few lines later
 * is the same texture, and `mat.side = THREE.DoubleSide` the same double side. The grep
 * used to read only the enclosing literal and missed those, while the rule it enforces is
 * wider than that shape.
 */
function hits(code: string): Hit[] {
	const out: Hit[] = [];
	const doubleSidedNames = new Set<string>();

	for (const side of code.matchAll(SIDE_ASSIGNMENT)) {
		const name = side[1];
		if (name !== undefined) doubleSidedNames.add(name);
	}

	for (const double of code.matchAll(DOUBLE_SIDED)) {
		const literal = enclosingLiteral(code, double.index);
		if (!literal) continue;
		const body = code.slice(literal.from, literal.to + 1);
		const texture = TEXTURE_PROPERTY.exec(body);
		if (texture) {
			out.push({ index: literal.from + texture.index, message: MESSAGE });
			continue;
		}
		// No texture in this literal, but the name it hangs on can still get one later.
		// Without this the grep sticks to the shape instead of to the rule.
		const declaration = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=[^;]*$/.exec(code.slice(0, literal.from));
		const name = declaration?.[1];
		if (name !== undefined) doubleSidedNames.add(name);
	}

	for (const texture of code.matchAll(TEXTURE_ASSIGNMENT)) {
		const name = texture[1];
		if (name === undefined) continue;
		const declaration = declarationOf(code, name);
		const doubleSided = doubleSidedNames.has(name) || (declaration !== null && DOUBLE_SIDED.test(declaration));
		DOUBLE_SIDED.lastIndex = 0;
		if (!doubleSided) continue;
		out.push({ index: texture.index, message: MESSAGE });
	}

	return out;
}

const FILES = await filesIn('src');

describe('no texture reads mirrored from behind', () => {
	test('every double-sided plane with a map is accounted for', async () => {
		const complaints = await grep({ files: FILES, exemptFiles: [], exemptions: EXEMPTIONS, hits: (code) => hits(code) });
		expect(complaints, complaints.join('\n')).toBeEmpty();
	});
});
