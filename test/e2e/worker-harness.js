const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const EXT = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(EXT, 'src/background/service-worker.js'), 'utf8')
  .replace(/import '\.\.\/lib\/(models|security)\.js';/g, (_, name) => fs.readFileSync(path.join(EXT, `src/lib/${name}.js`), 'utf8'));
const uiSender = { id: 'test-extension', url: 'chrome-extension://test-extension/src/options/options.html' };
const contentSender = { id: 'test-extension', tab: { id: 1, windowId: 1 }, frameId: 0, documentId: 'document-one', url: 'https://jobs.example/application?secret=123' };
function makeSandbox(fetchImpl, settings = {}, { timeoutMs = 30000 } = {}) {
  const listeners = {}, accesses = [];
  const store = { settings: { aiConsent: true, ...settings }, profile: { firstName: 'Asha' }, resume: null };
  const session = { 'authorized:1': { origin: 'https://jobs.example', documentToken: 'token-one', expires: Date.now() + 100000 } };
  const area = (values, name) => ({
    get: async (keys) => Object.fromEntries((keys == null ? Object.keys(values) : Array.isArray(keys) ? keys : [keys]).filter((k) => values[k] !== undefined).map((k) => [k, values[k]])),
    set: async (patch) => Object.assign(values, patch),
    remove: async (key) => { delete values[key]; },
    setAccessLevel: async (option) => { accesses.push({ area: name, ...option }); },
  });
  const sandbox = {
    console, URL, AbortController, TextDecoder, Uint8Array, TypeError,
    setTimeout: (fn, ms) => setTimeout(fn, ms === 30000 ? timeoutMs : 0), clearTimeout,
    fetch: fetchImpl,
    chrome: {
      runtime: { id: uiSender.id, getURL: (p) => `chrome-extension://${uiSender.id}/${p}`, onMessage: { addListener: (fn) => { listeners.message = fn; } }, onInstalled: { addListener: (fn) => { listeners.install = fn; } }, openOptionsPage: async () => { store.opened = (store.opened || 0) + 1; } },
      commands: { onCommand: { addListener() {} } },
      tabs: { onRemoved: { addListener() {} }, query: async () => [], sendMessage: async () => ({ url: contentSender.url, documentToken: 'token-one' }) },
      scripting: {},
      storage: { local: area(store, 'local'), session: area(session, 'session') },
    },
  };
  vm.createContext(sandbox); vm.runInContext(source, sandbox);
  return {
    store, session, accesses, sandbox,
    send: (msg, sender = msg.type === 'LLM_FILL' ? contentSender : uiSender) => new Promise((resolve) => listeners.message({ documentToken: 'token-one', ...msg }, sender, resolve)),
    install: (reason) => listeners.install({ reason }),
  };
}
module.exports = { makeSandbox, contentSender, uiSender };
