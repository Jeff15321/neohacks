import type { WorkingMemory } from '@app/contracts';
import type { MockFn } from '../../../llm/types.js';
import { MARK, parseBetween, type ActivityStepView } from './compact.js';

export const MOCK_PATTERN_ID = 'p_reply_to_email';

/**
 * Deterministic Tier-2 model for E2E (LLM_PROVIDER=mock). Rules over Tier-1 meanings:
 *  open <item> → abandon an unfinished focused task, open a "Read" task · reply → "Reply to an email" ·
 *  input with live text "saved/sent" → slot + link p_reply_to_email (created once) + complete + flag iff this is
 *  ≥ the 2nd completed instance · anything else → noise on the focused task.
 * ⇒ suggest.spec.ts: no flag after the 1st completed reply, flag after the 2nd.
 */
export const activityMock: MockFn = (req) => {
  const user = req.messages[0]?.content ?? '';
  const memory = parseBetween<WorkingMemory>(user, MARK.memory, MARK.recent, { activeTasks: [], recentCompleted: [], patterns: [], dismissed: [], focus: null });
  const fresh = parseBetween<ActivityStepView[]>(user, MARK.fresh, '\n\nReturn', []);
  const ops: unknown[] = [];
  const active = new Set(memory.activeTasks.map(t => t.id));
  let focus = memory.focus && active.has(memory.focus) ? memory.focus : null;
  let hasPattern = memory.patterns.some(p => p.id === MOCK_PATTERN_ID);
  const completedBefore = memory.patterns.find(p => p.id === MOCK_PATTERN_ID)?.instanceIds.length ?? 0;
  let completedNow = 0;
  for (const s of fresh) {
    const meaning = (s.meaning ?? '').toLowerCase();
    const saved = (s.liveText ?? []).some(t => /saved|sent/i.test(t));
    if (meaning.startsWith('open ')) {
      if (focus) ops.push({ op: 'abandon_task', taskId: focus, reason: 'moved to another item without a durable effect' });
      focus = `t${s.seq}`;
      ops.push({ op: 'open_task', taskId: focus, goal: `Read ${meaning.slice(5, 60)}`, confidence: 0.4, sites: [s.site], expectedNext: 'reply or go back' });
      ops.push({ op: 'attach_steps', taskId: focus, steps: [{ seq: s.seq, role: 'essential' }], confidence: 0.4, expectedNext: 'reply or go back', goal: '' });
    } else if (meaning.startsWith('reply')) {
      if (!focus) { focus = `t${s.seq}`; ops.push({ op: 'open_task', taskId: focus, goal: 'Reply to an email', confidence: 0.6, sites: [s.site], expectedNext: 'type reply' }); }
      ops.push({ op: 'attach_steps', taskId: focus, steps: [{ seq: s.seq, role: 'enabling' }], confidence: 0.75, expectedNext: 'type the reply text', goal: 'Reply to an email' });
    } else if (s.kind === 'input-commit' && saved && focus) {
      ops.push({ op: 'attach_steps', taskId: focus, steps: [{ seq: s.seq, role: 'essential' }], confidence: 0.9, expectedNext: '', goal: 'Reply to an email' });
      ops.push({ op: 'set_slot', taskId: focus, name: 'replyText', value: s.value ?? '', provenance: 'user-authored' });
      if (!hasPattern) {
        hasPattern = true;
        ops.push({ op: 'create_pattern', patternId: MOCK_PATTERN_ID, name: 'Reply to an email', abstractSteps: ['open email', 'click Reply', 'type reply (auto-saved draft)'],
          parameters: [{ name: 'thread', io: 'input', source: 'inbox row' }, { name: 'replyText', io: 'output', source: 'user-authored' }], automationIdea: 'Draft AI replies to the remaining emails' });
      }
      ops.push({ op: 'link_pattern', taskId: focus, patternId: MOCK_PATTERN_ID });
      ops.push({ op: 'complete_task', taskId: focus, evidence: (s.liveText ?? []).join(', ') });
      completedNow++;
      if (completedBefore + completedNow >= 2) ops.push({ op: 'flag_opportunity', taskId: focus, reason: `${completedBefore + completedNow} completed replies with the same structure` });
      focus = null;
    } else if (focus) {
      ops.push({ op: 'attach_steps', taskId: focus, steps: [{ seq: s.seq, role: 'noise' }], confidence: 0.4, expectedNext: '', goal: '' });
    }
  }
  return JSON.stringify({ ops });
};
