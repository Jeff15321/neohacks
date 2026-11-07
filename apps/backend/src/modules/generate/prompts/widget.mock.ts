import type { MockFn } from '../../../llm/types.js';
import { MOCK_WIDGET_CODE, MOCK_WIDGET_CODE_G2, MOCK_WIDGET_CODE_NET, MOCK_WIDGET_CODE_YT } from './widget.mockdata.js';
import { moviesMockWidget } from './widget.mock.movies.js';

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
  const movies = moviesMockWidget(user); // Phase A: fixture-movies (WidgetAI.db)
  if (movies) return out(movies);
  if (/fixture-net|netmail/i.test(user)) {
    return out({
      name: 'API Draft Creator', description: 'Button that creates an email draft by replaying the captured save-draft network call.',
      matchPatterns: LOCAL, grants: ['network', 'log'], insertionHint: 'Inserts a button into the main toolbar.', code: MOCK_WIDGET_CODE_NET,
      plan: ['Add a button to the toolbar', 'Replay the captured "save draft" request with new values', 'Read the drafts list back to confirm'],
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
