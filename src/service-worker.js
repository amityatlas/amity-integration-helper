const LINKEDIN_CONNECTIONS_URL = 'https://www.linkedin.com/mynetwork/invite-connect/connections/';
const ICLOUD_CONTACTS_URL = 'https://www.icloud.com/contacts';
const EXTENSION_SOURCE = 'amity-linkedin-extension';
const requests = new Map();
const returnedToAmity = new Set();
const linkedinTabs = new Map();
const icloudTabs = new Map();
const loginListeners = new Map();

async function sendToTab(tabId, message) {
  try { await chrome.tabs.sendMessage(tabId, message); } catch (_) { /* tab may be navigating */ }
}

async function debugToAmity(tabId, requestId, message, extra = {}) {
  console.log('[Amity iCloud helper]', message, { requestId, ...extra });
  if (!tabId) return;
  await sendToTab(tabId, {
    source: EXTENSION_SOURCE,
    type: 'AMITY_ICLOUD_DEBUG',
    requestId,
    message,
    ...extra,
  });
}

async function focusTab(tabId) {
  try {
    const tab = await chrome.tabs.update(tabId, { active: true });
    if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true });
  } catch (_) { /* the Amity tab may have been closed */ }
}

const AMITY_TAB_MATCHES = [
  'http://localhost:3000/*',
  'https://amityatlas-dev.web.app/*',
  'https://*.amityatlas.com/*',
];

// Chrome only auto-runs a declared content_scripts entry on a tab's next
// navigation. A tab that was already open (e.g. the Amity app the user was
// using) when this extension was installed/reloaded never gets amity-bridge.js
// injected, so its detection ping goes unanswered until the user manually
// reloads. Inject it into any already-open matching tab right away instead.
async function injectIntoExistingAmityTabs() {
  const tabs = await chrome.tabs.query({ url: AMITY_TAB_MATCHES });
  await Promise.all(tabs.map((tab) => (
    tab.id === undefined ? Promise.resolve() : chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['src/amity-bridge.js'],
      world: 'ISOLATED',
    }).catch(() => { /* tab may not allow injection (e.g. chrome:// or a closed tab) */ })
  )));
}

chrome.runtime.onInstalled.addListener(() => { void injectIntoExistingAmityTabs(); });
chrome.runtime.onStartup.addListener(() => { void injectIntoExistingAmityTabs(); });

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

async function installICloudScripts(tabId) {
  console.log('[Amity iCloud helper] installing scripts', { tabId });
  // Do not clear the installed guards before injecting. Each injection adds
  // its own window 'message' listener, and clearing the guard does not remove
  // the listener the previous injection registered — so every sync would add
  // another listener and a single begin message would start that many
  // concurrent scrapes. Let the guards make re-injection a no-op, exactly as
  // installLinkedInScripts does.
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['src/icloud-bridge.js'],
    world: 'ISOLATED',
  });
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['src/icloud-page.js'],
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

async function startICloudSync(message, sender) {
  const amityTabId = sender.tab?.id;
  if (!amityTabId) return;
  requests.set(message.requestId, amityTabId);
  await debugToAmity(amityTabId, message.requestId, 'sync received from Amity', { amityTabId });

  const tabs = await chrome.tabs.query({ url: 'https://www.icloud.com/contacts*' });
  await debugToAmity(amityTabId, message.requestId, 'queried existing iCloud contacts tabs', { count: tabs.length, urls: tabs.map((candidate) => candidate.url) });
  let tab = tabs.find((candidate) => candidate.active) || tabs[0];
  if (!tab) {
    await debugToAmity(amityTabId, message.requestId, 'creating iCloud contacts tab', { url: ICLOUD_CONTACTS_URL });
    tab = await chrome.tabs.create({ url: ICLOUD_CONTACTS_URL, active: true });
  }
  else {
    await debugToAmity(amityTabId, message.requestId, 'using existing iCloud tab', { tabId: tab.id, url: tab.url, status: tab.status });
    await chrome.tabs.update(tab.id, { active: true });
    if (!tab.url?.startsWith(ICLOUD_CONTACTS_URL)) {
      await debugToAmity(amityTabId, message.requestId, 'navigating existing iCloud tab to contacts', { from: tab.url, to: ICLOUD_CONTACTS_URL });
      tab = await chrome.tabs.update(tab.id, { url: ICLOUD_CONTACTS_URL });
    }
  }
  icloudTabs.set(message.requestId, tab.id);
  await debugToAmity(amityTabId, message.requestId, 'iCloud tab selected', { tabId: tab.id, url: tab.url, status: tab.status });

  const waitForContactsUrl = async () => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const current = await chrome.tabs.get(tab.id).catch(() => null);
      await debugToAmity(amityTabId, message.requestId, 'checking iCloud tab URL', { attempt, url: current?.url, status: current?.status });
      if (current?.url?.startsWith(ICLOUD_CONTACTS_URL)) return true;
      tab = await chrome.tabs.update(tab.id, { url: ICLOUD_CONTACTS_URL, active: true });
      await debugToAmity(amityTabId, message.requestId, 'forced iCloud tab back to contacts', { attempt, url: ICLOUD_CONTACTS_URL });
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    return false;
  };

  const begin = async () => {
    const payload = { source: EXTENSION_SOURCE, type: 'AMITY_ICLOUD_BEGIN_V2', requestId: message.requestId };
    await debugToAmity(amityTabId, message.requestId, 'begin iCloud sync on tab', { tabId: tab.id });
    const contactsUrlReady = await waitForContactsUrl();
    if (!contactsUrlReady) {
      await debugToAmity(amityTabId, message.requestId, 'iCloud contacts URL not ready after retries', { tabId: tab.id });
      await sendToTab(amityTabId, {
        source: EXTENSION_SOURCE,
        type: 'AMITY_ICLOUD_ERROR',
        requestId: message.requestId,
        message: 'iCloud redirected to Dashboard. Open Contacts in iCloud, then click Connect again.',
      });
      return;
    }
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        await debugToAmity(amityTabId, message.requestId, 'installing scripts and sending begin', { attempt, tabId: tab.id });
        await installICloudScripts(tab.id);
        await chrome.tabs.sendMessage(tab.id, payload);
        await debugToAmity(amityTabId, message.requestId, 'begin message delivered to iCloud tab', { attempt, tabId: tab.id });
        return;
      } catch (_) {
        await debugToAmity(amityTabId, message.requestId, 'failed to deliver begin to iCloud tab, retrying', { attempt, tabId: tab.id });
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
    }
    await debugToAmity(amityTabId, message.requestId, 'could not connect to iCloud tab after retries', { tabId: tab.id });
    await sendToTab(amityTabId, {
      source: EXTENSION_SOURCE,
      type: 'AMITY_ICLOUD_ERROR',
      requestId: message.requestId,
      message: 'The extension could not connect to the iCloud Contacts tab. Reload the extension and iCloud Contacts, then try again.',
    });
  };
  if (tab.status === 'complete') await begin();
  else {
    await debugToAmity(amityTabId, message.requestId, 'waiting for iCloud tab complete', { tabId: tab.id, status: tab.status });
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
  icloudTabs.delete(requestId);
  returnedToAmity.delete(requestId);
  requests.delete(requestId);
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (!message?.type?.startsWith('AMITY_LINKEDIN_') && !message?.type?.startsWith('AMITY_ICLOUD_')) return;
  if (message.type === 'AMITY_LINKEDIN_SYNC') {
    void startSync(message, sender);
    return;
  }
  if (message.type === 'AMITY_ICLOUD_SYNC') {
    void startICloudSync(message, sender);
    return;
  }
  if (message.type === 'AMITY_LINKEDIN_DISCONNECT') {
    requests.delete(message.requestId);
    return;
  }
  if (message.type === 'AMITY_ICLOUD_DISCONNECT') {
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
  if ((message.type === 'AMITY_LINKEDIN_PROGRESS' || message.type === 'AMITY_LINKEDIN_COMPLETE' || message.type === 'AMITY_LINKEDIN_ERROR'
    || message.type === 'AMITY_ICLOUD_PROGRESS' || message.type === 'AMITY_ICLOUD_COMPLETE' || message.type === 'AMITY_ICLOUD_ERROR')
    && !returnedToAmity.has(message.requestId)) {
    returnedToAmity.add(message.requestId);
    void focusTab(targetTabId);
  }
  if (message.type === 'AMITY_LINKEDIN_COMPLETE' || message.type === 'AMITY_LINKEDIN_ERROR'
    || message.type === 'AMITY_ICLOUD_COMPLETE' || message.type === 'AMITY_ICLOUD_ERROR') {
    cleanupRequest(message.requestId);
  }
});
