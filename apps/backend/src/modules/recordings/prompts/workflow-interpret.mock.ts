import type { MockFn } from '../../../llm/types.js';

interface CStep { seq: number; kind: string; site: string; target?: { name?: string; role?: string; tag?: string }; effects?: { liveText?: string[]; net?: string[] } }

/** Deterministic Workflow Interpreter (WF-INTERP): mail-reply spec for HardMail-like recordings, generic otherwise. */
export const workflowInterpretMock: MockFn = (req) => {
  const user = req.messages[0]?.content ?? '';
  const start = user.indexOf('[');
  const end = user.indexOf('\n\nPAGE SNAPSHOTS');
  let steps: CStep[] = [];
  try { steps = JSON.parse(user.slice(start, end)); } catch { /* empty */ }
  const site = steps[0]?.site ?? 'unknown';
  const seqs = (pred: (s: CStep) => boolean) => steps.filter(pred).map(s => s.seq);
  const answered = /ANSWERS TO YOUR OPEN QUESTIONS/.test(user);
  const instr = /USER INSTRUCTIONS[^\n]*\n([^\n]+)/.exec(user)?.[1] ?? '';
  const mail = steps.some(s => /reply/i.test(s.target?.name ?? '')) || /HardMail|Message Body/i.test(user);
  if (mail) {
    const open = seqs(s => s.kind === 'click' && (s.target?.role === 'row' || s.target?.tag === 'tr'));
    const reply = seqs(s => s.kind === 'click' && /reply/i.test(s.target?.name ?? ''));
    const type = seqs(s => s.kind === 'input-commit');
    const saved = steps.some(s => (s.effects?.liveText ?? []).some(t => /draft saved/i.test(t)));
    return JSON.stringify({
      goal: 'Draft an AI-written reply to each unread email in the inbox (save as draft, never send)',
      trigger: { site, placement: 'button in the main toolbar' },
      inputs: [{ name: 'email thread', source: 'each unread row in the inbox list (tr.zA.zE)' }],
      outputs: [{ name: 'reply draft', sink: 'reply composer, auto-saved as a draft' }],
      steps: [
        { intent: 'Open the next unread email from the inbox', site, role: 'essential', evidence: { stepSeq: open, netOpIds: [] } },
        { intent: 'Open the reply composer', site, role: 'essential', evidence: { stepSeq: reply, netOpIds: [] } },
        { intent: 'Write a reply with AI based on the email and type it into the composer', site, role: 'essential', evidence: { stepSeq: type, netOpIds: [] } },
        { intent: 'Wait for the "Draft saved" notice, then go back to the inbox', site, role: 'essential', evidence: { stepSeq: [], netOpIds: [] } },
      ],
      dataFlow: [],
      successCriteria: [saved ? 'a "Draft saved" notice appears after typing each reply' : 'the reply text stays in the composer', 'no email is sent'],
      consequentialActions: ['Send email (never pressed — drafts only)'],
      strategyHints: [{ step: 0, strategy: 'dom', reason: 'no mutating network call observed; the UI is the only interface' }],
      openQuestions: answered || /all unread/i.test(instr) ? [] : ['Should it draft replies for every unread email or only the newest ones?'],
    });
  }
  return JSON.stringify({
    goal: `Repeat the recorded ${steps.length}-step workflow on ${site}`,
    trigger: { site, placement: 'floating button' },
    inputs: [], outputs: [],
    steps: steps.map(s => ({ intent: `${s.kind} ${s.target?.name ?? ''}`.trim(), site, role: 'essential', evidence: { stepSeq: [s.seq], netOpIds: [] } })),
    dataFlow: [], successCriteria: [], consequentialActions: [], strategyHints: [],
    openQuestions: answered ? [] : ['What should vary between runs?'],
  });
};
