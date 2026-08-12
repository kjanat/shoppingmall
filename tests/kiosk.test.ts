import { describe, expect, test } from 'bun:test';
import { LEVELS, levelAt } from '#/data/levels';
import { ENTRANCE_LABEL } from '#/data/world';
import { BIG_MAP_MIN_WIDTH, deckLabelPlan, minimapLabelPlan } from '#/ui/KioskOverlay';
import { span } from '#/util/math';
import { profilePoint } from '$/scripts/perf/routes.ts';
import { callArguments, methodBody, read, withoutText } from './helpers/source-scan.ts';
import { stubTextMeasure } from './helpers/stub-dom.ts';
import { nr } from './helpers/world.ts';

/**
 * The kiosk draws the world; it does not keep a second copy of it.
 *
 * A loose number in a canvas call inside the world painters is a coordinate in metres, and so a
 * second copy of a measurement that already lives in `data/`. That is how the kiosk came to
 * draw five features at positions nothing moved along with the scene. Only the arguments that
 * point at a place are read: radius, width, angle and line width are free, so
 * `arc(t.x, t.z, 2.4, …)` is fine and `arc(0, 10, 1.1, …)` is not. Outside the two world
 * painters the canvas counts in screen pixels and nothing here applies.
 */

/** Canvas calls whose first two arguments are metres inside the world painters. */
const CANVAS_PLACEMENT = /\bctx\.(fillRect|strokeRect|rect|arc|ellipse|moveTo|lineTo|translate)\(/g;
/** The world-to-screen helpers of the big map: their argument is a metre. */
const SCREEN_PROJECTION = /\b(sx|sy)\(/g;
/** A map marker on a hand-written coordinate. */
const HAND_WRITTEN_MARKER = /\{[^{}]*\bx:\s*(-?\d+(?:\.\d+)?)\s*,\s*z:\s*(-?\d+(?:\.\d+)?)\s*,\s*level:/g;
const LOOSE_NUMBER = /^-?\d+(?:\.\d+)?$/;

const SOURCE = withoutText(await read('src/ui/KioskOverlay.ts'));

describe('the kiosk places nothing on loose metres', () => {
	test.each(['paintWorld', 'paintRoofLayer'])('%s', (name) => {
		const body = methodBody(SOURCE, name);
		const loose = callArguments(body, CANVAS_PLACEMENT).flatMap((call) => {
			const placed = call.args.slice(0, 2).filter((arg) => LOOSE_NUMBER.test(arg));
			return placed.length === 0 ? [] : [`ctx.${call.name}(${call.args.join(', ')}) places on loose metres ${placed.join(', ')}`];
		});
		expect(loose, loose.join('\n')).toBeEmpty();
	});

	test('nothing is projected to the screen from a loose coordinate', () => {
		const loose = callArguments(SOURCE, SCREEN_PROJECTION)
			.filter((call) => call.args[0] !== undefined && LOOSE_NUMBER.test(call.args[0]))
			.map((call) => `${call.name}(${call.args[0]}) projects a loose coordinate`);
		expect(loose, loose.join('\n')).toBeEmpty();
	});

	test('no map marker sits on a hand-written coordinate', () => {
		const markers = [...SOURCE.matchAll(HAND_WRITTEN_MARKER)].map(
			(match) => `a marker at (${match[1]}, ${match[2]}) — derive it from its entity`,
		);
		expect(markers, markers.join('\n')).toBeEmpty();
	});
});

/**
 * P1 exists in LEVELS, in the graph, in the lift and as a parking deck, but the big map had
 * three hand-written tabs and that was one short. A deck you can walk and cannot look up does
 * not exist for the player, so the tabs come out of LEVELS. A tab with a written deck id in it
 * is exactly the second list, and so the fault itself.
 */
describe('every deck gets a tab on the big map', () => {
	const DECK_IDS = new Set<string>(LEVELS.map((level) => level.id));

	test('the tabs are built from the level registry', () => {
		expect(SOURCE.includes('LEVELS_BOTTOM_UP'), 'the source of the map tabs is gone').toBeTrue();
		expect(
			/for \(const \w+ of LEVELS_BOTTOM_UP\)/.test(SOURCE),
			'KioskOverlay no longer walks LEVELS_BOTTOM_UP, so a new deck gets no tab',
		).toBeTrue();
	});

	test('no tab writes its deck id by hand', () => {
		const written = [...SOURCE.matchAll(/data-level="([^"]+)"/g)].map(
			(match) => `tab data-level="${match[1]}" is written by hand; derive it from LEVELS`,
		);
		expect(written, written.join('\n')).toBeEmpty();
	});

	test('the overlay keeps no deck list of its own', () => {
		const lists = [...SOURCE.matchAll(/\[\s*'[a-z0-9_]+'(?:\s*,\s*'[a-z0-9_]+')*\s*\]/g)]
			.map((match) => [...match[0].matchAll(/'([a-z0-9_]+)'/g)].map((member) => member[1]))
			.filter((members) => members.every((member) => member !== undefined && DECK_IDS.has(member)))
			.map((members) => `KioskOverlay keeps its own deck list (${members.join(', ')})`);
		expect(lists, lists.join('\n')).toBeEmpty();
	});
});

/**
 * Every map label is actually drawn.
 *
 * That a label text exists is checked elsewhere and stayed green while the map drew nothing:
 * P · TICKETS was measured against the 2.2 m of the booth itself at all five places and
 * silently fell away. Measured with the stub text metric, which is wider than a real monospace
 * at the sizes the map uses, so whatever fits here fits in the browser.
 */
describe('the map draws what it names', () => {
	const metric = stubTextMeasure();

	test.each(LEVELS.map((level) => level.id))('every name on the %s plan fits somewhere', (id) => {
		const level = LEVELS.find((candidate) => candidate.id === id);
		const unfittable = deckLabelPlan(metric, id, BIG_MAP_MIN_WIDTH).unfittable.map(
			(name) => `"${name}" fits nowhere on the plan of ${level?.code ?? id}, so the map does not draw it`,
		);
		expect(unfittable, unfittable.join('\n')).toBeEmpty();
	});

	/**
	 * The minimap names the main entrance in full from the one viewpoint outside the facade the
	 * project ships. Its slot stood empty there next to a labelled exit, because the anchor of
	 * the entrance fell half a pixel outside the circle and what was left fitted a truncation
	 * rather than a name.
	 */
	describe('from the pavement in front of it', () => {
		const { pose } = profilePoint('v0-entrance-street');
		const named = minimapLabelPlan(metric, {
			x: pose.x,
			z: pose.z,
			yaw: Math.atan2(-span(pose.x, pose.lookX), -span(pose.z, pose.lookZ)),
			level: levelAt(pose.y),
		}).plan;
		const entrance = named.find((label) => label.text === ENTRANCE_LABEL);

		test('the minimap names the main entrance', () => {
			expect(
				entrance,
				`it draws ${named.length === 0 ? 'nothing' : named.map((label) => label.text).join(', ')} instead`,
			).toBeDefined();
		});

		test('it names it in full', () => {
			expect(entrance?.label.whole, `it draws "${entrance?.label.lines.join(' ')}" instead of the whole name`).toBeTrue();
		});
	});
});

test('the label metric used here is the one the checks agree on', () => {
	// A metric that measured narrower than the browser would let a label pass here and clip
	// there; the stub is deliberately wider per glyph than a real monospace.
	expect(stubTextMeasure().measureText('mm').width, 'the stub metric got narrower than a real glyph').toBeGreaterThanOrEqual(
		2 * 7,
	);
});

test('the deck plan actually places names, so an empty unfittable list means something', () => {
	const plan = deckLabelPlan(stubTextMeasure(), 'v0', BIG_MAP_MIN_WIDTH);
	expect(
		plan.plan,
		`the plan places nothing at all on V0, so ${nr(plan.unfittable.length)} unfittable names prove nothing`,
	).not.toBeEmpty();
});
