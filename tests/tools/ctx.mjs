import { launchWithExtension, FIXTURE_URL } from './helpers.ts';
const { context, sw } = await launchWithExtension();
const page = await context.newPage();
await page.goto(FIXTURE_URL);
await page.waitForSelector('.msg-row');
const ctx = await sw.evaluate(async (url) => {
  const [tab] = await chrome.tabs.query({ url });
  return chrome.tabs.sendMessage(tab.id, { type: 'WWA_GET_CONTEXT' });
}, FIXTURE_URL);
console.log('landmarks:', ctx.landmarks.length, 'interactive:', ctx.interactive.length, 'candidates:', ctx.insertionCandidates.length);
for (const l of ctx.landmarks) console.log('LM', JSON.stringify({t:l.tag,id:l.id,c:l.classes,r:l.role,a:l.ariaLabel,tx:l.text?.slice(0,60)}));
for (const l of ctx.interactive) console.log('INT', JSON.stringify({t:l.tag,a:l.ariaLabel,tx:l.text?.slice(0,50)}));
for (const l of ctx.insertionCandidates) console.log('INS', JSON.stringify({t:l.tag,id:l.id,c:l.classes,r:l.role}));
await context.close();
