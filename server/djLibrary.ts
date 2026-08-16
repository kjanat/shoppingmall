import type { Database } from 'bun:sqlite';
import { basename, extname, join } from 'node:path';
import { desc, eq } from 'drizzle-orm';
import { finiteNumber, isRecord, readString } from '#/util/values.ts';
import type { DjLibraryDb } from './db/client.ts';
import { openDjLibraryDb } from './db/client.ts';
import type { DjTrackRow, DjYtDumpRow } from './db/schema.ts';
import { djTracks, djYtDumps } from './db/schema.ts';

const AUDIO_EXTENSIONS = ['.mp3', '.m4a', '.ogg', '.webm', '.wav', '.opus'] as const;
const YT_DLP_META_PREFIX = 'MALLMETA:';
const YT_DLP_META_PRINT = `after_move:${YT_DLP_META_PREFIX}%()j`;
const RE_YTID = /^[A-Za-z0-9_-]{8,16}$/;

interface LibraryTrack {
	id?: number;
	file: string;
	title: string;
	artist?: string;
	durationSeconds?: number;
	youtubeId?: string;
	sourceUrl?: string;
	requestedQuery?: string;
	downloadedAt: number;
}

interface YtDlpCapture {
	track: LibraryTrack;
	/** Exact JSON text after the prefix, without lossy parse/stringify. */
	dump: string;
}

type YtDumpRow = DjYtDumpRow;

function nonempty(value: string): string | undefined {
	const trimmed = value.trim();
	return trimmed || undefined;
}

function libraryBasename(path: string): string | undefined {
	const file = basename(path.trim());
	if (!file || file === '.' || file === '..' || file.includes('/') || file.includes('\\')) return undefined;
	return file;
}

function validYoutubeId(id: string): string | undefined {
	const trimmed = id.trim();
	return RE_YTID.test(trimmed) ? trimmed : undefined;
}

function isAudioFileName(name: string): boolean {
	return basename(name) === name && AUDIO_EXTENSIONS.some((extension) => extname(name).toLowerCase() === extension);
}

/** Parse yt-dlp's untyped info dict before it reaches the DJ library. */
function parseYtDlpInfo(raw: unknown, fallbackFile?: string): LibraryTrack | undefined {
	if (!isRecord(raw)) return undefined;
	const file = libraryBasename(readString(raw, 'filepath') || readString(raw, 'filename') || fallbackFile || '');
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

function parseYtDlpOutput(output: string, fallbackFile?: string): YtDlpCapture | undefined {
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

function trackFromRow(row: DjTrackRow): LibraryTrack {
	return {
		id: row.id,
		file: row.file,
		title: row.title,
		downloadedAt: row.downloadedAt,
		...(row.artist ? { artist: row.artist } : {}),
		...(row.durationSeconds === null ? {} : { durationSeconds: row.durationSeconds }),
		...(row.youtubeId ? { youtubeId: row.youtubeId } : {}),
		...(row.sourceUrl ? { sourceUrl: row.sourceUrl } : {}),
		...(row.requestedQuery ? { requestedQuery: row.requestedQuery } : {}),
	};
}

class DjLibrary {
	readonly sqlite: Database;
	readonly db: DjLibraryDb;

	constructor(path: string) {
		const opened = openDjLibraryDb(path);
		this.sqlite = opened.sqlite;
		this.db = opened.db;
	}

	close(): void {
		this.sqlite.close();
	}

	allTracks(): LibraryTrack[] {
		return this.db.select().from(djTracks).all().map(trackFromRow);
	}

	trackByFile(file: string): LibraryTrack | undefined {
		const row = this.db.select().from(djTracks).where(eq(djTracks.file, file)).get();
		return row ? trackFromRow(row) : undefined;
	}

	trackByYoutubeId(youtubeId: string): LibraryTrack | undefined {
		const row = this.db.select().from(djTracks).where(eq(djTracks.youtubeId, youtubeId)).get();
		return row ? trackFromRow(row) : undefined;
	}

	upsertTrack(track: LibraryTrack): number {
		const byYoutube = track.youtubeId ? this.trackByYoutubeId(track.youtubeId) : undefined;
		const byFile = this.trackByFile(track.file);
		if (byYoutube?.id !== undefined && byFile?.id !== undefined && byYoutube.id !== byFile.id) {
			throw new Error(`DJ library identity conflict for ${track.file}`);
		}
		const existing = byYoutube ?? byFile;
		const requestedQuery = track.requestedQuery ?? existing?.requestedQuery ?? null;
		const values = {
			file: track.file,
			title: track.title,
			artist: track.artist ?? null,
			durationSeconds: track.durationSeconds ?? null,
			youtubeId: track.youtubeId ?? null,
			sourceUrl: track.sourceUrl ?? null,
			requestedQuery,
			downloadedAt: track.downloadedAt,
		};
		if (existing?.id !== undefined) {
			this.db.update(djTracks).set(values).where(eq(djTracks.id, existing.id)).run();
			return existing.id;
		}

		const inserted = this.db.insert(djTracks).values(values).returning({ id: djTracks.id }).get();
		if (!inserted) throw new Error('DJ library insert returned no id');
		return inserted.id;
	}

	insertDump(trackId: number, payload: string, capturedAt = Date.now()): void {
		const dump = payload.trim();
		if (!dump) return;
		this.db.insert(djYtDumps).values({ trackId, capturedAt, payload: dump }).run();
	}

	saveTrack(track: LibraryTrack, dump?: string): number {
		return this.db.transaction(() => {
			const id = this.upsertTrack(track);
			if (dump) this.insertDump(id, dump, track.downloadedAt);
			return id;
		});
	}

	dumpsForTrack(trackId: number): YtDumpRow[] {
		return this.db
			.select()
			.from(djYtDumps)
			.where(eq(djYtDumps.trackId, trackId))
			.orderBy(desc(djYtDumps.capturedAt), desc(djYtDumps.id))
			.all();
	}
}

async function matchingAudio(dir: string, stem: string): Promise<string | undefined> {
	const matches = await Promise.all(
		AUDIO_EXTENSIONS.map(async (extension) => {
			const file = `${stem}${extension}`;
			return (await Bun.file(join(dir, file)).exists()) ? file : undefined;
		}),
	);
	return matches.find((file) => file !== undefined);
}

/** Import old yt-dlp sidecars without making them part of the live contract. */
async function importLegacySidecars(dir: string, library: DjLibrary): Promise<number> {
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
		if (!file || library.trackByFile(file)) continue;
		const track = parseYtDlpInfo(raw, file);
		if (!track) continue;
		const capturedAt = sidecar.lastModified || Date.now();
		library.saveTrack({ ...track, file, downloadedAt: capturedAt }, text);
		imported += 1;
	}
	return imported;
}

export type { LibraryTrack, YtDlpCapture, YtDumpRow };
export {
	AUDIO_EXTENSIONS,
	DjLibrary,
	importLegacySidecars,
	isAudioFileName,
	libraryBasename,
	parseYtDlpInfo,
	parseYtDlpOutput,
	validYoutubeId,
	YT_DLP_META_PREFIX,
	YT_DLP_META_PRINT,
};
