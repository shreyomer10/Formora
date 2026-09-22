// Orchestrator: extract -> deterministic fill -> memory -> one LLM call -> apply -> review panel.
(function () {
  const JAF = window.JAF;
  if (JAF.__mainLoaded) return;
  JAF.__mainLoaded = true;

  const JOB_SPECIFIC = /\b(why|this (role|position|company|job|opportunity)|our (company|team)|about us|cover letter|motivat|interest(ed)? in)\b/i;

  function haystack(q) {
    return [q.label, q.meta?.name, q.meta?.idAttr, q.meta?.placeholder, q.meta?.autocomplete].filter(Boolean).join(' | ').toLowerCase();
  }

  function profileValue(key, profile) {
    if (key === 'fullName') return profile.fullName || [profile.firstName, profile.lastName].filter(Boolean).join(' ');
    if (key === 'firstName' && !profile.firstName && profile.fullName) return profile.fullName.split(' ')[0];
    if (key === 'lastName' && !profile.lastName && profile.fullName) return profile.fullName.split(' ').slice(1).join(' ');
    return profile[key] || '';
  }

  // Deterministic pass. Returns {value, key} or null.
  function matchRule(q, profile, resume) {
    const h = haystack(q);
    const type = q.type;
    const labelOnly = String(q.label || '').toLowerCase();
    if (JAF.RULE_EXCLUDE.test(labelOnly)) return null;
    const hits = JAF.RULES.filter((rule) => {
      if (rule.types && !rule.types.includes(type) && !(rule.types.includes('text') && ['email', 'tel', 'url', 'number', 'date'].includes(type))) return false;
      return rule.test.test(h);
    });
    // A label that matches two unrelated rules ("name and phone") is a compound question: leave it to the LLM.
    const keys = new Set(hits.map((r) => r.key.replace(/^(first|last|middle|full)Name$/, 'name')));
    if (keys.size > 1) return null;
    const rule = hits[0];
    if (rule) {
      if (rule.key === '__resume') return resume && resume.base64 ? { value: '__resume', key: rule.key } : null;
      const v = profileValue(rule.key, profile);
      if (!v) return null;
      if (q.options && q.options.length) {
        const opts = q.options.map((o) => ({ label: o, value: o }));
        const opt = JAF.rangeOption(v, opts) || JAF.bestOption(v, opts);
        return opt ? { value: opt.label, key: rule.key } : null;
      }
      return { value: v, key: rule.key };
    }
    // type-only fallbacks
    if (q.type === 'email' && profile.email) return { value: profile.email, key: 'email' };
    if (q.type === 'tel' && profile.phone) return { value: profile.phone, key: 'phone' };
    if (q.type === 'file' && resume && resume.base64 && /resume|cv/i.test(h + ' ' + (q.meta?.accept || ''))) return { value: '__resume', key: '__resume' };
    return null;
  }

  async function loadState() {
    const s = await chrome.storage.local.get(['profile', 'resume', 'settings', 'memory']);
    // The content script only needs to know whether a key exists; the key itself stays in the service worker.
    const { apiKey, ...settings } = s.settings || {};
    settings.hasApiKey = !!apiKey;
    return { profile: s.profile || {}, resume: s.resume || null, settings, memory: s.memory || {} };
  }

  async function saveMemory(memory, q, value, url) {
    const key = JAF.normalizeLabel(q.label);
    if (!key || q.type === 'file') return;
    memory[key] = { label: q.label, type: q.type, answer: value, url, ts: Date.now() };
    await chrome.storage.local.set({ memory });
  }

  JAF.run = async function ({ mode = 'fill' } = {}) {
    const questions = JAF.isGForms() ? JAF.extractGForms() : JAF.extractGeneric();
    if (!questions.length) {
      if (window === window.top) JAF.overlay.status('No form fields found on this page.');
      return { questions: [] };
    }
    JAF.log('extracted', questions);
    if (questions.some((q) => q.type === 'combobox' && !q.options.length && !q.currentValue)) {
      JAF.overlay.status(`Found ${questions.length} question(s). Reading dropdown options...`);
      const n = await JAF.discoverOptions(questions);
      if (n) JAF.log('discovered options for', n, 'dropdown(s)');
    }
    if (mode === 'scan') {
      JAF.overlay.render(questions.map((q) => ({ q, source: 'skip', value: q.currentValue, note: 'scan only' })), reapply);
      JAF.overlay.status(`Found ${questions.length} question(s). Scan only, nothing filled.`);
      return { questions };
    }

    const { profile, resume, settings, memory } = await loadState();
    const results = [];
    const pending = [];

    JAF.overlay.status(`Found ${questions.length} question(s). Filling profile fields...`);
    for (const q of questions) {
      if (q.currentValue && q.type !== 'file' && !settings.overwrite) { results.push({ q, source: 'skip', value: q.currentValue, note: 'already filled' }); continue; }
      const m = matchRule(q, profile, resume);
      if (m) {
        const res = await JAF.fill(q, m.value, resume);
        results.push({ q, source: res.ok ? 'profile' : 'fail', value: m.value === '__resume' ? (resume.fileName || 'resume') : m.value, note: res.note });
        if (res.ok) JAF.highlight(q, '#16a34a');
        continue;
      }
      const mem = memory[JAF.normalizeLabel(q.label)];
      if (mem && mem.type === q.type && !JOB_SPECIFIC.test(q.label) && (!q.options.length || JAF.bestOption(Array.isArray(mem.answer) ? mem.answer[0] : mem.answer, q.options.map((o) => ({ label: o, value: o }))))) {
        const res = await JAF.fill(q, mem.answer, resume);
        results.push({ q, source: res.ok ? 'memory' : 'fail', value: mem.answer, note: res.note || 'reused a previous answer' });
        if (res.ok) JAF.highlight(q, '#16a34a');
        continue;
      }
      if (q.type === 'file') { results.push({ q, source: 'skip', value: '', note: q.meta?.unsupported || 'attach manually' }); continue; }
      pending.push(q);
    }

    if (pending.length) {
      if (!settings.hasApiKey) {
        pending.forEach((q) => results.push({ q, source: 'skip', value: '', note: 'no API key set in options' }));
      } else {
        JAF.overlay.status(`Asking ${settings.model || 'Gemini'} for ${pending.length} answer(s)...`);
        const hints = pending.map((q) => memory[JAF.normalizeLabel(q.label)]).filter(Boolean).slice(0, 20)
          .map((m) => ({ question: m.label, previousAnswer: m.answer }));
        const resp = await chrome.runtime.sendMessage({
          type: 'LLM_FILL',
          payload: {
            questions: pending.map((q) => ({ id: q.id, label: q.label, type: q.type, options: q.options, required: q.required, maxLength: q.meta?.maxLength || null, optionsPartial: !!q.meta?.optionsPartial })),
            page: JAF.pageContext(),
            previousAnswers: hints,
          },
        });
        if (!resp || !resp.ok) {
          pending.forEach((q) => results.push({ q, source: 'fail', value: '', note: (resp && resp.error) || 'LLM call failed' }));
        } else {
          const byId = new Map((resp.answers || []).map((a) => [a.id, a]));
          for (const q of pending) {
            const a = byId.get(q.id);
            if (!a || a.skip) { results.push({ q, source: 'skip', value: '', note: (a && a.note) || 'model had no grounded answer' }); continue; }
            const value = q.type === 'checkbox' ? (a.values && a.values.length ? a.values : [a.value]).filter(Boolean) : a.value;
            const res = await JAF.fill(q, value, resume);
            results.push({ q, source: res.ok ? 'ai' : 'fail', value, note: res.note || a.note || '' });
            if (res.ok) { JAF.highlight(q, '#7c3aed'); await saveMemory(memory, q, value, location.href); }
          }
        }
      }
    }

    const counts = results.reduce((c, r) => ((c[r.source] = (c[r.source] || 0) + 1), c), {});
    JAF.overlay.render(results, reapply);
    JAF.overlay.status(`Filled ${(counts.profile || 0) + (counts.memory || 0) + (counts.ai || 0)} of ${questions.length}. profile ${counts.profile || 0} · memory ${counts.memory || 0} · ai ${counts.ai || 0} · skipped ${counts.skip || 0} · failed ${counts.fail || 0}`);
    return { questions, results };
  };

  async function reapply(q, value) {
    const { resume, memory } = await loadState();
    const res = await JAF.fill(q, value, resume);
    if (res.ok) { JAF.highlight(q, '#7c3aed'); await saveMemory(memory, q, value, location.href); }
    return res;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && (msg.type === 'FILL_PAGE' || msg.type === 'SCAN_PAGE')) {
      JAF.run({ mode: msg.type === 'SCAN_PAGE' ? 'scan' : 'fill' })
        .then((r) => sendResponse({ ok: true, count: r.questions.length }))
        .catch((e) => { JAF.log(e); JAF.overlay.status('Error: ' + e.message); sendResponse({ ok: false, error: e.message }); });
      return true;
    }
  });
})();
