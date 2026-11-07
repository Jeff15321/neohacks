// E7 (Phase F): are timers / rAF throttled in a BACKGROUND tab (what a sink part with activate:false would see)?
// Playwright launches Chromium with --disable-background-timer-throttling / --disable-renderer-backgrounding /
// --disable-backgrounding-occluded-windows by default, which hides the effect (flow.spec.ts measures ~equal timings).
// This tool drops those flags and measures a sink-style loop (40 × setTimeout 50 ms, then rAF for 400 ms) on the tracker
// fixture in a background vs foreground tab. User-script worlds share the renderer's timers, so this is representative.
// RESULT (Phase F, 2026-11-07): INCONCLUSIVE — even without those flags Playwright's focus emulation keeps every page
// `visibilityState:'visible'` (headed + headless), so no throttling is observable. A real measurement needs a manual run
// in a normal Chrome profile (two tabs, DevTools console). See docs/phases/F.md E7.
//   (needs any backend serving fixtures on E2E_PORT)  cd tests/tools && E2E_PORT=8806 HEADED=1 npx tsx e7-background.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';

const PORT = Number(process.env.E2E_PORT ?? 8787);
const URL_T = `http://localhost:${PORT}/fixture-tracker/index.html`;
const HEADED = process.env.HEADED === '1';
const LOOP = `new Promise((resolve) => { const t0 = performance.now(); let n = 0;
  const tick = () => { if (++n >= 40) { let raf = 0; const r0 = performance.now(); const f = () => { raf++; requestAnimationFrame(f); }; requestAnimationFrame(f);
    setTimeout(() => resolve({ timersMs: Math.round(r0 - t0), rafIn400ms: raf, hidden: document.hidden, vis: document.visibilityState }), 400); return; }
    setTimeout(tick, 50); }; tick(); })`;
const browser = await chromium.launch({
  channel: 'chromium', headless: !HEADED,
  ignoreDefaultArgs: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
});
const ctx = await browser.newContext();
const out = { headed: HEADED, expectedTimersMs: 2000 };
try {
  const fg = await ctx.newPage();
  await fg.goto(URL_T);
  const bg = await ctx.newPage();
  await bg.goto(URL_T);
  await fg.bringToFront();
  await fg.waitForTimeout(1500);
  out.background = await bg.evaluate(LOOP);
  out.backgroundAfter12s = await (async () => { await fg.waitForTimeout(12_000); return bg.evaluate(LOOP); })();
  await bg.bringToFront();
  await bg.waitForTimeout(300);
  out.foreground = await bg.evaluate(LOOP);
  console.log('[e7]', JSON.stringify(out));
  if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(out, null, 1));
} finally { await browser.close(); }
