import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import {
	DjLibrary,
	importLegacySidecars,
	isAudioFileName,
	parseYtDlpInfo,
	parseYtDlpOutput,
	YT_DLP_META_PREFIX,
} from '$/server/djLibrary.ts';

const temporaryDirectories: string[] = [];

after(async () => {
	await Promise.all(temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('DJ library metadata boundary', () => {
	test('parses one tagged yt-dlp record and keeps its raw dump', () => {
		const payload = JSON.stringify({
			id: 'lcOxhH8N3Bo',
			title: 'Total Eclipse of the Heart',
			uploader: 'BonnieTylerVEVO',
			duration: 266.4,
			webpage_url: 'https://www.youtube.com/watch?v=lcOxhH8N3Bo',
			filepath: '/app/data/dj/music/Total Eclipse of the Heart.mp3',
			formats: [{ format_id: '251' }],
		});
		const capture = parseYtDlpOutput(`[download] done\n${YT_DLP_META_PREFIX}${payload}\n`);
		assert.ok(capture);
		assert.equal(capture.track.file, 'Total Eclipse of the Heart.mp3');
		assert.equal(capture.track.artist, 'BonnieTylerVEVO');
		assert.equal(capture.track.durationSeconds, 266);
		assert.equal(capture.track.youtubeId, 'lcOxhH8N3Bo');
		assert.equal(capture.dump, payload);
	});

	test('rejects records without a filename and invalid optional values', () => {
		assert.equal(parseYtDlpInfo({ title: 'No file' }), undefined);
		const track = parseYtDlpInfo({
			id: '../escape',
			title: 'Safe',
			duration: -2,
			filepath: '/tmp/Safe.mp3',
		});
		assert.ok(track);
		assert.equal(track.file, 'Safe.mp3');
		assert.equal(track.youtubeId, undefined);
		assert.equal(track.durationSeconds, undefined);
	});

	test('only audio basenames can cross the streaming boundary', () => {
		assert.equal(isAudioFileName('song.MP3'), true);
		assert.equal(isAudioFileName('library.sqlite'), false);
		assert.equal(isAudioFileName('library.sqlite-wal'), false);
		assert.equal(isAudioFileName('../song.mp3'), false);
		assert.equal(isAudioFileName('nested/song.mp3'), false);
	});
});

describe('DJ library persistence', () => {
	test('upserts by YouTube id and stores capture history atomically', () => {
		const library = new DjLibrary(':memory:');
		try {
			const firstId = library.saveTrack(
				{
					file: 'first.mp3',
					title: 'First',
					youtubeId: 'dQw4w9WgXcQ',
					downloadedAt: 10,
				},
				'{"format":"18"}',
			);
			const secondId = library.saveTrack(
				{
					file: 'second.mp3',
					title: 'Never Gonna Give You Up',
					artist: 'Rick Astley',
					youtubeId: 'dQw4w9WgXcQ',
					requestedQuery: 'rickroll',
					downloadedAt: 20,
				},
				'{"format":"251"}',
			);

			assert.equal(secondId, firstId);
			assert.equal(library.trackByFile('first.mp3'), undefined);
			const track = library.trackByYoutubeId('dQw4w9WgXcQ');
			assert.ok(track);
			assert.equal(track.file, 'second.mp3');
			assert.equal(track.artist, 'Rick Astley');
			assert.equal(track.requestedQuery, 'rickroll');
			assert.deepEqual(
				library.dumpsForTrack(firstId).map((dump) => dump.payload),
				['{"format":"251"}', '{"format":"18"}'],
			);
		} finally {
			library.close();
		}
	});

	test('rejects split file and YouTube identities', () => {
		const library = new DjLibrary(':memory:');
		try {
			library.saveTrack({ file: 'first.mp3', title: 'First', youtubeId: 'aaaaaaaaaaa', downloadedAt: 1 });
			library.saveTrack({ file: 'second.mp3', title: 'Second', youtubeId: 'bbbbbbbbbbb', downloadedAt: 2 });
			assert.throws(
				() =>
					library.saveTrack({
						file: 'second.mp3',
						title: 'Conflict',
						youtubeId: 'aaaaaaaaaaa',
						downloadedAt: 3,
					}),
				/identity conflict/,
			);
		} finally {
			library.close();
		}
	});

	test('refuses a library database written by a newer server', async () => {
		const library = new DjLibrary(':memory:');
		library.sqlite.run('PRAGMA user_version = 2');
		const serialized = library.sqlite.serialize();
		library.close();
		const directory = await mkdtemp(join(tmpdir(), 'mall-newer-library-'));
		temporaryDirectories.push(directory);
		const path = join(directory, 'library.sqlite');
		await writeFile(path, serialized);
		assert.throws(() => new DjLibrary(path), /newer than supported/);
	});

	test('refuses unversioned library tables', async () => {
		const library = new DjLibrary(':memory:');
		library.sqlite.run('PRAGMA user_version = 0');
		const serialized = library.sqlite.serialize();
		library.close();
		const directory = await mkdtemp(join(tmpdir(), 'mall-unversioned-library-'));
		temporaryDirectories.push(directory);
		const path = join(directory, 'library.sqlite');
		await writeFile(path, serialized);
		assert.throws(() => new DjLibrary(path), /unversioned table/);
	});

	test('imports each playable legacy sidecar once', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'mall-dj-library-'));
		temporaryDirectories.push(directory);
		await writeFile(join(directory, 'Nyan Cat.mp3'), 'audio');
		await writeFile(
			join(directory, 'Nyan Cat.info.json'),
			JSON.stringify({
				id: 'QH2-TGUlwu4',
				title: 'Nyan Cat',
				uploader: 'NyanCat',
				duration: 217,
			}),
		);

		const library = new DjLibrary(':memory:');
		try {
			assert.equal(await importLegacySidecars(directory, library), 1);
			assert.equal(await importLegacySidecars(directory, library), 0);
			const track = library.trackByFile('Nyan Cat.mp3');
			assert.ok(track);
			assert.equal(track.youtubeId, 'QH2-TGUlwu4');
			assert.equal(track.durationSeconds, 217);
		} finally {
			library.close();
		}
	});
});
