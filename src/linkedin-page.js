(() => {
  if (window.__AMITY_LINKEDIN_PAGE_INSTALLED__) return;
  window.__AMITY_LINKEDIN_PAGE_INSTALLED__ = true;
  const PAGE_SOURCE = 'amity-linkedin-page';
  const EXTENSION_SOURCE = 'amity-linkedin-extension';
  const PAGE_SIZE = 40;

  const text = (value) => value?.text || value || '';
  const vectorUrl = (profile) => {
    const container = profile?.picture || profile?.profilePicture?.displayImageReference || profile?.profilePicture?.displayImage;
    const vector = container?.['com.linkedin.common.VectorImage'] || container?.vectorImage || container;
    const artifact = [...(vector?.artifacts || [])].sort((a, b) => (b.width || 0) - (a.width || 0))[0];
    return artifact && vector?.rootUrl ? `${vector.rootUrl}${artifact.fileIdentifyingUrlPathSegment}` : '';
  };
  const timestamp = (item) => {
    const raw = item?.connectedAt ?? item?.connectionCreatedAt ?? item?.createdAt ?? item?.lastModifiedAt;
    if (!raw) return null;
    const value = Number(raw);
    return new Date(value < 10_000_000_000 ? value * 1000 : value).toISOString();
  };
  const firstString = (...values) => values.map(text).find((value) => typeof value === 'string' && value.trim())?.trim() || '';
  const headlineParts = (headline) => {
    const match = String(headline || '').match(/^(.+?)\s+(?:at|@)\s+(.+)$/i);
    return match ? { jobTitle: match[1].trim(), company: match[2].trim() } : { jobTitle: String(headline || '').trim(), company: '' };
  };
  // LinkedIn doesn't tag an education entry as "high school" vs "university"
  // — infer it from the degree/school name text instead, then fill our
  // form's remaining two slots (university, college) positionally from
  // whatever's left, same as before.
  const HIGH_SCHOOL_PATTERN = /high\s*school|lise|secondary school|lyc[ée]e|gymnasium/i;
  const educationFrom = (profile) => {
    const entries = profile?.educations || profile?.education || profile?.educationView?.elements || [];
    const parsed = (Array.isArray(entries) ? entries : [])
      .map((entry) => ({
        schoolName: firstString(entry?.schoolName, entry?.school?.name, entry?.school?.localizedName),
        degreeName: firstString(entry?.degreeName, entry?.degree),
      }))
      .filter((entry) => entry.schoolName);
    const isHighSchool = (entry) => HIGH_SCHOOL_PATTERN.test(entry.degreeName) || HIGH_SCHOOL_PATTERN.test(entry.schoolName);
    const highSchool = parsed.find(isHighSchool);
    const higherEd = parsed.filter((entry) => entry !== highSchool);
    return {
      highSchool: highSchool?.schoolName || '',
      university: higherEd[0]?.schoolName || '',
      college: higherEd[1]?.schoolName || '',
    };
  };
  const preview = (profile, connection) => {
    const firstName = String(text(profile?.firstName)).trim();
    const lastName = String(text(profile?.lastName)).trim();
    if (!firstName && !lastName) return null;
    const publicIdentifier = profile?.publicIdentifier || profile?.publicIdentifierWithCountry || '';
    const urn = profile?.entityUrn || profile?.dashEntityUrn || connection?.entityUrn || '';
    const id = urn.split(':').pop() || publicIdentifier;
    if (!id) return null;
    const headline = String(text(profile?.headline) || profile?.occupation || '').trim();
    const headlineData = headlineParts(headline);
    const company = firstString(
      profile?.companyName,
      profile?.currentPosition?.companyName,
      profile?.primaryCurrentPosition?.companyName,
      profile?.position?.companyName,
      headlineData.company,
    );
    const jobTitle = firstString(
      profile?.currentPosition?.title,
      profile?.primaryCurrentPosition?.title,
      profile?.position?.title,
      headlineData.jobTitle,
    );
    const city = firstString(profile?.geoLocation?.geo?.defaultLocalizedName, profile?.city);
    const country = firstString(profile?.geoLocation?.geo?.countryName, profile?.country, profile?.geoCountryName);
    const location = firstString(profile?.locationName, profile?.geoLocationName, [city, country].filter(Boolean).join(', '));
    return {
      id,
      name: `${firstName} ${lastName}`.trim(),
      firstName,
      lastName,
      headline,
      company,
      profession: jobTitle,
      jobTitle,
      industry: firstString(profile?.industryName, profile?.industry),
      city,
      country,
      location,
      education: educationFrom(profile),
      profileUrl: publicIdentifier ? `https://www.linkedin.com/in/${publicIdentifier}` : '',
      pictureUrl: vectorUrl(profile),
      importedContactId: null,
      connectedAt: timestamp(connection || profile),
    };
  };
  const parse = (data) => {
    const included = data?.included || [];
    const byUrn = new Map(included.map((item) => [item.entityUrn, item]));
    const findElements = (value, depth = 0) => {
      if (!value || depth > 6) return [];
      if (Array.isArray(value)) {
        if (value.some((item) => item?.connectedMember || item?.miniProfile || String(item?.entityUrn || '').includes('connection'))) return value;
        for (const item of value) { const found = findElements(item, depth + 1); if (found.length) return found; }
        return [];
      }
      if (typeof value !== 'object') return [];
      for (const child of Object.values(value)) { const found = findElements(child, depth + 1); if (found.length) return found; }
      return [];
    };
    const findPaging = (value, depth = 0) => {
      if (!value || depth > 7 || typeof value !== 'object') return null;
      if (value.paging && typeof value.paging === 'object') return value.paging;
      for (const child of Object.values(value)) { const found = findPaging(child, depth + 1); if (found) return found; }
      return null;
    };
    const elements = data?.data?.elements || data?.elements || findElements(data);
    const results = [];
    for (const item of elements) {
      const ref = Object.values(item || {}).find((value) => typeof value === 'string' && (value.includes('fs_miniProfile') || value.includes('fsd_profile')));
      const direct = item?.connectedMemberResolutionResult || item?.miniProfile || item?.profile || item?.connectedMember;
      const profile = (direct && typeof direct === 'object' ? direct : null)
        || byUrn.get(ref || direct || item?.member)
        || included.find((entity) => entity.entityUrn?.endsWith(`:${item?.entityUrn?.split(':').pop()}`));
      const mapped = preview(profile, item);
      if (mapped) results.push(mapped);
    }
    if (!results.length) {
      for (const item of included) {
        if (!/MiniProfile|Profile/.test(item?.$type || '')) continue;
        const mapped = preview(item, item);
        if (mapped) results.push(mapped);
      }
    }
    const paging = data?.data?.paging || data?.paging || findPaging(data) || {};
    return { items: results, elementCount: elements.length, total: Number.isFinite(paging.total) ? paging.total : null };
  };
  const post = (type, requestId, payload = {}) => window.postMessage({ source: EXTENSION_SOURCE, type, requestId, ...payload }, '*');

  async function sync(requestId) {
    if (/\/login|\/checkpoint|\/authwall/.test(location.pathname)) {
      post('AMITY_LINKEDIN_LOGIN_REQUIRED', requestId);
      return;
    }
    try {
      const csrf = document.cookie.match(/(?:^|;\s*)JSESSIONID=([^;]+)/)?.[1]?.replace(/"/g, '');
      if (!csrf) throw new Error('Please sign in to LinkedIn, then try again.');
      const all = new Map();
      let start = 0;
      let total = null;
      let emptyPages = 0;
      let sortType = 'LAST_NAME';
      while (true) {
        const params = new URLSearchParams({
          decorationId: 'com.linkedin.voyager.dash.deco.web.mynetwork.ConnectionListWithProfile-16',
          count: String(PAGE_SIZE),
          start: String(start),
          q: 'search',
          sortType,
        });
        const response = await fetch(`/voyager/api/relationships/dash/connections?${params}`, {
          credentials: 'include',
          headers: {
            accept: 'application/vnd.linkedin.normalized+json+2.1',
            'csrf-token': csrf,
            'x-restli-protocol-version': '2.0.0',
          },
        });
        if (response.status === 400 && start === 0 && sortType === 'LAST_NAME') {
          // LinkedIn enables directory sorts inconsistently by account/UI
          // rollout. RECENTLY_ADDED is accepted by the connections page on
          // accounts that reject LAST_NAME, so fall back without failing the
          // user's sync.
          sortType = 'RECENTLY_ADDED';
          continue;
        }
        if (!response.ok) throw new Error(`LinkedIn returned ${response.status}. Please reload LinkedIn and try again.`);
        const parsed = parse(await response.json());
        total = parsed.total ?? total;
        parsed.items.forEach((item) => all.set(item.id, item));
        post('AMITY_LINKEDIN_PROGRESS', requestId, { items: [...all.values()], loaded: all.size, total });
        emptyPages = parsed.elementCount ? 0 : emptyPages + 1;
        start += PAGE_SIZE;
        if ((total !== null && start >= total) || parsed.elementCount < PAGE_SIZE || emptyPages >= 2) break;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      post('AMITY_LINKEDIN_COMPLETE', requestId, { items: [...all.values()], loaded: all.size, total: total ?? all.size });
    } catch (error) {
      post('AMITY_LINKEDIN_ERROR', requestId, { message: error instanceof Error ? error.message : 'LinkedIn sync failed.' });
    }
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.data?.source !== PAGE_SOURCE || event.data?.type !== 'AMITY_LINKEDIN_BEGIN') return;
    void sync(event.data.requestId);
  });
})();
