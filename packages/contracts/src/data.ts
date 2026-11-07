import { z } from 'zod';

/** User data store (WidgetAI.db). Owned by Phase A. */

export const DATA_LIMITS = {
  COLLECTION_RE: /^[a-z0-9_-]{1,64}$/,
  /** Document ids: auto `d_<random>` or caller-chosen (e.g. a movie id). */
  ID_RE: /^[A-Za-z0-9_.:-]{1,128}$/,
  /** `where` keys (shallow equality on top-level fields). */
  WHERE_KEY_RE: /^[A-Za-z0-9_]{1,64}$/,
  WHERE_MAX_KEYS: 8,
  DOC_MAX_BYTES: 32 * 1024,
  MAX_DOCS_PER_COLLECTION: 5_000,
  MAX_COLLECTIONS_PER_USER: 100,
  LIST_MAX_LIMIT: 200,
  LIST_DEFAULT_LIMIT: 50,
  /** Collections one widget may declare. */
  MAX_DECLARED_COLLECTIONS: 10,
} as const;

export const DataCollectionName = z.string().regex(DATA_LIMITS.COLLECTION_RE, 'collection name must match ^[a-z0-9_-]{1,64}$');
export const DataDocId = z.string().regex(DATA_LIMITS.ID_RE, 'doc id must match ^[A-Za-z0-9_.:-]{1,128}$');
/** A document body: a JSON object (shape owned by the widgets that use the collection). */
export const DataBody = z.record(z.string(), z.unknown());
export type DataBody = z.infer<typeof DataBody>;

/** Shallow equality filter on top-level fields, e.g. `{"title":"Dune"}`. */
export const DataWhere = z.record(z.string().regex(DATA_LIMITS.WHERE_KEY_RE), z.union([z.string(), z.number(), z.boolean(), z.null()]))
  .refine(o => Object.keys(o).length <= DATA_LIMITS.WHERE_MAX_KEYS, `where: at most ${DATA_LIMITS.WHERE_MAX_KEYS} keys`);
export type DataWhere = z.infer<typeof DataWhere>;

export const DataQuery = z.object({
  where: DataWhere.optional(),
  limit: z.number().int().min(1).max(DATA_LIMITS.LIST_MAX_LIMIT).optional(),
  /** Cursor: id of the last doc of the previous page (newest-first order). */
  after: DataDocId.optional(),
});
export type DataQuery = z.infer<typeof DataQuery>;

export const DataDoc = z.object({
  id: z.string(),
  collection: z.string(),
  data: z.record(z.string(), z.unknown()),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type DataDoc = z.infer<typeof DataDoc>;

export const DataCollectionInfo = z.object({ name: z.string(), count: z.number(), updatedAt: z.number() });
export type DataCollectionInfo = z.infer<typeof DataCollectionInfo>;

/** REST bodies / query strings (backend boundary). */
export const DataCreateBody = z.object({ data: DataBody, id: DataDocId.optional() });
export const DataWriteBody = z.object({ data: DataBody });
/** Query string: numbers + JSON arrive as strings. */
export const DataListQueryString = z.object({
  limit: z.coerce.number().int().min(1).max(DATA_LIMITS.LIST_MAX_LIMIT).optional(),
  after: DataDocId.optional(),
  where: z.string().max(4000).optional(),
});

export interface DataListResponse { ok: true; docs: DataDoc[]; next?: string }
export interface DataCollectionsResponse { ok: true; collections: DataCollectionInfo[] }
export interface DataDocResponse { ok: true; doc: DataDoc }
