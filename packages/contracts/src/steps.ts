import { z } from 'zod';

/** Doc §1.2 / §3. Owned by Phase B (shape may be widened, never renamed). */

export const LocatorCandidate = z.object({
  kind: z.enum(['id', 'data', 'role-name', 'aria-label', 'text', 'css']),
  selector: z.string(),
  /** Number of elements this selector matched at capture time (1 = unique). */
  matches: z.number(),
});
export type LocatorCandidate = z.infer<typeof LocatorCandidate>;

export const LocatorBundle = z.object({
  candidates: z.array(LocatorCandidate),
  tag: z.string(),
  role: z.string().optional(),
  accessibleName: z.string().optional(),
  landmarkPath: z.string().optional(),
});
export type LocatorBundle = z.infer<typeof LocatorBundle>;

export const StepActionKind = z.enum([
  'click', 'input-commit', 'submit', 'key-shortcut', 'copy', 'paste', 'select',
  'drag-drop', 'navigate', 'tab-switch', 'download',
]);
export type StepActionKind = z.infer<typeof StepActionKind>;

export const SkeletonFragment = z.object({ root: z.string(), skeleton: z.string() });
export type SkeletonFragment = z.infer<typeof SkeletonFragment>;

export const StepNetEffect = z.object({
  opId: z.string(),
  method: z.string(),
  routeTemplate: z.string().optional(),
  status: z.number().optional(),
});

export const Step = z.object({
  id: z.string(),
  /** Global monotonic sequence assigned by the SW. */
  seq: z.number(),
  tabId: z.number(),
  windowId: z.number().optional(),
  origin: z.string(),
  url: z.string(),
  routeTemplate: z.string().optional(),
  action: z.object({
    kind: StepActionKind,
    target: LocatorBundle.optional(),
    accessibleName: z.string().optional(),
    role: z.string().optional(),
    landmarkPath: z.string().optional(),
    /** Redacted preview of committed input value. */
    valuePreview: z.string().optional(),
    key: z.string().optional(),
  }),
  effects: z.object({
    urlChange: z.string().optional(),
    titleChange: z.string().optional(),
    addedRegions: z.array(SkeletonFragment),
    removedRegions: z.array(z.string()),
    /** role=status/alert/aria-live text added, e.g. "Draft saved". */
    liveRegionText: z.array(z.string()),
    net: z.array(StepNetEffect),
    mutatingOk: z.boolean(),
  }),
  lateEffects: z.object({ liveRegionText: z.array(z.string()), net: z.array(StepNetEffect) }).optional(),
  settled: z.boolean(),
  tStart: z.number(),
  tEnd: z.number(),
});
export type Step = z.infer<typeof Step>;

/** Tier-1 Step Interpreter output. */
export const SemanticStep = z.object({
  seq: z.number(),
  verb: z.string(),
  object: z.string(),
  entities: z.record(z.string(), z.string()),
  isNavigationOnly: z.boolean(),
  readsData: z.array(z.string()),
  writesData: z.array(z.string()),
});
export type SemanticStep = z.infer<typeof SemanticStep>;

/** Data lineage edge: a value read in `from` reappears in `to`. */
export const LineageEdge = z.object({
  fromSeq: z.number(),
  toSeq: z.number(),
  field: z.string().optional(),
  valueHash: z.string(),
});
export type LineageEdge = z.infer<typeof LineageEdge>;
