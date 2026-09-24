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
    if (type === 'AMITY_LINKEDIN_PING' || type === 'AMITY_ICLOUD_PING') {
      if (type === 'AMITY_ICLOUD_PING') console.info('[Amity iCloud bridge] ping received', { requestId });
      window.postMessage({ source: EXTENSION_SOURCE, type: type === 'AMITY_LINKEDIN_PING' ? 'AMITY_LINKEDIN_READY' : 'AMITY_ICLOUD_READY', requestId }, '*');
      return;
    }
    if (type === 'AMITY_LINKEDIN_SYNC' || type === 'AMITY_LINKEDIN_DISCONNECT' || type === 'AMITY_ICLOUD_SYNC' || type === 'AMITY_ICLOUD_DISCONNECT') {
      if (type.startsWith('AMITY_ICLOUD_')) console.info('[Amity iCloud bridge] forwarding to service worker', { type, requestId });
      chrome.runtime.sendMessage(event.data);
    }
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.source !== EXTENSION_SOURCE) return;
    if (message?.type?.startsWith('AMITY_ICLOUD_')) console.info('[Amity iCloud bridge] forwarding to page', message);
    window.postMessage(message, '*');
  });
}
