// Short, shared catalog. Recheck docs and run Settings > Test selected models after releases.
// https://ai.google.dev/gemini-api/docs/models — reviewed 2026-09-25.
globalThis.FormoraModels = Object.freeze({
  reviewed: '2026-09-25',
  primary: 'gemini-3.8-flash',
  fallbacks: ['gemini-3.5-flash-lite', 'gemini-3.1-pro-preview'],
  ids: ['gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-pro-preview'],
  parse(value) {
    const items = value == null ? this.fallbacks : Array.isArray(value) ? value : String(value).split(/[,\s]+/);
    return [...new Set(items.map((v) => String(v).trim()).filter((v) => /^gemini-[\w.-]+$/.test(v)))];
  },
});
