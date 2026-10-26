const $ = (sel, root = document) => root.querySelector(sel);
const form = $('#form');
const statusEl = $('#status');
const resultsEl = $('#results');
const submitBtn = $('#submit');
const CONCURRENCY = 3;

async function fetchJson(url, init) {
  const res = await fetch(url, init);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// The Electron app exposes window.mediaApi (IPC); in the browser we talk to server.js instead.
const api = window.mediaApi || {
  getConfig: () => fetchJson('/api/config'),
  saveConfig: (payload) => fetchJson('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }),
  search: ({ q, types, providers, perPage }) => fetchJson(`/api/search?${new URLSearchParams({
    q,
    types: types.join(','),
    providers: providers.join(','),
    per_page: String(perPage),
  })}`),
};

// ---------- API key settings ----------
const settings = $('#settings');
const settingsForm = $('#settingsForm');
const settingsStatus = $('#settingsStatus');
const saveBtn = $('#saveSettings');

function showConfig(cfg) {
  document.querySelectorAll('.dot').forEach((dot) => {
    const { set } = cfg[dot.dataset.key] || {};
    dot.classList.toggle('ok', set);
    dot.classList.toggle('missing', !set);
    dot.title = set ? 'Đã có API key' : 'Chưa có API key';
  });
  document.querySelectorAll('.current').forEach((node) => {
    const { set, hint } = cfg[node.dataset.key] || {};
    node.textContent = set ? `(hiện tại: ${hint})` : '(chưa có key)';
  });
}

async function loadConfig() {
  try {
    const cfg = await api.getConfig();
    showConfig(cfg);
    return cfg;
  } catch {
    return null;
  }
}

loadConfig().then((cfg) => {
  if (cfg && !cfg.pexels.set && !cfg.pixabay.set) settings.showModal();
});

$('#openSettings').addEventListener('click', () => {
  settingsStatus.textContent = '';
  settings.showModal();
});
$('#closeSettings').addEventListener('click', () => settings.close());

settingsForm.querySelectorAll('.toggle').forEach((btn) => {
  btn.addEventListener('click', () => {
    const input = btn.previousElementSibling;
    input.type = input.type === 'password' ? 'text' : 'password';
    btn.textContent = input.type === 'password' ? 'Hiện' : 'Ẩn';
  });
});

settingsForm.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const payload = {};
  for (const provider of ['pexels', 'pixabay']) {
    const value = settingsForm.elements[provider].value.trim();
    if (settingsForm.elements[`clear-${provider}`].checked) payload[provider] = '';
    else if (value) payload[provider] = value;
  }

  saveBtn.disabled = true;
  settingsStatus.classList.remove('err');
  settingsStatus.textContent = 'Đang lưu và kiểm tra key…';
  document.querySelectorAll('.test').forEach((n) => { n.textContent = ''; n.className = 'test'; });

  try {
    const data = await api.saveConfig(payload);
    showConfig(data);
    for (const [provider, result] of Object.entries(data.tests || {})) {
      const node = $(`.test[data-key="${provider}"]`);
      node.classList.add(result.ok ? 'ok' : 'fail');
      node.textContent = result.ok ? '✓ Key hoạt động' : `✗ Key lỗi: ${result.message}`;
    }
    settingsForm.reset();
    settingsStatus.textContent = 'Đã lưu.';
  } catch (err) {
    settingsStatus.classList.add('err');
    settingsStatus.textContent = `Không lưu được: ${err.message}`;
  } finally {
    saveBtn.disabled = false;
  }
});

function parseKeywords(text) {
  const seen = new Set();
  return text
    .split(/[\n,]/)
    .map((k) => k.trim())
    .filter((k) => k && !seen.has(k.toLowerCase()) && seen.add(k.toLowerCase()));
}

function checked(name) {
  return [...form.querySelectorAll(`input[name="${name}"]:checked`)].map((i) => i.value);
}

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle('err', isError);
}

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function formatDuration(sec) {
  const s = Math.round(sec || 0);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function renderCard(item) {
  const media = el('div', { className: 'media' }, [
    el('span', { className: `badge ${item.provider}`, textContent: item.provider }),
    el('img', { src: item.thumb, alt: item.title || item.author || '', loading: 'lazy' }),
  ]);

  if (item.type === 'video') {
    media.append(el('span', { className: 'tag', textContent: `▶ ${formatDuration(item.duration)}` }));
    let video;
    media.addEventListener('mouseenter', () => {
      if (!item.preview) return;
      video ||= el('video', { src: item.preview, muted: true, loop: true, playsInline: true, preload: 'none' });
      media.append(video);
      video.play().catch(() => {});
    });
    media.addEventListener('mouseleave', () => {
      if (video) { video.pause(); video.remove(); }
    });
  } else if (item.width) {
    media.append(el('span', { className: 'tag', textContent: `${item.width}×${item.height}` }));
  }

  const actions = el('div', { className: 'actions' }, [
    el('a', { href: item.pageUrl, target: '_blank', rel: 'noopener', textContent: 'Trang gốc' }),
  ]);
  if (item.file) {
    actions.append(el('a', { href: item.file, target: '_blank', rel: 'noopener', textContent: item.type === 'video' ? 'File video' : 'File ảnh' }));
  }

  return el('article', { className: 'card' }, [
    media,
    el('div', { className: 'meta' }, [
      el('span', { textContent: item.author ? `by ${item.author}` : '' }),
      el('span', { className: 'title', textContent: item.title, title: item.title }),
      actions,
    ]),
  ]);
}

function createGroup(keyword) {
  const node = $('#tpl-group').content.firstElementChild.cloneNode(true);
  $('h2', node).textContent = keyword;
  $('.count', node).textContent = 'Đang tìm…';
  resultsEl.append(node);
  return node;
}

function fillGroup(node, data) {
  const { items, errors } = data;
  const grid = $('.grid', node);
  const photos = items.filter((i) => i.type === 'photo').length;
  $('.count', node).textContent = `${photos} ảnh · ${items.length - photos} video`;

  $('.errors', node).replaceChildren(
    ...errors.map((e) => el('li', { textContent: `${e.provider} (${e.type === 'photo' ? 'ảnh' : 'video'}): ${e.message}` })),
  );

  if (!items.length) {
    grid.replaceChildren(el('p', { className: 'empty', textContent: 'Không có kết quả.' }));
  } else {
    const cards = items.map((item) => {
      const card = renderCard(item);
      card.dataset.type = item.type;
      return card;
    });
    grid.replaceChildren(...cards);
  }

  node.querySelectorAll('.filters button').forEach((btn) => {
    btn.addEventListener('click', () => {
      node.querySelectorAll('.filters button').forEach((b) => b.classList.toggle('active', b === btn));
      const f = btn.dataset.filter;
      grid.querySelectorAll('.card').forEach((c) => c.classList.toggle('hidden', f !== 'all' && c.dataset.type !== f));
    });
  });

  $('.copy', node).addEventListener('click', async (ev) => {
    const links = items.map((i) => i.file || i.pageUrl).join('\n');
    try {
      await navigator.clipboard.writeText(links);
      ev.target.textContent = 'Đã copy!';
    } catch {
      ev.target.textContent = 'Không copy được';
    }
    setTimeout(() => { ev.target.textContent = 'Copy links'; }, 1500);
  });
}

async function searchKeyword(keyword, opts) {
  const node = createGroup(keyword);
  try {
    fillGroup(node, await api.search({ q: keyword, ...opts }));
  } catch (err) {
    fillGroup(node, { items: [], errors: [{ provider: 'app', type: 'photo', message: err.message }] });
  }
}

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const keywords = parseKeywords($('#keywords').value);
  const types = checked('types');
  const providers = checked('providers');
  const perPage = Math.min(80, Math.max(1, Number($('#perPage').value) || 10));

  if (!keywords.length) return setStatus('Nhập ít nhất một keyword.', true);
  if (!types.length) return setStatus('Chọn ít nhất một loại (Ảnh / Video).', true);
  if (!providers.length) return setStatus('Chọn ít nhất một nguồn.', true);

  resultsEl.replaceChildren();
  submitBtn.disabled = true;
  let done = 0;
  setStatus(`Đang tìm 0/${keywords.length} keyword…`);

  const queue = [...keywords];
  const worker = async () => {
    while (queue.length) {
      await searchKeyword(queue.shift(), { types, providers, perPage });
      setStatus(`Đang tìm ${++done}/${keywords.length} keyword…`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, keywords.length) }, worker));

  setStatus(`Xong ${keywords.length} keyword.`);
  submitBtn.disabled = false;
});
