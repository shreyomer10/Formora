// Unit test for the service worker's model fallback: runs service-worker.js in a sandbox with a
// stubbed chrome.* and fetch. No network, no API key needed.  usage: node fallback.test.js
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.resolve(__dirname, '..', '..', 'src', 'background', 'service-worker.js'), 'utf8');

function makeSandbox(fetchImpl, settings) {
  const listeners = {};
  const store = { settings, profile: { firstName: 'Asha' }, resume: null, stats: undefined };
  const sandbox = {
    console,
    setTimeout,
    fetch: fetchImpl,
    chrome: {
      runtime: { onMessage: { addListener: (fn) => (listeners.message = fn) } },
      commands: { onCommand: { addListener: () => {} } },
      tabs: {}, scripting: {},
      storage: { local: { get: async (keys) => Object.fromEntries(keys.map((k) => [k, store[k]]).filter(([, v]) => v !== undefined)), set: async (patch) => Object.assign(store, patch) } },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return { send: (msg) => new Promise((resolve) => listeners.message(msg, {}, resolve)), store };
}

const okBody = (model) => ({ status: 'completed', model, output_text: JSON.stringify({ answers: [{ id: 'q1', value: 'hi', values: [], skip: false, note: '' }] }), usage: { total_input_tokens: 10, total_output_tokens: 5 } });
const res = (status, body) => ({ ok: status < 400, status, text: async () => JSON.stringify(body), json: async () => body });

let failures = 0;
const expect = (name, cond, extra = '') => { if (!cond) { failures++; console.log('FAIL', name, extra); } else console.log('ok  ', name); };

(async () => {
  // 1. primary 503 twice -> first fallback answers
  let calls = [];
  let sb = makeSandbox(async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body.model);
    if (body.model === 'gemini-3.8-flash') return res(503, { error: { message: 'gemini-3.8-flash is currently experiencing high demand' } });
    return res(200, okBody(body.model));
  }, { apiKey: 'k', model: 'gemini-3.8-flash' });
  let r = await sb.send({ type: 'LLM_FILL', payload: { questions: [{ id: 'q1', label: 'x', type: 'text', options: [] }], page: {}, previousAnswers: [] } });
  expect('503 on primary -> fallback model answers', r.ok && r.model === 'gemini-3.5-flash-lite', JSON.stringify(r));
  expect('primary retried once before moving on', calls.join(',') === 'gemini-3.8-flash,gemini-3.8-flash,gemini-3.5-flash-lite', calls.join(','));
  expect('fallback note names both models', /gemini-3.8-flash failed/.test(r.fallbackNote) && /answered by gemini-3.5-flash-lite/.test(r.fallbackNote), r.fallbackNote);
  expect('answers passed through', r.answers && r.answers[0].value === 'hi');

  // 2. 400 (bad request) is not retried
  calls = [];
  sb = makeSandbox(async (url, init) => { calls.push(JSON.parse(init.body).model); return res(400, { error: { message: 'bad schema' } }); }, { apiKey: 'k', model: 'gemini-3.8-flash' });
  r = await sb.send({ type: 'LLM_FILL', payload: { questions: [], page: {}, previousAnswers: [] } });
  expect('400 fails immediately, no fallback', !r.ok && calls.length === 1 && /400/.test(r.error), JSON.stringify(r) + ' ' + calls.join(','));

  // 3. everything down -> clear error listing models
  calls = [];
  sb = makeSandbox(async (url, init) => { calls.push(JSON.parse(init.body).model); return res(429, { error: { message: 'quota' } }); }, { apiKey: 'k', model: 'gemini-3.8-flash', fallbackModels: 'gemini-3.5-flash-lite' });
  r = await sb.send({ type: 'LLM_FILL', payload: { questions: [], page: {}, previousAnswers: [] } });
  expect('all models 429 -> error mentions each', !r.ok && /All models busy/.test(r.error) && calls.join(',') === 'gemini-3.8-flash,gemini-3.8-flash,gemini-3.5-flash-lite', JSON.stringify(r) + ' ' + calls.join(','));

  // 4. network error is retryable; custom fallback list honoured
  calls = [];
  sb = makeSandbox(async (url, init) => { const m = JSON.parse(init.body).model; calls.push(m); if (m !== 'gemini-3.1-pro-preview') throw new TypeError('Failed to fetch'); return res(200, okBody(m)); }, { apiKey: 'k', model: 'gemini-3.8-flash', fallbackModels: 'gemini-3.1-pro-preview' });
  r = await sb.send({ type: 'LLM_FILL', payload: { questions: [], page: {}, previousAnswers: [] } });
  expect('network error -> custom fallback answers', r.ok && r.model === 'gemini-3.1-pro-preview' && calls.join(',') === 'gemini-3.8-flash,gemini-3.8-flash,gemini-3.1-pro-preview', JSON.stringify(r) + ' ' + calls.join(','));

  // 5. healthy primary: one call, no note
  calls = [];
  sb = makeSandbox(async (url, init) => { calls.push(JSON.parse(init.body).model); return res(200, okBody('gemini-3.8-flash')); }, { apiKey: 'k', model: 'gemini-3.8-flash' });
  r = await sb.send({ type: 'LLM_FILL', payload: { questions: [], page: {}, previousAnswers: [] } });
  expect('healthy primary: single call, no fallback note', r.ok && calls.length === 1 && !r.fallbackNote);

  process.exit(failures ? 1 : 0);
})();
