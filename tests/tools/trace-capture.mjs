// Capture labeled-trace inputs: run scripted scenarios on the fixtures with recording on, export the Step log
// (same payload as the Inspector "Export trace" button) to tests/traces/<scenario>.capture.json.
// Any backend works (only Tier-1 runs during capture; the recording is discarded, not interpreted):
//   cd tests/tools && E2E_PORT=8802 PW_PROFILE=/tmp/nx-b-cap [ONLY=gmail2-reply] npx tsx trace-capture.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchWithExtension, openPanel, G2_URL, YT_URL } from '../e2e/helpers.ts';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(DIR, '../traces');
const msg = (panel, m) => panel.evaluate(`chrome.runtime.sendMessage(${JSON.stringify(m)})`);

const SCENARIOS = {
  /** Demo 1: open unread → Reply → type (autosave "Draft saved"). */
  'gmail2-reply': async (page) => {
    await page.goto(G2_URL); await page.waitForSelector('tr.zA.zE');
    return async () => {
      await page.click('tr.zA.zE >> nth=0'); await page.waitForSelector('.a3s');
      await page.click('[aria-label="Reply"]'); await page.waitForSelector('[aria-label="Message Body"]');
      await page.keyboard.type('Thanks Priya, I will review the checklist by Friday.', { delay: 5 });
      await page.waitForSelector('#toast:not([hidden])'); await page.waitForTimeout(2300);
    };
  },
  /** Same task with noise: a detour to Drafts and back before replying, and a stray click on the read newsletter. */
  'gmail2-reply-noisy': async (page) => {
    await page.goto(G2_URL); await page.waitForSelector('tr.zA.zE');
    return async () => {
      await page.click('#drafts-nav'); await page.waitForSelector('.dl', { state: 'attached' });
      await page.click('[aria-label="Back to Inbox"]'); await page.waitForSelector('tr.zA');
      await page.click('tr.zA:not(.zE)'); await page.waitForSelector('.a3s');
      await page.click('[aria-label="Back to Inbox"]'); await page.waitForSelector('tr.zA.zE');
      await page.click('tr.zA.zE >> nth=0'); await page.waitForSelector('.a3s');
      await page.click('[aria-label="Reply"]'); await page.waitForSelector('[aria-label="Message Body"]');
      await page.keyboard.type('Sounds good, see you Saturday at 7!', { delay: 5 });
      await page.waitForSelector('#toast:not([hidden])'); await page.waitForTimeout(2300);
    };
  },
  /** Browsing only (no task): read two emails and go back. */
  'gmail2-browse': async (page) => {
    await page.goto(G2_URL); await page.waitForSelector('tr.zA.zE');
    return async () => {
      for (const sel of ['tr.zA.zE >> nth=0', 'tr.zA:not(.zE) >> nth=0']) {
        await page.click(sel); await page.waitForSelector('.a3s'); await page.waitForTimeout(600);
        await page.click('[aria-label="Back to Inbox"]'); await page.waitForSelector('tr.zA'); await page.waitForTimeout(500);
      }
    };
  },
  /** YouTube fixture: scroll to comments, expand/like interactions (whatever is clickable), copy a comment. */
  'youtube-read': async (page) => {
    await page.goto(YT_URL); await page.waitForTimeout(800);
    return async () => {
      const clickable = page.locator('button, [role="button"], a').first();
      if (await clickable.count()) { await clickable.click().catch(() => {}); await page.waitForTimeout(700); }
      await page.evaluate(`(() => { const t = [...document.querySelectorAll('#content-text, .comment, p, span')].find(e => (e.textContent||'').trim().length > 20); if (!t) return; const r = document.createRange(); r.selectNodeContents(t); const s = getSelection(); s.removeAllRanges(); s.addRange(r); })()`);
      await page.keyboard.press('ControlOrMeta+C'); await page.waitForTimeout(700);
    };
  },
};

const only = process.env.ONLY?.split(',');
fs.mkdirSync(OUT, { recursive: true });
for (const [name, setup] of Object.entries(SCENARIOS)) {
  if (only && !only.includes(name)) continue;
  const { context } = await launchWithExtension();
  try {
    const page = await context.newPage();
    const act = await setup(page);
    const panel = await openPanel(context);
    await msg(panel, { type: 'REC_START' });
    await page.waitForSelector('#wwa-rec-pill', { state: 'attached' });
    await act();
    await msg(panel, { type: 'REC_DISCARD' }); // flushes Steps without running the interpreter; export falls back to the Step store
    await page.waitForTimeout(500);
    await panel.click('[data-testid="tab-inspector"]');
    const [dl] = await Promise.all([panel.waitForEvent('download'), panel.click('[data-testid="export-trace"]')]);
    const trace = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
    trace.name = name;
    delete trace.spec; delete trace.semantic; // mock outputs are not ground truth
    fs.writeFileSync(path.join(OUT, `${name}.capture.json`), JSON.stringify(trace, null, 1));
    console.log(`[trace] ${name}: ${trace.steps.length} steps → ${trace.steps.map(s => `${s.seq}:${s.action.kind}`).join(' ')}`);
  } finally { await context.close(); }
}
