/** Random id with a prefix: `w_k3j9a0b1`. Uses crypto when available. */
export function randomId(prefix: string, len = 10): string {
  const g = globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } };
  const bytes = new Uint8Array(len);
  if (g.crypto?.getRandomValues) g.crypto.getRandomValues(bytes);
  else for (let i = 0; i < len; i++) bytes[i] = Math.floor(Math.random() * 256);
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (const b of bytes) s += abc[b % abc.length];
  return `${prefix}_${s}`;
}

/** traceId for one user-initiated flow (propagated panel → SW → backend → llm_calls). */
export const newTraceId = () => randomId('t', 12);

/** Fixed-size ring buffer (bus log, timelines). */
export class Ring<T> {
  private buf: T[] = [];
  constructor(private readonly size: number) {}
  push(x: T): void { this.buf.push(x); if (this.buf.length > this.size) this.buf.splice(0, this.buf.length - this.size); }
  /** Newest last. */
  list(limit?: number): T[] { return limit ? this.buf.slice(-limit) : [...this.buf]; }
  clear(): void { this.buf = []; }
  get length(): number { return this.buf.length; }
}
