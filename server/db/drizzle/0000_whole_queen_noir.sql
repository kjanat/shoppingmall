CREATE TABLE `dj_tracks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`file` text NOT NULL,
	`title` text NOT NULL,
	`artist` text,
	`duration_seconds` integer,
	`youtube_id` text,
	`source_url` text,
	`requested_query` text,
	`downloaded_at` integer NOT NULL,
	CONSTRAINT "dj_tracks_file_basename" CHECK("dj_tracks"."file" != '' AND instr("dj_tracks"."file", '/') = 0 AND instr("dj_tracks"."file", char(92)) = 0),
	CONSTRAINT "dj_tracks_duration_nonnegative" CHECK("dj_tracks"."duration_seconds" IS NULL OR "dj_tracks"."duration_seconds" >= 0),
	CONSTRAINT "dj_tracks_youtube_id" CHECK("dj_tracks"."youtube_id" IS NULL OR length("dj_tracks"."youtube_id") BETWEEN 8 AND 16)
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `dj_tracks_file_unique` ON `dj_tracks` (`file`);--> statement-breakpoint
CREATE UNIQUE INDEX `dj_tracks_youtube_id_unique` ON `dj_tracks` (`youtube_id`);--> statement-breakpoint
CREATE TABLE `dj_yt_dumps` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`track_id` integer NOT NULL,
	`captured_at` integer NOT NULL,
	`payload` text NOT NULL,
	FOREIGN KEY (`track_id`) REFERENCES `dj_tracks`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "dj_yt_dumps_payload_nonempty" CHECK("dj_yt_dumps"."payload" != '')
) STRICT;
--> statement-breakpoint
CREATE INDEX `dj_yt_dumps_track_captured_idx` ON `dj_yt_dumps` (`track_id`,"captured_at" DESC);
--> statement-breakpoint
PRAGMA user_version = 1;
