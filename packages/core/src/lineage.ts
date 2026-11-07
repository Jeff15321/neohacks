/**
 * §1.5 copy/paste/selection value hashing → LineageEdge (owner: Phase B, extended by F for cross-tab flows).
 * Pure. Values are normalised and hashed in the content script; only hashes leave the page.
 */
import type { LineageEdge } from '@app/contracts';

export const normaliseValue = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/** FNV-1a 32-bit over the normalised value, hex. Empty / very short values hash to '' (too ambiguous to link). */
export function hashValue(s: string): string {
  const v = normaliseValue(s);
  if (v.length < 3) return '';
  let h = 0x811c9dc5;
  for (let i = 0; i < v.length; i++) { h ^= v.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

interface StepLike { seq: number; action: { kind: string; valueHash?: string } }
const SOURCES = new Set(['copy', 'select']);
const SINKS = new Set(['paste', 'input-commit']);

/** A value read (copy/select) in one Step that reappears (paste/input) in a later Step → edge. */
export function lineageEdges(steps: StepLike[]): LineageEdge[] {
  const seen = new Map<string, number>();
  const edges: LineageEdge[] = [];
  for (const s of [...steps].sort((a, b) => a.seq - b.seq)) {
    const h = s.action.valueHash;
    if (!h) continue;
    if (SINKS.has(s.action.kind) && seen.has(h)) edges.push({ fromSeq: seen.get(h)!, toSeq: s.seq, valueHash: h });
    if (SOURCES.has(s.action.kind)) seen.set(h, s.seq);
  }
  return edges;
}
