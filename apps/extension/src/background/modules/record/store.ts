import { RecordingSession, SemanticStep, Step, WorkflowSpec, z } from '@app/contracts';
import { storage } from '../../platform/index.js';

/** Owned storage key (storage.session): the current/last recording. */
const KEY = 'wwa_rec';

export const RecState = z.object({
  session: RecordingSession,
  steps: z.array(Step),
  semantic: z.record(z.string(), SemanticStep),
  spec: WorkflowSpec.nullable(),
  pages: z.array(z.object({ url: z.string(), title: z.string(), skeleton: z.string().optional() })),
  widgetId: z.string().optional(),
});
export type RecState = z.infer<typeof RecState>;

export const recStore = {
  async load(): Promise<RecState | null> {
    const raw = await storage.session.get<unknown>(KEY);
    const r = RecState.safeParse(raw);
    return r.success ? r.data : null;
  },
  save: (s: RecState | null) => (s ? storage.session.set(KEY, s) : storage.session.remove(KEY)),
};
