import { launchWithExtension, FIXTURE_URL, EXT_ID } from '../e2e/helpers.ts';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const DIR = path.dirname(fileURLToPath(import.meta.url));

// minimal backend stub? backend should already be running from playwright run? check
try { await fetch('http://127.0.0.1:8787/health').then(r=>r.json()).then(j=>console.log('backend:',JSON.stringify(j))); }
catch { console.log('backend DOWN — start it first'); process.exit(1); }

const { context, sw } = await launchWithExtension();
const page = await context.newPage();
page.on('console', m => console.log('[page]', m.type(), m.text().slice(0,300)));
await page.goto(FIXTURE_URL);
await page.waitForSelector('.msg-row');

const panel = await context.newPage();
panel.on('console', m => console.log('[panel]', m.type(), m.text().slice(0,300)));
await panel.goto(`chrome-extension://${EXT_ID}/sidepanel.html`);
await panel.waitForSelector('#req');
await panel.fill('#req', 'Add a button that drafts replies to unread emails');
await panel.click('#gen-btn');
await panel.waitForSelector('.card h3', { timeout: 30000 });
console.log('generated ok');
const r = await panel.evaluate(async () => {
  const btn = [...document.querySelectorAll('button.primary')].find(b => /Approve/.test(b.textContent));
  btn.click();
  await new Promise(r => setTimeout(r, 3000));
  return document.body.innerText.slice(0, 800);
});
console.log('panel after run:', r);
console.log('sw check widgets:', await sw.evaluate(() => 'sw alive'));
await page.waitForTimeout(2000);
console.log('wwa elements:', await page.locator('[id^="wwa-"]').count());
await context.close();
