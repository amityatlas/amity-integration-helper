const PAGE_SOURCE = 'amity-linkedin-page';
const EXTENSION_SOURCE = 'amity-linkedin-extension';

// This script can run twice on the same page: once from the manifest's
// declared content_scripts on navigation, and once from the service worker's
// manual re-injection into already-open tabs (see service-worker.js). Guard
// against wiring up duplicate listeners, which would double-fire syncs.
if (!window.__amityBridgeInstalled) {
  window.__amityBridgeInstalled = true;

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.data?.source !== PAGE_SOURCE) return;
    const { type, requestId } = event.data;
    if (type === 'AMITY_LINKEDIN_PING') {
      window.postMessage({ source: EXTENSION_SOURCE, type: 'AMITY_LINKEDIN_READY', requestId }, '*');
      return;
    }
    if (type === 'AMITY_LINKEDIN_SYNC' || type === 'AMITY_LINKEDIN_DISCONNECT') {
      chrome.runtime.sendMessage(event.data);
    }
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.source !== EXTENSION_SOURCE) return;
    window.postMessage(message, '*');
  });
}
