// PoC service worker: configure USER_SCRIPT world messaging + execute generated code.
try {
  chrome.userScripts.configureWorld({ messaging: true });
} catch (e) {
  console.log('[poc] configureWorld failed:', e);
}

chrome.runtime.onInstalled.addListener(() => {
  try { chrome.userScripts.configureWorld({ messaging: true }); } catch (e) {}
});

chrome.runtime.onUserScriptMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'PING') {
    sendResponse({ pong: true, from: 'sw', echo: msg.payload ?? null });
    return false;
  }
});

// Entry point used by the test driver via service-worker evaluate.
globalThis.__pocExec = async (code) => {
  const [tab] = await chrome.tabs.query({ url: '*://127.0.0.1/*' });
  if (!tab) throw new Error('test tab not found');
  const results = await chrome.userScripts.execute({
    target: { tabId: tab.id },
    js: [{ code }],
    world: 'USER_SCRIPT',
    injectImmediately: true,
  });
  return results;
};

globalThis.__pocStatus = () => ({
  hasUserScripts: typeof chrome.userScripts !== 'undefined',
  hasExecute: typeof chrome.userScripts?.execute === 'function',
  ua: navigator.userAgent,
});
