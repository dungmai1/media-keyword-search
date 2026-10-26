// Pexels + Pixabay search, shared by the Electron app and the dev web server.
// Keys are always passed in by the caller; this module never stores them.

export const PROVIDERS = ['pexels', 'pixabay'];
export const TYPES = ['photo', 'video'];
const MAX_PER_PAGE = 80;
const CACHE_TTL = 60 * 60 * 1000;
const cache = new Map();

export function clearCache() {
  cache.clear();
}

async function getJson(url, headers = {}) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.data;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}${body ? `: ${body.slice(0, 120)}` : ''}`);
  }
  const data = await res.json();
  cache.set(url, { at: Date.now(), data });
  return data;
}

// ---------- Pexels ----------
// Cache keys are URLs; Pexels sends its key as a header, so clearCache() must run when it changes.
async function pexelsPhotos(q, perPage, key) {
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=${perPage}`;
  const data = await getJson(url, { Authorization: key });
  return (data.photos || []).map((p) => ({
    provider: 'pexels',
    type: 'photo',
    id: p.id,
    pageUrl: p.url,
    thumb: p.src.medium,
    file: p.src.original,
    width: p.width,
    height: p.height,
    author: p.photographer,
    title: p.alt || '',
  }));
}

async function pexelsVideos(q, perPage, key) {
  const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(q)}&per_page=${perPage}`;
  const data = await getJson(url, { Authorization: key });
  return (data.videos || []).map((v) => {
    const files = (v.video_files || [])
      .filter((f) => f.file_type === 'video/mp4' && f.width)
      .sort((a, b) => a.width - b.width);
    const preview = files.find((f) => f.width >= 480) || files[0];
    const best = files[files.length - 1];
    return {
      provider: 'pexels',
      type: 'video',
      id: v.id,
      pageUrl: v.url,
      thumb: v.image,
      preview: preview?.link,
      file: best?.link,
      width: v.width,
      height: v.height,
      duration: v.duration,
      author: v.user?.name || '',
      title: '',
    };
  });
}

// ---------- Pixabay ----------
// Pixabay requires per_page in [3, 200] and q <= 100 chars.
function pixabayParams(q, perPage, key) {
  return `key=${encodeURIComponent(key)}&q=${encodeURIComponent(q.slice(0, 100))}&per_page=${Math.max(3, perPage)}&safesearch=true`;
}

async function pixabayPhotos(q, perPage, key) {
  const url = `https://pixabay.com/api/?${pixabayParams(q, perPage, key)}&image_type=photo`;
  const data = await getJson(url);
  return (data.hits || []).slice(0, perPage).map((p) => ({
    provider: 'pixabay',
    type: 'photo',
    id: p.id,
    pageUrl: p.pageURL,
    thumb: p.webformatURL,
    file: p.largeImageURL,
    width: p.imageWidth,
    height: p.imageHeight,
    author: p.user,
    title: p.tags,
  }));
}

async function pixabayVideos(q, perPage, key) {
  const url = `https://pixabay.com/api/videos/?${pixabayParams(q, perPage, key)}`;
  const data = await getJson(url);
  return (data.hits || []).slice(0, perPage).map((v) => {
    const s = v.videos || {};
    const preview = s.tiny?.url ? s.tiny : s.small;
    const best = [s.large, s.medium, s.small, s.tiny].find((x) => x?.url);
    return {
      provider: 'pixabay',
      type: 'video',
      id: v.id,
      pageUrl: v.pageURL,
      thumb: s.medium?.thumbnail || s.small?.thumbnail || s.tiny?.thumbnail,
      preview: preview?.url,
      file: best?.url,
      width: best?.width,
      height: best?.height,
      duration: v.duration,
      author: v.user,
      title: v.tags,
    };
  });
}

const SOURCES = {
  pexels: { photo: pexelsPhotos, video: pexelsVideos },
  pixabay: { photo: pixabayPhotos, video: pixabayVideos },
};

// Normalizes untrusted search input ({ q, types, providers, perPage }).
export function parseSearchParams(input = {}) {
  const q = String(input.q || '').trim();
  if (!q) throw new Error('Thiếu keyword');
  const pick = (value, allowed) => {
    const list = (Array.isArray(value) ? value : String(value || '').split(',')).filter((x) => allowed.includes(x));
    return list.length ? list : allowed;
  };
  return {
    q,
    types: pick(input.types, TYPES),
    providers: pick(input.providers, PROVIDERS),
    perPage: Math.min(MAX_PER_PAGE, Math.max(1, Number(input.perPage) || 10)),
  };
}

export async function search({ q, types, providers, perPage }, keys) {
  const jobs = [];
  for (const name of providers) {
    for (const type of types) jobs.push({ name, type });
  }
  const settled = await Promise.allSettled(
    jobs.map(({ name, type }) => {
      if (!keys[name]) return Promise.reject(new Error(`Chưa nhập API key ${name}`));
      return SOURCES[name][type](q, perPage, keys[name]);
    }),
  );
  const items = [];
  const errors = [];
  settled.forEach((r, i) => {
    const { name, type } = jobs[i];
    if (r.status === 'fulfilled') items.push(...r.value);
    else errors.push({ provider: name, type, message: r.reason.message });
  });
  return { query: q, items, errors };
}

// ---------- API keys ----------
export function keyStatus(keys) {
  const info = (key) => ({ set: Boolean(key), hint: key ? `••••${key.slice(-4)}` : '' });
  return Object.fromEntries(PROVIDERS.map((p) => [p, info(keys[p])]));
}

// A provided string sets the key ('' clears it); a missing field keeps the current one.
export function parseKeyUpdates(body = {}) {
  const updates = {};
  for (const provider of PROVIDERS) {
    if (typeof body[provider] !== 'string') continue;
    const value = body[provider].trim();
    if (!/^[\w-]*$/.test(value)) throw new Error(`Key ${provider} chứa ký tự không hợp lệ`);
    updates[provider] = value;
  }
  return updates;
}

// Makes one tiny uncached request to check the key is accepted.
async function testKey(provider, key) {
  const url = provider === 'pexels'
    ? 'https://api.pexels.com/v1/search?query=nature&per_page=1'
    : `https://pixabay.com/api/?key=${encodeURIComponent(key)}&q=nature&per_page=3`;
  const res = await fetch(url, {
    headers: provider === 'pexels' ? { Authorization: key } : {},
    signal: AbortSignal.timeout(10000),
  });
  if (res.ok) return { ok: true };
  const body = (await res.text().catch(() => '')).slice(0, 120);
  return { ok: false, message: `HTTP ${res.status}${body ? `: ${body}` : ''}` };
}

export async function testKeys(keys) {
  const tests = {};
  await Promise.all(
    PROVIDERS.filter((p) => keys[p]).map(async (p) => {
      tests[p] = await testKey(p, keys[p]).catch((err) => ({ ok: false, message: err.message }));
    }),
  );
  return tests;
}
