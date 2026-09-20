const PAGE_SOURCE = 'amity-linkedin-page';
const EXTENSION_SOURCE = 'amity-linkedin-extension';

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
