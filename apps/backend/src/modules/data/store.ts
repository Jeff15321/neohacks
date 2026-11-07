import { DATA_LIMITS, type DataBody, type DataCollectionInfo, type DataDoc, type DataQuery, type DataWhere } from '@app/contracts';
import { randomId } from '@app/core';
import type { Db } from '../../store/db.js';

/** Store-level error (no fastify dependency); routes map it to HttpError. */
export class DataError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

type Row = { rid: number; id: string; collection: string; data: string; created_at: number; updated_at: number };

const toDoc = (r: Row): DataDoc => ({ id: r.id, collection: r.collection, data: JSON.parse(r.data), createdAt: r.created_at, updatedAt: r.updated_at });

/**
 * Per-user named collections of JSON documents over node:sqlite (owner of the `docs` table, Rules §4).
 * Pure: depends only on a Db handle → unit-testable with `openDb(':memory:')`.
 * Every method is scoped by userId; there is no cross-user access path.
 */
export class DataStore {
  constructor(private db: Db, private now: () => number = Date.now) {
    db.exec('CREATE INDEX IF NOT EXISTS docs_user_coll_created ON docs(user_id, collection, created_at DESC);');
  }

  listCollections(userId: string): DataCollectionInfo[] {
    const rows = this.db.prepare('SELECT collection AS name, COUNT(*) AS count, MAX(updated_at) AS updatedAt FROM docs WHERE user_id = ? GROUP BY collection ORDER BY collection')
      .all(userId) as Array<{ name: string; count: number; updatedAt: number }>;
    return rows.map(r => ({ name: r.name, count: Number(r.count), updatedAt: Number(r.updatedAt) }));
  }

  /** Newest first (ties: insertion order). `after` = id of the last doc of the previous page. `where` = shallow equality via json_extract. */
  list(userId: string, collection: string, q: DataQuery = {}): { docs: DataDoc[]; next?: string } {
    checkCollection(collection);
    const limit = Math.min(Math.max(1, q.limit ?? DATA_LIMITS.LIST_DEFAULT_LIMIT), DATA_LIMITS.LIST_MAX_LIMIT);
    const clauses = ['user_id = ?', 'collection = ?'];
    const params: Array<string | number | null> = [userId, collection];
    if (q.after) {
      const cur = this.row(userId, collection, q.after);
      if (!cur) throw new DataError(400, 'validation', `cursor "after" not found: ${q.after}`);
      clauses.push('(created_at < ? OR (created_at = ? AND rowid < ?))');
      params.push(cur.created_at, cur.created_at, cur.rid);
    }
    for (const [k, v] of Object.entries(checkWhere(q.where))) {
      const path = `$."${k}"`;
      if (v === null) { clauses.push(`json_type(data, ?) = 'null'`); params.push(path); }
      else if (typeof v === 'boolean') { clauses.push(`json_type(data, ?) = ?`); params.push(path, v ? 'true' : 'false'); }
      else { clauses.push('json_extract(data, ?) = ?'); params.push(path, v); }
    }
    const rows = this.db.prepare(`SELECT rowid AS rid, id, collection, data, created_at, updated_at FROM docs WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC, rowid DESC LIMIT ?`)
      .all(...params, limit + 1) as Row[];
    const more = rows.length > limit;
    const docs = rows.slice(0, limit).map(toDoc);
    return more ? { docs, next: docs[docs.length - 1].id } : { docs };
  }

  get(userId: string, collection: string, id: string): DataDoc | undefined {
    checkCollection(collection); checkId(id);
    const r = this.row(userId, collection, id);
    return r ? toDoc(r) : undefined;
  }

  /** Create; with `id` = upsert (replaces data, keeps createdAt). */
  create(userId: string, collection: string, data: DataBody, id?: string): DataDoc {
    checkCollection(collection);
    if (id !== undefined) checkId(id);
    const json = serialize(data);
    const existing = id ? this.row(userId, collection, id) : undefined;
    if (existing) return this.write(userId, collection, existing, json);
    this.checkCapacity(userId, collection);
    const t = this.now();
    const docId = id ?? randomId('d');
    this.db.prepare('INSERT INTO docs (user_id, collection, id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(userId, collection, docId, json, t, t);
    return { id: docId, collection, data: JSON.parse(json), createdAt: t, updatedAt: t };
  }

  /** PATCH: shallow merge into the existing data. */
  merge(userId: string, collection: string, id: string, patch: DataBody): DataDoc {
    const cur = this.mustRow(userId, collection, id);
    return this.write(userId, collection, cur, serialize({ ...JSON.parse(cur.data), ...patch }));
  }

  /** PUT: replace the data. */
  replace(userId: string, collection: string, id: string, data: DataBody): DataDoc {
    const cur = this.mustRow(userId, collection, id);
    return this.write(userId, collection, cur, serialize(data));
  }

  remove(userId: string, collection: string, id: string): boolean {
    checkCollection(collection); checkId(id);
    return Number(this.db.prepare('DELETE FROM docs WHERE user_id = ? AND collection = ? AND id = ?').run(userId, collection, id).changes) > 0;
  }

  /** Delete every doc in the collection; returns the number removed. */
  clear(userId: string, collection: string): number {
    checkCollection(collection);
    return Number(this.db.prepare('DELETE FROM docs WHERE user_id = ? AND collection = ?').run(userId, collection).changes);
  }

  private write(userId: string, collection: string, cur: Row, json: string): DataDoc {
    const t = Math.max(this.now(), cur.created_at);
    this.db.prepare('UPDATE docs SET data = ?, updated_at = ? WHERE user_id = ? AND collection = ? AND id = ?').run(json, t, userId, collection, cur.id);
    return { id: cur.id, collection, data: JSON.parse(json), createdAt: cur.created_at, updatedAt: t };
  }

  private checkCapacity(userId: string, collection: string) {
    const n = Number((this.db.prepare('SELECT COUNT(*) AS n FROM docs WHERE user_id = ? AND collection = ?').get(userId, collection) as { n: number }).n);
    if (n >= DATA_LIMITS.MAX_DOCS_PER_COLLECTION) throw new DataError(409, 'limit', `collection "${collection}" is full (${DATA_LIMITS.MAX_DOCS_PER_COLLECTION} docs)`);
    if (n === 0) {
      const c = Number((this.db.prepare('SELECT COUNT(DISTINCT collection) AS n FROM docs WHERE user_id = ?').get(userId) as { n: number }).n);
      if (c >= DATA_LIMITS.MAX_COLLECTIONS_PER_USER) throw new DataError(409, 'limit', `too many collections (max ${DATA_LIMITS.MAX_COLLECTIONS_PER_USER})`);
    }
  }

  private row(userId: string, collection: string, id: string): Row | undefined {
    return this.db.prepare('SELECT rowid AS rid, id, collection, data, created_at, updated_at FROM docs WHERE user_id = ? AND collection = ? AND id = ?')
      .get(userId, collection, id) as Row | undefined;
  }

  private mustRow(userId: string, collection: string, id: string): Row {
    checkCollection(collection); checkId(id);
    const r = this.row(userId, collection, id);
    if (!r) throw new DataError(404, 'not_found', `document not found: ${collection}/${id}`);
    return r;
  }
}

function checkCollection(c: string) {
  if (typeof c !== 'string' || !DATA_LIMITS.COLLECTION_RE.test(c)) throw new DataError(400, 'validation', `invalid collection name "${String(c).slice(0, 80)}" (must match ^[a-z0-9_-]{1,64}$)`);
}
function checkId(id: string) {
  if (typeof id !== 'string' || !DATA_LIMITS.ID_RE.test(id)) throw new DataError(400, 'validation', `invalid doc id "${String(id).slice(0, 80)}"`);
}
function checkWhere(w: DataWhere | undefined): DataWhere {
  if (!w) return {};
  if (typeof w !== 'object' || Array.isArray(w)) throw new DataError(400, 'validation', 'where must be an object');
  const keys = Object.keys(w);
  if (keys.length > DATA_LIMITS.WHERE_MAX_KEYS) throw new DataError(400, 'validation', `where: at most ${DATA_LIMITS.WHERE_MAX_KEYS} keys`);
  for (const k of keys) {
    if (!DATA_LIMITS.WHERE_KEY_RE.test(k)) throw new DataError(400, 'validation', `where: invalid key "${k.slice(0, 80)}"`);
    const v = w[k];
    if (v !== null && !['string', 'number', 'boolean'].includes(typeof v)) throw new DataError(400, 'validation', `where.${k}: only string/number/boolean/null equality is supported`);
  }
  return w;
}
function serialize(data: DataBody): string {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new DataError(400, 'validation', 'data must be a JSON object');
  const json = JSON.stringify(data);
  const bytes = Buffer.byteLength(json, 'utf8');
  if (bytes > DATA_LIMITS.DOC_MAX_BYTES) throw new DataError(413, 'too_large', `document is ${bytes} bytes (max ${DATA_LIMITS.DOC_MAX_BYTES})`);
  return json;
}
