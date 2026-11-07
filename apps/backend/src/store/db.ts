import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type Db = DatabaseSync;

/**
 * All tables, created idempotently. One owner per table (Rules §4):
 *   llm_calls          → llm/ (callModel)
 *   docs               → modules/data (Phase A)
 *   traces             → modules/recordings / observe (Phase B)
 *   activity_snapshots → modules/observe (Phase D)
 *   jobs               → modules/jobs (Phase D)
 * Owners may add columns/indexes via their own `CREATE ... IF NOT EXISTS` / migrations.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS llm_calls (
  id TEXT PRIMARY KEY,
  trace_id TEXT,
  stage TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  effort TEXT,
  started_at INTEGER NOT NULL,
  latency_ms INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  input TEXT NOT NULL,
  output TEXT,
  parse_ok INTEGER,
  error TEXT
);
CREATE INDEX IF NOT EXISTS llm_calls_trace ON llm_calls(trace_id);
CREATE INDEX IF NOT EXISTS llm_calls_started ON llm_calls(started_at);

CREATE TABLE IF NOT EXISTS docs (
  user_id TEXT NOT NULL,
  collection TEXT NOT NULL,
  id TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, collection, id)
);

CREATE TABLE IF NOT EXISTS traces (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  kind TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  body TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activity_snapshots (
  user_id TEXT PRIMARY KEY,
  updated_at INTEGER NOT NULL,
  state TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  body TEXT NOT NULL
);
`;

export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  return db;
}
