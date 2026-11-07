// Phase D: builds the activity-model eval traces (tests/traces/act-*.capture.json + labels) — 10 repeat traces and
// 4 noise traces. gmail2-* traces are FIXTURE-DERIVED (Steps copied from the captured HardMail trace
// gmail2-reply.capture.json / gmail2-browse.capture.json, re-targeted at other emails); all others are SYNTHETIC
// (hand-written Steps in the exact Step schema, realistic effects: live-region text, mutating net calls, lineage
// hashes). Labels are written here, BEFORE seeing any model output.
//   node tests/tools/trace-synth.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const TRACES = path.resolve(DIR, '../traces');
const read = (f) => JSON.parse(fs.readFileSync(path.join(TRACES, f), 'utf8'));
const clone = (v) => JSON.parse(JSON.stringify(v));

let seq = 0; let t = 1_700_000_000_000; let n = 0;
const reset = () => { seq = 0; t = 1_700_000_000_000; n = 0; };
const step = ({ origin, path: p = '/', title, kind = 'click', name, role, tag = 'button', sel, value, key, hash, regions = [], live = [], net = [], url, urlChange, tabId = 1, gap = 2500 }) => {
  t += gap;
  const s = {
    id: `syn_${++n}`, seq: ++seq, tabId, origin, url: url ?? origin + p,
    action: {
      kind,
      ...(name || sel ? { target: { candidates: sel ? [{ kind: sel.startsWith('[aria-label') ? 'aria-label' : sel.startsWith('#') ? 'id' : 'css', selector: sel, matches: 1 }] : [], tag, ...(role ? { role } : {}), ...(name ? { accessibleName: name } : {}) } } : {}),
      ...(name ? { accessibleName: name } : {}), ...(role ? { role } : {}),
      ...(value !== undefined ? { valuePreview: value } : {}), ...(key ? { key } : {}), ...(hash ? { valueHash: hash } : {}),
    },
    effects: {
      ...(urlChange ? { urlChange } : {}), ...(title ? { titleChange: title } : {}),
      addedRegions: regions.map(([root, skeleton]) => ({ root, skeleton })), removedRegions: [],
      liveRegionText: live, net: net.map(([method, routeTemplate, status], i) => ({ opId: `op${seq}_${i}`, method, routeTemplate, status })),
      mutatingOk: net.some(([m, , s]) => m !== 'GET' && s >= 200 && s < 300),
    },
    settled: true, tStart: t, tEnd: t + 450, settle: { reason: 'quiet', mutations: regions.length + live.length, lastActivityMs: 40 },
    ...(title ? { title } : {}),
  };
  if (urlChange) s.url = urlChange;
  return s;
};

// ------------------------------------------------------------------------------------------- fixture-derived (HardMail)
const g2 = read('gmail2-reply.capture.json').steps;
const g2b = read('gmail2-browse.capture.json').steps;
const EMAILS = {
  m1: { subj: 'Q4 launch checklist', from: 'Priya Nair', name: g2[0].action.accessibleName, reply: 'Thanks Priya, I will review the checklist by Friday.' },
  m2: { subj: 'Dinner Saturday?', from: 'Devon', name: 'Nov 6 Dinner Saturday? — Hey! A few of us are doing dinner Saturday at 7', reply: 'Count me in, see you at 7!' },
  m3: { subj: 'Weekly digest', from: 'Ops Bot', name: 'Nov 4 Weekly digest — Your weekly digest: 3 new docs, 1 pending approval', reply: 'Thanks, I will look at the pending approval today.' },
};
const reseq = (s) => { t += 2500; s.seq = ++seq; s.id = `g2_${++n}`; const d = s.tEnd - s.tStart; s.tStart = t; s.tEnd = t + d; return s; };
const retarget = (s, id) => {
  const e = EMAILS[id];
  const j = JSON.stringify(s).replaceAll('m1', id).replaceAll(EMAILS.m1.name, e.name).replaceAll('Q4 launch checklist', e.subj).replaceAll('Priya Nair', e.from).replaceAll(EMAILS.m1.reply, e.reply).replace(/Thanks Priya[^"]*/g, e.reply);
  return JSON.parse(j);
};
const g2Reply = (id, { shortcut = false, expand = false } = {}) => {
  const [open, reply, type] = g2.map(clone).map(s => retarget(s, id));
  const out = [reseq(open)];
  if (expand) out.push(reseq({ ...clone(reply), action: { kind: 'click', target: { candidates: [{ kind: 'aria-label', selector: '[aria-label="Show trimmed content"]', matches: 1 }], tag: 'div', role: 'button', accessibleName: 'Show trimmed content' }, accessibleName: 'Show trimmed content', role: 'button' }, effects: { ...clone(reply.effects), addedRegions: [{ root: 'div.ajR', skeleton: 'div.ajR "On Nov 3 … wrote: (quoted text)"\n  span.ams.bkH[role=link][aria-label="Reply"] "Reply"' }] } }));
  if (shortcut) { reply.action = { kind: 'key-shortcut', key: 'r' }; }
  out.push(reseq(reply), reseq(type));
  return out;
};
const g2Back = () => reseq(clone(g2b[1]));
const g2Open = (id) => reseq(retarget(clone(g2[0]), id));

// ------------------------------------------------------------------------------------------- synthetic sites
const ISS = 'https://issues.example.test', TRK = 'https://tracker.example.test', CRM = 'https://crm.example.test';
const SHOP = 'https://shop.example.test', NEWS = 'https://news.example.test', DOCS = 'https://docs.example.test';
const EXP = 'https://expenses.example.test', ML = 'https://mail.example.test';

const issueToTicket = (num, title, hashT, hashB) => [
  step({ origin: ISS, path: '/repo/issues', title: `Issues · acme/repo`, name: `#${num} ${title}`, role: 'link', tag: 'a', sel: `a[href="/acme/repo/issues/${num}"]`, urlChange: `${ISS}/acme/repo/issues/${num}`, regions: [['div.issue', `h1.title "${title}"\n  div.body "Steps to reproduce…"`]] }),
  step({ origin: ISS, path: `/acme/repo/issues/${num}`, kind: 'copy', name: title, tag: 'h1', value: title, hash: hashT }),
  step({ origin: ISS, path: `/acme/repo/issues/${num}`, kind: 'copy', name: 'Issue body', tag: 'div', value: 'Steps to reproduce: open settings, click save…', hash: hashB }),
  step({ origin: TRK, path: '/board', kind: 'tab-switch', title: 'Board · Tracker', tabId: 2 }),
  step({ origin: TRK, path: '/board', name: 'Create', sel: '#create-button', tabId: 2, regions: [['div[role=dialog]', 'div[role=dialog][aria-label="Create issue"]\n  input[name=summary]\n  textarea[name=description]\n  button "Create"']] }),
  step({ origin: TRK, path: '/board', kind: 'paste', name: 'Summary', tag: 'input', sel: 'input[name="summary"]', value: title, hash: hashT, tabId: 2 }),
  step({ origin: TRK, path: '/board', kind: 'paste', name: 'Description', tag: 'textarea', sel: 'textarea[name="description"]', value: 'Steps to reproduce: open settings…', hash: hashB, tabId: 2 }),
  step({ origin: TRK, path: '/board', name: 'Create', sel: 'button[type="submit"]', tabId: 2, live: [`Issue TRK-${100 + num} created`], net: [['POST', '/rest/api/3/issue', 201]] }),
  step({ origin: ISS, path: `/acme/repo/issues/${num}`, kind: 'tab-switch', title: `${title} · Issue #${num}` }),
];
const crmLog = (contact, note) => [
  step({ origin: CRM, path: '/contacts', name: contact, role: 'link', tag: 'a', sel: `a[data-contact="${contact.toLowerCase().replace(/ /g, '-')}"]`, urlChange: `${CRM}/contacts/${contact.toLowerCase().replace(/ /g, '-')}`, title: `${contact} · CRM` }),
  step({ origin: CRM, path: '/contacts/x', name: 'Log activity', sel: '[aria-label="Log activity"]', regions: [['form.activity', 'form.activity\n  select[name=type] "Call"\n  textarea[name=note][aria-label="Note"]\n  button "Save"']] }),
  step({ origin: CRM, path: '/contacts/x', kind: 'input-commit', name: 'Note', tag: 'textarea', sel: 'textarea[name="note"]', value: note }),
  step({ origin: CRM, path: '/contacts/x', name: 'Save', sel: 'form.activity button[type="submit"]', live: ['Activity logged'], net: [['POST', '/api/contacts/:id/activities', 201]] }),
  step({ origin: CRM, path: '/contacts', name: 'Contacts', role: 'link', tag: 'a', sel: 'nav a[href="/contacts"]', urlChange: `${CRM}/contacts`, title: 'Contacts · CRM' }),
];
const labelBug = (num, title) => [
  step({ origin: ISS, path: '/acme/repo/issues', name: `#${num} ${title}`, role: 'link', tag: 'a', sel: `a[href="/acme/repo/issues/${num}"]`, urlChange: `${ISS}/acme/repo/issues/${num}`, title: `${title} · Issue #${num}` }),
  step({ origin: ISS, path: `/acme/repo/issues/${num}`, name: 'Labels', sel: '[aria-label="Edit labels"]', regions: [['div.label-menu', 'div.label-menu[role=menu]\n  div[role=menuitemcheckbox] "bug"\n  div[role=menuitemcheckbox] "enhancement"\n  div[role=menuitemcheckbox] "question"']] }),
  step({ origin: ISS, path: `/acme/repo/issues/${num}`, name: 'bug', role: 'menuitemcheckbox', tag: 'div', sel: 'div[role="menuitemcheckbox"][data-label="bug"]', live: ['Label "bug" added'], net: [['PATCH', '/repos/:owner/:repo/issues/:number', 200]] }),
  step({ origin: ISS, path: `/acme/repo/issues/${num}`, kind: 'key-shortcut', key: 'Escape' }),
  step({ origin: ISS, path: '/acme/repo/issues', name: 'Issues', role: 'link', tag: 'a', sel: 'a[href="/acme/repo/issues"]', urlChange: `${ISS}/acme/repo/issues`, title: 'Issues · acme/repo' }),
];
const approveExpense = (id, who, amount) => [
  step({ origin: EXP, path: '/reports', name: `${who} — ${amount}`, role: 'row', tag: 'tr', sel: `tr[data-report="${id}"]`, urlChange: `${EXP}/reports/${id}`, title: `Report ${id} · Expenses`, regions: [['section.report', `section.report\n  h2 "Report ${id} — ${who}"\n  table.items\n  button "Approve"\n  button "Reject"`]] }),
  step({ origin: EXP, path: `/reports/${id}`, name: 'Approve', sel: 'button.approve', regions: [['div[role=dialog]', 'div[role=dialog] "Approve this report?"\n  button "Confirm"']] }),
  step({ origin: EXP, path: `/reports/${id}`, name: 'Confirm', sel: 'div[role="dialog"] button.confirm', live: ['Report approved'], net: [['POST', '/api/reports/:id/approve', 200]] }),
  step({ origin: EXP, path: '/reports', name: 'Back to reports', role: 'link', tag: 'a', sel: 'a.back', urlChange: `${EXP}/reports`, title: 'Reports · Expenses' }),
];
const archiveNewsletter = (subj) => [
  step({ origin: ML, path: '/inbox', name: subj, role: 'row', tag: 'tr', sel: `tr[data-subject="${subj}"]`, title: `${subj} — Mail`, regions: [['div.message', `div.message\n  h2 "${subj}"\n  div.body "This week in…  Unsubscribe"`]] }),
  step({ origin: ML, path: '/inbox', name: 'Archive', sel: '[aria-label="Archive"]', live: ['Conversation archived'], net: [['POST', '/api/threads/:id/archive', 200]], title: 'Inbox — Mail' }),
];
const addToCart = (product, price) => [
  step({ origin: SHOP, path: '/search?q=usb-c', name: `${product} ${price}`, role: 'link', tag: 'a', sel: `a[data-sku]`, urlChange: `${SHOP}/p/${product.toLowerCase().replace(/\W+/g, '-')}`, title: `${product} · Shop` }),
  step({ origin: SHOP, path: '/p/x', kind: 'select', name: 'Quantity', tag: 'select', sel: 'select[name="qty"]', value: '2' }),
  step({ origin: SHOP, path: '/p/x', name: 'Add to cart', sel: '#add-to-cart', live: ['Added to cart'], net: [['POST', '/api/cart/items', 200]] }),
  step({ origin: SHOP, path: '/p/x', kind: 'navigate', urlChange: `${SHOP}/search?q=usb-c`, title: 'Search: usb-c · Shop' }),
];

// ------------------------------------------------------------------------------------------- traces
const traces = [];
const add = (name, description, build, activity) => { reset(); traces.push({ name, description, steps: build(), activity }); };
const REPLY = 'repl(y|ies)|respond|answer';

add('act-g2-reply-x2', 'FIXTURE-DERIVED. Reply to 2 emails on HardMail (m1, then m3), Back to Inbox between.',
  () => [...g2Reply('m1'), g2Back(), ...g2Reply('m3')], { pattern: REPLY, minCompleted: 2, expectSuggestion: true });
add('act-g2-reply-variant', 'FIXTURE-DERIVED. 2nd reply done differently: keyboard "r" + expand trimmed content (enabling).',
  () => [...g2Reply('m1'), g2Back(), ...g2Reply('m2', { shortcut: true, expand: true })], { pattern: REPLY, minCompleted: 2, expectSuggestion: true });
add('act-g2-reply-noisy', 'FIXTURE-DERIVED. Reply m1; detour (open m2, read, back); reply m3.',
  () => [...g2Reply('m1'), g2Back(), g2Open('m2'), g2Back(), ...g2Reply('m3')], { pattern: REPLY, minCompleted: 2, expectSuggestion: true });
add('act-g2-reply-x3', 'FIXTURE-DERIVED. Reply to all 3 emails.',
  () => [...g2Reply('m1'), g2Back(), ...g2Reply('m2'), g2Back(), ...g2Reply('m3')], { pattern: REPLY, minCompleted: 2, expectSuggestion: true });
add('act-issue-to-ticket-x2', 'SYNTHETIC cross-site. Copy issue title+body → paste into tracker Create dialog → "Issue TRK-… created" (POST 201), twice.',
  () => [...issueToTicket(41, 'Settings page crashes on save', 'a1f3c9d2', 'b7e21f04'), ...issueToTicket(42, 'Dark mode toggle ignored', 'c3d4e5f6', 'd9a8b7c6')], { pattern: 'ticket|issue|tracker|transfer|jira', minCompleted: 2, expectSuggestion: true });
add('act-crm-log-call-x2', 'SYNTHETIC. Log a call note on 2 CRM contacts ("Activity logged", POST 201).',
  () => [...crmLog('Dana Whitfield', 'Called re renewal, wants pricing by Tue'), ...crmLog('Omar Haddad', 'Left voicemail about onboarding call')], { pattern: 'log|activity|note|call', minCompleted: 2, expectSuggestion: true });
add('act-label-bug-x2', 'SYNTHETIC. Add the "bug" label to 2 issues (PATCH 200, "Label added").',
  () => [...labelBug(17, 'Login button misaligned'), ...labelBug(23, 'CSV export drops last row')], { pattern: 'label|bug|triage|tag', minCompleted: 2, expectSuggestion: true });
add('act-approve-expense-x2', 'SYNTHETIC. Approve 2 expense reports (confirm dialog, "Report approved").',
  () => [...approveExpense('R-1042', 'Jamie Chen', '$184.20'), ...approveExpense('R-1043', 'Sam Ortiz', '$62.00')], { pattern: 'approv|expense|report', minCompleted: 2, expectSuggestion: true });
add('act-archive-newsletters-x3', 'SYNTHETIC. Open and archive 3 newsletters ("Conversation archived").',
  () => [...archiveNewsletter('The Weekly Byte #212'), ...archiveNewsletter('Product Digest — November'), ...archiveNewsletter('Morning Brew')], { pattern: 'archiv|newsletter|clean|triage', minCompleted: 2, expectSuggestion: true });
add('act-add-to-cart-x2', 'SYNTHETIC. Add 2 products to cart from search results ("Added to cart").',
  () => [...addToCart('USB-C Cable 2m', '$9.99'), ...addToCart('USB-C Charger 65W', '$29.99')], { pattern: 'cart|add|buy|shop|purchase', minCompleted: 2, expectSuggestion: null });

// noise (expect 0 suggestions)
add('act-noise-g2-browse', 'FIXTURE-DERIVED. Open email, back, open another, back, open the first again, back — no writes.',
  () => [g2Open('m1'), g2Back(), g2Open('m2'), g2Back(), g2Open('m3'), g2Back(), g2Open('m1'), g2Back()], { noise: true });
add('act-noise-news', 'SYNTHETIC. Reading news: open 4 articles, expand one, go back each time.', () => {
  const art = (slug, title) => [
    step({ origin: NEWS, path: '/', name: title, role: 'link', tag: 'a', sel: `a[href="/${slug}"]`, urlChange: `${NEWS}/${slug}`, title: `${title} — News`, net: [['GET', '/api/article/:slug', 200]] }),
    step({ origin: NEWS, path: `/${slug}`, kind: 'navigate', urlChange: `${NEWS}/`, title: 'Front page — News' }),
  ];
  return [...art('markets-rally', 'Markets rally on rate hopes'), ...art('city-council', 'City council approves park'),
    step({ origin: NEWS, path: '/', name: 'Weather', role: 'link', tag: 'a', sel: 'a[href="/weather"]', urlChange: `${NEWS}/weather`, title: 'Weather — News' }),
    step({ origin: NEWS, path: '/weather', name: 'Show 10-day forecast', sel: 'button.expand', regions: [['div.forecast', 'div.forecast\n  ol (10 days)']] }),
    step({ origin: NEWS, path: '/weather', kind: 'navigate', urlChange: `${NEWS}/`, title: 'Front page — News' }),
    ...art('ai-chips', 'New AI chips announced'), ...art('local-sports', 'Local team wins final')];
}, { noise: true });
add('act-noise-shop-browse', 'SYNTHETIC. Shopping browse: open products, view images, compare tabs — no cart, no purchase.', () => {
  const prod = (p, tab = 1) => [
    step({ origin: SHOP, path: '/c/headphones', name: p, role: 'link', tag: 'a', sel: 'a[data-sku]', urlChange: `${SHOP}/p/${p.toLowerCase().replace(/\W+/g, '-')}`, title: `${p} · Shop`, tabId: tab }),
    step({ origin: SHOP, path: '/p/x', name: 'Next image', sel: '[aria-label="Next image"]', tabId: tab }),
    step({ origin: SHOP, path: '/p/x', name: 'Reviews (214)', role: 'tab', tag: 'button', sel: '[role="tab"][aria-controls="reviews"]', regions: [['section#reviews', 'section#reviews\n  ol.reviews (10)']], tabId: tab }),
  ];
  return [...prod('Sony WH-1000XM6'), step({ origin: SHOP, path: '/c/headphones', kind: 'tab-switch', tabId: 2, title: 'Headphones · Shop' }), ...prod('Bose QC Ultra', 2),
    step({ origin: SHOP, path: '/p/x', kind: 'tab-switch', tabId: 1, title: 'Sony WH-1000XM6 · Shop' }), step({ origin: SHOP, path: '/p/x', name: 'Size chart', sel: 'button.size-chart' })];
}, { noise: true });
add('act-noise-docs-search', 'SYNTHETIC. Docs reading: search docs (input + submit = navigation only), open results, copy a snippet — nothing written anywhere.', () => [
  step({ origin: DOCS, path: '/', kind: 'input-commit', name: 'Search docs', tag: 'input', sel: 'input[type="search"]', value: 'structured outputs' }),
  step({ origin: DOCS, path: '/', kind: 'submit', name: 'Search', tag: 'form', sel: 'form[role="search"]', urlChange: `${DOCS}/search?q=structured+outputs`, title: 'Search · Docs', net: [['GET', '/api/search', 200]] }),
  step({ origin: DOCS, path: '/search', name: 'Structured outputs', role: 'link', tag: 'a', sel: 'a[href="/guides/structured-outputs"]', urlChange: `${DOCS}/guides/structured-outputs`, title: 'Structured outputs · Docs' }),
  step({ origin: DOCS, path: '/guides/structured-outputs', kind: 'copy', name: 'code block', tag: 'pre', value: 'output_config: { format: { type: "json_schema" …', hash: 'e1e2e3e4' }),
  step({ origin: DOCS, path: '/guides/structured-outputs', name: 'Effort', role: 'link', tag: 'a', sel: 'a[href="#effort"]', urlChange: `${DOCS}/guides/structured-outputs#effort` }),
  step({ origin: DOCS, path: '/guides/structured-outputs', kind: 'navigate', urlChange: `${DOCS}/search?q=structured+outputs`, title: 'Search · Docs' }),
  step({ origin: DOCS, path: '/search', name: 'Prompt caching', role: 'link', tag: 'a', sel: 'a[href="/guides/prompt-caching"]', urlChange: `${DOCS}/guides/prompt-caching`, title: 'Prompt caching · Docs' }),
  step({ origin: DOCS, path: '/guides/prompt-caching', name: 'Copy page', sel: '[aria-label="Copy page"]', live: ['Copied'] }),
], { noise: true });

for (const tr of traces) {
  fs.writeFileSync(path.join(TRACES, `${tr.name}.capture.json`), JSON.stringify({ kind: 'wwa-trace', version: 1, name: tr.name, synthetic: !tr.description.startsWith('FIXTURE'), description: tr.description, steps: tr.steps }, null, 1));
  fs.writeFileSync(path.join(TRACES, `${tr.name}.labels.json`), JSON.stringify({ description: tr.description, activity: tr.activity }, null, 1) + '\n');
}
console.log(`wrote ${traces.length} traces: ${traces.map(t => `${t.name}(${t.steps.length})`).join(', ')}`);
