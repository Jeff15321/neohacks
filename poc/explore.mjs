import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const DIR = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.join(DIR, 'extension');
const EXT_ID = fs.readFileSync(path.join(DIR, 'extid.txt'), 'utf8').trim();
const PROFILE = path.join(DIR, 'profile2');
fs.rmSync(PROFILE, { recursive: true, force: true });
const context = await chromium.launchPersistentContext(PROFILE, {
  channel: 'chromium', headless: false,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
const page = await context.newPage();
await page.goto(`chrome://extensions/?id=${EXT_ID}`);
await page.waitForTimeout(1500);
const info = await page.evaluate(() => {
  const seen = new Set(); const out = [];
  const walk = (root, depth) => {
    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot && !seen.has(el.shadowRoot)) { seen.add(el.shadowRoot); walk(el.shadowRoot, depth+1); }
      if (el.tagName === 'CR-TOGGLE') {
        // climb up to a container with meaningful text
        let p = el, txt = '';
        for (let i = 0; i < 6 && p; i++) { p = p.parentElement || p.getRootNode()?.host; if (p && p.textContent && p.textContent.trim().length > 5) { txt = p.textContent.trim().slice(0,120); if (txt.length > 15) break; } }
        out.push({ id: el.id, checked: el.hasAttribute('checked'), ctx: txt });
      }
    }
  };
  walk(document, 0);
  return out;
});
console.log(JSON.stringify(info, null, 1));
await context.close();
