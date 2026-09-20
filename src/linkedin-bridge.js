if (!globalThis.__AMITY_LINKEDIN_BRIDGE_INSTALLED__) {
globalThis.__AMITY_LINKEDIN_BRIDGE_INSTALLED__ = true;
const PAGE_SOURCE = 'amity-linkedin-page';
const EXTENSION_SOURCE = 'amity-linkedin-extension';

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== 'AMITY_LINKEDIN_BEGIN') return;
  window.postMessage({ ...message, source: PAGE_SOURCE }, '*');
});

window.addEventListener('message', (event) => {
  if (event.source !== window || event.data?.source !== EXTENSION_SOURCE) return;
  if (!event.data.type?.startsWith('AMITY_LINKEDIN_')) return;
  chrome.runtime.sendMessage(event.data);
});
}
