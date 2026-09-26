// Shared validation; no page-provided value grants extension authority.
globalThis.FormoraSecurity = Object.freeze({
  maxResumeBytes: 4 * 1024 * 1024,
  maxText: 60000,
  maxQuestions: 150,
  manualQuestion(q) {
    return /\b(agree|consent|confirm|certify|attest|declaration|authorization|authorisation|authori[sz]ed|eligib\w*|sponsor\w*|visa|citizen\w*|veteran|disabil\w*|ethnic\w*|race|gender|religion|criminal|background check|relocat\w*|willing to)\b/i.test(q.label || '');
  },
  safeUrl(value) {
    try { const u = new URL(value); return /^https?:$/.test(u.protocol) ? u.origin : ''; } catch { return ''; }
  },
  allowedPage(value) {
    try { const u = new URL(value); return u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)); } catch { return false; }
  },
  settings(settings = {}) {
    return { hasApiKey: !!settings.apiKey, overwrite: !!settings.overwrite, panelLayout: settings.panelLayout === 'sidebar' ? 'sidebar' : 'dialog', aiConsent: settings.aiConsent === true };
  },
  validateFill(payload) {
    if (!payload || !Array.isArray(payload.questions) || payload.questions.length > this.maxQuestions || JSON.stringify(payload).length > 256000) throw new Error('Too many questions or too much form context. Fill a smaller section.');
    const ids = new Set();
    const types = new Set(['text', 'textarea', 'number', 'date', 'email', 'tel', 'url', 'select', 'radio', 'checkbox', 'combobox', 'multiselect']);
    for (const q of payload.questions) {
      if (!q || typeof q.id !== 'string' || q.id.length > 150 || ids.has(q.id) || typeof q.label !== 'string' || q.label.length > 2000 || !types.has(q.type) || !Array.isArray(q.options) || q.options.length > 300 || q.options.some((o) => typeof o !== 'string' || o.length > 1000)) throw new Error('Invalid form question. Scan the page again.');
      ids.add(q.id);
    }
    return {
      questions: payload.questions.filter((q) => !this.manualQuestion(q)),
      page: { url: this.safeUrl(payload.page?.url), title: String(payload.page?.title || '').slice(0, 200), jobDescription: String(payload.page?.jobDescription || '').slice(0, 4000) },
      // Saved answers stay local; page content cannot ask the model to retrieve them.
      previousAnswers: [],
    };
  },
  validateAnswers(answers, questions) {
    if (!Array.isArray(answers) || answers.length > this.maxQuestions) throw new Error('Invalid AI answer list.');
    const byId = new Map(questions.map((q) => [q.id, q]));
    const seen = new Set();
    return answers.filter((a) => {
      const q = byId.get(a?.id);
      if (!q || seen.has(a.id) || this.manualQuestion(q)) return false;
      seen.add(a.id);
      if (typeof a.value !== 'string' || a.value.length > 12000 || typeof a.skip !== 'boolean' || !Array.isArray(a.values) || a.values.length > 300 || a.values.some((v) => typeof v !== 'string' || v.length > 1000)) throw new Error('Invalid AI answer. Try again.');
      if (!a.skip && q.options.length && ['select', 'radio', 'checkbox', 'multiselect'].includes(q.type)) {
        const selected = q.type === 'checkbox' || q.type === 'multiselect' ? a.values : [a.value];
        if (selected.some((v) => !q.options.includes(v))) throw new Error('AI selected an option that is not on the form.');
      }
      return true;
    }).map((a) => ({ id: a.id, value: a.value, values: a.values, skip: a.skip, note: String(a.note || '').slice(0, 300) }));
  },
});
