import { app, BrowserWindow, ipcMain, safeStorage, shell } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PROVIDERS, clearCache, keyStatus, parseKeyUpdates, parseSearchParams, search, testKeys,
} from '../src/media.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const keys = { pexels: '', pixabay: '' };

// Keys live in the user's app-data folder, encrypted with the OS keychain when available.
const configFile = () => path.join(app.getPath('userData'), 'config.json');

async function loadKeys() {
  let saved;
  try {
    saved = JSON.parse(await readFile(configFile(), 'utf8'));
  } catch {
    return;
  }
  for (const p of PROVIDERS) {
    const value = saved[p];
    if (!value) continue;
    try {
      keys[p] = saved.encrypted ? safeStorage.decryptString(Buffer.from(value, 'base64')) : value;
    } catch {
      keys[p] = '';
    }
  }
}

async function saveKeys() {
  const encrypted = safeStorage.isEncryptionAvailable();
  const data = { encrypted };
  for (const p of PROVIDERS) {
    data[p] = keys[p] && encrypted ? safeStorage.encryptString(keys[p]).toString('base64') : keys[p];
  }
  await writeFile(configFile(), JSON.stringify(data, null, 2), { mode: 0o600 });
}

// Errors are returned as { error } so the renderer gets the plain message.
function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, arg) => {
    try {
      return await fn(arg);
    } catch (err) {
      return { error: err.message };
    }
  });
}

handle('config:get', () => keyStatus(keys));

handle('config:save', async (body) => {
  const updates = parseKeyUpdates(body);
  if (Object.keys(updates).length) {
    Object.assign(keys, updates);
    await saveKeys();
    clearCache();
  }
  return { ...keyStatus(keys), tests: await testKeys(keys) };
});

handle('search', (params) => search(parseSearchParams(params), keys));

function isWebUrl(url) {
  return /^https?:\/\//i.test(url);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 720,
    minHeight: 500,
    show: false,
    title: 'Media Keyword Search',
    webPreferences: {
      preload: path.join(ROOT, 'electron', 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  // Links (source page, media file) open in the user's default browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isWebUrl(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    event.preventDefault();
    if (isWebUrl(url)) shell.openExternal(url);
  });

  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(ROOT, 'public', 'index.html'));
}

app.whenReady().then(async () => {
  await loadKeys();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
