// E2 (fixtures only — real Gmail/YouTube unavailable in this environment): settle timelines for ~20 clicks per site.
// Uses the Step settle diagnostics (reason, mutations, lastActivityMs = action → last significant mutation/net/url).
//   cd tests/tools && E2E_PORT=8802 PW_PROFILE=/tmp/nx-b-e2 npx tsx e2-settle.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchWithExtension, openPanel, G2_URL, NET_URL } from '../e2e/helpers.ts';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const msg = (panel, m) => panel.evaluate(`chrome.runtime.sendMessage(${JSON.stringify(m)})`);
const GAP = 1500; // > quiet window, so Steps close by themselves (not "interrupted")

const SITES = {
  gmail2: { url: G2_URL, ready: 'tr.zA', clicks: (i) => [
    'tr.zA >> nth=' + (i % 3), '[aria-label="Back to Inbox"]', '#drafts-nav', '[aria-label="Back to Inbox"]', 'tr.zA >> nth=' + ((i + 1) % 3), '[aria-label="Reply"]', '[aria-label="Back to Inbox"]',
  ] },
  netmail: { url: NET_URL, ready: 'table[role="grid"] tr', clicks: (i) => [
    'table[role="grid"] tr >> nth=' + (i % 2), '[aria-label="Back to Inbox"]', '#drafts-btn', '[aria-label="Back to Inbox"]', '#compose-btn', '#inbox-btn',
  ] },
};

const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null; };
const report = {};
const { context } = await launchWithExtension();
try {
  const panel = await openPanel(context);
  for (const [name, site] of Object.entries(SITES)) {
    const page = await context.newPage();
    await page.goto(site.url);
    await page.waitForSelector(site.ready);
    await msg(panel, { type: 'REC_START' });
    await page.waitForSelector('#wwa-rec-pill', { state: 'attached' });
    let n = 0;
    for (let round = 0; n < 20 && round < 6; round++) {
      for (const sel of site.clicks(round)) {
        if (n >= 20) break;
        const loc = page.locator(sel).first();
        if (!(await loc.count())) continue;
        await loc.click().catch(() => {});
        n++;
        await page.waitForTimeout(GAP);
      }
    }
    await page.waitForTimeout(1000);
    const rec = await msg(panel, { type: 'REC_GET' });
    await msg(panel, { type: 'REC_DISCARD' });
    const steps = (rec.steps ?? []).filter(s => s.action.kind === 'click');
    const quietAt = steps.map(s => s.settle?.lastActivityMs ?? 0);
    const reasons = steps.reduce((m, s) => ({ ...m, [s.settle?.reason ?? '?']: (m[s.settle?.reason ?? '?'] ?? 0) + 1 }), {});
    report[name] = {
      clicks: n, steps: steps.length, reasons, unsettled: steps.filter(s => !s.settled).length,
      timeToQuietMs: { p50: pct(quietAt, 0.5), p90: pct(quietAt, 0.9), max: Math.max(...quietAt) },
      stepDurationMs: { p50: pct(steps.map(s => s.tEnd - s.tStart), 0.5), p90: pct(steps.map(s => s.tEnd - s.tStart), 0.9) },
      withNet: steps.filter(s => s.effects.net.length).length,
      withRegions: steps.filter(s => s.effects.addedRegions.length).length,
      lateEffects: steps.filter(s => s.lateEffects).length,
      samples: steps.slice(0, 8).map(s => `${s.seq}:${(s.action.accessibleName ?? '').slice(0, 18)}:${s.settle?.reason}:${s.settle?.lastActivityMs}ms:net${s.effects.net.length}`),
    };
    console.log(`[E2] ${name}`, JSON.stringify(report[name]));
    await page.close();
  }
} finally {
  fs.writeFileSync(path.resolve(DIR, '../../docs/evidence/B/e2-settle.json'), JSON.stringify(report, null, 1));
  await context.close();
}
