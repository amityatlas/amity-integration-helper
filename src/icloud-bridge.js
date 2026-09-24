if (!globalThis.__AMITY_ICLOUD_BRIDGE_INSTALLED__) {
globalThis.__AMITY_ICLOUD_BRIDGE_INSTALLED__ = true;
const PAGE_SOURCE = 'amity-linkedin-page';
const EXTENSION_SOURCE = 'amity-linkedin-extension';

chrome.runtime.onMessage.addListener((message) => {
  if (message?.source !== EXTENSION_SOURCE) return;
  if (message?.type !== 'AMITY_ICLOUD_BEGIN_V2') return;
  // Re-tag as PAGE_SOURCE before handing it to the page. Posting it with
  // EXTENSION_SOURCE would match this script's own window listener below and
  // bounce the begin message straight back to the service worker, which then
  // forwards it to the Amity tab as if it were a sync result.
  window.postMessage({ ...message, source: PAGE_SOURCE }, '*');
});

window.addEventListener('message', (event) => {
  if (event.source !== window || event.data?.source !== EXTENSION_SOURCE) return;
  if (!event.data.type?.startsWith('AMITY_ICLOUD_')) return;
  chrome.runtime.sendMessage(event.data);
});
}
