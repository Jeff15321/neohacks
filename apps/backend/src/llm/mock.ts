import type { CompleteOptions, LLMProvider } from './provider.js';
import { MOCK_WIDGET_CODE, MOCK_WIDGET_CODE_YT, MOCK_WIDGET_CODE_G2, MOCK_REPLY, MOCK_TOPICS } from './mockdata.js';

/**
 * Deterministic provider for automated tests. No network.
 *  - Widget-generation prompts (system prompt contains WIDGET-GEN marker)
 *    return a canned GeneratedWidget JSON that automates the fixture Gmail.
 *  - Inference prompts return a canned reply.
 */
export class MockProvider implements LLMProvider {
  name = 'mock';
  async complete(opts: CompleteOptions): Promise<string> {
    if (opts.system?.includes('WIDGET-GEN')) {
      const userMsg = opts.messages[0]?.content ?? '';
      if (/fixture-g2|hardmail/i.test(userMsg)) {
        return JSON.stringify({
          name: 'Unread Reply Drafter',
          description: 'Toolbar button that drafts AI replies to the 2 most recent unread emails.',
          matchPatterns: ['*://127.0.0.1/*', '*://localhost/*', '*://mail.google.com/*'],
          grants: ['inference', 'log'],
          insertionHint: 'Inserts a button into the main toolbar.',
          code: MOCK_WIDGET_CODE_G2,
          warnings: ['mock provider: deterministic g2 widget'],
        });
      }
      if (/comment|topic|youtube|video/i.test(userMsg)) {
        return JSON.stringify({
          name: 'Comment Topic Analyzer',
          description: 'Adds a panel that groups video comments into discussion topics.',
          matchPatterns: ['*://127.0.0.1/*', '*://localhost/*', '*://*.youtube.com/*'],
          grants: ['inference', 'log'],
          insertionHint: 'Panel above the comments section.',
          code: MOCK_WIDGET_CODE_YT,
          warnings: ['mock provider: deterministic fixture widget'],
        });
      }
      return JSON.stringify({
        name: 'Unread Reply Drafter',
        description: 'Adds a toolbar button that drafts AI replies to the 2 most recent unread emails.',
        matchPatterns: ['*://127.0.0.1/*', '*://localhost/*', '*://mail.google.com/*'],
        grants: ['inference', 'log'],
        insertionHint: 'Appends a button into the main toolbar container.',
        code: MOCK_WIDGET_CODE,
        warnings: ['mock provider: deterministic fixture widget'],
      });
    }
    if (/group|topics|theme|classif/i.test(opts.messages[0]?.content ?? '') || /group|topics|theme/i.test(opts.system ?? '')) return MOCK_TOPICS;
    return MOCK_REPLY;
  }
}
