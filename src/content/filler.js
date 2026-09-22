// Writes values back into the page. Framework-safe: uses the native value setter
// so React/Vue/Angular state pick the change up, then dispatches the events they listen for.
(function () {
  const JAF = window.JAF;

  function fire(el, names) {
    for (const n of names) {
      const ev = n.startsWith('key')
        ? new KeyboardEvent(n, { bubbles: true, cancelable: true })
        : new Event(n, { bubbles: true, cancelable: true });
      el.dispatchEvent(ev);
    }
  }

  JAF.setNativeValue = function (el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    el.focus();
    fire(el, ['focus', 'keydown']);
    if (desc && desc.set) desc.set.call(el, value); else el.value = value;
    fire(el, ['input', 'keyup', 'change']);
    el.blur();
    fire(el, ['blur', 'focusout']);
  };

  function setEditable(el, value) {
    el.focus();
    try {
      document.execCommand('selectAll', false, null);
      const ok = document.execCommand('insertText', false, value);
      if (!ok) throw new Error('execCommand failed');
    } catch {
      el.textContent = value;
      fire(el, ['input', 'change']);
    }
    el.blur();
  }

  function formatDate(value, el) {
    const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return value;
    const [, y, mo, d] = m;
    if (el.type === 'date') return value;
    const hint = ((el.getAttribute('placeholder') || '') + ' ' + (el.getAttribute('aria-label') || '')).toLowerCase();
    if (/mm\s*[\/\-.]\s*dd/.test(hint)) return `${mo}/${d}/${y}`;
    if (/yyyy\s*[\/\-.]\s*mm/.test(hint)) return `${y}-${mo}-${d}`;
    return `${d}/${mo}/${y}`;
  }

  function click(el) {
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    el.focus();
    fire(el, ['mousedown', 'mouseup']);
    el.click();
  }

  async function fillCombobox(el, value) {
    JAF.setNativeValue(el, '');
    el.focus();
    // type the value so async option lists populate
    JAF.setNativeValue(el, value);
    el.focus();
    await JAF.sleep(500);
    const root = el.getRootNode();
    let opts = [];
    const ctl = el.getAttribute('aria-controls') || el.getAttribute('aria-owns');
    if (ctl) {
      ctl.split(/\s+/).forEach((id) => {
        const lb = root.getElementById ? root.getElementById(id) : document.getElementById(id);
        if (lb) opts = opts.concat(Array.from(lb.querySelectorAll('[role="option"], li')));
      });
    }
    if (!opts.length) opts = JAF.deepQueryAll('[role="option"], [role="listbox"] li, .select__option, [class*="option" i]').filter(JAF.isVisible);
    const options = opts.map((o) => ({ label: JAF.text(o), value: JAF.text(o), el: o })).filter((o) => o.label);
    const best = JAF.bestOption(value, options);
    if (best) { click(best.el); return { ok: true, note: `picked "${best.label}"` }; }
    // fall back to keyboard: ArrowDown + Enter selects the first suggestion in most libraries
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, bubbles: true }));
    await JAF.sleep(100);
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    return { ok: true, note: 'typed value; verify the selection' };
  }

  async function fillGFormsListbox(entry, value) {
    const best = JAF.bestOption(value, entry.options);
    if (!best) return { ok: false, note: 'no matching option' };
    click(entry.el);
    await JAF.sleep(350);
    // Google renders a popup copy of the options; find the visible one with the same data-value.
    const popup = JAF.deepQueryAll(`[role="option"][data-value="${CSS.escape(best.value)}"]`).filter(JAF.isVisible);
    const target = popup.find((o) => !entry.el.contains(o)) || popup[0] || best.el;
    click(target);
    await JAF.sleep(150);
    return { ok: true, note: `picked "${best.label}"` };
  }

  async function fillFile(el, resume) {
    if (!resume || !resume.base64) return { ok: false, note: 'no resume stored in options' };
    const bin = atob(resume.base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const file = new File([bytes], resume.fileName || 'resume.pdf', { type: resume.mimeType || 'application/pdf' });
    const dt = new DataTransfer();
    dt.items.add(file);
    try {
      el.files = dt.files;
    } catch {
      return { ok: false, note: 'browser blocked programmatic file set' };
    }
    fire(el, ['input', 'change']);
    return { ok: true, note: file.name };
  }

  function setChoice(el, on) {
    const isAria = el.tagName !== 'INPUT';
    const cur = isAria ? el.getAttribute('aria-checked') === 'true' : el.checked;
    if (cur === on) return;
    click(el);
    if (!isAria && el.checked !== on) {
      el.checked = on;
      fire(el, ['input', 'change']);
    }
  }

  // value: string, or array of strings for checkbox groups.
  JAF.fill = async function (q, value, resume) {
    const entry = JAF.registry.get(q.id);
    if (!entry) return { ok: false, note: 'element lost' };
    if (entry.kind === 'unsupported') return { ok: false, note: entry.note || q.meta?.unsupported || 'unsupported' };

    try {
      if (entry.kind === 'group') {
        const wanted = Array.isArray(value) ? value : [value];
        const chosen = wanted.map((v) => JAF.bestOption(v, entry.options)).filter(Boolean);
        if (!chosen.length) return { ok: false, note: `no option matched "${wanted.join(', ')}"` };
        if (q.type === 'radio') {
          const c = chosen[0];
          setChoice(c.el, true);
          if (c.isOther && c.otherInput) JAF.setNativeValue(c.otherInput, Array.isArray(value) ? value[0] : value);
          return { ok: true, note: `selected "${c.label}"` };
        }
        for (const o of entry.options) {
          const on = chosen.includes(o);
          setChoice(o.el, on);
          if (on && o.isOther && o.otherInput) JAF.setNativeValue(o.otherInput, wanted.find((w) => !entry.options.some((x) => JAF.fuzzyEq(w, x.label))) || '');
          await JAF.sleep(30);
        }
        return { ok: true, note: `checked ${chosen.map((c) => `"${c.label}"`).join(', ')}` };
      }

      if (entry.kind === 'gforms-listbox') return await fillGFormsListbox(entry, value);

      const el = entry.el;
      const v = Array.isArray(value) ? value.join(', ') : String(value ?? '');
      switch (q.type) {
        case 'file':
          return await fillFile(el, resume);
        case 'select':
        case 'multiselect': {
          if (el.tagName === 'SELECT') {
            const vals = Array.isArray(value) ? value : [value];
            const picks = vals.map((x) => JAF.bestOption(x, entry.options)).filter(Boolean);
            if (!picks.length) return { ok: false, note: `no option matched "${v}"` };
            if (el.multiple) {
              Array.from(el.options).forEach((o) => (o.selected = picks.some((p) => p.el === o)));
              fire(el, ['input', 'change']);
            } else {
              JAF.setNativeValue(el, picks[0].value);
            }
            return { ok: true, note: `picked "${picks.map((p) => p.label).join(', ')}"` };
          }
          // ARIA listbox
          const best = JAF.bestOption(v, entry.options);
          if (!best) return { ok: false, note: `no option matched "${v}"` };
          click(el); await JAF.sleep(200); click(best.el);
          return { ok: true, note: `picked "${best.label}"` };
        }
        case 'combobox':
          return await fillCombobox(el, v);
        case 'date':
          JAF.setNativeValue(el, formatDate(v, el));
          return { ok: true };
        default:
          if (el.isContentEditable || (el.getAttribute('role') === 'textbox' && el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA')) setEditable(el, v);
          else JAF.setNativeValue(el, /^\d{4}-\d{2}-\d{2}$/.test(v) ? formatDate(v, el) : v);
          return { ok: true };
      }
    } catch (e) {
      return { ok: false, note: e.message };
    }
  };

  JAF.highlight = function (q, color) {
    const entry = JAF.registry.get(q.id);
    if (!entry) return;
    const els = entry.els || [entry.el];
    for (const el of els) {
      const target = el.type === 'file' || el.getAttribute('role') === 'radio' || el.getAttribute('role') === 'checkbox' ? (el.closest('label, div') || el) : el;
      target.style.outline = `2px solid ${color}`;
      target.style.outlineOffset = '1px';
      setTimeout(() => { target.style.outline = ''; target.style.outlineOffset = ''; }, 6000);
    }
  };
})();
