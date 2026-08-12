import { Database } from 'bun:sqlite';
import { basename, extname, join } from 'node:path';
import { finiteNumber, isRecord, readString } from '#/util/values.ts';

export const AUDIO_EXTENSIONS = ['.mp3', '.m4a', '.ogg', '.webm', '.wav', '.opus'] as const;
export const YT_DLP_META_PREFIX = 'MALLMETA:';
export const YT_DLP_META_PRINT = `after_move:${YT_DLP_META_PREFIX}%()j`;

export type CrateTrack = {
	id?: number;
	file: string;
	title: string;
	artist?: string;
	durationSeconds?: number;
	youtubeId?: string;
	sourceUrl?: string;
	requestedQuery?: string;
	downloadedAt: number;
};

export type YtDlpCapture = {
	track: CrateTrack;
	/** Exact JSON text after the prefix, without lossy parse/stringify. */
	dump: string;
};

type TrackRow = {
	id: number;
	file: string;
	title: string;
	artist: string | null;
	durationSeconds: number | null;
	youtubeId: string | null;
	sourceUrl: string | null;
	requestedQuery: string | null;
	downloadedAt: number;
};

export type YtDumpRow = {
	id: number;
	trackId: number;
	capturedAt: number;
	payload: string;
};

const TRACK_COLUMNS = `
	id, file, title, artist,
	duration_seconds AS durationSeconds,
	youtube_id AS youtubeId,
	source_url AS sourceUrl,
	requested_query AS requestedQuery,
	downloaded_at AS downloadedAt
`;
const SCHEMA_VERSION = 1;

function nonempty(value: string): string | undefined {
	const trimmed = value.trim();
	return trimmed || undefined;
}

export function crateBasename(path: string): string | undefined {
	const file = basename(path.trim());
	if (!file || file === '.' || file === '..' || file.includes('/') || file.includes('\\')) return undefined;
	return file;
}

export function validYoutubeId(id: string): string | undefined {
	const trimmed = id.trim();
	return /^[A-Za-z0-9_-]{8,16}$/.test(trimmed) ? trimmed : undefined;
}

export function isAudioFileName(name: string): boolean {
	return basename(name) === name && AUDIO_EXTENSIONS.some((extension) => extname(name).toLowerCase() === extension);
}

/** Parse yt-dlp's untyped info dict before it reaches the crate. */
export function parseYtDlpInfo(raw: unknown, fallbackFile?: string): CrateTrack | undefined {
	if (!isRecord(raw)) return undefined;
	const file = crateBasename(readString(raw, 'filepath') || readString(raw, 'filename') || fallbackFile || '');
	if (!file) return undefined;
	const title = nonempty(readString(raw, 'track')) || nonempty(readString(raw, 'title')) || basename(file, extname(file));
	const artist = nonempty(readString(raw, 'artist')) || nonempty(readString(raw, 'uploader'));
	const duration = finiteNumber(raw, 'duration');
	const youtubeId = validYoutubeId(readString(raw, 'id'));
	const sourceUrl = nonempty(readString(raw, 'webpage_url'));
	return {
		file,
		title,
		downloadedAt: Date.now(),
		...(artist ? { artist } : {}),
		...(duration !== null && duration >= 0 ? { durationSeconds: Math.round(duration) } : {}),
		...(youtubeId ? { youtubeId } : {}),
		...(sourceUrl ? { sourceUrl } : {}),
	};
}

export function parseYtDlpOutput(output: string, fallbackFile?: string): YtDlpCapture | undefined {
	for (const line of output.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed.startsWith(YT_DLP_META_PREFIX)) continue;
		const dump = trimmed.slice(YT_DLP_META_PREFIX.length);
		try {
			const raw: unknown = JSON.parse(dump);
			const track = parseYtDlpInfo(raw, fallbackFile);
			if (track) return { track, dump };
		} catch {
			// yt-dlp may print unrelated text containing the prefix; keep scanning.
		}
	}
	return undefined;
}

function trackFromRow(row: TrackRow): CrateTrack {
	return {
		id: row.id,
		file: row.file,
		title: row.title,
		downloadedAt: row.downloadedAt,
		...(row.artist ? { artist: row.artist } : {}),
		...(row.durationSeconds !== null ? { durationSeconds: row.durationSeconds } : {}),
		...(row.youtubeId ? { youtubeId: row.youtubeId } : {}),
		...(row.sourceUrl ? { sourceUrl: row.sourceUrl } : {}),
		...(row.requestedQuery ? { requestedQuery: row.requestedQuery } : {}),
	};
}

function applySchema(sqlite: Database): void {
	// The compiled server has no migration directory beside it, so the tiny
	// crate schema travels with the code that opens it.
	const versionRow = sqlite
		.query<{ userVersion: number }, []>('SELECT user_version AS userVersion FROM pragma_user_version')
		.get();
	if (!versionRow) throw new Error('DJ crate has no schema version');
	if (versionRow.userVersion > SCHEMA_VERSION) {
		throw new Error(`DJ crate schema ${versionRow.userVersion} is newer than supported schema ${SCHEMA_VERSION}`);
	}
	if (versionRow.userVersion === SCHEMA_VERSION) return;
	if (versionRow.userVersion !== 0) throw new Error(`Unsupported DJ crate schema ${versionRow.userVersion}`);
	const existingCrateTable = sqlite
		.query<{ name: string }, []>(`
			SELECT name FROM sqlite_master
			WHERE type = 'table' AND name IN ('dj_tracks', 'dj_yt_dumps')
			LIMIT 1
		`)
		.get();
	if (existingCrateTable) throw new Error(`DJ crate has unversioned table ${existingCrateTable.name}`);

	const migrate = sqlite.transaction(() => {
		sqlite.run(`
			CREATE TABLE IF NOT EXISTS dj_tracks (
				id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
				file TEXT NOT NULL UNIQUE,
				title TEXT NOT NULL,
				artist TEXT,
				duration_seconds INTEGER,
				youtube_id TEXT UNIQUE,
				source_url TEXT,
				requested_query TEXT,
				downloaded_at INTEGER NOT NULL,
				CONSTRAINT dj_tracks_file_basename CHECK (
					file != '' AND instr(file, '/') = 0 AND instr(file, char(92)) = 0
				),
				CONSTRAINT dj_tracks_duration_nonnegative CHECK (
					duration_seconds IS NULL OR duration_seconds >= 0
				),
				CONSTRAINT dj_tracks_youtube_id CHECK (
					youtube_id IS NULL OR length(youtube_id) BETWEEN 8 AND 16
				)
			) STRICT
		`);
		sqlite.run(`
			CREATE TABLE IF NOT EXISTS dj_yt_dumps (
				id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
				track_id INTEGER NOT NULL REFERENCES dj_tracks(id) ON DELETE CASCADE,
				captured_at INTEGER NOT NULL,
				payload TEXT NOT NULL CHECK (payload != '')
			) STRICT
		`);
		sqlite.run(`
			CREATE INDEX IF NOT EXISTS dj_yt_dumps_track_captured_idx
			ON dj_yt_dumps (track_id, captured_at DESC)
		`);
		sqlite.run(`PRAGMA user_version = ${SCHEMA_VERSION}`);
	});
	migrate();
}

export class DjCrate {
	readonly sqlite: Database;

	constructor(path: string) {
		this.sqlite = new Database(path, { create: true, readwrite: true, strict: true });
		try {
			this.sqlite.run('PRAGMA journal_mode = WAL');
			this.sqlite.run('PRAGMA foreign_keys = ON');
			applySchema(this.sqlite);
		} catch (error) {
			this.sqlite.close();
			throw error;
		}
	}

	close(): void {
		this.sqlite.close();
	}

	allTracks(): CrateTrack[] {
		return this.sqlite.query<TrackRow, []>(`SELECT ${TRACK_COLUMNS} FROM dj_tracks`).all().map(trackFromRow);
	}

	trackByFile(file: string): CrateTrack | undefined {
		const row = this.sqlite.query<TrackRow, [string]>(`SELECT ${TRACK_COLUMNS} FROM dj_tracks WHERE file = ?`).get(file);
		return row ? trackFromRow(row) : undefined;
	}

	trackByYoutubeId(youtubeId: string): CrateTrack | undefined {
		const row = this.sqlite
			.query<TrackRow, [string]>(`SELECT ${TRACK_COLUMNS} FROM dj_tracks WHERE youtube_id = ?`)
			.get(youtubeId);
		return row ? trackFromRow(row) : undefined;
	}

	upsertTrack(track: CrateTrack): number {
		const byYoutube = track.youtubeId ? this.trackByYoutubeId(track.youtubeId) : undefined;
		const byFile = this.trackByFile(track.file);
		if (byYoutube?.id !== undefined && byFile?.id !== undefined && byYoutube.id !== byFile.id) {
			throw new Error(`DJ crate identity conflict for ${track.file}`);
		}
		const existing = byYoutube ?? byFile;
		const requestedQuery = track.requestedQuery ?? existing?.requestedQuery ?? null;
		if (existing?.id !== undefined) {
			this.sqlite
				.query<
					never,
					[string, string, string | null, number | null, string | null, string | null, string | null, number, number]
				>(`
					UPDATE dj_tracks SET
						file = ?, title = ?, artist = ?, duration_seconds = ?, youtube_id = ?,
						source_url = ?, requested_query = ?, downloaded_at = ?
					WHERE id = ?
				`)
				.run(
					track.file,
					track.title,
					track.artist ?? null,
					track.durationSeconds ?? null,
					track.youtubeId ?? null,
					track.sourceUrl ?? null,
					requestedQuery,
					track.downloadedAt,
					existing.id,
				);
			return existing.id;
		}

		const inserted = this.sqlite
			.query<never, [string, string, string | null, number | null, string | null, string | null, string | null, number]>(`
				INSERT INTO dj_tracks (
					file, title, artist, duration_seconds, youtube_id, source_url, requested_query, downloaded_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			`)
			.run(
				track.file,
				track.title,
				track.artist ?? null,
				track.durationSeconds ?? null,
				track.youtubeId ?? null,
				track.sourceUrl ?? null,
				requestedQuery,
				track.downloadedAt,
			);
		const id = Number(inserted.lastInsertRowid);
		if (!Number.isSafeInteger(id) || id < 1) throw new Error('DJ crate insert returned no id');
		return id;
	}

	insertDump(trackId: number, payload: string, capturedAt = Date.now()): void {
		const dump = payload.trim();
		if (!dump) return;
		this.sqlite
			.query<never, [number, number, string]>('INSERT INTO dj_yt_dumps (track_id, captured_at, payload) VALUES (?, ?, ?)')
			.run(trackId, capturedAt, dump);
	}

	saveTrack(track: CrateTrack, dump?: string): number {
		return this.sqlite.transaction(() => {
			const id = this.upsertTrack(track);
			if (dump) this.insertDump(id, dump, track.downloadedAt);
			return id;
		})();
	}

	dumpsForTrack(trackId: number): YtDumpRow[] {
		return this.sqlite
			.query<YtDumpRow, [number]>(`
				SELECT id, track_id AS trackId, captured_at AS capturedAt, payload
				FROM dj_yt_dumps WHERE track_id = ? ORDER BY captured_at DESC, id DESC
			`)
			.all(trackId);
	}
}

async function matchingAudio(dir: string, stem: string): Promise<string | undefined> {
	for (const ext of AUDIO_EXTENSIONS) {
		const file = `${stem}${ext}`;
		if (await Bun.file(join(dir, file)).exists()) return file;
	}
	return undefined;
}

/** Import old yt-dlp sidecars without making them part of the live contract. */
export async function importLegacySidecars(dir: string, crate: DjCrate): Promise<number> {
	let imported = 0;
	for await (const name of new Bun.Glob('*.info.json').scan({ cwd: dir, onlyFiles: true })) {
		const sidecar = Bun.file(join(dir, name));
		let text: string;
		try {
			text = await sidecar.text();
		} catch {
			continue;
		}
		let raw: unknown;
		try {
			raw = JSON.parse(text);
		} catch {
			continue;
		}
		const file = await matchingAudio(dir, name.slice(0, -'.info.json'.length));
		if (!file || crate.trackByFile(file)) continue;
		const track = parseYtDlpInfo(raw, file);
		if (!track) continue;
		const capturedAt = sidecar.lastModified || Date.now();
		crate.saveTrack({ ...track, file, downloadedAt: capturedAt }, text);
		imported += 1;
	}
	return imported;
}
