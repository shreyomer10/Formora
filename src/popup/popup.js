const status = document.getElementById('status');
const FILES = ['src/lib/security.js', 'src/lib/rules.js', 'src/content/util.js', 'src/content/extractor.js', 'src/content/sections.js', 'src/content/gforms.js', 'src/content/filler.js', 'src/content/overlay.js', 'src/content/main.js'];
let popupTab = null, panelLayout = 'dialog';
document.getElementById('fill').disabled = true;
document.getElementById('scan').disabled = true;
Promise.all([chrome.tabs.query({ active: true, currentWindow: true }), chrome.storage.local.get(['settings'])]).then(([tabs, { settings = {} }]) => {
  popupTab = tabs[0]; panelLayout = settings.panelLayout;
  document.getElementById('fill').disabled = false;
  document.getElementById('scan').disabled = false;
});

async function send(type) {
  // This branch also handles a popup that was already open when Settings changed.
  if (panelLayout === 'sidebar') {
    if (!chrome.sidePanel?.open) { status.textContent = 'This browser does not support native side panels. Choose Floating dialog in Settings.'; return; }
    try { await chrome.sidePanel.open({ windowId: popupTab.windowId }); }
    catch (e) { status.textContent = 'Could not open the browser panel: ' + e.message; return; }
  }
  status.textContent = 'Working...';
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id || !/^https?:/.test(tab.url || '')) { status.textContent = 'Open an HTTPS application page or local test page first.'; return; }
  try {
    // Existing tabs can still have the stylesheet from before an extension reload.
    await chrome.scripting.insertCSS({ target: { tabId: tab.id, frameIds: [0] }, files: ['src/content/overlay.css'] });
  } catch (e) {
    status.textContent = 'Could not style the panel: ' + e.message;
    return;
  }
  try {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'AUTHORIZATION_INFO' }, { frameId: 0 });
    } catch {
      await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, files: FILES });
    }
    const response = await chrome.runtime.sendMessage({ type: 'RUN_TAB', tabId: tab.id, mode: type === 'SCAN_PAGE' ? 'scan' : 'fill' });
    if (!response.ok) throw new Error(response.error);
  } catch (e) {
    status.textContent = 'Could not fill the page: ' + e.message;
    return;
  }
  status.textContent = 'Running. See the panel on the page.';
  setTimeout(() => window.close(), 800);
}

document.getElementById('fill').onclick = () => send('FILL_PAGE');
document.getElementById('scan').onclick = () => send('SCAN_PAGE');
document.getElementById('options').onclick = () => chrome.runtime.openOptionsPage();

chrome.runtime.sendMessage({ type: 'COLOR_SCHEME', dark: window.matchMedia('(prefers-color-scheme: dark)').matches }).catch(() => {});
chrome.storage.local.get(['settings', 'profile', 'resume']).then(({ settings = {}, profile = {}, resume }) => {
  const missing = [];
  if (!settings.apiKey) missing.push('API key');
  if (!profile.email) missing.push('profile');
  if (!resume) missing.push('resume');
  if (missing.length) {
    status.textContent = 'Finish setup: ' + missing.join(', ') + '. Open the setup guide below.';
    const options = document.getElementById('options');
    options.textContent = 'Continue setup';
    options.classList.add('primary');
  }
});
