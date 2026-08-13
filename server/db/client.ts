import { Database } from 'bun:sqlite';
import { type BunSQLiteDatabase, drizzle } from 'drizzle-orm/bun-sqlite';
import initialMigration from './drizzle/0000_whole_queen_noir.sql' with { type: 'text' };
import * as schema from './schema.ts';

const SCHEMA_VERSION = 1;

export type CrateDb = BunSQLiteDatabase<typeof schema>;

function applySchema(sqlite: Database): void {
	// The compiled server has no migration directory beside it. Runtime DDL
	// stays embedded; Drizzle owns the declared schema and application queries.
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
		for (const statement of initialMigration.split('--> statement-breakpoint')) {
			if (statement.trim()) sqlite.run(statement);
		}
	});
	migrate();
	const migratedVersion = sqlite
		.query<{ userVersion: number }, []>('SELECT user_version AS userVersion FROM pragma_user_version')
		.get();
	if (migratedVersion?.userVersion !== SCHEMA_VERSION) throw new Error('DJ crate migration did not stamp its schema version');
}

export function openCrateDb(path: string): { db: CrateDb; sqlite: Database } {
	const sqlite = new Database(path, { create: true, readwrite: true, strict: true });
	try {
		sqlite.run('PRAGMA journal_mode = WAL');
		sqlite.run('PRAGMA foreign_keys = ON');
		applySchema(sqlite);
		return { db: drizzle(sqlite, { schema }), sqlite };
	} catch (error) {
		sqlite.close();
		throw error;
	}
}
