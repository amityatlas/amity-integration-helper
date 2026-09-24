(() => {
  if (window.__AMITY_ICLOUD_PAGE_INSTALLED__) return;
  window.__AMITY_ICLOUD_PAGE_INSTALLED__ = true;
  const PAGE_SOURCE = 'amity-linkedin-page';
  const EXTENSION_SOURCE = 'amity-linkedin-extension';
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const post = (type, requestId, payload = {}) => window.postMessage({ source: EXTENSION_SOURCE, type, requestId, ...payload }, '*');
  const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const hash = (value) => {
    let h = 0;
    for (let i = 0; i < value.length; i += 1) h = ((h << 5) - h) + value.charCodeAt(i) | 0;
    return Math.abs(h).toString(36);
  };
  const splitName = (name) => {
    const parts = clean(name).split(' ').filter(Boolean);
    return { firstName: parts[0] || '', lastName: parts.slice(1).join(' ') };
  };
  const visible = (el) => {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  };
  const textLines = (root = document.body) => clean(root.innerText || '').split(/\n+/).map(clean).filter(Boolean);
  const rowCandidates = () => Array.from(document.querySelectorAll('[role="row"], [role="option"], [role="listitem"], li, button, [aria-selected]'))
    .filter(visible)
    .filter((el) => {
      const text = clean(el.innerText || el.getAttribute('aria-label') || '');
      if (!text || text.length > 90) return false;
      if (/all contacts|lists|search|edit|icloud|contacts/i.test(text)) return false;
      return /[A-Za-zÀ-ž]/.test(text);
    });
  const detailRoot = () => {
    const panels = Array.from(document.querySelectorAll('[role="main"], main, [aria-label*="details" i], [class*="detail" i], [class*="card" i]')).filter(visible);
    return panels.sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0] || document.body;
  };
  const parseDetail = (fallbackName) => {
    const lines = textLines(detailRoot());
    const name = clean(lines.find((line) => line === fallbackName) || lines.find((line) => line.length > 1 && !/^(edit|mobile|home|work|email|phone|address)$/i.test(line)) || fallbackName);
    const phones = [...new Set(lines
      .filter((line) => /(?:\+|00)?[\d\s().-]{7,}/.test(line))
      .map((line) => clean(line.match(/(?:\+|00)?[\d\s().-]{7,}/)?.[0] || ''))
      .filter(Boolean))];
    const emails = [...new Set(lines
      .map((line) => line.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || '')
      .filter(Boolean)
      .map((email) => email.toLowerCase()))];
    const labelIndex = (label) => lines.findIndex((line) => new RegExp(`^${label}$`, 'i').test(line));
    const after = (label) => {
      const idx = labelIndex(label);
      return idx >= 0 ? clean(lines[idx + 1] || '') : '';
    };
    const company = after('company') || after('work') || '';
    const location = after('address') || '';
    const { firstName, lastName } = splitName(name);
    const sourceKey = [name, phones.join(','), emails.join(',')].filter(Boolean).join('|') || fallbackName;
    return {
      id: `icloud:${hash(sourceKey)}`,
      name,
      firstName,
      lastName,
      phone: phones,
      email: emails,
      company,
      location,
      avatar: '',
      importedContactId: null,
    };
  };
  const scrollContainer = () => Array.from(document.querySelectorAll('[role="listbox"], [role="grid"], [class*="list" i], [class*="scroll" i], div'))
    .filter((el) => visible(el) && el.scrollHeight > el.clientHeight + 20)
    .sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))[0] || document.scrollingElement;

  async function sync(requestId) {
    try {
      for (let attempt = 0; attempt < 120 && !/\/contacts\/?/.test(location.pathname); attempt += 1) {
        await wait(1000);
      }
      if (!/\/contacts\/?/.test(location.pathname)) {
        post('AMITY_ICLOUD_ERROR', requestId, { message: 'Open iCloud Contacts, then try again.' });
        return;
      }
      const seenRows = new Set();
      const contacts = new Map();
      const scroller = scrollContainer();
      let stablePasses = 0;
      for (let pass = 0; pass < 80 && stablePasses < 5; pass += 1) {
        const before = contacts.size;
        for (const row of rowCandidates()) {
          const label = clean(row.innerText || row.getAttribute('aria-label') || '');
          if (!label || seenRows.has(label)) continue;
          seenRows.add(label);
          row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
          row.click();
          await wait(160);
          const contact = parseDetail(label);
          if (contact.name && (contact.phone.length || contact.email.length || contact.firstName || contact.lastName)) {
            contacts.set(contact.id, contact);
          }
          if (contacts.size % 10 === 0) {
            post('AMITY_ICLOUD_PROGRESS', requestId, { items: [...contacts.values()], loaded: contacts.size, total: null });
          }
        }
        post('AMITY_ICLOUD_PROGRESS', requestId, { items: [...contacts.values()], loaded: contacts.size, total: null });
        stablePasses = contacts.size === before ? stablePasses + 1 : 0;
        if (scroller) scroller.scrollTop = Math.min(scroller.scrollTop + Math.max(240, scroller.clientHeight * 0.85), scroller.scrollHeight);
        await wait(300);
      }
      post('AMITY_ICLOUD_COMPLETE', requestId, { items: [...contacts.values()], loaded: contacts.size, total: contacts.size });
    } catch (error) {
      post('AMITY_ICLOUD_ERROR', requestId, { message: error instanceof Error ? error.message : 'iCloud Contacts sync failed.' });
    }
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.data?.source !== EXTENSION_SOURCE || event.data?.type !== 'AMITY_ICLOUD_BEGIN') return;
    void sync(event.data.requestId);
  });
})();
