// Live-LLM run of the WidgetAI.db flow on the CineBase fixture (Phase A).
// Needs a backend with LLM_PROVIDER=anthropic on E2E_PORT (default 8787) whose EXTENSION_AUTH_TOKEN matches the
// extension build (tests/e2e builds with dev-token-change-me), and the extension built for that port:
//   E2E_PORT=8803 npx tsx data-live.mjs
import { request } from 'playwright';
import { launchWithExtension, EXT_ID, BASE, TOKEN } from '../e2e/helpers.ts';

const MOVIE = (id) => `${BASE}/fixture-movies/movie.html?id=${id}`;
const log = (...a) => console.log('[data-live]', ...a);
const { context, sw } = await launchWithExtension();
const page = await context.newPage();
const panel = await context.newPage();
await panel.goto(`chrome-extension://${EXT_ID}/sidepanel.html`);
await panel.waitForSelector('#req');

async function generateAndApprove(request) {
  await panel.click('[data-testid="tab-create"]');
  await panel.fill('#req', request);
  const t0 = Date.now();
  await panel.click('#gen-btn');
  await panel.locator('[data-testid="approval-card"] h3').first().waitFor({ timeout: 600_000 });
  const card = await panel.locator('[data-testid="approval-card"]').first().innerText();
  log(`generated in ${Math.round((Date.now() - t0) / 1000)}s:`, card.split('\n').filter(Boolean).slice(0, 12).join(' | '));
  await panel.locator('[data-testid="approval-card"] [data-testid="approve"]').first().click();
}
// widget UIs live in shadow roots: read their text (string evaluate — see AGENTS.md)
const widgetText = () => page.evaluate(`[...document.querySelectorAll('[id^="wwa-"]')].map(h => (h.shadowRoot ? [...h.shadowRoot.children].filter(c => c.tagName !== 'STYLE').map(c => c.innerText).join(' ') : h.innerText).replace(/\\s+/g, ' ').trim()).join(' | ')`);
const saveButton = () => page.locator('[id^="wwa-"] button').filter({ hasText: /save/i }).first();

await page.goto(MOVIE('dune'));
await page.waitForSelector('.movie-title');
await generateAndApprove('Add a button to save this movie so I can see it later');
for (const id of ['dune', 'arrival']) {
  if (id !== 'dune') await page.goto(MOVIE(id));
  await saveButton().waitFor({ timeout: 20_000 });
  await saveButton().click();
  await page.waitForTimeout(2500);
  log(`${id}: widget text after click →`, (await widgetText()).slice(0, 160));
}
const userId = await sw.evaluate('chrome.storage.local.get("wwa_install_id").then(r => r.wwa_install_id)');
const api = await request.newContext({ baseURL: BASE, extraHTTPHeaders: { 'x-extension-token': TOKEN, 'x-user-id': userId } });
const docs = (await (await api.get('/api/data/saved_movies')).json()).docs ?? [];
log(`GET /api/data/saved_movies → ${docs.length} docs:`, JSON.stringify(docs.map(d => ({ id: d.id, ...d.data }))).slice(0, 600));
log('collections:', JSON.stringify((await (await api.get('/api/data')).json()).collections));

await page.goto(`${BASE}/fixture-movies/watchlist.html`);
await page.waitForSelector('#watchlist-sidebar');
await generateAndApprove('Show my saved movies in the sidebar');
await page.locator('[id^="wwa-"]').first().waitFor({ timeout: 20_000 });
await page.waitForTimeout(4000);
const listText = await widgetText();
log('list widget text:', listText.slice(0, 400));
log('list shows Dune:', /Dune/.test(listText), 'Arrival:', /Arrival/.test(listText));
const widgets = await sw.evaluate('chrome.storage.local.get("wwa_widgets").then(r => r.wwa_widgets)');
for (const w of widgets) log(`widget "${w.name}" grants=${w.grants} collections=${w.collections} status=${w.status}${w.lastError ? ' err=' + w.lastError : ''}`);
const dataLog = (await sw.evaluate('globalThis.__wwaBus.log.list()')).filter(e => e.type === 'WIDGET_DATA');
log(`WIDGET_DATA bus entries: ${dataLog.length} (ok ${dataLog.filter(e => e.ok).length})`, dataLog.filter(e => !e.ok).map(e => e.error).join('; '));
await panel.click('[data-testid="tab-data"]');
await panel.waitForTimeout(1500);
log('Data tab:', (await panel.locator('[data-testid="data-tab"]').innerText()).replace(/\n/g, ' | ').slice(0, 500));
if (process.env.SHOT) await panel.screenshot({ path: process.env.SHOT, fullPage: true });
await context.close();
