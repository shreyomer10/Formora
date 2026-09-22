// Review panel injected into the page. Shows what was filled, by what, and lets
// the user edit and re-apply LLM answers before they submit.
(function () {
  const JAF = window.JAF;

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function root() {
    let r = document.getElementById('applypilot-root');
    if (!r) {
      r = document.createElement('div');
      r.id = 'applypilot-root';
      document.documentElement.appendChild(r);
    }
    return r;
  }

  JAF.overlay = {
    show(status) {
      const r = root();
      if (!r.querySelector('.ap-panel')) {
        r.innerHTML = `
          <div class="ap-panel">
            <div class="ap-head"><span class="ap-title">ApplyPilot</span><button data-act="rescan">Re-run</button><button data-act="close">Close</button></div>
            <div class="ap-status"></div>
            <div class="ap-list"></div>
            <div class="ap-foot">Nothing is submitted automatically. Review the form, then submit it yourself.</div>
          </div>`;
        r.querySelector('[data-act="close"]').onclick = () => r.remove();
        r.querySelector('[data-act="rescan"]').onclick = () => JAF.run({ mode: 'fill' });
      }
      if (status != null) r.querySelector('.ap-status').textContent = status;
    },
    status(text) { this.show(text); },
    hide() { const r = document.getElementById('applypilot-root'); if (r) r.remove(); },

    // results: [{q, source:'profile'|'memory'|'ai'|'skip'|'fail', value, note}]
    render(results, onReapply) {
      this.show();
      const list = root().querySelector('.ap-list');
      list.innerHTML = '';
      const order = { fail: 0, skip: 1, ai: 2, memory: 3, profile: 4 };
      results.sort((a, b) => order[a.source] - order[b.source]);
      for (const r of results) {
        const cls = r.source === 'fail' ? 'ap-fail' : r.source === 'skip' ? 'ap-skip' : r.source === 'ai' ? 'ap-ai' : 'ap-ok';
        const item = document.createElement('div');
        item.className = `ap-item ${cls}`;
        const editable = ['ai', 'memory', 'skip', 'fail'].includes(r.source) && r.q.type !== 'file';
        const valueText = Array.isArray(r.value) ? r.value.join(', ') : (r.value ?? '');
        item.innerHTML = `
          <div class="ap-label">${esc(r.q.label)}<span class="ap-badge">${esc(r.source)}</span><span class="ap-badge">${esc(r.q.type)}</span></div>
          ${editable ? `<textarea>${esc(valueText)}</textarea>` : `<div class="ap-note">${esc(valueText)}</div>`}
          ${r.note ? `<div class="ap-note">${esc(r.note)}</div>` : ''}
          ${r.q.options && r.q.options.length && editable ? `<div class="ap-note">Options: ${esc(r.q.options.join(' | '))}</div>` : ''}
          ${editable ? `<div class="ap-row"><button class="ap-primary" data-act="apply">Apply</button><button data-act="locate">Locate</button></div>` : `<div class="ap-row"><button data-act="locate">Locate</button></div>`}`;
        item.querySelector('.ap-label').onclick = () => JAF.highlight(r.q, '#7c3aed');
        item.querySelector('[data-act="locate"]').onclick = () => {
          JAF.highlight(r.q, '#7c3aed');
          const entry = JAF.registry.get(r.q.id);
          const el = entry && (entry.el || (entry.els && entry.els[0]));
          if (el) el.scrollIntoView({ block: 'center' });
        };
        const applyBtn = item.querySelector('[data-act="apply"]');
        if (applyBtn) applyBtn.onclick = async () => {
          const ta = item.querySelector('textarea');
          let v = ta.value;
          if (r.q.type === 'checkbox') v = v.split(/\s*[,|;]\s*/).filter(Boolean);
          applyBtn.textContent = '...';
          const res = await onReapply(r.q, v);
          applyBtn.textContent = res.ok ? 'Applied' : 'Failed';
          item.className = `ap-item ${res.ok ? 'ap-ai' : 'ap-fail'}`;
          if (res.note) { let n = item.querySelector('.ap-note'); if (!n) { n = document.createElement('div'); n.className = 'ap-note'; item.appendChild(n); } n.textContent = res.note; }
        };
        list.appendChild(item);
      }
    },
  };
})();
