import { z } from 'zod';
import { NetOpSummary } from './net.js';

export const Landmark = z.object({
  tag: z.string(),
  id: z.string().optional(),
  classes: z.string().optional(),
  role: z.string().optional(),
  ariaLabel: z.string().optional(),
  /** up to 3 data-* attributes, e.g. {"data-legacy-message-id": "m1"} */
  dataAttrs: z.record(z.string(), z.string()).optional(),
  /** truncated visible text */
  text: z.string().optional(),
  rect: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).optional(),
});
export type Landmark = z.infer<typeof Landmark>;

export const PageContext = z.object({
  url: z.string(),
  origin: z.string(),
  title: z.string(),
  /** High-signal landmark elements: toolbars, navs, mains, buttons, inputs. */
  landmarks: z.array(Landmark),
  /** Candidate containers where a widget could be inserted. */
  insertionCandidates: z.array(Landmark),
  /** Short visible-text sample for grounding (capped server-side). */
  textSample: z.string(),
  /** Interactive elements (buttons/links/inputs) summary. */
  interactive: z.array(Landmark),
  /** Nested skeleton of the main content region (depth-limited, text-truncated). */
  domSkeleton: z.string().optional(),
  /** Recently observed network operations on this tab (redacted). */
  networkOps: z.array(NetOpSummary).optional(),
});
export type PageContext = z.infer<typeof PageContext>;
