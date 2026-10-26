const { contextBridge, ipcRenderer } = require('electron');

async function call(channel, arg) {
  const result = await ipcRenderer.invoke(channel, arg);
  if (result && typeof result === 'object' && 'error' in result) throw new Error(result.error);
  return result;
}

contextBridge.exposeInMainWorld('mediaApi', {
  getConfig: () => call('config:get'),
  saveConfig: (payload) => call('config:save', payload),
  search: (params) => call('search', params),
});
