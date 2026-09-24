// Browser-owned UI. Each connection belongs to one tab and one document; never route
// a pending edit to a newly activated tab or a newly loaded application step.
const JAF = window.JAF;
let port = null, tabId = null, windowId = null, state = null;
let binding = 0, requestId = 0;
const pending = new Map();

function disconnect() {
  binding++;
  const previous = port; port = null; state = null;
  previous?.disconnect();
  for (const { resolve, timer } of pending.values()) { clearTimeout(timer); resolve({ ok: false, note: 'The active page changed. Preview its fields before applying.' }); }
  pending.clear();
}

function request(action, data = {}) {
  if (!port) return Promise.resolve({ ok: false, note: 'Open an application page, then reload it if Formora cannot connect.' });
  const id = ++requestId;
  return new Promise((resolve) => {
    const timer = setTimeout(() => { pending.delete(id); resolve({ ok: false, note: 'The page did not respond. Try again.' }); }, action === 'fill' ? 180000 : 30000);
    pending.set(id, { resolve, timer });
    try { port.postMessage({ requestId: id, action, documentToken: state?.documentToken, version: state?.version, ...data }); }
    catch { clearTimeout(timer); pending.delete(id); resolve({ ok: false, note: 'Connection lost. Reload the application page.' }); }
  });
}

JAF.run = async ({ mode }) => {
  const result = await request(mode);
  if (!result.ok) JAF.overlay.status(result.note);
};
JAF.markSeen = () => request('dismiss');
JAF.registry = new Map();
JAF.highlight = (q) => request('locate', { id: q.id }).then((r) => { if (!r.ok) JAF.overlay.status(r.note); });
JAF.getDiagnostic = async () => {
  const r = await request('diagnostic');
  if (!r.ok) throw new Error(r.note);
  return r.text;
};

function render(next) {
  const changed = !state || state.documentToken !== next.documentToken || state.version !== next.version;
  state = next;
  if (changed) {
    if (next.results.length) {
      const owner = binding, documentToken = next.documentToken, version = next.version;
      JAF.overlay.render(next.results, (q, value) => {
        if (owner !== binding) return Promise.resolve({ ok: false, note: 'The active tab changed. Preview the fields again.' });
        return request('apply', { id: q.id, value, documentToken, version });
      });
    } else JAF.overlay.empty('Click Fill page or Preview fields to read this application.');
  }
  if (next.change?.appeared) JAF.overlay.fieldsAppeared(next.change.appeared);
  else if (next.change) JAF.overlay.pageChanged(next.change);
  else JAF.overlay.pageChanged(null);
  if (next.summary) JAF.overlay.summary();
  else if (next.busy) JAF.overlay.busy(next.status);
  else JAF.overlay.status(next.status);
  document.querySelector('.ap-step').textContent = next.step;
  document.querySelectorAll('[data-act="fill"], [data-act="scan"]').forEach((button) => { button.disabled = next.running; });
}

async function connect(nextTabId) {
  disconnect(); tabId = nextTabId;
  const owner = binding;
  JAF.overlay.ready('Connecting to the active page…');
  if (tabId == null) { JAF.overlay.status('Open a job application in this window.'); return; }
  try {
    const connection = chrome.tabs.connect(tabId, { name: 'formora-panel', frameId: 0 });
    port = connection;
    connection.onMessage.addListener((msg) => {
      if (owner !== binding) return;
      if (msg.type === 'STATE') render(msg.state);
      if (msg.type === 'REPLY') {
        const waiting = pending.get(msg.requestId);
        if (waiting) { clearTimeout(waiting.timer); pending.delete(msg.requestId); waiting.resolve(msg.result); }
      }
    });
    connection.onDisconnect.addListener(() => {
      const error = chrome.runtime.lastError;
      if (owner !== binding) return;
      disconnect();
      JAF.overlay.ready(error ? 'Open a supported application page. Reload it if Formora cannot connect.' : 'The page changed. Waiting for it to finish loading…');
    });
  } catch { JAF.overlay.ready('Cannot connect to this page. Open an application page and reload it.'); }
}

chrome.tabs.onActivated.addListener((info) => { if (info.windowId === windowId) connect(info.tabId); });
chrome.tabs.onUpdated.addListener((id, info) => {
  if (id !== tabId) return;
  if (info.status === 'loading') { disconnect(); JAF.overlay.ready('The page is loading…'); }
  if (info.status === 'complete') connect(id);
});
chrome.tabs.onRemoved.addListener((id) => { if (id === tabId) { disconnect(); JAF.overlay.ready('Open another application tab.'); } });
(async () => {
  windowId = (await chrome.windows.getCurrent()).id;
  const [tab] = await chrome.tabs.query({ active: true, windowId });
  await connect(tab?.id);
})().catch((e) => JAF.overlay.ready(e.message));
