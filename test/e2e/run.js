// E2E: load the unpacked extension into real Chrome, seed a profile, fill the sample form, assert values.
const puppeteer = require('puppeteer-core');
const http = require('http');
const fs = require('fs');
const path = require('path');

const EXT = path.resolve(__dirname, '..', '..');
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 8765;

const profile = {
  firstName: 'Asha', lastName: 'Verma', email: 'asha@example.com', phone: '+91 9876543210', dob: '1998-04-12',
  linkedin: 'https://linkedin.com/in/asha', noticePeriod: '30', expectedCtc: '14 LPA', totalExperienceYears: '2.5',
  city: 'Pune', country: 'India', skills: 'Node.js, Go, Kafka', degree: 'B.Tech',
};
const resume = { fileName: 'asha-resume.pdf', mimeType: 'application/pdf', base64: Buffer.from('%PDF-1.4 fake').toString('base64'), text: 'Asha Verma, backend engineer.' };

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const f = path.join(EXT, 'test', req.url === '/' ? 'sample-form.html' : req.url);
      fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); res.end(); } else { res.writeHead(200, { 'content-type': 'text/html' }); res.end(d); } });
    }).listen(PORT, () => resolve(srv));
  });
}

(async () => {
  const srv = await serve();
  const headless = process.argv.includes('--headful') ? false : 'new';
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless,
    pipe: true, enableExtensions: [EXT], args: ['--no-first-run', '--no-default-browser-check'],
  });
  let exitCode = 0;
  try {
    const sw = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().includes('service-worker.js'), { timeout: 15000 });
    const extId = new URL(sw.url()).host;
    console.log('extension id', extId);

    const opt = await browser.newPage();
    await opt.goto(`chrome-extension://${extId}/src/options/options.html`);
    await opt.evaluate((profile, resume) => chrome.storage.local.set({ profile, resume, settings: { model: 'gemini-3.8-flash' }, memory: {
      'describe project proud': { label: 'Describe a project you are proud of.', type: 'textarea', answer: 'I built a payments reconciliation service.', ts: Date.now() },
    } }), profile, resume);

    const page = await browser.newPage();
    page.on('console', (m) => { if (m.text().includes('ApplyPilot')) console.log('  page:', m.text().slice(0, 200)); });
    await page.goto(`http://localhost:${PORT}/`);
    await new Promise((r) => setTimeout(r, 800));

    // Trigger the fill through the extension messaging API from the options page.
    const resp = await opt.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((t) => (t.url || t.pendingUrl || '').includes('localhost')) || tabs[tabs.length - 1];
      return await chrome.tabs.sendMessage(tab.id, { type: 'FILL_PAGE' });
    });
    console.log('fill response', resp);
    await new Promise((r) => setTimeout(r, 1500));

    const got = await page.evaluate(() => ({
      fn: document.getElementById('fn').value,
      ln: document.getElementById('ln').value,
      em: document.getElementById('em').value,
      ph: document.getElementById('ph').value,
      dob: document.getElementById('dob').value,
      li: document.getElementById('li').value,
      np: document.getElementById('np').value,
      ctc: document.getElementById('ctc').value,
      cv: document.getElementById('cv').files.length ? document.getElementById('cv').files[0].name : '',
      exp: document.getElementById('exp').value,
      relocate: (document.querySelector('input[name=relocate]:checked') || {}).value || '',
      wa: (document.querySelector('[role=radio][aria-checked=true]') || {}).dataset?.value || '',
      tech: Array.from(document.querySelectorAll('input[name="tech[]"]:checked')).map((x) => x.value),
      degree: (document.querySelector('input[name=degree]:checked') || {}).value || '',
      country: document.getElementById('country-value').textContent,
      countryMenuOpen: !!document.querySelector('.select-menu'),
      why: document.getElementById('why').value,
      proj: document.getElementById('proj').value,
      ref: document.getElementById('ref').value,
      honeypot: document.querySelector('.hp').value,
      panel: !!document.getElementById('applypilot-root'),
      status: (document.querySelector('#applypilot-root .ap-status') || {}).textContent || '',
      labels: Array.from(document.querySelectorAll('#applypilot-root .ap-label')).map((l) => l.textContent),
    }));
    console.log(JSON.stringify(got, null, 1));

    const expect = (name, cond) => { if (!cond) { exitCode = 1; console.log('FAIL', name); } else console.log('ok  ', name); };
    expect('first name', got.fn === 'Asha');
    expect('last name', got.ln === 'Verma');
    expect('email', got.em === 'asha@example.com');
    expect('phone', got.ph === '+91 9876543210');
    expect('dob formatted DD/MM/YYYY', got.dob === '12/04/1998');
    expect('linkedin', got.li === 'https://linkedin.com/in/asha');
    expect('notice period', got.np === '30');
    expect('expected ctc', got.ctc === '14 LPA');
    expect('resume attached', got.cv === 'asha-resume.pdf');
    expect('experience select 1-3', got.exp === '1-3');
    expect('hidden-input styled radio: degree B.Tech', got.degree === 'btech');
    expect('popup-only combobox: country India', got.country === 'India');
    expect('combobox menu closed afterwards', !got.countryMenuOpen);
    expect('memory answer reused', got.proj === 'I built a payments reconciliation service.');
    expect('honeypot untouched', got.honeypot === '');
    expect('why left for LLM (no key)', got.why === '');
    expect('panel rendered', got.panel);
    expect('all 19 questions extracted', got.labels.length >= 19);
    expect('reference field left alone', got.ref === '');
    console.log('status:', got.status);

    // ---- Google Forms mock ----
    await page.goto(`http://localhost:${PORT}/gforms-mock.html`);
    await new Promise((r) => setTimeout(r, 800));
    await opt.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((t) => (t.url || t.pendingUrl || '').includes('localhost')) || tabs[tabs.length - 1];
      return await chrome.tabs.sendMessage(tab.id, { type: 'FILL_PAGE' });
    });
    await new Promise((r) => setTimeout(r, 2000));
    const g = await page.evaluate(() => ({
      name: document.querySelector('[name="entry.1001"]').value,
      email: document.querySelector('[name="entry.1002"]').value,
      notice: (document.querySelector('[role=radiogroup]:not([aria-label]) [role=radio][aria-checked=true]') || {}).dataset?.value || '',
      degree: (document.querySelector('[role=listbox] [role=option][aria-selected=true]') || {}).dataset?.value || '',
      status: (document.querySelector('#applypilot-root .ap-status') || {}).textContent || '',
      labels: Array.from(document.querySelectorAll('#applypilot-root .ap-label')).map((l) => l.textContent),
    }));
    console.log(JSON.stringify(g, null, 1));
    expect('gforms: full name', g.name === 'Asha Verma');
    expect('gforms: email', g.email === 'asha@example.com');
    expect('gforms: notice period radio "30 days"', g.notice === '30 days');
    expect('gforms: degree listbox B.Tech', g.degree === 'B.Tech');
    expect('gforms: 8 questions (incl. 2 grid rows)', g.labels.length === 8);
  } catch (e) {
    exitCode = 1;
    console.error('ERROR', e);
  } finally {
    await browser.close();
    srv.close();
    process.exit(exitCode);
  }
})();
