// Negative browser regressions plus real user-action positive controls. Synthetic data only.
const puppeteer = require('puppeteer-core');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const EXT = process.env.FORMORA_TEST_EXT || path.resolve(__dirname, '../..');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let checks = 0;
function pass(name) { checks++; console.log('PASS', name); }

(async () => {
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    if (req.url.startsWith('/embedded')) {
      res.end('<!doctype html><label>Email address<input id="email" type="email"></label><label>Resume<input id="resume" type="file"></label>'); return;
    }
    res.end('<!doctype html><title>Security test application</title>' +
      '<script>sessionStorage.setItem("applypilot.active","1");</script>' +
      '<label>Email address<input id="email" type="email"></label>' +
      '<label>Resume<input id="resume" type="file"></label>' +
      '<label>Describe your engineering experience<textarea id="experience"></textarea></label>' +
      '<label><input id="consent" type="checkbox">I confirm the information is accurate</label>' +
      '<label>Work authorization<select id="authorization"><option value="">Choose</option><option>Yes</option><option>No</option></select></label>' +
      `<iframe src="http://localhost:${server.address().port}/embedded"></iframe>`);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, pipe: true, enableExtensions: [EXT], args: ['--no-first-run', '--no-default-browser-check'] });
    const target = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().includes('service-worker.js'));
    const id = new URL(target.url()).host;
    const options = await browser.newPage();
    await options.goto(`chrome-extension://${id}/src/options/options.html`);
    const worker = await target.worker();
    await worker.evaluate(() => {
      globalThis.auditRequests = [];
      globalThis.fetch = async (_url, init) => {
        const body = JSON.parse(init.body); auditRequests.push(body);
        const input = JSON.parse(body.input);
        const answers = input.questions.map((q) => ({ id: q.id, value: 'PRIVATE_AI_DRAFT', values: [], skip: false, note: 'PRIVATE_AI_NOTE' }));
        return { ok: true, json: async () => ({ output_text: JSON.stringify({ answers }) }) };
      };
    });
    await options.evaluate(() => chrome.storage.local.set({
      profile: { email: 'audit@example.invalid', skills: 'Node.js' },
      resume: { base64: btoa('synthetic resume'), fileName: 'audit.pdf', mimeType: 'application/pdf', text: 'Engineer with Node.js experience' },
      settings: { apiKey: 'SYNTHETIC_KEY_NEVER_FOR_PAGE', aiConsent: true, panelLayout: 'dialog' }, memory: {},
    }));
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/?token=URL_SECRET#fragment-secret`);
    await delay(700);
    assert.equal(await page.$('#applypilot-root'), null);
    assert.equal(await page.$eval('#email', (e) => e.value), '');
    assert.equal(await page.$eval('#resume', (e) => e.files.length), 0);
    pass('S1: website sessionStorage cannot activate the panel or disclose a resume');

    // Evaluate inside the extension's isolated world to check Chrome-enforced storage isolation.
    const client = await page.createCDPSession(); const contexts = [];
    client.on('Runtime.executionContextCreated', ({ context }) => contexts.push(context));
    await client.send('Runtime.enable');
    const isolated = contexts.find((c) => !c.auxData?.isDefault && (c.name === id || c.origin === `chrome-extension://${id}`));
    assert(isolated, 'Extension isolated context exists');
    const isolatedEval = async (expression) => {
      const result = await client.send('Runtime.evaluate', { contextId: isolated.id, expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
      return result.result.value;
    };
    const denied = await isolatedEval(`(async () => { try { await chrome.storage.local.get('settings'); return false; } catch { return true; } })()`);
    assert.equal(denied, true);
    assert.equal((await isolatedEval(`JAF.worker({type:'GET_FILL_STATE'})`)).ok, false);
    assert.equal((await isolatedEval(`JAF.worker({type:'TEST_KEY'})`)).ok, false);
    pass('S4: Chrome blocks content-script storage; unauthorized profile access and key testing are denied');

    await page.bringToFront();
    const tabId = await options.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id);
    const fill = await options.evaluate((tabId) => chrome.runtime.sendMessage({ type: 'RUN_TAB', tabId, mode: 'fill' }), tabId);
    assert(fill.ok, fill.error);
    assert.equal(await page.$eval('#email', (e) => e.value), 'audit@example.invalid');
    assert.equal(await page.$eval('#resume', async (e) => await e.files[0].text()), 'synthetic resume');
    pass('S1 positive control: authorized factual autofill and ordinary resume attachment still work');

    const embedded = page.frames().find((f) => f.url().includes('/embedded'));
    assert.equal(await embedded.$eval('#email', (e) => e.value), '');
    assert.equal(await embedded.$eval('#resume', (e) => e.files.length), 0);
    await page.evaluate(() => { for (const frame of document.querySelectorAll('iframe')) frame.contentWindow.postMessage({ type: 'applypilot-attach' }, '*'); });
    await delay(100);
    assert.equal(await embedded.$eval('#resume', (e) => e.files.length), 0);
    pass('S2/S3: unrelated frames stay empty; forged picker messages cannot attach the resume');

    const manual = await isolatedEval(`JAF.gformsAttach({})`);
    assert.equal(manual.ok, false); assert.match(manual.note, /manually/);
    pass('S3 positive control: unsupported Drive upload gives a clear manual fallback');

    assert.equal(await page.$eval('#experience', (e) => e.value), '');
    assert.equal(await page.$eval('#consent', (e) => e.checked), false);
    assert.equal(await page.$eval('#authorization', (e) => e.value), '');
    const html = await page.content(); assert(!html.includes('PRIVATE_AI_DRAFT')); assert(!html.includes('PRIVATE_AI_NOTE')); assert(!html.includes('SYNTHETIC_KEY'));
    assert.equal(Object.keys(await options.evaluate(async () => (await chrome.storage.local.get('memory')).memory)).length, 0);
    const requests = await worker.evaluate(() => auditRequests);
    assert.equal(requests.length, 1);
    assert(!JSON.stringify(requests).includes('URL_SECRET')); assert(!JSON.stringify(requests).includes('fragment-secret'));
    assert.equal(JSON.parse(requests[0].input).questions.length, 1);
    pass('S5/S6: AI drafts and notes never reach page DOM/memory; declarations and URL secrets stay out of AI requests');

    await page.evaluate(() => {
      document.querySelector('#email').value = '';
      document.querySelector('#applypilot-root [data-act="fill"]').click();
      document.querySelector('#applypilot-root [data-act="fill"]').onclick?.();
      document.querySelector('#applypilot-root [data-act="review-draft"]').click();
    });
    await delay(250);
    assert.equal(await page.$eval('#email', (e) => e.value), '');
    assert.equal(await worker.evaluate(() => auditRequests.length), 1);
    pass('S1: synthetic clicks and direct handler calls cannot refill or spend API quota');

    // A genuine browser click opens a browser-owned panel, where drafts become visible.
    await page.click('#applypilot-root [data-act="review-draft"]');
    const nativeTarget = await browser.waitForTarget((t) => t.url().includes('/src/sidepanel/sidepanel.html'));
    const native = await nativeTarget.asPage();
    await native.waitForSelector('.ap-item textarea');
    const draft = await native.$eval('.ap-item textarea', (e) => e.value); assert.equal(draft, 'PRIVATE_AI_DRAFT');
    assert.equal(await page.$eval('#experience', (e) => e.value), '');
    await native.click('.ap-item [data-act="apply"]');
    await page.waitForFunction(() => document.querySelector('#experience').value === 'PRIVATE_AI_DRAFT');
    await options.waitForFunction(async () => Object.keys((await chrome.storage.local.get('memory')).memory).length === 1, { polling: 100 });
    const memory = await options.evaluate(async () => (await chrome.storage.local.get('memory')).memory);
    assert.equal(Object.keys(memory).length, 1); assert(Object.values(memory)[0].approved); assert(!JSON.stringify(memory).includes('URL_SECRET'));
    pass('S5 positive control: a real review/Apply shares one draft and remembers it only after approval');

    await page.reload(); await delay(500);
    assert.equal(await page.$eval('#email', (e) => e.value), '');
    const stale = await options.evaluate((tabId) => chrome.tabs.sendMessage(tabId, { type: 'FILL_PAGE' }, { frameId: 0 }), tabId);
    assert.equal(stale.ok, false); assert.match(stale.error, /authorize/);
    assert.equal(await page.$eval('#email', (e) => e.value), '');
    pass('S1: a full navigation invalidates previous document authorization');

    await options.bringToFront();
    // CDP provides an in-memory File to exercise the actual change handler.
    await options.evaluate(() => {
      const data = new DataTransfer(); data.items.add(new File([new Uint8Array(4 * 1024 * 1024 + 1)], 'too-large.pdf', { type: 'application/pdf' }));
      document.querySelector('#resumeFile').files = data.files;
      document.querySelector('#resumeFile').dispatchEvent(new Event('change'));
    });
    await options.waitForFunction(() => document.querySelector('#resumeMsg').textContent.includes('4 MB'));
    assert.equal(await options.evaluate(async () => (await chrome.storage.local.get('resume')).resume.fileName), 'audit.pdf');
    pass('Reliability: oversized upload shows an error and preserves the saved resume');
    console.log(`${checks} focused browser security regressions passed.`);
  } finally { if (browser) await browser.close(); await new Promise((resolve) => server.close(resolve)); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
