import { z } from 'zod';

/** User data store (WidgetAI.db). Owned by Phase A. */

export const DATA_LIMITS = {
  COLLECTION_RE: /^[a-z0-9_-]{1,64}$/,
  DOC_MAX_BYTES: 32 * 1024,
  MAX_DOCS_PER_COLLECTION: 5_000,
  MAX_COLLECTIONS_PER_USER: 100,
  LIST_MAX_LIMIT: 200,
} as const;

export const DataDoc = z.object({
  id: z.string(),
  collection: z.string(),
  data: z.record(z.string(), z.unknown()),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type DataDoc = z.infer<typeof DataDoc>;
