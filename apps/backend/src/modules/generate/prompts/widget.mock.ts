import type { MockFn } from '../../../llm/types.js';
import { MOCK_WIDGET_CODE, MOCK_WIDGET_CODE_G2, MOCK_WIDGET_CODE_NET, MOCK_WIDGET_CODE_YT } from './widget.mockdata.js';
import { MOCK_WIDGET_CODE_G2_DELETE, MOCK_WIDGET_CODE_G2_STEPS } from './widget.mockdata.steps.js';
import { MOCK_WIDGET_CODE_SPEC_G2 } from './widget.spec.mockdata.js';
import { moviesMockWidget } from './widget.mock.movies.js';
import { flowMockWidget } from './widget.mockdata.flow.js';

const LOCAL = ['*://127.0.0.1/*', '*://localhost/*'];

/**
 * Deterministic widget generator for E2E (LLM_PROVIDER=mock). Picks a canned widget by the page URL /
 * request in the user prompt. Phases add branches for their fixtures (keep the order: most specific first).
 */
export const widgetMock: MockFn = (req) => {
  const user = req.messages[0]?.content ?? '';
  const changeSummary = /PRIOR WIDGET CODE/.test(user) ? 'mock: regenerated with the requested change' : '';
  const out = (w: { name: string; description: string; matchPatterns: string[]; grants: string[]; insertionHint: string; code: string; plan: string[]; collections?: string[] }) =>
    JSON.stringify({ collections: [], ...w, warnings: ['mock provider: deterministic fixture widget'], changeSummary, consequentialActions: [] });
  const flow = flowMockWidget(user); // Phase F: fixture-issues → fixture-tracker bundle (WidgetAI.flow)
  if (flow) return JSON.stringify({ collections: [], warnings: ['mock provider: deterministic fixture bundle'], changeSummary, ...flow });
  const movies = moviesMockWidget(user); // Phase A: fixture-movies (WidgetAI.db)
  if (movies) return out(movies);
  // Phase B: spec-conditioned generation from a recording (record.spec.ts)
  if (/RECORDED WORKFLOW SPEC/.test(user) && /fixture-g2|hardmail/i.test(user)) {
    return out({
      name: 'Recorded: Draft Replies to Unread', description: 'Toolbar button that drafts an AI reply to every unread email, as recorded (never sends).',
      matchPatterns: [...LOCAL, '*://mail.google.com/*'], grants: ['inference', 'log'], insertionHint: 'Button in the main toolbar (spec trigger).', code: MOCK_WIDGET_CODE_SPEC_G2,
      plan: ['Add a "Draft replies to unread" button to the toolbar', 'For each unread email: open it, write a reply with AI, let it auto-save as a draft', 'Never press Send'],
    });
  }
  if (/fixture-net|netmail/i.test(user)) {
    return out({
      name: 'API Draft Creator', description: 'Button that creates an email draft by replaying the captured save-draft network call.',
      matchPatterns: LOCAL, grants: ['network', 'log'], insertionHint: 'Inserts a button into the main toolbar.', code: MOCK_WIDGET_CODE_NET,
      plan: ['Add a button to the toolbar', 'Strategy: network (confirmed op, JSON body, CSRF dependency resolvable) with a DOM fallback',
        'Re-fetch the CSRF token the save-draft request depends on', 'Replay the captured "save draft" request with new values and the fresh token',
        'Read the drafts list back to confirm, then mark the operation verified'],
    });
  }
  // Phase C: danger-guard + step-based chaos widgets (more specific than the plain g2 widget below)
  const userRequest = user.match(/USER REQUEST: (.*)/)?.[1] ?? '';
  if (/fixture-g2/i.test(user) && /newsletter|clean ?up|delete/i.test(userRequest)) {
    return out({
      name: 'Newsletter Cleanup', description: 'Deletes the weekly digest newsletter (consequential: guarded at runtime).',
      matchPatterns: LOCAL, grants: ['log'], insertionHint: 'Inserts a button into the main toolbar.', code: MOCK_WIDGET_CODE_G2_DELETE,
      plan: ['Open the newsletter email', 'Click Delete (asks for your confirmation)'],
    });
  }
  if (/fixture-g2[^\s]*chaos=/i.test(user)) {
    return out({
      name: 'Unread Reply Drafter (self-healing)', description: 'Drafts AI replies to the 2 newest unread emails using checked steps with recovery branches.',
      matchPatterns: LOCAL, grants: ['inference', 'log'], insertionHint: 'Inserts a button into the main toolbar.', code: MOCK_WIDGET_CODE_G2_STEPS,
      plan: ['Add a "Draft Replies" button', 'Open each of the 2 newest unread emails (checked steps, popup/collapsed-composer branches)', 'Write a reply with AI and save it as a draft (never sends)'],
    });
  }
  if (/fixture-g2|hardmail/i.test(user)) {
    return out({
      name: 'Unread Reply Drafter', description: 'Toolbar button that drafts AI replies to the 2 most recent unread emails.',
      matchPatterns: [...LOCAL, '*://mail.google.com/*'], grants: ['inference', 'log'], insertionHint: 'Inserts a button into the main toolbar.', code: MOCK_WIDGET_CODE_G2,
      plan: ['Add a "Draft Replies" button to the toolbar', 'Open each of the 2 newest unread emails', 'Write a reply with AI and save it as a draft (never sends)'],
    });
  }
  if (/comment|topic|youtube|video/i.test(user)) {
    return out({
      name: 'Comment Topic Analyzer', description: 'Adds a panel that groups video comments into discussion topics.',
      matchPatterns: [...LOCAL, '*://*.youtube.com/*'], grants: ['inference', 'log'], insertionHint: 'Panel above the comments section.', code: MOCK_WIDGET_CODE_YT,
      plan: ['Add a panel above the comments', 'Read the visible comments', 'Group them into topics with AI'],
    });
  }
  return out({
    name: 'Unread Reply Drafter', description: 'Adds a toolbar button that drafts AI replies to the 2 most recent unread emails.',
    matchPatterns: [...LOCAL, '*://mail.google.com/*'], grants: ['inference', 'log'], insertionHint: 'Appends a button into the main toolbar container.', code: MOCK_WIDGET_CODE,
    plan: ['Add a button to the toolbar', 'Open the 2 newest unread emails', 'Write a reply with AI and save it as a draft (never sends)'],
  });
};
