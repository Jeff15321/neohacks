export * from './limits.js';
export * from './net.js';
export * from './page.js';
export * from './widget.js';
export * from './api.js';
export * from './llm.js';
export * from './steps.js';
export * from './workflow.js';
export * from './activity.js';
export * from './runtime.js';
export * from './data.js';
export * from './flow.js';
export * from './jobs.js';
export * from './messages/index.js';
export { z } from 'zod';

import type { z as Z } from 'zod';
/** Format a zod error with the boundary + message type it came from (Rules §3). */
export function boundaryError(boundary: string, type: string | undefined, err: Z.ZodError): string {
  const issues = err.issues.slice(0, 3).map(i => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
  return `[${boundary}] invalid ${type ?? 'message'}: ${issues}`;
}
