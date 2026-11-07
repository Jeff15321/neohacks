// Live-LLM run of the cross-site flow (Phase F, Demo 3): issues (127.0.0.1) → tracker (localhost).
// Needs a backend with LLM_PROVIDER=anthropic on E2E_PORT whose EXTENSION_AUTH_TOKEN matches the extension build
// (dev-token-change-me), and the extension built for that port:
//   BACKEND_PORT=8806 LLM_PROVIDER=anthropic DATA_DB_PATH=/tmp/nx-f.db npm run start -w apps/backend &
//   BACKEND_URL=http://127.0.0.1:8806 npm run build
//   cd tests/tools && E2E_PORT=8806 PW_PROFILE=/tmp/nx-f-live npx tsx flow-live.mjs
import fs from 'node:fs';
import { request } from 'playwright';
import { launchWithExtension, EXT_ID, BASE, PORT } from '../e2e/helpers.ts';

const ISSUES = (n) => `${BASE}/fixture-issues/index.html?n=${n}`;
const TRACKER = `http://localhost:${PORT}/fixture-tracker/index.html`;
const OUT = process.env.OUT ?? '';
const log = (...a) => console.log('[flow-live]', ...a);
const api = await request.newContext({ baseURL: BASE });
await api.post('/fixture-tracker-api/__reset');
const { context, sw } = await launchWithExtension();
const out = {};
try {
  const page = await context.newPage();
  await page.goto(ISSUES(101));
  await page.waitForSelector('.js-issue-title');
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${EXT_ID}/sidepanel.html`);
  await panel.waitForSelector('#req');
  await panel.click('[data-testid="tab-create"]');
  await panel.fill('#req', `Add a "Create ticket" button to this GitHub issue page. Clicking it creates a ticket in our tracker at ${TRACKER} (a different site; its Create issue form has Summary, Description and Labels fields and a Create button, then it shows the new ticket page) with the issue title as the summary and the issue body plus a link back to the issue as the description, and labels copied from the issue. Show a link to the new ticket next to the button.`);
  const t0 = Date.now();
  await panel.click('#gen-btn');
  const card = panel.locator('[data-testid="approval-card"]').first();
  await card.locator('h3').waitFor({ timeout: 300_000 });
  out.genSeconds = Math.round((Date.now() - t0) / 1000);
  out.card = (await card.innerText()).split('\n').filter(Boolean).slice(0, 20).join(' | ');
  log(`generated in ${out.genSeconds}s:`, out.card);
  const [w] = await sw.evaluate('chrome.storage.local.get("wwa_widgets").then(r => r.wwa_widgets)');
  out.widget = { name: w.name, matchPatterns: w.matchPatterns, grants: w.grants, traceId: w.traceId, parts: (w.parts ?? []).map(p => ({ role: p.role, matchPatterns: p.matchPatterns, entryUrl: p.entryUrl, handlers: p.handlers, codeChars: p.code.length })), consequentialActions: w.consequentialActions };
  log('bundle:', JSON.stringify(out.widget));
  await card.locator('[data-testid="approve"]').click();
  await page.goto(ISSUES(102));
  await page.bringToFront();
  const btn = page.locator('[id^="wwa-"] button, [id^="wwa-"]').filter({ hasText: /ticket/i }).first();
  await btn.waitFor({ timeout: 20_000 });
  const t1 = Date.now();
  await btn.click();
  let tickets = [];
  for (let i = 0; i < 120; i++) {
    tickets = (await (await api.get('/fixture-tracker-api/__state')).json()).tickets;
    const runs = await sw.evaluate('globalThis.__wwaFlow.store.list()');
    if (runs[0] && ['succeeded', 'failed', 'cancelled'].includes(runs[0].status)) { out.run = runs[0]; break; }
    await page.waitForTimeout(1000);
  }
  out.flowSeconds = Math.round((Date.now() - t1) / 1000);
  out.tickets = tickets;
  out.homeText = await page.evaluate(`[...document.querySelectorAll('[id^="wwa-"]')].map(h => (h.shadowRoot ? h.shadowRoot.textContent : h.textContent)).join(' | ').replace(/\\s+/g, ' ').slice(0, 300)`);
  out.homeLinks = await page.evaluate(`[...document.querySelectorAll('[id^="wwa-"] a')].map(a => a.href)`);
  log('run:', out.run && out.run.status, out.run && out.run.error, 'events:', out.run && out.run.events.map(e => e.event).join(' → '));
  log('tickets:', JSON.stringify(tickets.map(t => ({ key: t.key, summary: t.summary, labels: t.labels, desc: t.description.slice(0, 80) }))));
  log('home widget text:', out.homeText, 'links:', out.homeLinks);
  out.pass = out.run?.status === 'succeeded' && tickets.some(t => t.summary === 'Crash when exporting a report with an empty date range') && out.homeLinks.some(h => h.includes('localhost'));
  log('PASS', out.pass);
  out.code = { home: w.code, parts: (w.parts ?? []).map(p => p.code) };
} finally {
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  await context.close();
  await api.dispose();
}
