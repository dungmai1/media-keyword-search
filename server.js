// Dev web server: serves ./public and exposes the same API the Electron app uses over IPC.
// Keys are read from / written to .env.
import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { clearCache, keyStatus, parseKeyUpdates, parseSearchParams, search, testKeys } from './src/media.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const ENV_FILE = path.join(ROOT, '.env');
if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

const PORT = Number(process.env.PORT) || 3000;
// Bound to loopback by default: the config endpoint can read/replace API keys.
const HOST = process.env.HOST || '127.0.0.1';
const ENV_NAMES = { pexels: 'PEXELS_API_KEY', pixabay: 'PIXABAY_API_KEY' };
const keys = {
  pexels: process.env.PEXELS_API_KEY || '',
  pixabay: process.env.PIXABAY_API_KEY || '',
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

async function saveEnv(updates) {
  const lines = existsSync(ENV_FILE) ? (await readFile(ENV_FILE, 'utf8')).split('\n') : [];
  for (const [provider, value] of Object.entries(updates)) {
    const name = ENV_NAMES[provider];
    const i = lines.findIndex((l) => l.startsWith(`${name}=`));
    if (i >= 0) lines[i] = `${name}=${value}`;
    else lines.splice(lines.at(-1) === '' ? lines.length - 1 : lines.length, 0, `${name}=${value}`);
  }
  if (lines.at(-1) !== '') lines.push('');
  await writeFile(ENV_FILE, lines.join('\n'), { mode: 0o600 });
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 10_000) throw new Error('Body quá lớn');
  }
  return JSON.parse(raw || '{}');
}

async function handleConfig(req, res) {
  if (req.method === 'GET') return sendJson(res, 200, keyStatus(keys));
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
  // Requiring JSON forces a CORS preflight, so other websites cannot post here.
  if (!String(req.headers['content-type']).startsWith('application/json')) {
    return sendJson(res, 415, { error: 'Content-Type phải là application/json' });
  }

  let updates;
  try {
    updates = parseKeyUpdates(await readBody(req));
  } catch (err) {
    return sendJson(res, 400, { error: err instanceof SyntaxError ? 'JSON không hợp lệ' : err.message });
  }

  if (Object.keys(updates).length) {
    await saveEnv(updates);
    Object.assign(keys, updates);
    clearCache();
  }
  return sendJson(res, 200, { ...keyStatus(keys), tests: await testKeys(keys) });
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/config') {
    return handleConfig(req, res).catch((err) => sendJson(res, 500, { error: err.message }));
  }

  if (url.pathname === '/api/search') {
    let params;
    try {
      params = parseSearchParams({
        q: url.searchParams.get('q'),
        types: url.searchParams.get('types'),
        providers: url.searchParams.get('providers'),
        perPage: url.searchParams.get('per_page'),
      });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
    try {
      return sendJson(res, 200, await search(params, keys));
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  // Static files from ./public
  const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const file = path.join(ROOT, 'public', path.normalize(rel));
  if (!file.startsWith(path.join(ROOT, 'public'))) return sendJson(res, 403, { error: 'Forbidden' });
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    sendJson(res, 404, { error: 'Not found' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Media search: http://localhost:${PORT}`);
  if (!keys.pexels) console.warn('! PEXELS_API_KEY chưa được đặt (nhập trong mục API keys trên web)');
  if (!keys.pixabay) console.warn('! PIXABAY_API_KEY chưa được đặt (nhập trong mục API keys trên web)');
});
