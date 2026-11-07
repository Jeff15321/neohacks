import { test, expect, request } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { launchWithExtension, openPanel, generate, approveFirst, busLog, BASE, TOKEN } from './helpers.js';

/** Phase A — user data store (WidgetAI.db): save on one page, list on another, manage in the panel Data tab. */
const MOVIE = (id: string) => `${BASE}/fixture-movies/movie.html?id=${id}`;
const WATCHLIST = `${BASE}/fixture-movies/watchlist.html`;
const EVIDENCE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../docs/evidence/A');

test.describe('WidgetAI.db end-to-end (mock LLM, CineBase fixture)', () => {
  test('save 2 movies → GET /api/data has 2 → list widget shows both → panel Data view deletes one', async () => {
    const { context, sw } = await launchWithExtension();
    try {
      const page = await context.newPage();
      await page.goto(MOVIE('dune'));
      await page.waitForSelector('.movie-detail .movie-title');

      // --- 1. generate + approve "Save movie" on the movie detail page ---
      const panel = await openPanel(context);
      const title = await generate(panel, 'Add a button to save this movie to my saved movies list');
      expect(title).toContain('Save movie');
      const card = panel.locator('[data-testid="approval-card"]').first();
      await expect(card.locator('[data-testid="stores-data"]')).toHaveText(/Stores data in:\s*saved_movies/);
      expect(await card.innerText()).toMatch(/Read and save your personal data/);
      expect(await page.locator('[id^="wwa-"]').count()).toBe(0); // nothing injected before approval

      await approveFirst(panel);
      const saveBtn = page.locator('#wwa-save-movie button#save');
      await expect(saveBtn).toHaveText('Save movie', { timeout: 15_000 });
      await saveBtn.click();
      await expect(saveBtn).toHaveText(/Saved/, { timeout: 10_000 });

      // --- 2. second movie: the registered user script re-injects on navigation ---
      await page.goto(MOVIE('arrival'));
      await expect(saveBtn).toHaveText('Save movie', { timeout: 15_000 });
      await saveBtn.click();
      await expect(saveBtn).toHaveText(/Saved/, { timeout: 10_000 });
      // and a saved movie shows as saved when revisited (WidgetAI.db.get)
      await page.goto(MOVIE('dune'));
      await expect(saveBtn).toHaveText(/Saved/, { timeout: 15_000 });

      // --- 3. backend has 2 docs for THIS install's user id (and nothing for another user) ---
      const userId = await sw.evaluate('chrome.storage.local.get("wwa_install_id").then(r => r.wwa_install_id)') as string;
      expect(userId).toMatch(/^[0-9a-f-]{36}$/);
      const api = await request.newContext({ baseURL: BASE, extraHTTPHeaders: { 'x-extension-token': TOKEN } });
      const getDocs = async (uid: string) => (await (await api.get('/api/data/saved_movies', { headers: { 'x-user-id': uid } })).json()).docs as Array<{ id: string; data: { title: string; year: number } }>;
      const docs = await getDocs(userId);
      expect(docs).toHaveLength(2);
      expect(docs.map(d => d.data.title).sort()).toEqual(['Arrival', 'Dune']);
      expect(docs.map(d => d.id).sort()).toEqual(['arrival', 'dune']); // stable ids → no duplicates
      expect(await getDocs('99999999-9999-4999-8999-999999999999')).toHaveLength(0);
      expect((await api.get('/api/data/saved_movies')).status()).toBe(400); // no x-user-id

      // --- 4. generate + approve "My saved movies" on the watchlist page (a different page) ---
      await page.goto(WATCHLIST);
      await page.waitForSelector('#watchlist-sidebar');
      const title2 = await generate(panel, 'Show my saved movies in the sidebar');
      expect(title2).toContain('My saved movies');
      await expect(panel.locator('[data-testid="approval-card"] [data-testid="stores-data"]').first()).toHaveText(/saved_movies/);
      // the generator was told about the existing collection (GENERATE_WIDGET → existingCollections)
      const gen2 = (await busLog(sw)).filter(e => e.type === 'GENERATE_WIDGET' && e.channel === 'panel').pop()!;
      const calls = (await (await api.get(`/api/debug/llm-calls?traceId=${gen2.traceId}`)).json()).calls;
      expect(JSON.parse(calls[0].input).messages[0].content).toMatch(/EXISTING DATA COLLECTIONS[^\n]*\n- saved_movies/);

      await approveFirst(panel);
      const items = page.locator('#wwa-saved-movies li.saved-movie');
      await expect(items).toHaveCount(2, { timeout: 15_000 });
      const texts = await items.allInnerTexts();
      expect(texts.join(' | ')).toContain('Dune');
      expect(texts.join(' | ')).toContain('Arrival');

      // --- 5. runtime enforcement: an undeclared collection is refused by the SW (after the bus grant/origin checks) ---
      const widgets = await sw.evaluate('chrome.storage.local.get("wwa_widgets").then(r => r.wwa_widgets)') as Array<{ id: string; name: string; collections?: string[] }>;
      const lister = widgets.find(w => w.name === 'My saved movies')!;
      expect(lister.collections).toEqual(['saved_movies']);
      const sender = JSON.stringify({ tab: { id: 1, url: WATCHLIST }, url: WATCHLIST, frameId: 0 });
      const denied = await sw.evaluate(`globalThis.__wwaBus.dispatch('userScript', { type: 'WIDGET_DATA', widgetId: ${JSON.stringify(lister.id)}, requestId: 'x', op: 'list', collection: 'private_notes' }, ${sender})`) as { ok: boolean; error?: string };
      expect(denied.ok).toBe(false);
      expect(denied.error).toMatch(/collection "private_notes" not declared/);
      const wrongOrigin = await sw.evaluate(`globalThis.__wwaBus.dispatch('userScript', { type: 'WIDGET_DATA', widgetId: ${JSON.stringify(lister.id)}, requestId: 'y', op: 'list', collection: 'saved_movies' }, ${JSON.stringify({ tab: { id: 1, url: MOVIE('dune') }, url: MOVIE('dune') })})`) as { ok: boolean; error?: string };
      expect(wrongOrigin.ok).toBe(false);
      expect(wrongOrigin.error).toMatch(/origin not allowed/);
      const log = await busLog(sw);
      const dataMsgs = log.filter(e => e.type === 'WIDGET_DATA' && e.channel === 'userScript');
      expect(dataMsgs.filter(e => e.ok).length).toBeGreaterThanOrEqual(5); // get, add, get, add, get, list

      // --- 6. panel Data view: 2 docs → delete one → 1 ---
      await panel.click('[data-testid="tab-data"]');
      const coll = panel.locator('[data-testid="data-collection"][data-name="saved_movies"]');
      await expect(coll).toContainText('2', { timeout: 10_000 });
      const docRows = panel.locator('[data-testid="data-doc"]');
      await expect(docRows).toHaveCount(2);
      await expect(panel.locator('[data-testid="data-docs"]')).toContainText('"title": "Dune"');
      fs.mkdirSync(EVIDENCE, { recursive: true });
      await panel.waitForTimeout(300); // let the tab-trigger transition settle for the evidence screenshot
      await panel.screenshot({ path: path.join(EVIDENCE, 'data-tab.png'), fullPage: true });

      await panel.locator('[data-testid="data-doc"][data-id="arrival"] [data-testid="data-delete"]').click();
      await expect(docRows).toHaveCount(1);
      await expect(coll).toContainText('1');
      const left = await getDocs(userId);
      expect(left.map(d => d.id)).toEqual(['dune']);
      // the list widget reflects it on refresh
      await page.locator('#wwa-saved-movies button#refresh').click();
      await expect(items).toHaveCount(1, { timeout: 10_000 });
      await expect(items.first()).toContainText('Dune');
      await panel.screenshot({ path: path.join(EVIDENCE, 'data-tab-after-delete.png'), fullPage: true });
      console.log(`[e2e] data: user=${userId.slice(0, 8)}… docs before=2 after=${left.length}; WIDGET_DATA ok=${dataMsgs.filter(e => e.ok).length}`);
    } finally {
      await context.close();
    }
  });
});
