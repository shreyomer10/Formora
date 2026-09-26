// Review panel injected into the page. Shows what was filled, by what, and lets
// the user edit and re-apply LLM answers before they submit. Draggable, resizable,
// collapsible, and it stays up across the steps of a multi-page application.
(function () {
  const JAF = window.JAF;
  const nativePanel = !!JAF.isSidePanel;

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const same = (a, b) => norm(a) === norm(b);
  const POS_KEY = 'applypilot.pos';
  const SIZE_KEY = 'applypilot.size';
  const MIN_KEY = 'applypilot.min';
  const MIN_W = 300, MIN_H = 360;
  const UI_VERSION = '2';
  let styleRefresh = null;
  let layout = 'dialog';
  let rootElement = null;
  JAF.overlayReady = nativePanel ? Promise.resolve() : JAF.worker({ type: 'GET_UI_SETTINGS' }).then(({ settings = {} }) => setLayout(settings.panelLayout));
  JAF.setLayout = setLayout;
  function setLayout(value) {
    const previous = layout;
    layout = value === 'sidebar' ? 'sidebar' : 'dialog';
    const r = rootElement;
    if (!r?.querySelector('.ap-panel')) return;
    if (layout === 'sidebar') r.remove();
    else {
      document.documentElement.appendChild(r); place(r, load(POS_KEY)); size(r, load(SIZE_KEY));
      if (previous === 'sidebar' && currentResults.length && !JAF.running) { JAF.overlay.render(currentResults, reapplyHandler); JAF.overlay.summary(); }
    }
  }

  function ensureStyles(r) {
    if (nativePanel || layout === 'sidebar') return;
    // A tab can retain the previous release's injected CSS after an extension
    // reload. Ask the worker for this release's sheet when its marker is absent.
    if (getComputedStyle(r).getPropertyValue('--ap-ui-version').trim() === UI_VERSION || styleRefresh) return;
    if (!chrome.runtime.sendMessage) return;
    styleRefresh = chrome.runtime.sendMessage({ type: 'REFRESH_OVERLAY_STYLES' }).catch(() => {});
  }

  function store(key, val) { try { if (val == null) sessionStorage.removeItem(key); else sessionStorage.setItem(key, JSON.stringify(val)); } catch { /* storage blocked */ } }
  function load(key) { try { const v = sessionStorage.getItem(key); return v ? JSON.parse(v) : null; } catch { return null; } }

  function root() {
    let r = rootElement;
    if (!r) {
      r = document.createElement('div');
      r.id = 'applypilot-root';
      // Page scripts can dispatch events against shared DOM but cannot create trusted clicks.
      if (!nativePanel) r.addEventListener('click', (event) => {
        if (!event.isTrusted) { event.preventDefault(); event.stopImmediatePropagation(); }
      }, true);
      // In browser-panel mode the content script keeps only a detached view model.
      // Nothing is inserted into the application's DOM or changes its layout.
      if (nativePanel || layout !== 'sidebar') document.documentElement.appendChild(r);
    }
    rootElement = r;
    r.dataset.formoraUi = UI_VERSION;
    return r;
  }
  const panel = () => root().querySelector('.ap-panel');

  function clamp(x, y, p) {
    const w = p.offsetWidth || 380, h = p.offsetHeight || 200;
    return { x: Math.min(Math.max(0, x), Math.max(0, innerWidth - w)), y: Math.min(Math.max(0, y), Math.max(0, innerHeight - Math.min(h, 60))) };
  }

  function place(r, pos) {
    if (!pos) { r.style.left = ''; r.style.top = ''; r.style.right = '16px'; r.style.bottom = '16px'; return; }
    const p = clamp(pos.x, pos.y, panel());
    r.style.right = 'auto'; r.style.bottom = 'auto'; r.style.left = p.x + 'px'; r.style.top = p.y + 'px';
  }

  function size(r, s) {
    const p = panel();
    if (!s) { p.style.width = ''; p.style.height = ''; p.style.maxHeight = ''; return; }
    p.style.width = Math.max(MIN_W, Math.min(s.w, innerWidth - 16)) + 'px';
    p.style.height = Math.max(MIN_H, Math.min(s.h, innerHeight - 16)) + 'px';
    p.style.maxHeight = 'none';
  }

  // Pointer-drag helper: onMove gets the pointer delta from the start of the drag.
  function dragOn(handle, r, onStart, onMove, onEnd) {
    let d = null;
    handle.addEventListener('pointerdown', (e) => {
      if (layout === 'sidebar' || e.button !== 0 || e.target.closest('button')) return;
      d = { x: e.clientX, y: e.clientY, s: onStart() };
      handle.setPointerCapture(e.pointerId);
      r.classList.add('ap-dragging');
      e.preventDefault();
    });
    handle.addEventListener('pointermove', (e) => { if (d) onMove(e.clientX - d.x, e.clientY - d.y, d.s); });
    const end = (e) => {
      if (!d) return;
      d = null;
      r.classList.remove('ap-dragging');
      try { handle.releasePointerCapture(e.pointerId); } catch { /* already released */ }
      onEnd();
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  function wire(r) {
    if (nativePanel) {
      answerSizer = new ResizeObserver(() => r.querySelectorAll('textarea').forEach(fitAnswer));
      answerSizer.observe(panel());
      return;
    }
    const head = r.querySelector('.ap-head');
    dragOn(head, r,
      () => panel().getBoundingClientRect(),
      (dx, dy, s) => place(r, { x: s.left + dx, y: s.top + dy }),
      () => { const b = panel().getBoundingClientRect(); store(POS_KEY, { x: b.left, y: b.top }); });
    head.addEventListener('dblclick', (e) => { if (!e.target.closest('button')) { store(POS_KEY, null); store(SIZE_KEY, null); place(r, null); size(r, null); } });

    // Resize from the bottom-right corner. The panel is anchored top-left while resizing so it grows away from the corner.
    const grip = r.querySelector('.ap-resize');
    dragOn(grip, r,
      () => { const b = panel().getBoundingClientRect(); place(r, { x: b.left, y: b.top }); return b; },
      (dx, dy, s) => size(r, { w: s.width + dx, h: s.height + dy }),
      () => { const b = panel().getBoundingClientRect(); store(SIZE_KEY, { w: b.width, h: b.height }); store(POS_KEY, { x: b.left, y: b.top }); });

    window.addEventListener('resize', () => { const pos = load(POS_KEY); if (pos) place(r, pos); const s = load(SIZE_KEY); if (s) size(r, s); });
    let lastWidth = 0;
    answerSizer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width === lastWidth) return;
      lastWidth = entry.contentRect.width;
      r.querySelectorAll('textarea').forEach(fitAnswer);
    });
    answerSizer.observe(panel());
  }

  let applyAllHandler = null;
  let answerSizer = null;
  let currentFilter = 'all';
  let currentResults = [];
  let reapplyHandler = null;
  let resultVersion = 0;
  let changeInfo = null;

  function fitAnswer(textarea) {
    if (!textarea.offsetWidth) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(260, Math.max(88, textarea.scrollHeight + 2))}px`;
  }

  function stateOf(r) {
    if (r.dirty) return 'edited';
    if (r.source === 'pending') return 'pending';
    if (r.source === 'fail') return 'fail';
    if (r.source === 'manual' || r.q?.meta?.manualFill) return 'manual';
    if (r.source === 'ai') return 'review';
    if (['profile', 'memory'].includes(r.source)) return 'filled';
    if (/^(current position: end date left empty|not a current position|left unticked)$/.test(r.note || '')) return 'blank';
    return r.q?.currentValue ? 'existing' : 'skipped';
  }

  const states = {
    manual: { label: 'Fill manually', icon: '!', cls: 'ap-skip' },
    fail: { label: 'Needs a retry', icon: '!', cls: 'ap-fail' },
    skipped: { label: 'Needs your answer', icon: '!', cls: 'ap-skip' },
    edited: { label: 'Unsaved changes', icon: '!', cls: 'ap-skip' },
    review: { label: 'Review AI answer', icon: '↗', cls: 'ap-ai' },
    filled: { label: 'Filled', icon: '✓', cls: 'ap-ok' },
    existing: { label: 'Already filled', icon: '✓', cls: 'ap-existing' },
    blank: { label: 'Left blank', icon: '–', cls: 'ap-existing' },
    pending: { label: 'Preparing answer', icon: '·', cls: 'ap-pending' },
  };
  const needsYou = (r) => ['manual', 'fail', 'skipped', 'edited'].includes(stateOf(r));

  function filterCards() {
    const r = root();
    for (const card of r.querySelectorAll('.ap-item')) {
      const state = card.dataset.state;
      card.hidden = currentFilter === 'attention' ? !['manual', 'fail', 'skipped', 'edited'].includes(state)
        : currentFilter === 'review' ? state !== 'review' : false;
    }
    for (const button of r.querySelectorAll('[data-filter]')) button.setAttribute('aria-pressed', String(button.dataset.filter === currentFilter));
    const empty = r.querySelector('.ap-filter-empty');
    if (empty) empty.hidden = currentFilter === 'all' || [...r.querySelectorAll('.ap-item')].some((card) => !card.hidden);
    requestAnimationFrame(() => r.querySelectorAll('textarea').forEach(fitAnswer));
  }

  function updateFilters() {
    const fields = currentResults.filter((r) => r.q);
    const filters = root().querySelector('.ap-filters');
    filters.hidden = !fields.length || fields.some((r) => r.source === 'pending');
    const counts = { all: fields.length, attention: fields.filter(needsYou).length, review: fields.filter((r) => stateOf(r) === 'review').length };
    for (const button of filters.querySelectorAll('[data-filter]')) button.querySelector('span').textContent = counts[button.dataset.filter];
    filterCards();
  }

  function userNote(r, state) {
    if (state === 'manual') return r.value ? 'Choose this answer in the form. Use the suggested value below.' : 'This field needs a selection in the form.';
    if (state === 'review') return 'Draft only. Check this answer, then Apply to share it with the website.';
    if (state === 'filled') return /\bcheck\b|verify|could not|does not|not found/i.test(r.note || '') ? r.note : '';
    if (state === 'existing') return '';
    if (state === 'blank') return r.note === 'current position: end date left empty' ? 'No end date needed for your current role.' : 'Left unselected based on your profile.';
    if (r.note === 'no API key set in options') return 'Add an API key in Settings to generate an answer, or enter your own.';
    if (r.note === 'scan only') return 'Scan complete. Fill the form when you’re ready.';
    return r.note || 'Add your answer here or directly in the form.';
  }

  JAF.overlay = {
    show(status) {
      const r = root();
      ensureStyles(r);
      if (!r.querySelector('.ap-panel')) {
        r.innerHTML = `
          <div class="ap-panel" role="region" aria-label="Formora">
            <div class="ap-head" title="Drag to move. Double-click to reset position and size.">
              <span class="ap-title"><img class="ap-logo" alt="" src="${chrome.runtime.getURL("icons/dark/icon32.png")}" /> Formora</span><span class="ap-step"></span>
              <button data-act="settings" title="Formora Settings" aria-label="Open Formora Settings">&#9881;</button>
              <button data-act="min" title="Collapse" aria-label="Collapse panel">&#8211;</button>
              <button data-act="close" title="Close" aria-label="Close panel">&#10005;</button>
            </div>
            <div class="ap-actions"><button class="ap-primary" data-act="fill" title="Fill this page using your saved information">Fill page <span aria-hidden="true">↗</span></button><button data-act="scan" title="Preview the questions without filling them">Preview fields</button><button data-act="cancel" hidden>Cancel AI</button></div>
            <div class="ap-status" role="status" aria-live="polite"><span class="ap-spin" hidden></span><div class="ap-status-text"></div></div>
            <div class="ap-progress" role="progressbar" aria-label="Fields filled" aria-valuemin="0" hidden><span></span></div>
            <div class="ap-change" hidden></div>
            <div class="ap-filters" role="group" aria-label="Filter answers" hidden><button data-filter="all" aria-pressed="true">All <span>0</span></button><button data-filter="attention" aria-pressed="false">Needs you <span>0</span></button><button data-filter="review" aria-pressed="false">AI review <span>0</span></button></div>
            <div class="ap-tools" hidden><span class="ap-tools-note"></span><button data-act="apply-all">Apply all answers</button></div>
            <div class="ap-list"></div>
            <div class="ap-foot"><span aria-hidden="true">✓</span> You’re in control. Only you can submit this application.</div>
            <div class="ap-resize" title="Drag to resize"></div>
          </div>`;
        r.querySelector('[data-act="close"]').onclick = () => { JAF.overlay.hide(); if (JAF.stopWatch) JAF.stopWatch(); };
        r.querySelector('[data-act="fill"]').onclick = () => JAF.run({ mode: 'fill' });
        r.querySelector('[data-act="scan"]').onclick = () => JAF.run({ mode: 'scan' });
        r.querySelector('[data-act="cancel"]').onclick = () => JAF.cancelAI?.();
        r.querySelector('[data-act="settings"]').onclick = async () => {
          try { const response = await chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' }); if (!response.ok) throw new Error(response.error); }
          catch (e) { this.status('Could not open Settings: ' + e.message); }
        };
        r.querySelector('[data-act="min"]').onclick = () => this.minimize(!r.classList.contains('ap-min'));
        r.querySelector('[data-act="apply-all"]').onclick = () => applyAllHandler && applyAllHandler();
        r.querySelectorAll('[data-filter]').forEach((button) => { button.onclick = () => { currentFilter = button.dataset.filter; filterCards(); }; });
        wire(r);
        place(r, load(POS_KEY));
        size(r, load(SIZE_KEY));
        if (!nativePanel && load(MIN_KEY)) this.minimize(true);
      }
      if (status != null) { r.querySelector('.ap-status-text').textContent = status; r.querySelector('.ap-spin').hidden = true; r.querySelector('.ap-progress').hidden = true; r.querySelector('[data-act="cancel"]').hidden = true; }
    },
    status(text) { this.show(text); },
    summary(results = currentResults) {
      const fields = results.filter((r) => r.q);
      const filled = fields.filter((r) => ['profile', 'memory'].includes(r.source)).length;
      const attention = fields.filter(needsYou).length;
      this.show();
      root().querySelector('.ap-spin').hidden = true;
      root().querySelector('[data-act="cancel"]').hidden = true;
      root().querySelector('.ap-status-text').innerHTML = `<strong>Filled ${filled} of ${fields.length} fields</strong>\n<div class="ap-status-detail">${attention ? `${attention} ${attention === 1 ? 'field still needs' : 'fields still need'} your input.` : 'Review your answers, then submit on the form.'}</div>`;
      const progress = root().querySelector('.ap-progress');
      progress.hidden = !fields.length;
      progress.setAttribute('aria-valuenow', filled);
      progress.setAttribute('aria-valuemax', fields.length);
      progress.firstElementChild.style.width = `${fields.length ? filled / fields.length * 100 : 0}%`;
    },
    // Status with a spinner: extraction, dropdown discovery, the model call.
    busy(text) { this.show(text); root().querySelector('.ap-spin').hidden = false; root().querySelector('[data-act="cancel"]').hidden = false; },
    hide() { answerSizer?.disconnect(); answerSizer = null; rootElement?.remove(); rootElement = null; currentResults = []; resultVersion++; },
    isVisible() { return !!rootElement?.querySelector('.ap-panel'); },
    minimize(on) {
      const r = root();
      r.classList.toggle('ap-min', !!on);
      const b = r.querySelector('[data-act="min"]');
      if (b) { b.innerHTML = on ? '&#9633;' : '&#8211;'; b.title = on ? 'Expand' : 'Collapse'; b.setAttribute('aria-label', on ? 'Expand panel' : 'Collapse panel'); }
      store(MIN_KEY, on ? 1 : null);
    },
    setStep(n) { this.show(); root().querySelector('.ap-step').textContent = n ? `step ${n}` : ''; },

    // Empty list with a hint. Used before extraction and whenever the page moves on.
    empty(text) {
      this.show();
      currentResults = [];
      resultVersion++;
      const list = root().querySelector('.ap-list');
      list.innerHTML = `<div class="ap-empty">${esc(text || 'No questions extracted yet.')}</div>`;
      root().querySelector('.ap-filters').hidden = true;
      root().querySelector('.ap-progress').hidden = true;
      this.tools(null);
    },

    // Compact state after a reload / navigation: nothing filled yet on this page.
    ready(text) {
      this.show(text || 'Ready. Click "Fill page" when the form is on screen.');
      this.empty('Questions on this page will appear here after you click Fill page or Scan.');
      this.pageChanged(null);
    },

    // Multi-step forms: the page moved on. Clear the old answers, offer to fill the new step.
    pageChanged(info) {
      changeInfo = info;
      this.show();
      const bar = root().querySelector('.ap-change');
      if (!info) { bar.hidden = true; bar.innerHTML = ''; return; }
      const what = info.unknown ? `${info.unknown} new field(s)` : 'a new step';
      bar.hidden = false;
      bar.innerHTML = `<span>Page changed: ${esc(what)} found.</span><button class="ap-primary" data-act="fill-new">Fill this page</button><button data-act="scan-new">Scan only</button><button data-act="dismiss" title="Ignore">&#10005;</button>`;
      bar.querySelector('[data-act="fill-new"]').onclick = () => JAF.run({ mode: 'fill' });
      bar.querySelector('[data-act="scan-new"]').onclick = () => JAF.run({ mode: 'scan' });
      bar.querySelector('[data-act="dismiss"]').onclick = () => { bar.hidden = true; this.status('Ready.'); if (JAF.markSeen) JAF.markSeen(true); };
      this.status('New page detected.');
      this.empty('This looks like a new page. Its questions will appear here after you click Fill this page.');
      this.minimize(false);
    },

    // Same page, a few new fields (a "Yes" that revealed more questions). Offer, keep the list.
    fieldsAppeared(n) {
      changeInfo = { appeared: n };
      this.show();
      const bar = root().querySelector('.ap-change');
      bar.hidden = false;
      bar.innerHTML = `<span>${n} new field(s) appeared on this page.</span><button class="ap-primary" data-act="fill-new">Fill new fields</button><button data-act="dismiss" title="Ignore">&#10005;</button>`;
      bar.querySelector('[data-act="fill-new"]').onclick = () => JAF.run({ mode: 'fill' });
      bar.querySelector('[data-act="dismiss"]').onclick = () => { bar.hidden = true; if (JAF.markSeen) JAF.markSeen(); };
      this.minimize(false);
    },

    tools(handler, note) {
      const t = root().querySelector('.ap-tools');
      applyAllHandler = handler;
      t.hidden = !handler;
      t.querySelector('.ap-tools-note').textContent = note || '';
    },

    // results: [{q, source:'profile'|'memory'|'ai'|'manual'|'skip'|'fail'|'pending'|'info', value, note}]
    // 'pending' items are placeholders for answers the model is still producing.
    render(results, onReapply) {
      this.show();
      this.pageChanged(null);
      currentResults = results;
      reapplyHandler = onReapply;
      resultVersion++;
      currentFilter = 'all';
      const list = root().querySelector('.ap-list');
      list.innerHTML = '';
      const order = { fail: 0, manual: 1, skip: 2, pending: 3, ai: 4, memory: 5, profile: 6, info: 7 };
      results.sort((a, b) => order[a.source] - order[b.source]);
      const editors = []; // for Apply all
      for (const r of results) {
        const item = document.createElement('div');
        if (!nativePanel && r.source === 'ai') {
          item.className = 'ap-item ap-ai'; item.dataset.state = 'review';
          item.innerHTML = `<div class="ap-label">${esc(r.q.label)}</div><div class="ap-note">An AI draft is ready. Review it in the browser side panel before sharing it with this website.</div><button data-act="review-draft">Review AI draft</button>`;
          item.querySelector('button').onclick = () => JAF.worker({ type: 'OPEN_REVIEW' }).then((r) => { if (!r.ok) this.status(r.error); }).catch((e) => this.status(e.message));
          list.appendChild(item); continue;
        }
        if (r.source === 'info') {
          item.className = 'ap-item ap-info';
          item.innerHTML = `<div class="ap-note">${esc(r.note)}</div>`;
          list.appendChild(item);
          continue;
        }
        if (r.source === 'pending') {
          item.className = 'ap-item ap-pending';
          item.dataset.state = 'pending';
          item.innerHTML = `<div class="ap-label">${esc(r.q.label)}<span class="ap-badge ap-wait"><span class="ap-spin ap-spin-sm"></span>Preparing answer</span></div><div class="ap-shimmer"></div><div class="ap-shimmer ap-shimmer-short"></div>`;
          list.appendChild(item);
          continue;
        }
        const manual = r.source === 'manual' || !!r.q.meta?.manualFill;
        const state = stateOf(r);
        const style = states[state];
        item.dataset.state = state;
        item.className = `ap-item ${style.cls}`;
        const editable = !manual && state !== 'blank' && ['ai', 'memory', 'skip', 'fail'].includes(r.source) && r.q.type !== 'file';
        const valueText = Array.isArray(r.value) ? r.value.join(', ') : (r.value ?? '');
        const opts = r.q.options || [];
        // Option questions get a real selector so "Apply" can only send values the page accepts.
        const kind = !editable ? 'none'
          : opts.length && (r.q.type === 'radio' || r.q.type === 'select') ? 'select'
          : opts.length && r.q.type === 'checkbox' ? 'checks'
          : 'text';
        let editor = '';
        if (kind === 'select') {
          const list = opts.slice();
          if (valueText && !list.some((o) => same(o, valueText))) list.unshift(valueText);
          editor = `<select class="ap-edit" aria-label="${esc(r.q.label)}">${list.map((o) => `<option${same(o, valueText) ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
        } else if (kind === 'checks') {
          const vals = Array.isArray(r.value) ? r.value : String(r.value || '').split(/\s*[,|;]\s*/).filter(Boolean);
          editor = `<div class="ap-checks">${opts.map((o) => `<label><input type="checkbox"${vals.some((v) => same(v, o)) ? ' checked' : ''} /> ${esc(o)}</label>`).join('')}</div>`;
        } else if (kind === 'text') {
          editor = `<textarea aria-label="${esc(r.q.label)}" placeholder="Write your answer…" rows="3">${esc(valueText)}</textarea>`;
        } else {
          editor = valueText ? `<div class="ap-value">${manual ? '<span class="ap-value-label">Suggested answer</span>' : ''}${esc(valueText)}</div>` : '';
        }
        const section = r.q.meta && r.q.meta.section && !same(r.q.meta.section, r.q.label) ? `<div class="ap-section">${esc(r.q.meta.section)}</div>` : '';
        const note = userNote(r, state);
        item.innerHTML = `
          ${section}<div class="ap-label"><span class="ap-question">${esc(r.q.label)}</span><span class="ap-badge ap-state"><span aria-hidden="true">${style.icon}</span> ${style.label}</span></div>
          ${note ? `<div class="ap-note">${esc(note)}</div>` : ''}
          ${editor}
          ${opts.length && kind === 'text' ? `<div class="ap-note ap-opts">Options${r.q.meta?.optionsPartial ? ' (partial)' : ''}: ${esc(opts.join(' | '))}</div>` : ''}
          <div class="ap-row">${editable ? '<button class="ap-primary" data-act="apply">Apply answer</button>' : ''}<button class="${manual ? 'ap-manual-action' : 'ap-locate'}" data-act="locate">${manual ? 'Fill in form' : 'Show in form'} <span aria-hidden="true">↗</span></button>${['profile', 'memory'].includes(r.source) ? `<span class="ap-provenance">${r.source === 'profile' ? 'From your profile' : 'Saved answer'}</span>` : ''}</div>`;
        item.querySelector('.ap-label').onclick = () => JAF.highlight(r.q, '#1C3A4B');
        item.querySelector('[data-act="locate"]').onclick = () => {
          JAF.highlight(r.q, '#1C3A4B');
          const entry = JAF.registry.get(r.q.id);
          const el = entry && (entry.el || (entry.els && entry.els[0]));
        if (el) {
            el.scrollIntoView({ block: 'center' });
            if (manual) el.focus({ preventScroll: true });
          }
        };
        const applyBtn = item.querySelector('[data-act="apply"]');
        if (applyBtn) {
          const getValue = () => {
            let v;
            if (kind === 'select') v = item.querySelector('select.ap-edit').value;
            else if (kind === 'checks') v = Array.from(item.querySelectorAll('.ap-checks input')).filter((c) => c.checked).map((c) => c.parentElement.textContent.trim());
            else {
              v = item.querySelector('textarea').value;
              if (r.q.type === 'checkbox') v = v.split(/\s*[,|;]\s*/).filter(Boolean);
            }
            return v;
          };
          const apply = async () => {
            const v = getValue();
            if (applyBtn.disabled) return { ok: false };
            applyBtn.disabled = true;
            applyBtn.textContent = 'Applying…';
            let res;
            try { res = await onReapply(r.q, v); } catch { res = { ok: false, note: 'Could not apply this answer. Try again or fill it in the form.' }; }
            finally { applyBtn.disabled = false; }
            applyBtn.textContent = res.ok ? 'Applied ✓' : 'Try again';
            r.source = res.ok ? 'memory' : 'fail';
            r.note = res.note || (res.ok ? 'Your answer has been updated in the form.' : 'Please fill this answer in the form.');
            r.dirty = false;
            r.value = v;
            const nextState = stateOf(r), nextStyle = states[nextState];
            item.dataset.state = nextState;
            item.className = `ap-item ${nextStyle.cls}`;
            item.querySelector('.ap-state').textContent = `${nextStyle.icon} ${nextStyle.label}`;
            let n = item.querySelector('.ap-note');
            if (!n) { n = document.createElement('div'); n.className = 'ap-note'; item.querySelector('.ap-label').after(n); }
            n.textContent = res.ok ? 'Your answer has been updated in the form.' : res.note || 'Please fill this answer in the form.';
            updateFilters();
            this.summary();
            return res;
          };
          applyBtn.onclick = apply;
          item.querySelectorAll('textarea, select, input').forEach((input) => input.addEventListener('input', () => {
            r.dirty = true;
            applyBtn.textContent = 'Apply changes';
            item.dataset.state = 'edited';
            item.className = 'ap-item ap-skip';
            item.querySelector('.ap-state').textContent = '! Unsaved changes';
            // Keep the card visible while typing; update filter membership when
            // the user switches views or applies the answer.
            const attention = root().querySelector('[data-filter="attention"] span');
            attention.textContent = currentResults.filter(needsYou).length;
            root().querySelector('[data-filter="review"] span').textContent = currentResults.filter((x) => stateOf(x) === 'review').length;
            this.summary();
          }));
          editors.push({ getValue, apply, source: r.source });
        }
        list.appendChild(item);
        const textarea = item.querySelector('textarea');
        if (textarea) {
          const fit = () => fitAnswer(textarea);
          requestAnimationFrame(fit);
          textarea.addEventListener('input', fit);
        }
      }
      const noMatches = document.createElement('div');
      noMatches.className = 'ap-filter-empty';
      noMatches.textContent = 'All clear. No answers in this view.';
      noMatches.hidden = true;
      list.appendChild(noMatches);
      updateFilters();
      // Apply all: every editable card that holds a value, in list order. Skips empty editors.
      const pending = results.some((r) => r.source === 'pending');
      if (editors.length && !pending) {
        this.tools(async () => {
          const btn = root().querySelector('[data-act="apply-all"]');
          btn.disabled = true;
          let ok = 0, fail = 0, skipped = 0;
          for (const e of editors) {
            const v = e.getValue();
            if (!v || (Array.isArray(v) && !v.length)) { skipped++; continue; }
            btn.textContent = `Applying ${ok + fail + 1}...`;
            const res = await e.apply();
            if (res.ok) ok++; else fail++;
          }
          btn.disabled = false;
          btn.textContent = 'Apply all answers';
          this.tools(applyAllHandler, `Applied ${ok} ${ok === 1 ? 'answer' : 'answers'}${fail ? ` · ${fail} need a retry` : ''}${skipped ? ` · ${skipped} left empty` : ''}`);
        }, 'Edited an answer? Apply it to the form.');
      } else {
        this.tools(null);
      }
    },
  };

  // A tab-scoped port carries data and explicit actions to the browser-owned panel.
  // The DOM registry and actual writes stay in this document's isolated content script.
  if (!nativePanel && window === window.top && chrome.runtime.onConnect) {
    const ports = new Set();
    const documentToken = crypto.randomUUID();
    let queued = false;
    function snapshot() {
      const r = rootElement;
      return {
        documentToken, version: resultVersion, running: !!JAF.running,
        status: r?.querySelector('.ap-status-text')?.textContent || 'Ready. Click Fill page to start.',
        busy: r ? !r.querySelector('.ap-spin')?.hidden : false,
        summary: r ? !r.querySelector('.ap-progress')?.hidden : false,
        step: r?.querySelector('.ap-step')?.textContent || '',
        change: r?.querySelector('.ap-change')?.hidden ? null : changeInfo,
        results: currentResults.map(({ q, source, value, note }) => ({
          source, value, note,
          q: q ? { id: q.id, type: q.type, label: q.label, options: q.options, currentValue: q.currentValue,
            meta: { manualFill: q.meta?.manualFill, section: q.meta?.section, optionsPartial: q.meta?.optionsPartial } } : undefined,
        })),
      };
    }
    function publish() {
      if (queued || !ports.size) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        const state = snapshot();
        for (const port of ports) { try { port.postMessage({ type: 'STATE', state }); } catch { ports.delete(port); } }
      });
    }
    for (const name of ['show', 'status', 'busy', 'summary', 'render', 'empty', 'ready', 'pageChanged', 'fieldsAppeared', 'setStep', 'hide']) {
      const original = JAF.overlay[name];
      JAF.overlay[name] = function (...args) { const result = original.apply(this, args); publish(); return result; };
    }
    JAF.publishPanel = publish;
    chrome.runtime.onConnect.addListener((port) => {
      if (port.name !== 'formora-panel' || port.sender?.id !== chrome.runtime.id || port.sender?.url !== chrome.runtime.getURL('src/sidepanel/sidepanel.html')) return;
      ports.add(port);
      port.onDisconnect.addListener(() => ports.delete(port));
      JAF.overlayReady.then(() => {
        if (!JAF.overlay.isVisible()) JAF.overlay.ready();
        JAF.startWatch?.();
        publish();
      });
      port.onMessage.addListener(async (msg) => {
        try {
          await JAF.overlayReady;
          let result = { ok: true };
          if (msg.action === 'fill' || msg.action === 'scan') await JAF.run({ mode: msg.action });
          else if (msg.action === 'dismiss') { changeInfo = null; JAF.overlay.pageChanged(null); JAF.markSeen?.(true); }
          else {
            if (msg.documentToken !== documentToken || msg.version !== resultVersion || JAF.running) throw new Error('The page changed. Preview fields again before applying an answer.');
            const entry = currentResults.find((r) => r.q?.id === msg.id);
            if (!entry) throw new Error('This field is no longer on the current page.');
            const registered = JAF.registry.get(msg.id);
            const element = registered?.el || registered?.els?.[0];
            if (!element?.isConnected) throw new Error('This field was replaced. Preview fields again.');
            if (msg.action === 'apply') {
              if (!reapplyHandler || entry.source === 'manual' || entry.q.meta?.manualFill || entry.q.type === 'file') throw new Error('Fill this field directly in the form.');
              result = await reapplyHandler(entry.q, msg.value, true);
              entry.value = msg.value; entry.source = result.ok ? 'memory' : 'fail'; entry.note = result.note || '';
              JAF.overlay.summary();
            } else if (msg.action === 'locate') {
              JAF.highlight(entry.q, '#1C3A4B'); element.scrollIntoView({ block: 'center' });
              element.focus({ preventScroll: true });
            } else throw new Error('Unknown panel action.');
          }
          port.postMessage({ type: 'REPLY', requestId: msg.requestId, result });
        } catch (e) {
          try { port.postMessage({ type: 'REPLY', requestId: msg.requestId, result: { ok: false, note: e.message } }); } catch { /* panel closed */ }
        }
      });
    });
  }
})();
