import type { MockFn } from '../../../llm/types.js';
import { JUDGE_MARK, type JudgeInput } from './judge.js';

/** Deterministic Judge for E2E: suggest iff ≥2 completed instances and the pattern is not dismissed. */
export const judgeMock: MockFn = (req) => {
  const user = req.messages[0]?.content ?? '';
  let inp: Partial<JudgeInput> = {};
  try { inp = JSON.parse(user.slice(user.indexOf(JUDGE_MARK) + JUDGE_MARK.length, user.lastIndexOf('\n\nDecide')).trim()); } catch { /* empty */ }
  const pid = (inp.pattern as { id?: string } | undefined)?.id ?? '';
  const ok = (inp.completedInstances ?? 0) >= 2 && !(inp.dismissed ?? []).some(d => d.patternId === pid);
  return JSON.stringify({
    suggest: ok,
    reason: ok ? 'mock: ≥2 completed instances of the same reply pattern' : 'mock: not enough evidence',
    title: 'Draft replies to your remaining unread emails?',
    why: `You replied to ${inp.completedInstances ?? 0} emails the same way in the last few minutes`,
    value: 0.8, confidence: 0.8, feasibility: 0.9,
    request: 'Add a toolbar button that drafts an AI reply to every unread email (draft only — never send).',
    spec: {
      goal: 'Draft an AI reply to each unread email',
      placement: 'Button in the main toolbar',
      inputs: [{ name: 'thread', source: 'each unread inbox row' }],
      outputs: [{ name: 'replyText', sink: 'reply composer (auto-saved draft)' }],
      steps: [{ intent: 'Open the unread email', role: 'essential' }, { intent: 'Click Reply', role: 'essential' }, { intent: 'Write the reply with AI; it auto-saves as a draft', role: 'essential' }],
      successCriteria: ['"Draft saved" appears for each unread email'],
      consequentialActions: ['Send'],
    },
  });
};
