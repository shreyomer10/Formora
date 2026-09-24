// Review panel injected into the page. Shows what was filled, by what, and lets
// the user edit and re-apply LLM answers before they submit. Draggable, resizable,
// collapsible, and it stays up across the steps of a multi-page application.
(function () {
  const JAF = window.JAF;

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const same = (a, b) => norm(a) === norm(b);
  const POS_KEY = 'applypilot.pos';
  const SIZE_KEY = 'applypilot.size';
  const MIN_KEY = 'applypilot.min';
  const MIN_W = 300, MIN_H = 180;

  function store(key, val) { try { if (val == null) sessionStorage.removeItem(key); else sessionStorage.setItem(key, JSON.stringify(val)); } catch { /* storage blocked */ } }
  function load(key) { try { const v = sessionStorage.getItem(key); return v ? JSON.parse(v) : null; } catch { return null; } }

  function root() {
    let r = document.getElementById('applypilot-root');
    if (!r) {
      r = document.createElement('div');
      r.id = 'applypilot-root';
      document.documentElement.appendChild(r);
    }
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
      if (e.button !== 0 || e.target.closest('button')) return;
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
  }

  let applyAllHandler = null;

  JAF.overlay = {
    show(status) {
      const r = root();
      if (!r.querySelector('.ap-panel')) {
        r.innerHTML = `
          <div class="ap-panel">
            <div class="ap-head" title="Drag to move. Double-click to reset position and size.">
              <span class="ap-title">ApplyPilot</span><span class="ap-step"></span>
              <button data-act="fill" title="Extract and fill the form on this page">Fill page</button>
              <button data-act="scan" title="Only list the questions, fill nothing">Scan</button>
              <button data-act="min" title="Collapse">&#8211;</button>
              <button data-act="close" title="Close">&#10005;</button>
            </div>
            <div class="ap-status"><span class="ap-spin" hidden></span><span class="ap-status-text"></span></div>
            <div class="ap-change" hidden></div>
            <div class="ap-tools" hidden><button class="ap-primary" data-act="apply-all">Apply all</button><span class="ap-tools-note"></span></div>
            <div class="ap-list"></div>
            <div class="ap-foot">Nothing is submitted automatically. Review the form, then submit it yourself.</div>
            <div class="ap-resize" title="Drag to resize"></div>
          </div>`;
        r.querySelector('[data-act="close"]').onclick = () => { JAF.overlay.hide(); if (JAF.stopWatch) JAF.stopWatch(); };
        r.querySelector('[data-act="fill"]').onclick = () => JAF.run({ mode: 'fill' });
        r.querySelector('[data-act="scan"]').onclick = () => JAF.run({ mode: 'scan' });
        r.querySelector('[data-act="min"]').onclick = () => this.minimize(!r.classList.contains('ap-min'));
        r.querySelector('[data-act="apply-all"]').onclick = () => applyAllHandler && applyAllHandler();
        wire(r);
        place(r, load(POS_KEY));
        size(r, load(SIZE_KEY));
        if (load(MIN_KEY)) this.minimize(true);
      }
      if (status != null) { r.querySelector('.ap-status-text').textContent = status; r.querySelector('.ap-spin').hidden = true; }
    },
    status(text) { this.show(text); },
    // Status with a spinner: extraction, dropdown discovery, the model call.
    busy(text) { this.show(text); root().querySelector('.ap-spin').hidden = false; },
    hide() { const r = document.getElementById('applypilot-root'); if (r) r.remove(); },
    minimize(on) {
      const r = root();
      r.classList.toggle('ap-min', !!on);
      const b = r.querySelector('[data-act="min"]');
      if (b) { b.innerHTML = on ? '&#9633;' : '&#8211;'; b.title = on ? 'Expand' : 'Collapse'; }
      store(MIN_KEY, on ? 1 : null);
    },
    setStep(n) { this.show(); root().querySelector('.ap-step').textContent = n ? `step ${n}` : ''; },

    // Empty list with a hint. Used before extraction and whenever the page moves on.
    empty(text) {
      this.show();
      const list = root().querySelector('.ap-list');
      list.innerHTML = `<div class="ap-empty">${esc(text || 'No questions extracted yet.')}</div>`;
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
      this.show();
      const bar = root().querySelector('.ap-change');
      if (!info) { bar.hidden = true; bar.innerHTML = ''; return; }
      const what = info.unknown ? `${info.unknown} new field(s)` : 'a new step';
      bar.hidden = false;
      bar.innerHTML = `<span>Page changed: ${esc(what)} found.</span><button class="ap-primary" data-act="fill-new">Fill this page</button><button data-act="scan-new">Scan only</button><button data-act="dismiss" title="Ignore">&#10005;</button>`;
      bar.querySelector('[data-act="fill-new"]').onclick = () => JAF.run({ mode: 'fill' });
      bar.querySelector('[data-act="scan-new"]').onclick = () => JAF.run({ mode: 'scan' });
      bar.querySelector('[data-act="dismiss"]').onclick = () => { bar.hidden = true; if (JAF.markSeen) JAF.markSeen(); };
      this.status('New page detected.');
      this.empty('This looks like a new page. Its questions will appear here after you click Fill this page.');
      this.minimize(false);
    },

    tools(handler, note) {
      const t = root().querySelector('.ap-tools');
      applyAllHandler = handler;
      t.hidden = !handler;
      t.querySelector('.ap-tools-note').textContent = note || '';
    },

    // results: [{q, source:'profile'|'memory'|'ai'|'skip'|'fail'|'pending'|'info', value, note}]
    // 'pending' items are placeholders for answers the model is still producing.
    render(results, onReapply) {
      this.show();
      this.pageChanged(null);
      const list = root().querySelector('.ap-list');
      list.innerHTML = '';
      const order = { info: 0, pending: 1, fail: 2, skip: 3, ai: 4, memory: 5, profile: 6 };
      results.sort((a, b) => order[a.source] - order[b.source]);
      const editors = []; // for Apply all
      for (const r of results) {
        const item = document.createElement('div');
        if (r.source === 'info') {
          item.className = 'ap-item ap-info';
          item.innerHTML = `<div class="ap-note">${esc(r.note)}</div>`;
          list.appendChild(item);
          continue;
        }
        if (r.source === 'pending') {
          item.className = 'ap-item ap-pending';
          item.innerHTML = `<div class="ap-label">${esc(r.q.label)}<span class="ap-badge ap-wait"><span class="ap-spin ap-spin-sm"></span>waiting for AI</span><span class="ap-badge">${esc(r.q.type)}</span></div><div class="ap-shimmer"></div><div class="ap-shimmer ap-shimmer-short"></div>`;
          list.appendChild(item);
          continue;
        }
        const cls = r.source === 'fail' ? 'ap-fail' : r.source === 'skip' ? 'ap-skip' : r.source === 'ai' ? 'ap-ai' : 'ap-ok';
        item.className = `ap-item ${cls}`;
        const editable = ['ai', 'memory', 'skip', 'fail'].includes(r.source) && r.q.type !== 'file';
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
          editor = `<select class="ap-edit">${list.map((o) => `<option${same(o, valueText) ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
        } else if (kind === 'checks') {
          const vals = Array.isArray(r.value) ? r.value : String(r.value || '').split(/\s*[,|;]\s*/).filter(Boolean);
          editor = `<div class="ap-checks">${opts.map((o) => `<label><input type="checkbox"${vals.some((v) => same(v, o)) ? ' checked' : ''} /> ${esc(o)}</label>`).join('')}</div>`;
        } else if (kind === 'text') {
          editor = `<textarea>${esc(valueText)}</textarea>`;
        } else {
          editor = `<div class="ap-note">${esc(valueText)}</div>`;
        }
        const section = r.q.meta && r.q.meta.section && !same(r.q.meta.section, r.q.label) ? `<span class="ap-badge ap-sec">${esc(r.q.meta.section)}</span>` : '';
        item.innerHTML = `
          <div class="ap-label">${esc(r.q.label)}<span class="ap-badge">${esc(r.source)}</span><span class="ap-badge">${esc(r.q.type)}</span>${section}</div>
          ${editor}
          ${r.note ? `<div class="ap-note">${esc(r.note)}</div>` : ''}
          ${opts.length && kind === 'text' ? `<div class="ap-note ap-opts">Options${r.q.meta?.optionsPartial ? ' (partial)' : ''}: ${esc(opts.join(' | '))}</div>` : ''}
          ${editable ? `<div class="ap-row"><button class="ap-primary" data-act="apply">Apply</button><button data-act="locate">Locate</button></div>` : `<div class="ap-row"><button data-act="locate">Locate</button></div>`}`;
        item.querySelector('.ap-label').onclick = () => JAF.highlight(r.q, '#7c3aed');
        item.querySelector('[data-act="locate"]').onclick = () => {
          JAF.highlight(r.q, '#7c3aed');
          const entry = JAF.registry.get(r.q.id);
          const el = entry && (entry.el || (entry.els && entry.els[0]));
          if (el) el.scrollIntoView({ block: 'center' });
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
            applyBtn.textContent = '...';
            const res = await onReapply(r.q, v);
            applyBtn.textContent = res.ok ? 'Applied' : 'Failed';
            item.className = `ap-item ${res.ok ? 'ap-ai' : 'ap-fail'}`;
            if (res.note) { let n = item.querySelector('.ap-note'); if (!n) { n = document.createElement('div'); n.className = 'ap-note'; item.appendChild(n); } n.textContent = res.note; }
            return res;
          };
          applyBtn.onclick = apply;
          editors.push({ getValue, apply, source: r.source });
        }
        list.appendChild(item);
      }
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
          btn.textContent = 'Apply all';
          this.tools(applyAllHandler, `applied ${ok}${fail ? `, failed ${fail}` : ''}${skipped ? `, ${skipped} empty` : ''}`);
        }, `${editors.length} editable answer(s)`);
      } else {
        this.tools(null);
      }
    },
  };
})();
