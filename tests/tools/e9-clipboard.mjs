// E9: can copy/paste handlers read selection + clipboard text in the ISOLATED world on a contenteditable-heavy page?
// Records on HardMail: select the email body → Ctrl/Cmd+C → Reply → Ctrl/Cmd+V into the contenteditable composer.
// Checks: copy Step has a redacted preview + valueHash; paste Step's valueHash equals the copy's (lineage edge).
//   cd tests/tools && E2E_PORT=8802 PW_PROFILE=/tmp/nx-b-e9 npx tsx e9-clipboard.mjs
import { launchWithExtension, openPanel, G2_URL } from '../e2e/helpers.ts';
import { lineageEdges } from '../../packages/core/src/lineage.ts';

const msg = (panel, m) => panel.evaluate(`chrome.runtime.sendMessage(${JSON.stringify(m)})`);
const { context } = await launchWithExtension();
const out = { headless: process.env.HEADED !== '1' };
try {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(G2_URL).origin });
  const page = await context.newPage();
  await page.goto(G2_URL);
  await page.waitForSelector('tr.zA.zE');
  const panel = await openPanel(context);
  await page.bringToFront();
  await msg(panel, { type: 'REC_START' });
  await page.waitForSelector('#wwa-rec-pill', { state: 'attached' });
  await page.click('tr.zA.zE >> nth=0');
  await page.waitForSelector('.a3s');
  await page.evaluate(`(() => { const r = document.createRange(); r.selectNodeContents(document.querySelector('.a3s')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); })()`);
  await page.keyboard.press('ControlOrMeta+C');
  await page.waitForTimeout(600);
  await page.click('[aria-label="Reply"]');
  await page.waitForSelector('[aria-label="Message Body"]');
  await page.keyboard.press('ControlOrMeta+V');
  await page.waitForTimeout(2500);
  out.composerText = (await page.locator('[aria-label="Message Body"]').innerText()).slice(0, 60);
  const rec = await msg(panel, { type: 'REC_GET' });
  await msg(panel, { type: 'REC_DISCARD' });
  const steps = rec.steps ?? [];
  out.steps = steps.map(s => ({ seq: s.seq, kind: s.action.kind, preview: s.action.valuePreview?.slice(0, 50), hash: s.action.valueHash }));
  const copy = steps.find(s => s.action.kind === 'copy');
  const paste = steps.find(s => s.action.kind === 'paste');
  out.copyRead = !!copy?.action.valuePreview && !!copy?.action.valueHash;
  out.pasteRead = !!paste?.action.valueHash;
  out.lineage = lineageEdges(steps);
  out.result = out.copyRead && out.pasteRead && out.lineage.length > 0 ? 'POSITIVE' : 'PARTIAL/NEGATIVE';
} finally {
  console.log('[E9]', JSON.stringify(out, null, 1));
  await context.close();
}
