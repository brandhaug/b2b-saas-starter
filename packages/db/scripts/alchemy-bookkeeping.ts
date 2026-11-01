// Alchemy's D1 migration bookkeeping, mirrored for this package's deploy
// tooling (scripts/baseline.ts). Source of truth: SQL/Migrations/
// AlchemyFormat.ts in the alchemy package — the table shape, the row format
// (hash = sha256 of migration.sql, created_at = the folder timestamp in
// epoch millis, applied_at = now), and the name-keyed applied-detection
// everything here has to reproduce faithfully.
//
// Pure string/SQL helpers plus one JSON decoder: no wrangler spawn, so
// scripts can share them without inheriting a process.
import { createHash } from 'node:crypto'
import { timestampPrefixMillis } from '@alchemy.run/sql/Migrations/Utils'
import { Schema } from 'effect'

export { sqlLiteral } from '@alchemy.run/sql/Migrations/Utils'

// The exact CREATE TABLE alchemy runs on first contact with a database.
export const ENSURE_BOOKKEEPING_TABLE = `CREATE TABLE IF NOT EXISTS __alchemy_migrations (
  id INTEGER PRIMARY KEY,
  hash text NOT NULL,
  created_at numeric,
  name text,
  applied_at TEXT
);`

/** The bookkeeping row alchemy writes for one applied migration. */
export type BookkeepingRecord = {
  readonly hash: string
  readonly createdAtMillis: number | null
}

export function bookkeepingRecord(name: string, sql: string): BookkeepingRecord {
  return {
    hash: createHash('sha256').update(sql).digest('hex'),
    createdAtMillis: timestampPrefixMillis(name) ?? null
  }
}

// Parses drizzle's sqlite dialect: backticked table names. Drives the
// baseline's existence markers.
export function tablesCreatedBy(sql: string): Array<string> {
  const tables: Array<string> = []
  for (const statement of sql.split('--> statement-breakpoint')) {
    const table = statement.match(/CREATE TABLE (?:IF NOT EXISTS )?`([^`]+)`/)?.[1]
    if (!table) {
      continue
    }
    tables.push(table)
  }
  return tables
}

// Wrangler's `--json` output for a row-returning statement: one batch per
// statement. Decoding it instead of casting means a wrangler output change
// fails loudly rather than producing an empty row-set. Extra columns (PRAGMA
// rows carry more than `name`) are ignored by the struct.
const NamesJson = Schema.fromJsonString(
  Schema.Array(
    Schema.Struct({
      results: Schema.Array(Schema.Struct({ name: Schema.String }))
    })
  )
)

const decodeNamesJson = Schema.decodeUnknownSync(NamesJson)

export function decodeNames(json: string): Array<string> {
  return decodeNamesJson(json).flatMap((batch) => batch.results.map((row) => row.name))
}
