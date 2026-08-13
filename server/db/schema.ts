import { relations, sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const djTracks = sqliteTable(
	'dj_tracks',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		file: text('file').notNull().unique(),
		title: text('title').notNull(),
		artist: text('artist'),
		durationSeconds: integer('duration_seconds'),
		youtubeId: text('youtube_id').unique(),
		sourceUrl: text('source_url'),
		requestedQuery: text('requested_query'),
		downloadedAt: integer('downloaded_at').notNull(),
	},
	(table) => [
		check(
			'dj_tracks_file_basename',
			sql`${table.file} != '' AND instr(${table.file}, '/') = 0 AND instr(${table.file}, char(92)) = 0`,
		),
		check('dj_tracks_duration_nonnegative', sql`${table.durationSeconds} IS NULL OR ${table.durationSeconds} >= 0`),
		check('dj_tracks_youtube_id', sql`${table.youtubeId} IS NULL OR length(${table.youtubeId}) BETWEEN 8 AND 16`),
	],
);

export const djYtDumps = sqliteTable(
	'dj_yt_dumps',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		trackId: integer('track_id')
			.notNull()
			.references(() => djTracks.id, { onDelete: 'cascade' }),
		capturedAt: integer('captured_at').notNull(),
		payload: text('payload').notNull(),
	},
	(table) => [
		index('dj_yt_dumps_track_captured_idx').on(table.trackId, sql`${table.capturedAt} DESC`),
		check('dj_yt_dumps_payload_nonempty', sql`${table.payload} != ''`),
	],
);

export const djTracksRelations = relations(djTracks, ({ many }) => ({
	dumps: many(djYtDumps),
}));

export const djYtDumpsRelations = relations(djYtDumps, ({ one }) => ({
	track: one(djTracks, {
		fields: [djYtDumps.trackId],
		references: [djTracks.id],
	}),
}));

export type DjTrackRow = typeof djTracks.$inferSelect;
export type DjYtDumpRow = typeof djYtDumps.$inferSelect;
