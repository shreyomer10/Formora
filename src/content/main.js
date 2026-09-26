// Orchestrator: prepare repeatable sections -> extract -> deterministic fill -> memory ->
// one LLM call -> apply -> review panel. Then watch for the next step of the application.
(function () {
  if (window !== window.top) return;
  const JAF = window.JAF;
  const SEC = FormoraSecurity;
  JAF.cancelAI = () => JAF.worker({ type: 'CANCEL_AI' });
  if (JAF.__mainLoaded) return;
  JAF.__mainLoaded = true;

  const JOB_SPECIFIC = /\b(why|this (role|position|company|job|opportunity)|our (company|team)|about us|cover letter|motivat|interest(ed)? in)\b/i;
  const NOT_RESUME = /\b(cover letter|photo|picture|transcript|certificate|certification|portfolio|id proof|passport|attachment)\b/i;
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
    const response = await JAF.worker({ type: 'GET_FILL_STATE' });
    if (!response?.ok) throw new Error(response?.error || 'Open Formora from the toolbar to authorize this page.');
    return response.state;
  }

  async function saveMemory(memory, q, value) {
    if (SEC.manualQuestion(q) || q.type === 'file' || q.meta?.entry || JOB_SPECIFIC.test(q.label)) return;
    const response = await JAF.worker({ type: 'SAVE_ANSWER', key: JAF.normalizeLabel(q.label), question: { label: q.label, type: q.type }, value });
    if (!response.ok) throw new Error(response.error);
  }
  const memoryKey = (q) => `${SEC.safeUrl(location.href)}|${JAF.normalizeLabel(q.label)}`;

  // ---- multi-step watcher ------------------------------------------------------
  let watchTimer = null;
  let baseline = null;
  let lastSeen = null;
  let stableTicks = 0;
  let steps = 0;

  // Accept the page as it is now. With `forget`, the previous step's extracted fields are dropped too,
  // so a dismissed "page changed" is not re-announced on the next tick.
  JAF.markSeen = function (forget) {
    if (forget) JAF.registry = new Map();
    baseline = JAF.formFingerprint(); lastSeen = baseline; stableTicks = 0;
  };

  JAF.startWatch = function () {
    if (!isTop) return;
    JAF.markSeen();
    if (watchTimer) return;
    watchTimer = setInterval(() => {
      if (JAF.running || !JAF.overlay.isVisible()) return;
      const fp = JAF.formFingerprint();
      // Frameworks re-mount single inputs on blur (Workday), and a radio choice can reveal a field
      // or two: those are the same page. A new page is when most of what we extracted is gone and
      // other fields took its place, or the URL moved and the fields changed with it.
      const net = fp.unknown - fp.lost; // fields that appeared beyond one-for-one replacements
      const mostLost = fp.total > 0 && fp.lost >= Math.max(2, Math.ceil(fp.total * 0.85));
      const newPage = (mostLost && fp.unknown >= 2) ||
        (fp.url !== baseline.url && (fp.lost > 0 || fp.unknown > 0)) ||
        (fp.total === 0 && Math.abs(fp.count - baseline.count) >= 3);
      const grew = !newPage && net >= 2 && (net - (baseline.unknown - baseline.lost)) >= 2;
      // Nothing to say unless the page differs from the state last announced or dismissed.
      const differs = fp.url !== baseline.url || fp.lost !== baseline.lost || fp.unknown !== baseline.unknown || fp.count !== baseline.count;
      if (!differs || (!newPage && !grew)) { lastSeen = fp; stableTicks = 0; return; }
      // Wait for the DOM to settle (SPA transitions render in pieces) before announcing.
      const sameAsLast = lastSeen && fp.url === lastSeen.url && fp.count === lastSeen.count && fp.unknown === lastSeen.unknown && fp.lost === lastSeen.lost;
      lastSeen = fp;
      stableTicks = sameAsLast ? stableTicks + 1 : 0;
      if (stableTicks < 2) return;
      baseline = fp;
      if (newPage) {
        if (fp.count > 0) JAF.overlay.pageChanged(fp);
        else JAF.overlay.status('Page changed; no form fields found yet.');
      } else {
        JAF.overlay.fieldsAppeared(net); // keep the current answers on screen
      }
    }, 700);
  };

  JAF.stopWatch = function () {
    if (watchTimer) clearInterval(watchTimer);
    watchTimer = null;
  };

  // ---- run ---------------------------------------------------------------------
  JAF.run = async function ({ mode = 'fill' } = {}) {
    if (JAF.running) return { questions: [] };
    JAF.running = true;
    try {
      await JAF.overlayReady;
      return await runInner(mode);
    } catch (e) {
      JAF.log(e);
      if (isTop) JAF.overlay.status('Error: ' + e.message);
      throw e;
    } finally {
      JAF.running = false;
      JAF.publishPanel?.();
      if (isTop) JAF.startWatch();
    }
  };

  async function runInner(mode) {
    const { profile, resume, settings, memory } = await loadState();
    JAF.log('Starting', mode, JAF.isGForms() ? 'Google Forms extraction' : 'generic extraction');
    const results = [];
    steps += 1;
    if (isTop) { JAF.overlay.setStep(steps); JAF.overlay.empty('Your answers will appear here in a moment.'); JAF.overlay.busy('Reading the form…'); }

    if (mode === 'fill' && !JAF.isGForms()) {
      if (isTop) JAF.overlay.busy('Checking for Work Experience / Education / Certification sections...');
      const notes = await JAF.prepareSections(profile);
      notes.forEach((n) => results.push({ source: 'info', note: n.text }));
    }

    const questions = JAF.isGForms() ? JAF.extractGForms() : JAF.extractGeneric();
    JAF.log('extracted field count', questions.length);
    if (!questions.length) {
      if (isTop) JAF.overlay.status('No form fields found on this page.');
      return { questions: [] };
    }
    JAF.log('extracted', questions.length, questions.map((q) => `${q.label} [${q.type}${q.meta?.entry ? ' ' + q.meta.entry.kind + q.meta.entry.index : ''}]`).join(' | '));
    for (const q of questions) {
      const reason = SEC.manualQuestion(q) ? 'Choose consent, eligibility and sensitive declarations yourself.' : JAF.manualFillReason(q);
      if (reason) q.meta = { ...q.meta, manualFill: reason };
    }
    if (questions.some((q) => q.type === 'combobox' && !q.options.length && !q.currentValue && !q.meta?.manualFill)) {
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
      if (q.meta?.manualFill) {
        const suggestion = SEC.manualQuestion(q) ? '' : sv ? sv.value : matchRule(q, profile, resume)?.value;
        results.push({ q, source: 'manual', value: suggestion || '', note: q.meta.manualFill });
        continue;
      }
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
      const mem = memory[memoryKey(q)];
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
      if (!settings.hasApiKey || !settings.aiConsent) {
        pending.forEach((q) => results.push({ q, source: 'skip', value: '', note: settings.hasApiKey ? 'Enable AI data sharing in Settings to draft this answer.' : 'no API key set in options' }));
      } else {
        // Show what is already filled right away; the model's questions get placeholders until it answers.
        JAF.overlay.render(results.concat(pending.map((q) => ({ q, source: 'pending', value: '', note: '' }))), reapply);
        JAF.overlay.busy(`Preparing ${pending.length} ${pending.length === 1 ? 'answer' : 'answers'} from your profile and resume…`);
        const hints = pending.map((q) => memory[memoryKey(q)]).filter(Boolean).slice(0, 20)
          .map((m) => ({ question: m.label, previousAnswer: m.answer }));
        const resp = await JAF.worker({
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
            if (!a || a.skip) { results.push({ q, source: 'skip', value: '', note: 'No grounded draft available. Enter this answer yourself.' }); continue; }
            const value = q.type === 'checkbox' ? (a.values && a.values.length ? a.values : [a.value]).filter(Boolean) : a.value;
            if (q.type === 'checkbox' && !value.length) { results.push({ q, source: 'skip', value: '', note: 'left unticked' }); continue; }
            if (!q.type.match(/checkbox/) && !String(value || '').trim()) { results.push({ q, source: 'skip', value: '', note: 'model returned nothing' }); continue; }
            // Keep drafts in the isolated world. Only the browser-owned panel sees their values.
            results.push({ q, source: 'ai', value, note: 'Draft only. Review in the browser side panel before applying.' });
          }
        }
      }
    }

    JAF.overlay.render(results, reapply);
    JAF.overlay.summary(results);
    return { questions, results };
  }

  async function reapply(q, value, reviewed = false) {
    if (SEC.manualQuestion(q)) return { ok: false, note: 'Choose this declaration directly on the form.' };
    const entry = JAF.registry.get(q.id);
    if (!(entry?.el || entry?.els?.[0])?.isConnected) return { ok: false, note: 'This field changed. Preview the page again.' };
    const { resume, memory } = await loadState();
    const res = await JAF.fill(q, value, resume);
    if (res.ok) { JAF.highlight(q, '#1C3A4B'); if (reviewed) await saveMemory(memory, q, value); }
    return res;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (_sender.id !== chrome.runtime.id || !_sender.url?.startsWith(chrome.runtime.getURL(''))) return;
    if (msg?.type === 'AUTHORIZATION_INFO') { sendResponse({ url: location.href, documentToken: JAF.documentToken }); return; }
    if (msg?.type === 'UI_SETTINGS') { JAF.setLayout?.(msg.panelLayout); return; }
    if (msg && (msg.type === 'FILL_PAGE' || msg.type === 'SCAN_PAGE')) {
      JAF.run({ mode: msg.type === 'SCAN_PAGE' ? 'scan' : 'fill' })
        .then((r) => sendResponse({ ok: true, count: r.questions.length }))
        .catch((e) => { JAF.log(e); JAF.overlay.status('Error: ' + e.message); sendResponse({ ok: false, error: e.message }); });
      return true;
    }
  });

  // Authorization is never restored from website-controlled storage. A full navigation
  // requires a new explicit toolbar/side-panel action; SPA step detection stays local.
})();
