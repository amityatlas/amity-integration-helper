const LINKEDIN_CONNECTIONS_URL = 'https://www.linkedin.com/mynetwork/invite-connect/connections/';
const EXTENSION_SOURCE = 'amity-linkedin-extension';
const requests = new Map();
const returnedToAmity = new Set();
const linkedinTabs = new Map();
const loginListeners = new Map();

async function sendToTab(tabId, message) {
  try { await chrome.tabs.sendMessage(tabId, message); } catch (_) { /* tab may be navigating */ }
}

async function focusTab(tabId) {
  try {
    const tab = await chrome.tabs.update(tabId, { active: true });
    if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true });
  } catch (_) { /* the Amity tab may have been closed */ }
}

async function installLinkedInScripts(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['src/linkedin-bridge.js'],
    world: 'ISOLATED',
  });
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['src/linkedin-page.js'],
    world: 'MAIN',
  });
}

async function startSync(message, sender) {
  const amityTabId = sender.tab?.id;
  if (!amityTabId) return;
  requests.set(message.requestId, amityTabId);

  const tabs = await chrome.tabs.query({ url: 'https://www.linkedin.com/*' });
  let tab = tabs.find((candidate) => candidate.active) || tabs[0];
  if (!tab) tab = await chrome.tabs.create({ url: LINKEDIN_CONNECTIONS_URL, active: true });
  else {
    await chrome.tabs.update(tab.id, { active: true });
    if (!tab.url?.includes('/mynetwork/invite-connect/connections')) {
      tab = await chrome.tabs.update(tab.id, { url: LINKEDIN_CONNECTIONS_URL });
    }
  }
  linkedinTabs.set(message.requestId, tab.id);

  const begin = async () => {
    const payload = { source: EXTENSION_SOURCE, type: 'AMITY_LINKEDIN_BEGIN', requestId: message.requestId };
    // A completed navigation and document_idle content-script injection can
    // land a few milliseconds apart. Retry delivery instead of losing the
    // one message that starts the sync.
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        await installLinkedInScripts(tab.id);
        await chrome.tabs.sendMessage(tab.id, payload);
        return;
      } catch (_) {
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }
    await sendToTab(amityTabId, {
      source: EXTENSION_SOURCE,
      type: 'AMITY_LINKEDIN_ERROR',
      requestId: message.requestId,
      message: 'The extension could not connect to the LinkedIn tab. Reload the extension and LinkedIn, then try again.',
    });
  };
  if (tab.status === 'complete') await begin();
  else {
    const listener = (tabId, changeInfo) => {
      if (tabId !== tab.id || changeInfo.status !== 'complete') return;
      chrome.tabs.onUpdated.removeListener(listener);
      void begin();
    };
    chrome.tabs.onUpdated.addListener(listener);
  }
}

function waitForLogin(requestId) {
  if (loginListeners.has(requestId)) return;
  const linkedInTabId = linkedinTabs.get(requestId);
  if (!linkedInTabId) return;
  const listener = async (tabId, changeInfo, tab) => {
    if (tabId !== linkedInTabId || changeInfo.status !== 'complete') return;
    if (/\/login|\/checkpoint|\/authwall/.test(tab.url || '')) return;
    chrome.tabs.onUpdated.removeListener(listener);
    loginListeners.delete(requestId);
    try {
      await installLinkedInScripts(linkedInTabId);
      await chrome.tabs.sendMessage(linkedInTabId, {
        source: EXTENSION_SOURCE,
        type: 'AMITY_LINKEDIN_BEGIN',
        requestId,
      });
    } catch (_) { /* a later navigation update can be retried by Connect */ }
  };
  loginListeners.set(requestId, listener);
  chrome.tabs.onUpdated.addListener(listener);
}

function cleanupRequest(requestId) {
  const listener = loginListeners.get(requestId);
  if (listener) chrome.tabs.onUpdated.removeListener(listener);
  loginListeners.delete(requestId);
  linkedinTabs.delete(requestId);
  returnedToAmity.delete(requestId);
  requests.delete(requestId);
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (!message?.type?.startsWith('AMITY_LINKEDIN_')) return;
  if (message.type === 'AMITY_LINKEDIN_SYNC') {
    void startSync(message, sender);
    return;
  }
  if (message.type === 'AMITY_LINKEDIN_DISCONNECT') {
    requests.delete(message.requestId);
    return;
  }
  const targetTabId = requests.get(message.requestId);
  if (!targetTabId) return;
  void sendToTab(targetTabId, message);
  if (message.type === 'AMITY_LINKEDIN_LOGIN_REQUIRED') {
    waitForLogin(message.requestId);
    return;
  }
  if ((message.type === 'AMITY_LINKEDIN_PROGRESS' || message.type === 'AMITY_LINKEDIN_COMPLETE' || message.type === 'AMITY_LINKEDIN_ERROR')
    && !returnedToAmity.has(message.requestId)) {
    returnedToAmity.add(message.requestId);
    void focusTab(targetTabId);
  }
  if (message.type === 'AMITY_LINKEDIN_COMPLETE' || message.type === 'AMITY_LINKEDIN_ERROR') {
    cleanupRequest(message.requestId);
  }
});
