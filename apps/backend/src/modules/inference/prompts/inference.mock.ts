import type { MockFn } from '../../../llm/types.js';

export const MOCK_REPLY = `Hi, thanks for reaching out. I've received your message and will follow up shortly with the details you need. Best regards.`;

export const MOCK_TOPICS = `1. Rust vs Go tradeoffs — @cthulhu, @gopher_gal debate whether the complexity is worth it.
2. Performance results — @webdev_jane, @scaleup_sam, @data_dave ask for benchmarks, latencies, and RAM numbers.
3. Learning resources — @rustfan, @neovimmer want more explainers (lifetimes, macros).`;

/** Ported from MVP MockProvider: topic-grouping prompts get MOCK_TOPICS, everything else MOCK_REPLY. */
export const inferenceMock: MockFn = (req) => {
  const prompt = (req.messages[0]?.content ?? '').split('\n\nCONTEXT')[0];
  return /group|topics|theme|classif/i.test(prompt) ? MOCK_TOPICS : MOCK_REPLY;
};
