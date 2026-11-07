import type { MockFn } from '../../../llm/types.js';

const VERB: Record<string, string> = {
  click: 'click', 'input-commit': 'type', submit: 'submit', 'key-shortcut': 'press', copy: 'copy', paste: 'paste',
  select: 'select', 'drag-drop': 'drop', navigate: 'navigate', 'tab-switch': 'switch tab', download: 'download',
};

interface CStep { seq: number; kind: string; target?: { role?: string; name?: string; tag?: string }; value?: string; effects?: { appeared?: Array<{ skeleton: string }>; liveText?: string[] } }

/** Deterministic Tier-1 labels (STEP-INTERP): verb from the action kind, refined by obvious effects. */
export const stepInterpretMock: MockFn = (req) => {
  const user = req.messages[0]?.content ?? '';
  const json = user.slice(user.indexOf('STEPS TO LABEL'));
  let steps: CStep[] = [];
  try { steps = JSON.parse(json.slice(json.indexOf('['))); } catch { /* empty */ }
  return JSON.stringify({
    steps: steps.map(s => {
      const name = s.target?.name?.slice(0, 40) ?? s.target?.tag ?? 'page';
      const appeared = (s.effects?.appeared ?? []).map(a => a.skeleton).join('\n');
      let verb = VERB[s.kind] ?? s.kind;
      let object = name;
      if (s.kind === 'click' && /^reply$/i.test(name)) { verb = 'reply'; object = 'reply composer'; }
      else if (s.kind === 'click' && (s.target?.role === 'row' || s.target?.tag === 'tr')) { verb = 'open'; object = `email "${name.slice(0, 30)}"`; }
      else if (s.kind === 'input-commit' && /contenteditable|Message Body/i.test(appeared + name)) { object = 'reply text'; }
      const saved = (s.effects?.liveText ?? []).some(t => /saved/i.test(t));
      return {
        seq: s.seq, verb, object,
        entities: s.value ? [{ key: 'value', value: s.value.slice(0, 80) }] : [],
        isNavigationOnly: s.kind === 'navigate' || s.kind === 'tab-switch' || /back/i.test(name),
        readsData: verb === 'open' ? ['email body'] : [],
        writesData: s.kind === 'input-commit' ? [saved ? 'reply draft (saved)' : 'text'] : [],
      };
    }),
  });
};
