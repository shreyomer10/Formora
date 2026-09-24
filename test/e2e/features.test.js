// Real Chrome integration checks; uses a temporary browser profile and synthetic data only.
const puppeteer = require('puppeteer-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const EXT = path.resolve(__dirname, '../..');

async function run(assets = false) {
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end(fs.readFileSync(path.join(EXT, 'test/sample-form.html')));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, pipe: true, enableExtensions: [EXT], args: ['--no-first-run', '--no-default-browser-check'] });
    const target = await browser.waitForTarget((t) => t.type() === 'service_worker');
    const id = new URL(target.url()).host;
    const optionsUrl = `chrome-extension://${id}/src/options/options.html`;
    await browser.waitForTarget((t) => t.url() === optionsUrl);
    const options = await (await browser.waitForTarget((t) => t.url() === optionsUrl)).page();
    await options.setViewport({ width: 1280, height: 800 });
    await options.waitForSelector('#model option');
    assert(await options.$eval('#onboarding', (e) => !e.hidden), 'first install shows setup guide');
    const out = path.join(EXT, 'store/assets');
    if (assets) { fs.mkdirSync(out, { recursive: true }); await options.evaluate(() => scrollTo(0, 0)); await options.screenshot({ path: path.join(out, '03-onboarding.png') }); }
    await options.type('#apiKey', 'fake-test-key');
    await options.type('[data-k=firstName]', 'Asha');
    await options.type('[data-k=email]', 'asha@example.com');
    await options.select('#panelLayout', 'sidebar');
    // File selection must preserve the unsaved key/profile/layout.
    const file = await options.$('#resumeFile');
    await file.uploadFile(path.join(EXT, 'test/e2e/fixtures/resume.pdf'));
    await options.waitForFunction(() => document.getElementById('resumeInfo').textContent.includes('resume.pdf'));
    assert.equal(await options.$eval('#apiKey', (e) => e.value), 'fake-test-key');
    assert.equal(await options.$eval('#panelLayout', (e) => e.value), 'sidebar');
    // Mock the API inside this temporary worker; no request leaves Chrome.
    const worker = await target.worker();
    await worker.evaluate(() => {
      globalThis.fetch = async (_url, init) => {
        const request = JSON.parse(init.body);
        const data = Array.isArray(request.input)
          ? { resumeText: 'Asha Verma, backend engineer.', profile: { firstName: 'Asha', lastName: 'Verma', email: 'asha@example.com', skills: 'Node.js, Go', workExperience: [], education: [], certifications: [] } }
          : { ok: true };
        return { ok: true, json: async () => ({ output_text: JSON.stringify(data) }) };
      };
    });
    await options.click('#extract');
    await options.waitForFunction(() => document.getElementById('resumeMsg').textContent.startsWith('Done.'));
    assert(await options.$eval('#onboarding', (e) => !e.hidden), 'extraction waits for explicit review/save');
    await options.click('#save');
    await options.waitForFunction(() => document.getElementById('onboarding').hidden);
    await options.reload(); await options.waitForSelector('#model option');
    assert(await options.$eval('#onboarding', (e) => e.hidden), 'onboarding completion persists');
    assert.equal(await options.$eval('#panelLayout', (e) => e.value), 'sidebar');
    assert.equal(await options.$$eval('#fallbackModels select', (nodes) => nodes.length), 2);
    await options.click('.fallback-row:last-child [data-move-up]');
    assert.equal(await options.$eval('#fallbackModels select', (e) => e.value), 'gemini-3.1-pro-preview');
    await options.click('#testModels');
    await options.waitForFunction(() => document.getElementById('modelResults').textContent.includes('Available'));
    assert.equal((await options.$eval('#modelResults', (e) => e.textContent)).split('\n').length, 3);
    // Verify old comma-separated IDs, custom IDs, and explicit empty selection survive reload/save.
    await options.evaluate(async () => {
      const { settings } = await chrome.storage.local.get('settings');
      await chrome.storage.local.set({ settings: { ...settings, fallbackModels: 'gemini-old-custom, gemini-3.5-flash-lite' } });
    });
    await options.reload(); await options.waitForSelector('#fallbackModels select');
    assert.equal(await options.$eval('#fallbackModels select', (e) => e.value), 'gemini-old-custom');
    await options.click('#fallbackModels button'); await options.click('#fallbackModels button');
    await options.click('#save');
    await options.waitForFunction(async () => (await chrome.storage.local.get('settings')).settings.fallbackModels.length === 0);
    await options.reload(); await options.waitForSelector('#model option');
    assert.equal(await options.$$eval('#fallbackModels select', (nodes) => nodes.length), 0);
    await options.click('#addFallback'); await options.click('#addFallback'); await options.click('#save');
    // No key needed for the deterministic form fixture.
    await options.evaluate(async () => {
      const { settings } = await chrome.storage.local.get('settings');
      const { profile } = await chrome.storage.local.get('profile');
      await chrome.storage.local.set({ settings: { ...settings, apiKey: '' }, profile: {
        ...profile, phone: '+91 9876543210', dob: '1998-04-12', linkedin: 'https://linkedin.com/in/asha',
        noticePeriod: '30', expectedCtc: '14 LPA', totalExperienceYears: '2.5', country: 'India', degree: 'B.Tech',
        tenthPercentage: '92%', twelfthPercentage: '88%', cgpa: '8.9', rollNumber: 'CS2019-042',
      } });
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    const origin = `http://127.0.0.1:${server.address().port}`;
    await page.goto(origin);
    await page.waitForFunction(() => !!document.querySelector('#fn'));
    const appTabId = await options.evaluate(async () => {
      const tabs = await chrome.tabs.query({}); const tab = tabs.find((t) => t.url?.startsWith('http://127.0.0.1')) || tabs.at(-1);
      await chrome.tabs.sendMessage(tab.id, { type: 'FILL_PAGE' });
      return tab.id;
    });
    assert.equal(await page.$('#applypilot-root'), null, 'native mode inserts no panel in the website');
    assert.equal(await page.evaluate(() => innerWidth), 1280, 'no content-script layout change');
    await page.bringToFront();
    const browserWindowId = await options.evaluate(async (id) => (await chrome.tabs.get(id)).windowId, appTabId);
    await options.evaluate((id) => chrome.windows.update(id, { left: 0, top: 0, width: 1000, height: 800 }), browserWindowId);
    const applicationSession = await page.createCDPSession();
    await applicationSession.send('Emulation.clearDeviceMetricsOverride');
    const fullPageWidth = await page.evaluate(() => innerWidth);
    await options.evaluate((windowId) => chrome.sidePanel.open({ windowId }), browserWindowId);
    const nativeTarget = await browser.waitForTarget((t) => t.url().includes('/src/sidepanel/sidepanel.html'));
    const native = await nativeTarget.asPage();
    assert(native, 'browser creates a real native side-panel document');
    await native.waitForSelector('.ap-item');
    console.log('Native browser panel viewport metrics:', fullPageWidth, await page.evaluate(() => ({ inner: innerWidth, outer: outerWidth })), await native.evaluate(() => ({ inner: innerWidth, outer: outerWidth })));
    assert.equal(await page.$('#applypilot-root'), null, 'native panel never overlays the web page');
    assert((await native.$eval('.ap-status-text', (e) => e.textContent)).includes('Filled'));
    // Apply a reviewed answer across the tab-scoped connection.
    await native.evaluate(() => {
      const item = [...document.querySelectorAll('.ap-item')].find((e) => e.textContent.includes('Why do you want'));
      item.querySelector('textarea').value = 'I enjoy building payment systems.';
      item.querySelector('[data-act=apply]').click();
    });
    await page.waitForFunction(() => document.getElementById('why').value === 'I enjoy building payment systems.');
    await native.click('[data-act=diagnostic]');
    await native.waitForFunction(() => document.querySelector('.ap-diagnostic-preview').value.includes('extractionLog'));
    const nativeReport = JSON.parse(await native.$eval('.ap-diagnostic-preview', (e) => e.value));
    assert.equal(nativeReport.site, origin);
    assert(!JSON.stringify(nativeReport).includes('asha@example.com'));
    if (assets) await native.screenshot({ path: path.join(out, 'native-panel-reference.png') });
    // Switching tabs must discard the previous application's fields and edit destination.
    const second = await browser.newPage();
    await second.goto(origin + '/second');
    await second.bringToFront();
    await native.waitForFunction(() => !document.querySelector('.ap-item'));
    await native.click('[data-act=scan]');
    await native.waitForSelector('.ap-item');
    assert.equal(await second.$eval('#fn', (e) => e.value), '', 'scan does not fill another tab');
    await second.evaluate(() => {
      document.body.innerHTML = '<h1>Next step</h1><label>Portfolio URL<input name="portfolio"></label><label>Additional details<textarea name="details"></textarea></label>';
    });
    await native.waitForFunction(() => !document.querySelector('.ap-change').hidden, { timeout: 15000 });
    assert.equal(await native.$('.ap-item'), null, 'SPA step changes clear stale answers');
    await native.click('[data-act=scan-new]');
    await native.waitForFunction(() => document.querySelectorAll('.ap-item').length === 2);
    await page.bringToFront();
    await native.waitForFunction(() => document.querySelector('.ap-status-text').textContent.includes('Filled'));
    await second.close();
    await page.reload();
    await native.waitForFunction(() => !document.querySelector('.ap-item') && !document.querySelector('.ap-status-text').textContent.includes('loading'));
    await native.click('[data-act=fill]');
    await native.waitForFunction(() => document.querySelector('.ap-status-text').textContent.includes('Filled'));
    assert.equal(await page.$('#applypilot-root'), null, 'reload keeps the overlay out of the page');
    await native.click('[data-act=settings]');
    await options.bringToFront();
    await options.reload(); await options.waitForSelector('#model option');
    await options.select('#panelLayout', 'dialog'); await options.click('#save');
    await page.waitForSelector('#applypilot-root .ap-panel');
    await page.setViewport({ width: 1280, height: 800 });
    await page.bringToFront();
    if (assets) await page.screenshot({ path: path.join(out, '02-dialog.png') });
    await browser.defaultBrowserContext().overridePermissions(origin, ['clipboard-read', 'clipboard-write']);
    await page.click('[data-act=diagnostic]');
    await page.waitForFunction(() => document.querySelector('.ap-diagnostic-message').textContent.startsWith('Copied'));
    const report = await page.evaluate(() => navigator.clipboard.readText());
    const parsed = JSON.parse(report);
    assert(parsed.extractionLog.length > 0 && parsed.panelNotes.length > 0);
    assert(!report.includes('asha@example.com') && !report.includes('fake-test-key') && !report.includes('backend engineer'));
    assert(!parsed.panelNotes.some((n) => 'value' in n));
    // Unavailable clipboard still gives a manually selectable report.
    await browser.defaultBrowserContext().overridePermissions(origin, []);
    await page.click('[data-act=diagnostic]');
    await page.waitForFunction(() => !document.querySelector('.ap-diagnostic-preview').hidden);
    assert((await page.$eval('.ap-diagnostic-preview', (e) => e.value)).includes('extractionLog'));
    // New scan with zero fields must not export stale notes from the prior page.
    await page.evaluate(() => document.querySelectorAll('body > *').forEach((e) => e.remove()));
    await options.evaluate(async (tabId) => {
      await chrome.tabs.sendMessage(tabId, { type: 'SCAN_PAGE' });
    }, appTabId);
    await page.click('[data-act=diagnostic]');
    await page.waitForFunction(() => JSON.parse(document.querySelector('.ap-diagnostic-preview').value).panelNotes.length === 0);
    if (assets) {
      const promo = await browser.newPage();
      const logo = fs.readFileSync(path.join(EXT, 'icons/icon128.png')).toString('base64');
      for (const [name, width, height] of [['promo-small.png', 440, 280], ['promo-marquee.png', 1400, 560]]) {
        await promo.setViewport({ width, height });
        await promo.setContent(`<style>*{box-sizing:border-box}body{margin:0;background:#1c3a4b;color:white;font-family:system-ui;height:100vh;display:flex;align-items:center;justify-content:center;gap:7vw}.brand{text-align:center}img{width:${width < 500 ? 72 : 116}px}h1{font-size:${width < 500 ? 32 : 72}px;margin:10px 0;letter-spacing:-1px}p{color:#cbdfe8;font-size:${width < 500 ? 15 : 25}px;margin:0}.card{width:320px;background:#fff;border-radius:24px;padding:34px;color:#1c3a4b;transform:rotate(-4deg)}.line{display:flex;align-items:center;gap:16px;margin:22px 0}.tick{font-size:26px;color:#21704c}.bar{height:13px;border-radius:9px;background:#dce8ed;flex:1}</style><div class="brand"><img src="data:image/png;base64,${logo}"><h1>Formora</h1><p>Fill. Review. Submit yourself.</p></div>${width > 500 ? '<div class="card"><div class="line"><span class="tick">✓</span><div class="bar"></div></div><div class="line"><span class="tick">✓</span><div class="bar"></div></div><div class="line"><span class="tick">✓</span><div class="bar"></div></div></div>' : ''}`);
        await promo.screenshot({ path: path.join(out, name) });
      }
      fs.copyFileSync(path.join(EXT, 'icons/icon128.png'), path.join(out, 'icon128.png'));
    }
    console.log('PASS: install onboarding, resume upload/extraction/review/save, model selection and tests, native side panel/tab switching/remote editing/dialog/settings, clipboard and fallback, diagnostic privacy and stale-state clearing' + (assets ? '; store assets generated' : ''));
  } finally { if (browser) await browser.close(); await new Promise((resolve) => server.close(resolve)); }
}
module.exports = run;
if (require.main === module) run().catch((e) => { console.error(e); process.exitCode = 1; });
