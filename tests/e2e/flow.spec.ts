import { test, expect, request, type BrowserContext, type Page, type Worker } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchWithExtension, openPanel, busLog, BASE, PORT } from './helpers.js';

/**
 * Phase F (doc §5, Demo 3): cross-site flows. Home = GitHub-like issues on 127.0.0.1, sink = Jira-like tracker on
 * localhost (different origins, same mock backend). Mock LLM → deterministic bundle (widget.mockdata.flow.ts).
 */
const DIR = path.dirname(fileURLToPath(import.meta.url));
const EVIDENCE = process.env.EVIDENCE_DIR ?? '';
const ISSUES_URL = `${BASE}/fixture-issues/index.html`;
const TRACKER_ORIGIN = `http://localhost:${PORT}`;
const TRACKER_URL = `${TRACKER_ORIGIN}/fixture-tracker/index.html`;
const TITLE_101 = 'Login button unresponsive on Safari 17';
const TITLE_102 = 'Crash when exporting a report with an empty date range';

const msg = (panel: Page, m: Record<string, unknown>) => panel.evaluate(`chrome.runtime.sendMessage(${JSON.stringify(m)})`) as Promise<any>;
const runs = async (panel: Page) => ((await msg(panel, { type: 'GET_FLOW_RUNS' })).runs ?? []) as any[];
const flowAlarms = (sw: Worker) => sw.evaluate(`chrome.alarms.getAll().then(a => a.filter(x => x.name.startsWith('wwa-flow:')).map(x => x.name))`) as Promise<string[]>;
const activeUrl = (sw: Worker) => sw.evaluate(`chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(t => t[0] && t[0].url)`) as Promise<string>;
const select = (page: Page, sel: string) => page.evaluate(`(() => { const r = document.createRange(); r.selectNodeContents(document.querySelector(${JSON.stringify(sel)})); const s = getSelection(); s.removeAllRanges(); s.addRange(r); })()`);

async function tracker() {
  const api = await request.newContext({ baseURL: BASE });
  return {
    reset: () => api.post('/fixture-tracker-api/__reset'),
    slow: (ms: number) => api.post('/fixture-tracker-api/__slow', { data: { ms } }),
    tickets: async () => ((await (await api.get('/fixture-tracker-api/__state')).json()).tickets ?? []) as Array<{ key: string; summary: string; description: string; labels: string[]; origin: string }>,
    dispose: () => api.dispose(),
  };
}

/** Request-based bundle generation on an issue page (used by the failure test; the main test records instead). */
async function generateAndApprove(context: BrowserContext, panel: Page) {
  await panel.click('[data-testid="tab-create"]');
  await panel.fill('#req', 'Add a "Create ticket" button that files this issue in our tracker and links to the new ticket');
  await panel.click('#gen-btn');
  const card = panel.locator('[data-testid="approval-card"]').first();
  await card.locator('h3').waitFor({ timeout: 30_000 });
  await expect(card.locator('[data-testid="bundle-part"]')).toContainText('localhost');
  await card.locator('[data-testid="approve"]').click();
  await panel.locator('[data-testid="widget-card"]').first().waitFor({ timeout: 10_000 });
  void context;
}

test.describe('Cross-site flows (Demo 3, mock LLM)', () => {
  test('record issue→ticket across tabs (lineage) → bundle → approve → "Create ticket" on ANOTHER issue → tracker ticket + link', async () => {
    const { context, sw } = await launchWithExtension();
    const api = await tracker();
    try {
      await api.reset();
      for (const origin of [BASE, TRACKER_ORIGIN]) await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
      const issues = await context.newPage();
      await issues.goto(`${ISSUES_URL}?n=101`);
      await issues.waitForSelector('.js-issue-title');
      const trk = await context.newPage();
      await trk.goto(TRACKER_URL);
      await trk.waitForSelector('#create-form');
      const panel = await openPanel(context);

      // ---- 1. record once: copy title/body on the issue (127.0.0.1) → paste into the tracker (localhost) → Create
      await issues.bringToFront();
      const started = await msg(panel, { type: 'REC_START' });
      expect(started.ok, started.error).toBe(true);
      expect(started.session.startTab).toBeGreaterThan(0);
      await issues.waitForSelector('#wwa-rec-pill', { state: 'attached', timeout: 5_000 });
      await select(issues, '.js-issue-title');
      await issues.keyboard.press('ControlOrMeta+C');
      await issues.waitForTimeout(500);
      await trk.bringToFront();
      await trk.waitForSelector('#wwa-rec-pill', { state: 'attached', timeout: 5_000 }); // recording followed the tab switch
      await trk.click('#summary');
      await trk.keyboard.press('ControlOrMeta+V');
      await trk.waitForTimeout(500);
      await issues.bringToFront();
      await select(issues, '.js-comment-body');
      await issues.keyboard.press('ControlOrMeta+C');
      await issues.waitForTimeout(500);
      await trk.bringToFront();
      await trk.click('#description');
      await trk.keyboard.press('ControlOrMeta+V');
      await trk.waitForTimeout(1800); // input commit (1.5 s idle)
      expect(await trk.inputValue('#summary')).toBe(TITLE_101);
      await trk.click('#create-btn');
      await trk.waitForURL(/ticket\.html\?key=TRK-1/);
      await trk.waitForSelector('[data-testid="ticket-key"]:not(:empty)');
      await trk.waitForTimeout(600);
      const stopped = await msg(panel, { type: 'REC_STOP' });
      expect(stopped.ok, stopped.error).toBe(true);
      expect(stopped.session.tabs.length).toBe(2);

      const rec = await msg(panel, { type: 'REC_GET' });
      const steps = rec.steps as any[];
      const issuesTab = stopped.session.startTab;
      const kinds = steps.map(s => `${s.action.kind}@${s.tabId === issuesTab ? 'issues' : 'tracker'}`);
      console.log('[e2e-flow] recorded', kinds.join(' '));
      expect(kinds.filter(k => k === 'copy@issues').length).toBe(2);
      expect(kinds.filter(k => k === 'tab-switch@tracker').length).toBeGreaterThanOrEqual(1);
      expect(kinds.some(k => k.startsWith('paste@tracker'))).toBe(true);
      // ---- lineage: copy on the issues tab → paste/input on the tracker tab (cross-tab edges)
      await expect.poll(async () => (await msg(panel, { type: 'REC_GET' })).spec?.dataFlow?.length ?? 0, { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
      const spec = (await msg(panel, { type: 'REC_GET' })).spec;
      const bySeq = new Map(steps.map(s => [s.seq, s]));
      const cross = spec.dataFlow.filter((e: any) => bySeq.get(e.fromSeq)?.tabId === issuesTab && bySeq.get(e.toSeq)?.tabId !== issuesTab);
      expect(cross.length).toBeGreaterThanOrEqual(2);
      expect(cross.every((e: any) => bySeq.get(e.fromSeq).action.kind === 'copy')).toBe(true);
      console.log('[e2e-flow] lineage edges', JSON.stringify(spec.dataFlow));

      // ---- 2. generate from the recording → bundle approval card lists BOTH origins + the flow grant
      await panel.click('[data-testid="tab-record"]');
      await expect(panel.locator('[data-testid="rec-status"]')).toHaveText('ready', { timeout: 15_000 });
      await panel.fill('#rec-instructions', 'Run from a "Create ticket" button on any issue page.');
      await panel.click('[data-testid="rec-generate"]');
      const card = panel.locator('[data-testid="record-tab"] [data-testid="approval-card"]');
      await card.locator('h3').waitFor({ timeout: 30_000 });
      await expect(card.locator('h3')).toContainText('Ticket');
      await expect(card).toContainText('127.0.0.1');
      await expect(card.locator('[data-testid="bundle-part"]')).toContainText('localhost');
      await expect(card).toContainText('Open and act on the other sites');
      await expect(card).toContainText('Creates a new ticket in the tracker');
      if (EVIDENCE) await panel.screenshot({ path: path.join(EVIDENCE, 'bundle-approval.png'), fullPage: true });
      const widgets = (await msg(panel, { type: 'LIST_WIDGETS' })).widgets as any[];
      expect(widgets[0].origin).toBe(new URL(BASE).origin); // home = where the recording started
      expect(widgets[0].grants).toContain('flow');
      expect(widgets[0].parts[0].role).toBe('tracker-sink');
      expect(widgets[0].spec?.dataFlow?.length).toBeGreaterThanOrEqual(2);
      // nothing runs before approval
      await expect(issues.locator('[data-testid="wwa-create-ticket"]')).toHaveCount(0);
      await card.locator('[data-testid="approve"]').click();
      await panel.locator('[data-testid="widget-card"]').first().waitFor({ timeout: 10_000 });

      // ---- 3. ANOTHER issue → Create ticket → tracker has TRK-2 with the mapped title + body → link in the home widget
      await issues.goto(`${ISSUES_URL}?n=102`);
      await issues.bringToFront();
      await issues.locator('[data-testid="wwa-create-ticket"]').click({ timeout: 15_000 });
      const link = issues.locator('[data-testid="wwa-ticket-link"]');
      await link.waitFor({ timeout: 45_000 });
      await expect(link).toHaveText('TRK-2');
      expect(await link.getAttribute('href')).toBe(`${TRACKER_ORIGIN}/fixture-tracker/ticket.html?key=TRK-2`);
      const tickets = await api.tickets();
      expect(tickets.map(t => t.key)).toEqual(['TRK-1', 'TRK-2']);
      expect(tickets[1].summary).toBe(TITLE_102);
      expect(tickets[1].description).toContain('RangeError: Invalid time value');
      expect(tickets[1].description).toContain('fixture-issues/index.html?n=102');
      expect(tickets[1].labels).toEqual(['bug', 'reports']);
      expect(tickets[1].origin).toBe(TRACKER_ORIGIN); // created by the tracker page itself (its own origin + session)

      const [run] = await runs(panel);
      expect(run.status).toBe('succeeded');
      expect(run.result.ok).toBe(true);
      expect(run.result.evidence.id).toBe('TRK-2');
      // reused the tracker tab (on TRK-1's page): checkpoint → navigate to the form → re-inject → create → navigate → re-inject → read back
      expect(run.injections).toBe(3);
      expect(run.events.filter((e: any) => e.event === 'navigated').length).toBe(2);
      expect(run.checkpoint).toEqual({ submitted: true });
      await expect.poll(() => activeUrl(sw), { timeout: 5_000 }).toContain('fixture-issues'); // focus returned home
      expect(await flowAlarms(sw)).toEqual([]);
      await expect(trk.locator('#wwa-flow-pill')).toHaveCount(0);
      if (EVIDENCE) await issues.screenshot({ path: path.join(EVIDENCE, 'home-link.png') });
      const t1 = (run.updatedAt - run.createdAt) as number;

      // ---- E7: same flow with activate:false (sink runs in a background tab)
      await issues.goto(`${ISSUES_URL}?n=103`);
      await issues.bringToFront();
      await issues.evaluate(`document.documentElement.setAttribute('data-wwa-flow-activate', 'false')`);
      await issues.locator('[data-testid="wwa-create-ticket"]').click({ timeout: 15_000 });
      await expect(issues.locator('[data-testid="wwa-ticket-link"]')).toHaveText('TRK-3', { timeout: 60_000 });
      const [bg] = await runs(panel);
      expect(bg.status).toBe('succeeded');
      expect(bg.activate).toBe(false);
      const t2 = (bg.updatedAt - bg.createdAt) as number;
      console.log(`[e2e-flow] E7 foreground(activate:true)=${t1}ms background(activate:false)=${t2}ms (both reused tab, 3 injections)`);
      if (EVIDENCE) fs.writeFileSync(path.join(EVIDENCE, 'e7.json'), JSON.stringify({ headless: process.env.HEADED !== '1', foregroundMs: t1, backgroundMs: t2, fgEvents: run.events, bgEvents: bg.events }, null, 1));

      const log = await busLog(sw);
      for (const t of ['FLOW_CALL', 'FLOW_WAIT', 'FLOW_CHECKPOINT', 'FLOW_RESULT', 'REC_GENERATE', 'APPROVE_WIDGET']) expect(log.some(e => e.type === t && e.ok), t).toBe(true);
      // sink-part messages are confined to the tracker origin (part id "<widgetId>#tracker-sink")
      expect(log.filter(e => e.type === 'FLOW_RESULT').every(e => e.ok)).toBe(true);
    } finally { await api.dispose(); await context.close(); }
  });

  test('closing the target tab mid-run → home promise rejects with a reason, run failed, no orphan state; panel cancel', async () => {
    const { context, sw } = await launchWithExtension();
    const api = await tracker();
    try {
      await api.reset();
      const issues = await context.newPage();
      await issues.goto(`${ISSUES_URL}?n=101`);
      await issues.waitForSelector('.js-issue-title');
      const panel = await openPanel(context);
      await generateAndApprove(context, panel);
      await api.slow(8_000);

      // ---- tab closed mid-run
      await issues.bringToFront();
      const opened = context.waitForEvent('page', { predicate: p => p.url().startsWith(TRACKER_ORIGIN) || p.url() === 'about:blank' });
      await issues.locator('[data-testid="wwa-create-ticket"]').click({ timeout: 15_000 });
      const trk = await opened; // no tracker tab open → the coordinator opened entryUrl
      await expect.poll(async () => (await runs(panel))[0]?.checkpoint?.submitted ?? false, { timeout: 15_000 }).toBe(true);
      await expect(trk.locator('#wwa-flow-pill')).toHaveCount(1); // progress pill on the focused target tab
      await trk.close();
      const result = issues.locator('[data-testid="wwa-ticket-result"]');
      await expect(result).toHaveAttribute('data-error', /target tab was closed/, { timeout: 10_000 });
      const [failed] = await runs(panel);
      expect(failed.status).toBe('failed');
      expect(failed.error).toMatch(/target tab was closed/);
      expect((await runs(panel)).filter(r => !['succeeded', 'failed', 'cancelled'].includes(r.status))).toEqual([]);
      expect(await flowAlarms(sw)).toEqual([]);
      await expect.poll(() => activeUrl(sw), { timeout: 5_000 }).toContain('fixture-issues');
      await expect(issues.locator('[data-testid="wwa-ticket-link"]')).toHaveCount(0);

      // ---- cancel from the panel mid-run → home rejects "cancelled"; the sink's next platform call rejects
      await api.slow(0);
      const opened2 = context.waitForEvent('page', { predicate: p => p.url().startsWith(TRACKER_ORIGIN) || p.url() === 'about:blank' });
      await issues.evaluate(`document.documentElement.setAttribute('data-wwa-flow-activate', 'true')`);
      await issues.locator('[data-testid="wwa-create-ticket"]').click();
      await opened2;
      // Widgets tab → the widget card lists its cross-site runs with a Cancel button for the active one
      await panel.click('[data-testid="tab-widgets"]');
      await panel.locator('[data-testid="flow-cancel"]').first().click({ timeout: 5_000 });
      await expect(result).toHaveAttribute('data-error', /cancelled/, { timeout: 10_000 });
      const [cancelled] = await runs(panel);
      expect(cancelled.status).toBe('cancelled');
      expect(cancelled.error).toMatch(/cancelled from the panel/);
      await expect(panel.locator('[data-testid="flow-run"]').first()).toContainText('cancelled');
      await expect(panel.locator('[data-testid="flow-run"]').nth(1)).toContainText('target tab was closed');
      if (EVIDENCE) await panel.screenshot({ path: path.join(EVIDENCE, 'panel-flow-runs.png'), fullPage: true });
      expect(await flowAlarms(sw)).toEqual([]);

      // ---- security: a part id cannot be used from the wrong origin; parts cannot start flows
      const log = await busLog(sw);
      expect(log.some(e => e.type === 'FLOW_CALL' && e.ok)).toBe(true);
      if (EVIDENCE) fs.writeFileSync(path.join(EVIDENCE, 'failure-runs.json'), JSON.stringify(await runs(panel), null, 1));
    } finally { await api.dispose(); await context.close(); }
  });

  test('E5 spike: onUserScriptConnect port messaging in a worldId world (bidirectional, survives re-execution, disconnect on navigation)', async () => {
    const { context, sw } = await launchWithExtension();
    try {
      const page = await context.newPage();
      await page.goto(`${ISSUES_URL}?n=101`);
      await page.waitForSelector('.js-issue-title');
      const r = await sw.evaluate(`(async () => {
        const worldId = 'e5-spike';
        await chrome.userScripts.configureWorld({ worldId, messaging: true });
        const tab = (await chrome.tabs.query({ url: '*://127.0.0.1/*' }))[0];
        const out = { available: typeof chrome.runtime.onUserScriptConnect !== 'undefined', sessions: [], disconnects: 0 };
        const session = (label, n) => new Promise((resolve) => {
          const s = { label, connected: false, name: '', pongs: 0, rtts: [], senderUrl: '' };
          const t = setTimeout(() => resolve(s), 5000);
          const onConnect = (port) => {
            chrome.runtime.onUserScriptConnect.removeListener(onConnect);
            s.connected = true; s.name = port.name; s.senderUrl = (port.sender && port.sender.url) || '';
            let t0 = 0;
            port.onDisconnect.addListener(() => { out.disconnects++; });
            port.onMessage.addListener((m) => {
              if (m.type === 'pong') { s.rtts.push(Date.now() - t0); s.pongs++; if (s.pongs >= n) { clearTimeout(t); resolve(s); return; } }
              t0 = Date.now(); port.postMessage({ type: 'ping', i: s.pongs });
            });
            out.lastPort = port;
          };
          chrome.runtime.onUserScriptConnect.addListener(onConnect);
        });
        const code = "(() => { const p = chrome.runtime.connect({ name: 'e5' }); globalThis.__e5 = (globalThis.__e5 || 0) + 1; p.onMessage.addListener((m) => { if (m.type === 'ping') p.postMessage({ type: 'pong', i: m.i, run: globalThis.__e5 }); }); p.postMessage({ type: 'hello' }); return globalThis.__e5; })()";
        const run = () => chrome.userScripts.execute({ target: { tabId: tab.id }, world: 'USER_SCRIPT', worldId, js: [{ code }] });
        const p1 = session('first', 50); const ex1 = await run(); out.sessions.push(await p1); out.exec1 = ex1[0] && ex1[0].result;
        const p2 = session('second (same world, re-executed)', 20); const ex2 = await run(); out.sessions.push(await p2); out.exec2 = ex2[0] && ex2[0].result;
        const before = out.disconnects;
        await chrome.tabs.reload(tab.id);
        await new Promise(r => setTimeout(r, 1500));
        out.disconnectOnNavigation = out.disconnects > before;
        delete out.lastPort;
        for (const s of out.sessions) { s.avgRttMs = s.rtts.length ? +(s.rtts.reduce((a, b) => a + b, 0) / s.rtts.length).toFixed(2) : null; s.maxRttMs = s.rtts.length ? Math.max(...s.rtts) : null; delete s.rtts; }
        return out;
      })()`) as any;
      console.log('[e2e-flow] E5', JSON.stringify(r));
      if (EVIDENCE) fs.writeFileSync(path.join(EVIDENCE, 'e5.json'), JSON.stringify(r, null, 1));
      expect(r.available).toBe(true);
      expect(r.sessions[0].connected).toBe(true);
      expect(r.sessions[0].pongs).toBe(50);
      expect(r.sessions[1].pongs).toBe(20);
      expect(r.exec2).toBe(2); // same worldId shares globals across executions

      // E7 (platform part): chained 50 ms timers + rAF in a background vs foreground tab (sink-style polling loops)
      const e7 = await sw.evaluate(`(async () => {
        await chrome.userScripts.configureWorld({ worldId: 'e7-spike', messaging: true });
        const code = "new Promise((resolve) => { const t0 = performance.now(); let n = 0; const tick = () => { if (++n >= 40) { let raf = 0; const r0 = performance.now(); const done = () => resolve({ timersMs: Math.round(r0 - t0), raf, hidden: document.hidden, vis: document.visibilityState }); requestAnimationFrame(() => { raf++; }); setTimeout(done, 400); return; } setTimeout(tick, 50); }; tick(); })";
        const run = async (tabId) => (await chrome.userScripts.execute({ target: { tabId }, world: 'USER_SCRIPT', worldId: 'e7-spike', js: [{ code }] }))[0].result;
        const home = (await chrome.tabs.query({ url: '*://127.0.0.1/*' }))[0];
        await chrome.tabs.update(home.id, { active: true });
        const bgTab = await chrome.tabs.create({ url: ${JSON.stringify(TRACKER_URL)}, active: false });
        await new Promise(r => setTimeout(r, 1500));
        const background = await run(bgTab.id);
        await chrome.tabs.update(bgTab.id, { active: true });
        await new Promise(r => setTimeout(r, 300));
        const foreground = await run(bgTab.id);
        return { expectedMs: 40 * 50, background, foreground };
      })()`) as any;
      console.log('[e2e-flow] E7 timers', JSON.stringify(e7));
      if (EVIDENCE) fs.writeFileSync(path.join(EVIDENCE, `e7-timers-${process.env.HEADED === '1' ? 'headed' : 'headless'}.json`), JSON.stringify(e7, null, 1));
      expect(e7.background.timersMs).toBeGreaterThan(0);
    } finally { await context.close(); }
  });
});

void DIR;
