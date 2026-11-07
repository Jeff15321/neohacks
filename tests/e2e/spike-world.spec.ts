import { test, expect } from '@playwright/test';
import { launchWithExtension, G2_URL } from './helpers.js';

// Spike (decision B): same-worldId re-execution + JSON state handoff via chrome.userScripts.execute.
test('spike: userScripts.execute awaits promises, same worldId shares globals, JSON state round-trips', async () => {
  const { context, sw } = await launchWithExtension();
  try {
    const page = await context.newPage();
    await page.goto(G2_URL);
    await page.waitForSelector('tr.zA');
    const out = await sw.evaluate(`(async () => {
      const [tab] = await chrome.tabs.query({ url: '${G2_URL}*' });
      await chrome.userScripts.configureWorld({ worldId: 'w_spike', messaging: true });
      const a = await chrome.userScripts.execute({ target: { tabId: tab.id }, js: [{ code: '(async () => { globalThis.__spike = 41; await new Promise(r => setTimeout(r, 300)); return { n: 1, rows: document.querySelectorAll("tr.zA").length }; })()' }], world: 'USER_SCRIPT', worldId: 'w_spike', injectImmediately: true });
      const state = { k: 'v', n: 2 };
      const b = await chrome.userScripts.execute({ target: { tabId: tab.id }, js: [{ code: '(async (state) => { return { ...state, shared: globalThis.__spike, n: state.n + 1 }; })(' + JSON.stringify(state) + ')' }], world: 'USER_SCRIPT', worldId: 'w_spike', injectImmediately: true });
      const c = await chrome.userScripts.execute({ target: { tabId: tab.id }, js: [{ code: '(() => typeof globalThis.__spike)()' }], world: 'USER_SCRIPT', worldId: 'w_other', injectImmediately: true });
      const d = await chrome.userScripts.execute({ target: { tabId: tab.id }, js: [{ code: '(async () => { throw new Error("boom"); })()' }], world: 'USER_SCRIPT', worldId: 'w_spike', injectImmediately: true });
      return { a, b, c, d };
    })()`);
    console.log('[spike]', JSON.stringify(out));
    const o = out as any;
    expect(o.a[0].result).toEqual({ n: 1, rows: 3 });
    expect(o.b[0].result).toEqual({ k: 'v', n: 3, shared: 41 });
  } finally { await context.close(); }
});
