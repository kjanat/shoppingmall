import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { loadGame, type PersistedGame, saveGame } from '#/app/GamePersist';
import { stubSessionStorage } from '$/scripts/stub-dom.ts';

/**
 * De laadgrens van een opgeslagen spel.
 *
 * `JSON.parse` geeft `any`, en wat daaruit kwam ging ongelezen naar `resume`, dat
 * x, y, z, koers en snelheid rechtstreeks in de transform van een voertuig schrijft.
 * Eén `null` of `"12"` in sessionStorage zette een auto daarmee op NaN, en dan klapt
 * de matrix en niet de laadfunctie. De versiestap houdt oude sessies buiten de deur
 * en zegt niets over de vórm van wat er staat.
 */

const KEY = 'mallsim.game.v3';

const opslag = stubSessionStorage();

function schrijf(waarde: unknown): void {
	opslag.setItem(KEY, JSON.stringify(waarde));
}

const HELE_SESSIE: Omit<PersistedGame, 'v' | 'savedAt'> = {
	x: 1,
	y: 2,
	z: 3,
	yaw: 0.4,
	pitch: -0.1,
	score: 7,
	metSims: [1, 2],
	freeMove: true,
	storeId: 'kruidvat',
	path: [{ id: 'a', x: 0, y: 0, z: 0 }],
	thiefFiredAt: 12,
	disco: true,
	ride: { kind: 'car', id: 'huurauto-1', x: 5, y: 0, z: 6, yaw: 1, speed: 3 },
	parkedVehicle: { kind: 'car', id: 'ZWARTE MOTOR', x: 73, y: 0, z: -45, yaw: 0.8, speed: 0 },
};

describe('een opgeslagen sessie wordt aan de grens gelezen', () => {
	beforeEach(() => {
		opslag.clear();
	});

	test('wat opgeslagen is komt er ongeschonden weer uit', () => {
		saveGame(HELE_SESSIE);
		const terug = loadGame();
		assert.ok(terug);
		assert.deepEqual(terug.ride, HELE_SESSIE.ride);
		assert.deepEqual(terug.parkedVehicle, HELE_SESSIE.parkedVehicle);
		assert.deepEqual(terug.path, HELE_SESSIE.path);
		assert.equal(terug.score, 7);
		assert.equal(terug.storeId, 'kruidvat');
		assert.equal(terug.disco, true);
	});

	test('een rit met een getal dat geen getal is levert geen rit op', () => {
		for (const kapot of [
			{ kind: 'car', id: '', x: null, y: 0, z: 0, yaw: 0, speed: 0 },
			{ kind: 'car', id: '', x: '12', y: 0, z: 0, yaw: 0, speed: 0 },
			{ kind: 'car', id: '', x: 0, y: 0, z: 0, yaw: 0 },
			{ kind: 'helicopter', id: '', x: 0, y: 0, z: 0, yaw: 0, speed: 0 },
			'auto',
			null,
		]) {
			schrijf({ ...HELE_SESSIE, v: 3, savedAt: Date.now(), ride: kapot });
			const terug = loadGame();
			assert.ok(terug, `${JSON.stringify(kapot)} hoort de rest van de sessie niet weg te gooien`);
			assert.equal(terug.ride, null, `${JSON.stringify(kapot)} kwam er als rit doorheen`);
		}
	});

	/**
	 * De motor rijdt als slot van `DriveableCars` en komt dus terug via dezelfde
	 * rit-soort als de huurauto's; zijn naam is waar `resume` het exemplaar op
	 * terugvindt. Een rit-soort die de laadgrens niet kent wordt stilletjes `null`,
	 * en dan sta je na een herbouw te voet in de motor waar je op zat.
	 */
	test('een motorrit komt met zijn eigen exemplaar terug', () => {
		const motorrit = { kind: 'car', id: 'ZWARTE MOTOR', x: -10.4, y: -6, z: 14, yaw: Math.PI, speed: 8 } as const;
		saveGame({ ...HELE_SESSIE, ride: { ...motorrit } });
		const terug = loadGame();
		assert.ok(terug);
		assert.deepEqual(terug.ride, motorrit, 'de motorrit hoort ongeschonden terug te komen');
	});

	test('een sessie zonder bruikbare camerastand wordt niet hervat', () => {
		schrijf({ ...HELE_SESSIE, v: 3, savedAt: Date.now(), y: 'boven' });
		assert.equal(loadGame(), null);
	});

	test('elk veld dat de sessie niet draagt krijgt zijn eigen lege waarde', () => {
		schrijf({ v: 3, savedAt: Date.now(), x: 0, y: 0, z: 0, yaw: 0, pitch: 0 });
		const terug = loadGame();
		assert.ok(terug);
		assert.equal(terug.score, 0);
		assert.deepEqual(terug.metSims, []);
		assert.deepEqual(terug.path, []);
		assert.equal(terug.storeId, null);
		assert.equal(terug.disco, false);
		assert.equal(terug.ride, null);
		assert.equal(terug.parkedVehicle, null);
	});

	test('een route houdt alleen de knopen over waar echt een plek in staat', () => {
		schrijf({
			...HELE_SESSIE,
			v: 3,
			savedAt: Date.now(),
			path: [{ id: 'a', x: 0, y: 0, z: 0 }, { id: 'b', x: Number.NaN, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }, 'c'],
		});
		const terug = loadGame();
		assert.ok(terug);
		assert.deepEqual(terug.path, [
			{ id: 'a', x: 0, y: 0, z: 0 },
			{ id: '', x: 1, y: 1, z: 1 },
		]);
	});

	test('een sessie uit een vorige versie of van gisteren komt niet terug', () => {
		schrijf({ ...HELE_SESSIE, v: 2, savedAt: Date.now() });
		assert.equal(loadGame(), null);
		schrijf({ ...HELE_SESSIE, v: 3, savedAt: Date.now() - 9 * 3600 * 1000 });
		assert.equal(loadGame(), null);
		assert.equal(opslag.getItem(KEY), null, 'een verlopen sessie hoort ook opgeruimd te worden');
	});

	test('rommel in de opslag is geen sessie', () => {
		for (const rommel of ['', 'niet eens json', '[]', '"tekst"', '12', 'null']) {
			opslag.setItem(KEY, rommel);
			assert.equal(loadGame(), null, `${rommel} kwam er als sessie doorheen`);
		}
	});
});
