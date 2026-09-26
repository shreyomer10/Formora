const assert = require('node:assert/strict');
const { makeSandbox, contentSender, uiSender } = require('./worker-harness');
const question = { id: 'q1', label: 'Describe your engineering experience', type: 'textarea', options: [] };
const payload = { questions: [question], page: { url: 'https://jobs.example/application?token=secret#private', title: 'Engineer', jobDescription: 'Build APIs' } };
const answer = { id: 'q1', value: 'I build APIs.', values: [], skip: false, note: '' };
const success = (answers = [answer]) => ({ ok: true, json: async () => ({ output_text: JSON.stringify({ answers }) }) });
let count = 0;
async function check(name, fn) { await fn(); console.log('PASS', name); count++; }
(async () => {
  await check('S4: both storage areas restrict access; content state never includes the key', async () => {
    const sb = makeSandbox(async () => success(), { apiKey: 'private-test-key' });
    const result = await sb.send({ type: 'GET_FILL_STATE' }, contentSender);
    assert(result.ok); assert.equal(result.state.settings.hasApiKey, true);
    assert(!JSON.stringify(result).includes('private-test-key'));
    assert.equal(sb.accesses.length, 2); assert(sb.accesses.every((x) => x.accessLevel === 'TRUSTED_CONTEXTS'));
  });
  await check('S1/S2/S4: wrong extension, frame, origin, document, token and expired grants cannot read data or spend API quota', async () => {
    let requests = 0;
    for (const sender of [{ ...contentSender, id: 'other' }, { ...contentSender, frameId: 9 }, { ...contentSender, url: 'https://evil.example/' }, { ...contentSender, url: 'http://jobs.example/' }, uiSender]) {
      const sb = makeSandbox(async () => { requests++; return success(); }, { apiKey: 'key' });
      assert.equal((await sb.send({ type: 'GET_FILL_STATE' }, sender)).ok, false);
      assert.equal((await sb.send({ type: 'LLM_FILL', payload }, sender)).ok, false);
    }
    const sb = makeSandbox(async () => { requests++; return success(); }, { apiKey: 'key' });
    assert.equal((await sb.send({ type: 'GET_FILL_STATE', documentToken: 'forged' }, contentSender)).ok, false);
    assert((await sb.send({ type: 'GET_FILL_STATE' }, contentSender)).ok);
    assert.equal((await sb.send({ type: 'GET_FILL_STATE' }, { ...contentSender, documentId: 'new-document' })).ok, false);
    sb.session['authorized:1'].expires = 0;
    assert.equal((await sb.send({ type: 'LLM_FILL', payload })).ok, false);
    assert.equal(requests, 0);
  });
  await check('S4: extraction, key/model tests and tab authorization reject content senders', async () => {
    let requests = 0;
    const sb = makeSandbox(async () => { requests++; return success(); }, { apiKey: 'key' });
    for (const type of ['EXTRACT_PROFILE', 'TEST_KEY', 'TEST_MODELS', 'AUTHORIZE_TAB', 'RUN_TAB']) assert.equal((await sb.send({ type, tabId: 1 }, contentSender)).ok, false);
    assert.equal(requests, 0);
  });
  await check('S5/S6: AI excludes declarations, unrelated saved answers, URL tokens and unnecessary contact fields', async () => {
    let request;
    const sb = makeSandbox(async (_url, init) => { request = JSON.parse(init.body); assert.equal(init.redirect, 'error'); return success([answer, { ...answer, id: 'consent' }]); }, { apiKey: 'key' });
    sb.store.profile = { email: 'private@example.invalid', phone: '1234567890', skills: 'Node.js', dob: '1999-01-01' };
    sb.store.resume = { text: 'Engineer private@example.invalid 1234567890 Node.js' };
    const result = await sb.send({ type: 'LLM_FILL', payload: { ...payload, questions: [question, { id: 'consent', label: 'I agree to these terms', type: 'checkbox', options: ['Yes'] }], previousAnswers: [{ previousAnswer: 'PRIVATE_MEMORY' }] } });
    assert(result.ok); assert.equal(result.answers.length, 1);
    assert.equal(JSON.parse(request.input).page.url, 'https://jobs.example');
    const serialized = JSON.stringify(request);
    for (const secret of ['token=secret', '#private', 'PRIVATE_MEMORY', 'private@example.invalid', '1234567890', '1999-01-01']) assert(!serialized.includes(secret), secret);
    assert(serialized.includes('Node.js')); assert.equal(request.store, false);
  });
  await check('S5: invalid options and oversized/malformed questions rejected; no request for invalid input', async () => {
    let requests = 0;
    const sb = makeSandbox(async () => { requests++; return success([{ ...answer, value: 'invented' }]); }, { apiKey: 'key' });
    const invalid = await sb.send({ type: 'LLM_FILL', payload: { ...payload, questions: [{ ...question, type: 'radio', options: ['Yes', 'No'] }] } });
    assert.equal(invalid.ok, false);
    for (const questions of [Array(151).fill(question), [{ ...question, label: 'x'.repeat(2001) }], [{ ...question, options: [5] }]]) assert.equal((await sb.send({ type: 'LLM_FILL', payload: { ...payload, questions } })).ok, false);
    assert.equal(requests, 1);
  });
  await check('S5: personal data cannot be sent before AI sharing is enabled', async () => {
    let requests = 0;
    const sb = makeSandbox(async () => { requests++; return success(); }, { apiKey: 'key', aiConsent: false });
    assert.equal((await sb.send({ type: 'LLM_FILL', payload })).ok, false);
    assert.equal((await sb.send({ type: 'EXTRACT_PROFILE', payload: { mimeType: 'application/pdf', base64: 'JVBERg==' } })).ok, false);
    assert.equal(requests, 0);
  });
  await check('S5/S6: memory reuse is approved, site-scoped and time-limited; declarations cannot be saved', async () => {
    const sb = makeSandbox(async () => success());
    sb.store.memory = {
      old: { answer: 'unreviewed' },
      alien: { approved: true, origin: 'https://other.example', ts: Date.now(), answer: 'other site' },
      expired: { approved: true, origin: 'https://jobs.example', ts: 1, answer: 'expired' },
    };
    let result = await sb.send({ type: 'GET_FILL_STATE' }, contentSender); assert.equal(Object.keys(result.state.memory).length, 0);
    result = await sb.send({ type: 'SAVE_ANSWER', key: 'experience', question, value: 'Reviewed answer' }, contentSender); assert(result.ok);
    result = await sb.send({ type: 'GET_FILL_STATE' }, contentSender); assert.equal(Object.keys(result.state.memory).length, 1);
    assert(!JSON.stringify(sb.store.memory).includes('token=secret'));
    result = await sb.send({ type: 'SAVE_ANSWER', key: 'consent', question: { label: 'I confirm this is accurate', type: 'checkbox' }, value: ['Yes'] }, contentSender); assert.equal(result.ok, false);
  });
  await check('Reliability: request timeout aborts fetch and releases the concurrency slot', async () => {
    const sb = makeSandbox((_url, init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))), { apiKey: 'key' }, { timeoutMs: 10 });
    const result = await sb.send({ type: 'LLM_FILL', payload }); assert.equal(result.ok, false); assert.match(result.error, /timed out/);
    assert.equal(require('node:vm').runInContext('activeRequests.size', sb.sandbox), 0);
  });
  await check('Reliability: concurrent requests rejected; explicit cancellation aborts the active request', async () => {
    let started;
    const ready = new Promise((resolve) => { started = resolve; });
    const sb = makeSandbox((_url, init) => { started(); return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))); }, { apiKey: 'key' });
    const first = sb.send({ type: 'LLM_FILL', payload }); await ready;
    const second = await sb.send({ type: 'LLM_FILL', payload }); assert.equal(second.ok, false); assert.match(second.error, /already running/);
    assert((await sb.send({ type: 'CANCEL_AI', tabId: 1 })).ok);
    assert.match((await first).error, /cancelled/);
  });
  await check('Reliability: oversized PDFs and error bodies cannot leak data or start unsafe requests', async () => {
    let requests = 0;
    const sb = makeSandbox(async () => { requests++; return { ok: false, status: 400, text: async () => 'SECRET_KEY_AND_RESUME' }; }, { apiKey: 'key' });
    assert.equal((await sb.send({ type: 'EXTRACT_PROFILE', payload: { base64: 'A'.repeat(6000000), mimeType: 'application/pdf' } })).ok, false);
    assert.equal(requests, 0);
    const result = await sb.send({ type: 'LLM_FILL', payload }); assert.equal(result.ok, false); assert(!result.error.includes('SECRET_KEY'));
  });
  await check('S4/S6: upgrade keeps profile/key and readable legacy answers but removes stored URL tokens', async () => {
    const sb = makeSandbox(async () => success(), { apiKey: 'preserved-key' });
    sb.store.memory = { legacy: { label: 'Experience', type: 'text', answer: 'Legacy answer', url: 'https://jobs.example/a?token=SECRET', ts: Date.now() } };
    await sb.send({ type: 'GET_UI_SETTINGS' });
    assert.equal(sb.store.settings.apiKey, 'preserved-key'); assert.equal(sb.store.profile.firstName, 'Asha');
    assert.equal(sb.store.memory.legacy.answer, 'Legacy answer'); assert.equal(sb.store.memory.legacy.approved, false);
    assert(!JSON.stringify(sb.store.memory).includes('SECRET'));
  });
  await check('S5: malformed AI JSON and oversized streaming responses do not expose model output', async () => {
    let sb = makeSandbox(async () => ({ ok: true, json: async () => ({ output_text: 'PRIVATE_MODEL_TEXT not JSON' }) }), { apiKey: 'key' });
    let result = await sb.send({ type: 'LLM_FILL', payload }); assert.equal(result.ok, false); assert(!result.error.includes('PRIVATE_MODEL_TEXT'));
    let cancelled = false;
    sb = makeSandbox(async () => ({ ok: true, body: { getReader: () => ({ read: async () => ({ value: new Uint8Array(1024 * 1024 + 1), done: false }), cancel: async () => { cancelled = true; } }) } }), { apiKey: 'key' });
    result = await sb.send({ type: 'LLM_FILL', payload }); assert.equal(result.ok, false); assert(cancelled);
  });
  console.log(`${count} focused worker security regressions passed.`);
})().catch((e) => { console.error(e); process.exitCode = 1; });
