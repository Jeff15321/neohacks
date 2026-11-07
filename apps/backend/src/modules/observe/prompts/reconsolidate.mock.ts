import type { MockFn } from '../../../llm/types.js';

/** Deterministic reconsolidation for E2E: the mock Tier 2 never drifts, so no corrections. */
export const reconsolidateMock: MockFn = () => JSON.stringify({ ops: [] });
