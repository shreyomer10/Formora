const status = document.getElementById('status');
const FILES = ['src/lib/rules.js', 'src/content/util.js', 'src/content/extractor.js', 'src/content/gforms.js', 'src/content/filler.js', 'src/content/overlay.js', 'src/content/main.js'];

async function send(type) {
  status.textContent = 'Working...';
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id || !/^https?:|^file:/.test(tab.url || '')) { status.textContent = 'Open a job application page first.'; return; }
  try {
    await chrome.tabs.sendMessage(tab.id, { type });
  } catch {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: FILES });
      await chrome.scripting.insertCSS({ target: { tabId: tab.id, allFrames: true }, files: ['src/content/overlay.css'] });
      await chrome.tabs.sendMessage(tab.id, { type });
    } catch (e) {
      status.textContent = 'Could not reach the page: ' + e.message;
      return;
    }
  }
  status.textContent = 'Running. See the panel on the page.';
  setTimeout(() => window.close(), 800);
}

document.getElementById('fill').onclick = () => send('FILL_PAGE');
document.getElementById('scan').onclick = () => send('SCAN_PAGE');
document.getElementById('options').onclick = () => chrome.runtime.openOptionsPage();

chrome.storage.local.get(['settings', 'profile', 'resume']).then(({ settings = {}, profile = {}, resume }) => {
  const missing = [];
  if (!settings.apiKey) missing.push('API key');
  if (!profile.email) missing.push('profile');
  if (!resume) missing.push('resume');
  if (missing.length) status.textContent = 'Setup needed: ' + missing.join(', ');
});
