if (!globalThis.__AMITY_ICLOUD_BRIDGE_INSTALLED__) {
globalThis.__AMITY_ICLOUD_BRIDGE_INSTALLED__ = true;
const PAGE_SOURCE = 'amity-linkedin-page';
const EXTENSION_SOURCE = 'amity-linkedin-extension';

chrome.runtime.onMessage.addListener((message) => {
  if (message?.source !== EXTENSION_SOURCE) return;
  if (message?.type !== 'AMITY_ICLOUD_BEGIN') return;
  window.postMessage(message, '*');
});

window.addEventListener('message', (event) => {
  if (event.source !== window || event.data?.source !== EXTENSION_SOURCE) return;
  if (!event.data.type?.startsWith('AMITY_ICLOUD_')) return;
  chrome.runtime.sendMessage(event.data);
});
}
