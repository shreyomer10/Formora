// Orchestrator: prepare repeatable sections -> extract -> deterministic fill -> memory ->
// one LLM call -> apply -> review panel. Then watch for the next step of the application.
(function () {
  const JAF = window.JAF;
  if (JAF.__mainLoaded) return;
  JAF.__mainLoaded = true;

  const JOB_SPECIFIC = /\b(why|this (role|position|company|job|opportunity)|our (company|team)|about us|cover letter|motivat|interest(ed)? in)\b/i;
  const NOT_RESUME = /\b(cover letter|photo|picture|transcript|certificate|certification|portfolio|id proof|passport|attachment)\b/i;
  const ACTIVE_KEY = 'applypilot.active';
  const isTop = window === window.top;

  function haystack(q) {
    return [q.label, q.meta?.name, q.meta?.idAttr, q.meta?.placeholder, q.meta?.autocomplete].filter(Boolean).join(' | ').toLowerCase();
  }

  function profileValue(key, profile) {
    if (key === 'fullName') return profile.fullName || [profile.firstName, profile.lastName].filter(Boolean).join(' ');
    if (key === 'firstName' && !profile.firstName && profile.fullName) return profile.fullName.split(' ')[0];
    if (key === 'lastName' && !profile.lastName && profile.fullName) return profile.fullName.split(' ').slice(1).join(' ');
    // Fall back to the first education entry when the flat field is empty.
    const edu = Array.isArray(profile.education) && profile.education[0];
    if (edu) {
      if (key === 'college' && !profile.college) return edu.school || '';
      if (key === 'degree' && !profile.degree) return edu.degree || '';
      if (key === 'branch' && !profile.branch) return edu.field || '';
      if (key === 'cgpa' && !profile.cgpa) return edu.gpa || '';
      if (key === 'graduationYear' && !profile.graduationYear) return (JAF.parseDate(edu.endDate) || {}).y || '';
    }
    const job = Array.isArray(profile.workExperience) && profile.workExperience[0];
    if (job) {
      if (key === 'currentCompany' && !profile.currentCompany) return job.company || '';
      if (key === 'currentTitle' && !profile.currentTitle) return job.title || '';
    }
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
    if (q.type === 'file' && resume && resume.base64) {
      const sec = String(q.meta?.section || '').toLowerCase();
      if (/resume|cv/i.test(h + ' ' + (q.meta?.accept || '') + ' ' + sec)) return { value: '__resume', key: '__resume' };
      // The only upload on the page, not labelled as something else: that is the resume slot.
      if (q.meta?.onlyFile && !NOT_RESUME.test(h + ' ' + sec)) return { value: '__resume', key: '__resume' };
    }
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
    if (!key || q.type === 'file' || q.meta?.entry) return;
    memory[key] = { label: q.label, type: q.type, answer: value, url, ts: Date.now() };
    await chrome.storage.local.set({ memory });
  }

  // ---- multi-step watcher ------------------------------------------------------
  let watchTimer = null;
  let baseline = null;
  let lastSeen = null;
  let stableTicks = 0;
  let steps = 0;

  function setActive(on) { try { if (on) sessionStorage.setItem(ACTIVE_KEY, '1'); else sessionStorage.removeItem(ACTIVE_KEY); } catch { /* blocked */ } }
  function isActive() { try { return sessionStorage.getItem(ACTIVE_KEY) === '1'; } catch { return false; } }

  JAF.markSeen = function () { baseline = JAF.formFingerprint(); lastSeen = baseline; stableTicks = 0; };

  JAF.startWatch = function () {
    if (!isTop) return;
    setActive(true);
    JAF.markSeen();
    if (watchTimer) return;
    watchTimer = setInterval(() => {
      if (JAF.running || !document.getElementById('applypilot-root')) return;
      const fp = JAF.formFingerprint();
      // Compare with the last announced state, so one new step is announced once, not every tick.
      const changed = fp.url !== baseline.url || fp.unknown !== baseline.unknown || Math.abs(fp.count - baseline.count) > 2;
      if (!changed) { lastSeen = fp; stableTicks = 0; return; }
      // Wait for the DOM to settle (SPA transitions render in pieces) before announcing the step.
      const sameAsLast = lastSeen && fp.url === lastSeen.url && fp.count === lastSeen.count && fp.unknown === lastSeen.unknown;
      lastSeen = fp;
      stableTicks = sameAsLast ? stableTicks + 1 : 0;
      if (stableTicks < 2) return;
      baseline = fp;
      if (fp.count > 0) JAF.overlay.pageChanged(fp);
      else JAF.overlay.status('Page changed; no form fields found yet.');
    }, 700);
  };

  JAF.stopWatch = function () {
    if (watchTimer) clearInterval(watchTimer);
    watchTimer = null;
    setActive(false);
  };

  // ---- run ---------------------------------------------------------------------
  JAF.run = async function ({ mode = 'fill' } = {}) {
    if (JAF.running) return { questions: [] };
    JAF.running = true;
    try {
      return await runInner(mode);
    } finally {
      JAF.running = false;
      if (isTop) JAF.startWatch();
    }
  };

  async function runInner(mode) {
    const { profile, resume, settings, memory } = await loadState();
    const results = [];
    steps += 1;
    if (isTop) { JAF.overlay.setStep(steps); JAF.overlay.empty('Extracting the questions on this page...'); JAF.overlay.busy('Extracting questions...'); }

    if (mode === 'fill' && !JAF.isGForms()) {
      if (isTop) JAF.overlay.busy('Checking for Work Experience / Education / Certification sections...');
      const notes = await JAF.prepareSections(profile);
      notes.forEach((n) => results.push({ source: 'info', note: n.text }));
    }

    const questions = JAF.isGForms() ? JAF.extractGForms() : JAF.extractGeneric();
    if (!questions.length) {
      if (isTop) JAF.overlay.status('No form fields found on this page.');
      return { questions: [] };
    }
    JAF.log('extracted', questions.length, questions.map((q) => `${q.label} [${q.type}${q.meta?.entry ? ' ' + q.meta.entry.kind + q.meta.entry.index : ''}]`).join(' | '));
    if (questions.some((q) => q.type === 'combobox' && !q.options.length && !q.currentValue && !q.meta?.multi)) {
      JAF.overlay.busy(`Found ${questions.length} question(s). Reading dropdown options...`);
      const n = await JAF.discoverOptions(questions);
      if (n) JAF.log('discovered options for', n, 'dropdown(s)');
    }
    if (mode === 'scan') {
      JAF.overlay.render(questions.map((q) => ({ q, source: 'skip', value: q.currentValue, note: 'scan only' })), reapply);
      JAF.overlay.status(`Found ${questions.length} question(s). Scan only, nothing filled.`);
      return { questions };
    }

    const pending = [];

    JAF.overlay.busy(`Found ${questions.length} question(s). Filling profile fields...`);
    for (const q of questions) {
      if (q.currentValue && q.type !== 'file' && !settings.overwrite) { results.push({ q, source: 'skip', value: q.currentValue, note: 'already filled' }); continue; }

      // Fields inside a repeated block (Work Experience 2) come from that profile entry only.
      const sv = JAF.sectionValue(q, profile);
      if (sv && sv.skip) { results.push({ q, source: 'skip', value: '', note: sv.note }); continue; }
      if (sv) {
        const res = await JAF.fill(q, sv.value, resume);
        results.push({ q, source: res.ok ? 'profile' : 'fail', value: sv.value, note: res.note });
        if (res.ok) JAF.highlight(q, '#16a34a');
        continue;
      }
      const hasEntry = q.meta?.entry && Array.isArray(profile[{ work: 'workExperience', education: 'education', certification: 'certifications' }[q.meta.entry.kind]]) &&
        profile[{ work: 'workExperience', education: 'education', certification: 'certifications' }[q.meta.entry.kind]][q.meta.entry.index - 1];
      const m = hasEntry ? null : matchRule(q, profile, resume);
      if (m) {
        const res = await JAF.fill(q, m.value, resume);
        results.push({ q, source: res.ok ? 'profile' : 'fail', value: m.value === '__resume' ? (resume.fileName || 'resume') : m.value, note: res.note });
        if (res.ok) JAF.highlight(q, '#16a34a');
        continue;
      }
      const mem = memory[JAF.normalizeLabel(q.label)];
      if (mem && !q.meta?.entry && mem.type === q.type && !JOB_SPECIFIC.test(q.label) && (!q.options.length || JAF.bestOption(Array.isArray(mem.answer) ? mem.answer[0] : mem.answer, q.options.map((o) => ({ label: o, value: o }))))) {
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
        // Show what is already filled right away; the model's questions get placeholders until it answers.
        JAF.overlay.render(results.concat(pending.map((q) => ({ q, source: 'pending', value: '', note: '' }))), reapply);
        JAF.overlay.busy(`Asking ${settings.model || 'Gemini'} for ${pending.length} answer(s)... this takes 10-40 s`);
        const hints = pending.map((q) => memory[JAF.normalizeLabel(q.label)]).filter(Boolean).slice(0, 20)
          .map((m) => ({ question: m.label, previousAnswer: m.answer }));
        const resp = await chrome.runtime.sendMessage({
          type: 'LLM_FILL',
          payload: {
            questions: pending.map((q) => ({
              id: q.id, label: q.label, type: q.type, options: q.options, required: q.required, maxLength: q.meta?.maxLength || null,
              optionsPartial: !!q.meta?.optionsPartial, section: q.meta?.section || '', entry: q.meta?.entry || null, multi: !!q.meta?.multi,
            })),
            page: JAF.pageContext(),
            previousAnswers: hints,
          },
        });
        if (!resp || !resp.ok) {
          pending.forEach((q) => results.push({ q, source: 'fail', value: '', note: (resp && resp.error) || 'LLM call failed' }));
        } else {
          if (resp.fallbackNote) results.push({ source: 'info', note: resp.fallbackNote });
          const byId = new Map((resp.answers || []).map((a) => [a.id, a]));
          for (const q of pending) {
            const a = byId.get(q.id);
            if (!a || a.skip) { results.push({ q, source: 'skip', value: '', note: (a && a.note) || 'model had no grounded answer' }); continue; }
            const value = q.type === 'checkbox' ? (a.values && a.values.length ? a.values : [a.value]).filter(Boolean) : a.value;
            if (q.type === 'checkbox' && !value.length) { results.push({ q, source: 'skip', value: '', note: a.note || 'left unticked' }); continue; }
            if (!q.type.match(/checkbox/) && !String(value || '').trim()) { results.push({ q, source: 'skip', value: '', note: a.note || 'model returned nothing' }); continue; }
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
  }

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

  // ---- Google Drive picker frame (Google Forms file upload) ----------------------
  // The form's "Add file" button opens the Drive picker in a cross-origin iframe. This same
  // content script runs inside that frame; the top frame asks it to drop the stored resume
  // into the picker's upload input.
  if (!isTop && /docs\.google\.com$/.test(location.hostname) && /picker/.test(location.pathname)) {
    window.addEventListener('message', async (e) => {
      const msg = e.data;
      if (!msg || msg.type !== 'applypilot-attach') return;
      const reply = (r) => { try { e.source.postMessage({ type: 'applypilot-attach-result', ...r }, '*'); } catch { /* frame gone */ } };
      try {
        const { resume } = await chrome.storage.local.get(['resume']);
        if (!resume || !resume.base64) return reply({ ok: false, note: 'no resume stored' });
        // Switch to the Upload tab when the picker opened on another one.
        const tab = Array.from(document.querySelectorAll('[role="tab"], [role="button"], button, div'))
          .find((el) => /^upload$/i.test(JAF.text(el)) && JAF.isVisible(el) && el.getBoundingClientRect().width < 200);
        if (tab) { tab.click(); await JAF.sleep(400); }
        const input = await JAF.waitFor(() => JAF.deepQueryAll('input[type="file"]').find((i) => !i.disabled), 5000, 150);
        if (!input) return reply({ ok: false, note: 'no upload input in the picker' });
        const bin = atob(resume.base64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const dt = new DataTransfer();
        dt.items.add(new File([bytes], resume.fileName || 'resume.pdf', { type: resume.mimeType || 'application/pdf' }));
        input.files = dt.files;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        reply({ ok: true, note: `handed ${resume.fileName} to the Drive picker` });
      } catch (err) {
        reply({ ok: false, note: err.message });
      }
    });
  }

  // After a full page load inside an application the user already started, come back up
  // in a compact state so the next step is one click away.
  if (isTop && isActive()) {
    const boot = () => { JAF.overlay.ready(); JAF.startWatch(); };
    if (document.readyState === 'complete') setTimeout(boot, 300); else window.addEventListener('load', () => setTimeout(boot, 300), { once: true });
  }
})();
