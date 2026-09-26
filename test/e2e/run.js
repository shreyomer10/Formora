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
  tenthPercentage: '92%', twelfthPercentage: '88%', cgpa: '8.9', rollNumber: 'CS2019-042',
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
      'http://localhost:8765|describe project proud': { approved: true, origin: 'http://localhost:8765', label: 'Describe a project you are proud of.', type: 'textarea', answer: 'I built a payments reconciliation service.', ts: Date.now() },
    } }), profile, resume);

    const page = await browser.newPage();
    page.on('console', (m) => { if (m.text().includes('ApplyPilot')) console.log('  page:', m.text().slice(0, 200)); });
    await page.goto(`http://localhost:${PORT}/`);
    await new Promise((r) => setTimeout(r, 800));

    // Trigger the fill through the extension messaging API from the options page.
    const resp = await opt.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((t) => (t.url || t.pendingUrl || '').includes('localhost')) || tabs[tabs.length - 1];
      return await chrome.runtime.sendMessage({ type: 'RUN_TAB', tabId: tab.id, mode: 'fill' });
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
      p10: document.getElementById('p10').value, p12: document.getElementById('p12').value, gcg: document.getElementById('gcg').value, roll: document.getElementById('roll').value,
      applyAll: !!document.querySelector('#applypilot-root .ap-tools:not([hidden]) [data-act="apply-all"]'),
      resizeGrip: !!document.querySelector('#applypilot-root .ap-resize'),
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
    expect('searchable country left for manual selection', got.country === '' && got.labels.some((l) => /Country.*Fill manually/.test(l)));
    expect('combobox menu closed afterwards', !got.countryMenuOpen);
    expect('memory answer reused', got.proj === 'I built a payments reconciliation service.');
    expect('honeypot untouched', got.honeypot === '');
    expect('why left for LLM (no key)', got.why === '');
    expect('panel rendered', got.panel);
    expect('all 23 questions extracted', got.labels.length >= 23);
    expect('reference field left alone', got.ref === '');
    expect('10th / 12th / graduation CGPA / roll number from profile', got.p10 === '92%' && got.p12 === '88%' && got.gcg === '8.9' && got.roll === 'CS2019-042');
    expect('Apply all button shown for editable answers', got.applyAll);
    expect('resize grip present', got.resizeGrip);

    await page.click('#applypilot-root [data-filter="attention"]');
    const filtered = await page.$$eval('#applypilot-root .ap-item:not([hidden])', (items) => items.length > 0 && items.every((i) => ['manual', 'fail', 'skipped'].includes(i.dataset.state)));
    await page.click('#applypilot-root [data-filter="review"]');
    const emptyReview = await page.$eval('#applypilot-root .ap-filter-empty', (e) => !e.hidden);
    await page.click('#applypilot-root [data-filter="all"]');
    const reviewUi = await page.evaluate(() => {
      const root = document.getElementById('applypilot-root');
      return { bannerHidden: getComputedStyle(root.querySelector('.ap-change')).display === 'none', technicalBadges: [...root.querySelectorAll('.ap-badge')].some((b) => /^(combobox|textarea|text|profile|memory|ai)$/.test(b.textContent.trim())) };
    });
    expect('review panel: action filter and empty review state work', filtered && emptyReview);
    expect('review panel: hidden banner takes no space; no technical badges', reviewUi.bannerHidden && !reviewUi.technicalBadges);

    await page.evaluate(() => {
      const item = [...document.querySelectorAll('#applypilot-root .ap-item')].find((i) => /Why do you want/.test(i.textContent));
      item.querySelector('textarea').value = 'Because payments are hard.';
    });
    await page.click('#applypilot-root [data-act="apply-all"]');
    await page.waitForFunction(() => /Applied \d+/.test(document.querySelector('#applypilot-root .ap-tools-note').textContent));
    const applied = await page.$eval('#why', (e) => e.value);
    expect('Apply all wrote the edited answer into the form', applied === 'Because payments are hard.');

    // Same page, one field re-mounted by the framework (Workday does this on blur): the list must stay.
    const rerender = await page.evaluate(async () => {
      const old = document.getElementById('np');
      const fresh = old.cloneNode(true); old.replaceWith(fresh);
      await new Promise((r) => setTimeout(r, 3500));
      return { items: document.querySelectorAll('#applypilot-root .ap-item').length, bar: !document.querySelector('#applypilot-root .ap-change').hidden, empty: !!document.querySelector('#applypilot-root .ap-empty') };
    });
    console.log('re-render', rerender);
    expect('re-mounting one input on the same page keeps the answers (no "page changed")', rerender.items > 10 && !rerender.bar && !rerender.empty);

    // Resize: drag the grip, panel grows and the size is remembered.
    const resized = await page.evaluate(async () => {
      const p = document.querySelector('#applypilot-root .ap-panel');
      const grip = document.querySelector('#applypilot-root .ap-resize');
      const before = p.getBoundingClientRect();
      const g = grip.getBoundingClientRect();
      const ev = (type, x, y) => grip.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, pointerId: 2, isPrimary: true }));
      ev('pointerdown', g.left + 5, g.top + 5); ev('pointermove', g.left + 125, g.top + 85); ev('pointerup', g.left + 125, g.top + 85);
      await new Promise((r) => setTimeout(r, 50));
      const after = p.getBoundingClientRect();
      return { dw: Math.round(after.width - before.width), dh: Math.round(after.height - before.height), saved: sessionStorage.getItem('applypilot.size') };
    });
    console.log('resize', resized);
    expect('panel resizable by its corner grip', resized.dw >= 100 && resized.dh >= 60 && !!resized.saved);
    console.log('status:', got.status);

    // ---- Google Forms mock ----
    await page.goto(`http://localhost:${PORT}/gforms-mock.html`);
    await new Promise((r) => setTimeout(r, 800));
    await opt.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((t) => (t.url || t.pendingUrl || '').includes('localhost')) || tabs[tabs.length - 1];
      return await chrome.runtime.sendMessage({ type: 'RUN_TAB', tabId: tab.id, mode: 'fill' });
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

    // ---- Workday-style mock: nav chrome, multi-step, repeatable sections, typeaheads, drop zone ----
    await opt.evaluate((profile) => chrome.storage.local.set({ profile }), {
      ...profile,
      workExperience: [
        { title: 'Backend Engineer', company: 'Acme Payments', location: 'Pune', startDate: '2023-06', endDate: '', current: true, description: 'Built the reconciliation service.' },
        { title: 'Software Intern', company: 'Beta Labs', location: 'Remote', startDate: '2022-01', endDate: '2022-06', current: false, description: 'Wrote Go microservices.' },
      ],
      education: [{ school: 'IIIT Naya Raipur', degree: 'B.Tech', field: 'Data Science and Artificial Intelligence', startDate: '2018-08', endDate: '2022-05', gpa: '8.9' }],
      certifications: [{ name: 'AWS Certified Developer', issuer: 'Amazon', number: 'AWS-123', issued: '2024-03-15', expires: '2027-03' }],
      skills: 'Python, Docker, Kotlin, Haskell',
    });
    await page.goto(`http://localhost:${PORT}/workday-mock.html`);
    await new Promise((r) => setTimeout(r, 800));
    const fillActive = () => opt.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((t) => (t.url || t.pendingUrl || '').includes('localhost')) || tabs[tabs.length - 1];
      return await chrome.runtime.sendMessage({ type: 'RUN_TAB', tabId: tab.id, mode: 'fill' });
    });
    await fillActive();
    await new Promise((r) => setTimeout(r, 1500));
    const w1 = await page.evaluate(() => ({
      fn: document.getElementById('fn').value, ln: document.getElementById('ln').value, em: document.getElementById('em').value,
      labels: Array.from(document.querySelectorAll('#applypilot-root .ap-label')).map((l) => l.textContent),
      status: (document.querySelector('#applypilot-root .ap-status') || {}).textContent || '',
      step: (document.querySelector('#applypilot-root .ap-step') || {}).textContent || '',
    }));
    console.log(JSON.stringify(w1, null, 1));
    expect('wd step1: name + email filled', w1.fn === 'Asha' && w1.ln === 'Verma' && w1.em === 'asha@example.com');
    expect('wd step1: header language/settings buttons ignored', !w1.labels.some((l) => /selector button/i.test(l)));
    expect('wd step1: panel shows step 1', /step 1/.test(w1.step));

    // Drag the panel by its header.
    const drag = await page.evaluate(async () => {
      const head = document.querySelector('#applypilot-root .ap-head');
      const r = head.getBoundingClientRect();
      const ev = (type, x, y) => head.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, pointerId: 1, isPrimary: true }));
      ev('pointerdown', r.left + 20, r.top + 10);
      ev('pointermove', r.left - 200, r.top - 150);
      ev('pointerup', r.left - 200, r.top - 150);
      await new Promise((res) => setTimeout(res, 50));
      const after = head.getBoundingClientRect();
      return { dx: Math.round(r.left - after.left), dy: Math.round(r.top - after.top), pos: sessionStorage.getItem('applypilot.pos') };
    });
    console.log('drag', drag);
    expect('wd panel: draggable (moved ~200px left, 150px up)', drag.dx > 150 && drag.dy > 100 && !!drag.pos);

    // Move to the next step the way the user would; the watcher must notice and offer to fill.
    await page.click('#next1');
    await new Promise((r) => setTimeout(r, 3000));
    const change = await page.evaluate(() => {
      const bar = document.querySelector('#applypilot-root .ap-change');
      return { hidden: !bar || bar.hidden, text: bar ? bar.textContent : '' };
    });
    console.log('page-change bar', change);
    expect('wd step2: "Page changed" offer shown after Save and Continue', !change.hidden && /Page changed/.test(change.text));

    // Dismiss must stick: the bar may not come back on its own.
    await page.click('#applypilot-root .ap-change [data-act="dismiss"]');
    await new Promise((r) => setTimeout(r, 3500));
    const dismissed = await page.evaluate(() => document.querySelector('#applypilot-root .ap-change').hidden);
    expect('wd step2: dismissing "Page changed" keeps it dismissed', dismissed);
    await page.evaluate(() => {
      window.typeaheadEvents = 0;
      for (const input of document.querySelectorAll('.search input')) {
        for (const name of ['focus', 'input', 'keydown', 'change']) {
          input.addEventListener(name, () => window.typeaheadEvents++);
        }
      }
    });
    // The header button still fills the new step.
    await page.click('#applypilot-root [data-act="fill"]');
    // Wait for section preparation and filling to finish.
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const st = await page.evaluate(() => (document.querySelector('#applypilot-root .ap-status') || {}).textContent || '');
      if (/^Filled|^No form|^Error/.test(st)) break;
    }
    await new Promise((r) => setTimeout(r, 500));
    const w2 = await page.evaluate(() => {
      const ent = (kind, n) => document.querySelectorAll(`[data-entry="${kind}"]`)[n];
      const val = (e, f) => { const x = e && e.querySelector(`[data-f="${f}"]`); return x ? (x.type === 'checkbox' ? x.checked : x.tagName === 'BUTTON' ? x.textContent : x.value) : null; };
      const dates = (e) => Array.from(e ? e.querySelectorAll('.date') : []).map((d) => Array.from(d.querySelectorAll('input')).map((i) => i.value).join('/'));
      const w0 = ent('work', 0), wA = ent('work', 1), e0 = ent('education', 0), c0 = ent('cert', 0);
      return {
        workCount: document.querySelectorAll('[data-entry="work"]').length,
        eduCount: document.querySelectorAll('[data-entry="education"]').length,
        certCount: document.querySelectorAll('[data-entry="cert"]').length,
        w0: { title: val(w0, 'title'), company: val(w0, 'company'), current: val(w0, 'current'), dates: dates(w0), desc: val(w0, 'description') },
        w1: { title: val(wA, 'title'), company: val(wA, 'company'), current: val(wA, 'current'), dates: dates(wA) },
        e0: { school: val(e0, 'school'), degree: val(e0, 'degree'), field: val(e0, 'field') },
        c0: { name: val(c0, 'name'), number: val(c0, 'number'), dates: dates(c0) },
        chips: Array.from(document.querySelectorAll('.chip')).map((c) => c.textContent),
        typeaheadEvents: window.typeaheadEvents,
        manualCards: Array.from(document.querySelectorAll('#applypilot-root .ap-item')).filter((i) => /Fill manually/.test(i.textContent)).map((i) => ({ text: i.textContent, apply: !!i.querySelector('[data-act="apply"]'), locate: !!i.querySelector('[data-act="locate"]') })),
        cv: document.getElementById('cvname').textContent,
        certFile: document.querySelector('[data-entry="cert"] input[type=file]').files.length,
        status: (document.querySelector('#applypilot-root .ap-status') || {}).textContent || '',
        step: (document.querySelector('#applypilot-root .ap-step') || {}).textContent || '',
        items: Array.from(document.querySelectorAll('#applypilot-root .ap-item')).map((i) => i.textContent.replace(/\s+/g, ' ').slice(0, 120)),
      };
    });
    console.log(JSON.stringify(w2, null, 1));
    expect('wd: 2 work blocks added via Add / Add Another', w2.workCount === 2);
    expect('wd: education kept at 1 block (already present)', w2.eduCount === 1);
    expect('wd: 1 certification block added', w2.certCount === 1);
    expect('wd: work 1 title/company from entry 1', w2.w0.title === 'Backend Engineer' && w2.w0.company === 'Acme Payments');
    expect('wd: work 1 current ticked, From = 06/2023, To empty', w2.w0.current === true && w2.w0.dates[0] === '06/2023' && w2.w0.dates[1] === '/');
    expect('wd: work 1 description', w2.w0.desc === 'Built the reconciliation service.');
    expect('wd: work 2 from entry 2 with To = 06/2022', w2.w1.title === 'Software Intern' && w2.w1.company === 'Beta Labs' && w2.w1.current === false && w2.w1.dates[1] === '06/2022');
    expect('wd: education school', w2.e0.school === 'IIIT Naya Raipur');
    expect('wd: degree "B.Tech" -> "Bachelor of Technology" in popup dropdown', w2.e0.degree === 'Bachelor of Technology');
    expect('wd: field of study left for manual selection', w2.e0.field === '');
    expect('wd: certification name + number + issued date 03/15/2024', w2.c0.name === 'AWS Certified Developer' && w2.c0.number === 'AWS-123' && w2.c0.dates[0] === '03/15/2024');
    expect('wd: searchable skills left untouched', w2.chips.length === 0);
    expect('wd: no discovery, typing or Enter events on searchable controls', w2.typeaheadEvents === 0);
    expect('wd: two manual cards with suggestions and Locate, without Apply', w2.manualCards.length === 2 && w2.manualCards.every((c) => !c.apply && c.locate) && w2.manualCards.some((c) => c.text.includes('Data Science and Artificial Intelligence')) && w2.manualCards.some((c) => c.text.includes('Python, Docker, Kotlin, Haskell')));
    expect('wd: manual fields excluded from filled count', /Filled 18 of 23 fields/.test(w2.status));
    expect('wd: resume attached through the drop zone', w2.cv === 'Uploaded: asha-resume.pdf');
    expect('wd: certification attachment left alone', w2.certFile === 0);
    expect('wd: panel shows step 2', /step 2/.test(w2.step));
    console.log('status:', w2.status);

    // Direct calls must also refuse searches, even with existing query text,
    // visible options, and a multi-value answer. A click alone is not success.
    const controls = await browser.newPage();
    await controls.setContent('<label>Skills<input id="search" role="combobox" value="existing query" aria-controls="choices"></label><div id="choices" role="listbox"><div role="option">Python</div></div><button id="degree" role="combobox" aria-controls="choices">Select One</button>');
    for (const script of ['util.js', 'filler.js']) await controls.addScriptTag({ path: path.join(EXT, 'src/content', script) });
    const guards = await controls.evaluate(async () => {
      const input = document.getElementById('search');
      let events = 0;
      for (const name of ['focus', 'input', 'keydown', 'change']) input.addEventListener(name, () => events++);
      JAF.registry = new Map([['search', { kind: 'single', el: input, options: [] }], ['degree', { kind: 'single', el: document.getElementById('degree'), options: [] }]]);
      const q = { id: 'search', type: 'combobox', options: [], meta: { multi: true } };
      await JAF.discoverOptions([q]);
      const result = await JAF.fill(q, ['Python', 'Docker']);
      const button = await JAF.fill({ id: 'degree', type: 'combobox' }, 'Python');
      return { result, button, events, value: input.value, discovered: q.options.length };
    });
    expect('direct fill: searchable controls cannot bypass manual fallback', !guards.result.ok && guards.result.manual && guards.events === 0 && guards.value === 'existing query' && guards.discovered === 0);
    expect('button dropdown: ignored selection is not counted as filled', !guards.button.ok);
    await controls.evaluate(() => {
      window.styleRequests = [];
      JAF.worker = (msg) => chrome.runtime.sendMessage(msg);
      window.chrome = { storage: { local: { get: async () => ({ settings: {} }) }, onChanged: { addListener: () => {} } }, runtime: { getURL: () => '', sendMessage: async (msg) => { window.styleRequests.push(msg.type); return { ok: true }; } } };
    });
    // Reproduce an existing tab retaining the previous release's stylesheet.
    const oldStyles = '#applypilot-root { font: 13px system-ui; } #applypilot-root .ap-status { background: #eef3f5; } #applypilot-root .ap-change { display: flex; } #applypilot-root .ap-item.ap-ok { border-left: 4px solid green; }';
    await controls.addStyleTag({ content: oldStyles });
    await controls.addScriptTag({ path: path.join(EXT, 'src/content/overlay.js') });
    const requestedStyles = await controls.evaluate(() => {
      JAF.overlay.show('Ready.');
      return window.styleRequests.join(',');
    });
    expect('existing tab: stale styles trigger a refresh', requestedStyles.includes('REFRESH_OVERLAY_STYLES'));
    await controls.addStyleTag({ path: path.join(EXT, 'src/content/overlay.css') });
    await controls.addStyleTag({ content: oldStyles }); // old injection must not override the updated UI
    // The button transitions from the browser default to the refreshed theme.
    await controls.waitForFunction(() => getComputedStyle(document.querySelector('#applypilot-root .ap-actions [data-act="fill"]')).backgroundColor === 'rgb(28, 58, 75)');
    // Review editors now live in the trusted browser panel for AI drafts.
    const panelTest = await browser.newPage();
    await panelTest.setContent('<!doctype html><body></body>');
    await panelTest.addScriptTag({ path: path.join(EXT, 'src/content/util.js') });
    await panelTest.evaluate(() => { JAF.isSidePanel = true; window.chrome = { runtime: { getURL: () => '' } }; });
    await panelTest.addStyleTag({ path: path.join(EXT, 'src/content/overlay.css') });
    await panelTest.addScriptTag({ path: path.join(EXT, 'src/content/overlay.js') });
    const transitions = await panelTest.evaluate(async () => {
      const results = [
        { q: { id: 'search', label: 'Graduation year', type: 'combobox', meta: { manualFill: 'manual' }, options: [] }, source: 'manual', value: '2027' },
        { q: { id: 'degree', label: 'Describe your work', type: 'textarea', options: [] }, source: 'ai', value: 'My draft answer.' },
      ];
      let shouldFail = true;
      JAF.overlay.render(results, async () => { if (shouldFail) throw new Error('Site unavailable'); return { ok: true }; });
      JAF.overlay.summary(results);
      const root = document.getElementById('applypilot-root');
      const heading = root.querySelector('.ap-status strong').getBoundingClientRect();
      const detail = root.querySelector('.ap-status-detail').getBoundingClientRect();
      const styling = root.querySelector('.ap-title').textContent.trim() === 'Formora'
        && detail.top > heading.bottom
        && /fields\s+1 field still needs your input/.test(root.querySelector('.ap-status-text').textContent)
        && getComputedStyle(root.querySelector('.ap-actions [data-act="fill"]')).backgroundColor === 'rgb(28, 58, 75)'
        && getComputedStyle(root.querySelector('[data-filter="all"]')).borderRadius === '9px'
        && getComputedStyle(root.querySelector('.ap-change')).display === 'none';
      root.querySelector('[data-filter="review"]').click();
      const card = root.querySelector('.ap-item:not([hidden])');
      const onlyReview = card.dataset.state === 'review' && root.querySelectorAll('.ap-item:not([hidden])').length === 1;
      const input = card.querySelector('textarea');
      input.value = 'My revised answer.';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const dirty = card.dataset.state === 'edited' && /Unsaved changes/.test(card.textContent) && !card.hidden;
      await card.querySelector('[data-act="apply"]').onclick();
      root.querySelector('[data-filter="attention"]').click();
      const failed = card.dataset.state === 'fail' && !card.hidden && !card.querySelector('[data-act="apply"]').disabled;
      shouldFail = false;
      await card.querySelector('[data-act="apply"]').onclick();
      const success = card.dataset.state === 'filled' && card.hidden && root.querySelector('[data-filter="attention"] span').textContent === '1' && /Filled 1 of 2 fields/.test(root.querySelector('.ap-status').textContent);
      return { styling, onlyReview, dirty, failed, success };
    });
    expect('review panel: review filter, unsaved edits, failed apply and successful retry', Object.values(transitions).every(Boolean));
    await panelTest.close();
    await controls.close();
  } catch (e) {
    exitCode = 1;
    console.error('ERROR', e);
  } finally {
    await browser.close();
    srv.close();
    process.exit(exitCode);
  }
})();
