// Debug helper: load the extension, open a test page, run a scan and print what was extracted.
// usage: node debug.js workday-mock.html#step2 [--fill]
const puppeteer = require('puppeteer-core');
const http = require('http');
const fs = require('fs');
const path = require('path');
const EXT = path.resolve(__dirname, '..', '..');
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 8766;
const target = process.argv[2] || 'workday-mock.html';
const fill = process.argv.includes('--fill');

(async () => {
  const srv = http.createServer((req, res) => {
    const f = path.join(EXT, 'test', req.url.split('#')[0].replace(/^\//, '') || 'sample-form.html');
    fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); res.end(); } else { res.writeHead(200, { 'content-type': 'text/html' }); res.end(d); } });
  }).listen(PORT);
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', pipe: true, enableExtensions: [EXT], args: ['--no-first-run'] });
  try {
    const sw = await browser.waitForTarget((t) => t.type() === 'service_worker', { timeout: 15000 });
    const extId = new URL(sw.url()).host;
    const opt = await browser.newPage();
    await opt.goto(`chrome-extension://${extId}/src/options/options.html`);
    await opt.evaluate(() => chrome.storage.local.set({
      profile: {
        firstName: 'Asha', lastName: 'Verma', email: 'asha@example.com', skills: 'Python, Docker, Kotlin, Haskell', degree: 'B.Tech',
        workExperience: [
          { title: 'Backend Engineer', company: 'Acme Payments', location: 'Pune', startDate: '2023-06', endDate: '', current: true, description: 'Built it.' },
          { title: 'Software Intern', company: 'Beta Labs', location: 'Remote', startDate: '2022-01', endDate: '2022-06', current: false, description: 'Wrote Go.' },
        ],
        education: [{ school: 'IIIT NR', degree: 'B.Tech', field: 'Data Science and Artificial Intelligence', startDate: '2018-08', endDate: '2022-05', gpa: '8.9' }],
        certifications: [{ name: 'AWS Dev', issuer: 'Amazon', number: 'AWS-123', issued: '2024-03-15', expires: '2027-03' }],
      },
      resume: { fileName: 'asha-resume.pdf', mimeType: 'application/pdf', base64: btoa('%PDF-1.4 fake'), text: 'x' },
      settings: {}, memory: {},
    }));
    const page = await browser.newPage();
    page.on('console', (m) => console.log('  page:', m.text().slice(0, 300)));
    await page.goto(`http://localhost:${PORT}/${target}`);
    await new Promise((r) => setTimeout(r, 800));
    if (process.argv.includes('--preadd')) await page.evaluate(() => { document.getElementById('addWork').click(); document.getElementById('addWork').click(); document.getElementById('addCert').click(); });
    await opt.evaluate(async (type) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((t) => (t.url || '').includes('localhost')) || tabs[tabs.length - 1];
      return await chrome.runtime.sendMessage({ type: 'RUN_TAB', tabId: tab.id, mode: type === 'SCAN_PAGE' ? 'scan' : 'fill' });
    }, fill ? 'FILL_PAGE' : 'SCAN_PAGE');
    await new Promise((r) => setTimeout(r, fill ? 12000 : 3000));
    const out = await page.evaluate(() => {
      const qs = Array.from(document.querySelectorAll('#applypilot-root .ap-item')).map((i) => i.textContent.replace(/\s+/g, ' ').trim().slice(0, 160));
      const inputs = Array.from(document.querySelectorAll('input, textarea, button[aria-haspopup]')).filter((el) => !el.closest('#applypilot-root') && el.type !== 'hidden' && el.offsetParent);
      const reg = window.JAF ? window.JAF.registry : null;
      const known = new Set();
      if (reg) for (const e of reg.values()) { if (e.el) known.add(e.el); (e.els || []).forEach((x) => known.add(x)); }
      const orphans = inputs.filter((el) => !known.has(el)).map((el) => `${el.tagName}#${el.id}.${el.className} label=${(el.closest('.field') || el.parentElement).textContent.trim().slice(0, 40)}`);
      return { qs, orphans, status: (document.querySelector('#applypilot-root .ap-status') || {}).textContent };
    });
    console.log(JSON.stringify(out, null, 1));
  } finally {
    await browser.close();
    srv.close();
  }
})();
