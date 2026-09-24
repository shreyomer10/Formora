// Writes values back into the page. Framework-safe: uses the native value setter
// so React/Vue/Angular state pick the change up, then dispatches the events they listen for.
// Every choice (radio, checkbox, dropdown option) is verified after clicking; a fill only
// reports ok when the page actually shows the new state.
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

  function mouseInit(el, extra = {}) {
    const r = el.getBoundingClientRect();
    return {
      bubbles: true, cancelable: true, composed: true, view: window, button: 0, buttons: 1,
      clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, ...extra,
    };
  }

  // Full pointer + mouse sequence with real MouseEvent objects. ARIA widgets (Google
  // Forms, react-select, Workday) listen on different events of this sequence.
  function realClick(el) {
    const init = mouseInit(el);
    const P = typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
    const pinit = { ...init, pointerId: 1, pointerType: 'mouse', isPrimary: true };
    el.dispatchEvent(new P('pointerdown', pinit));
    el.dispatchEvent(new MouseEvent('mousedown', init));
    el.dispatchEvent(new P('pointerup', pinit));
    el.dispatchEvent(new MouseEvent('mouseup', init));
    el.dispatchEvent(new MouseEvent('click', init));
  }

  function key(el, keyName, code, keyCode) {
    const init = { key: keyName, code, keyCode, which: keyCode, bubbles: true, cancelable: true, composed: true };
    el.dispatchEvent(new KeyboardEvent('keydown', init));
    el.dispatchEvent(new KeyboardEvent('keypress', init));
    el.dispatchEvent(new KeyboardEvent('keyup', init));
  }

  function click(el) {
    try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch { /* detached */ }
    try { el.focus({ preventScroll: true }); } catch { /* not focusable */ }
    if (el.tagName === 'INPUT') el.click(); // native inputs toggle on click(); avoid a second synthetic click
    else realClick(el);
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

  // Like setNativeValue but keeps focus: comboboxes close their menu on blur.
  function typeInto(el, value) {
    el.focus();
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value); else el.value = value;
    fire(el, ['input', 'keyup']);
  }

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

  // Accepts "YYYY-MM-DD", "YYYY-MM", "MM/YYYY", "MM/DD/YYYY", "Jun 2023", "2023"; returns {y, m, d} or null.
  JAF.parseDate = function (value) {
    const s = String(value || '').trim();
    let m;
    if ((m = s.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/))) return { y: m[1], m: m[2].padStart(2, '0'), d: m[3] ? m[3].padStart(2, '0') : '' };
    if ((m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/))) {
      // DD/MM/YYYY is the common form outside the US; treat the first number as the day when it cannot be a month.
      const a = +m[1], b = +m[2];
      const [d, mo] = a > 12 ? [m[1], m[2]] : b > 12 ? [m[2], m[1]] : [m[1], m[2]];
      return { y: m[3], m: String(mo).padStart(2, '0'), d: String(d).padStart(2, '0') };
    }
    if ((m = s.match(/^(\d{1,2})[\/.-](\d{4})$/))) return { y: m[2], m: m[1].padStart(2, '0'), d: '' };
    if ((m = s.match(/^([a-z]{3,9})\.?\s+(\d{4})$/i))) {
      const mi = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m[1].slice(0, 3).toLowerCase());
      if (mi >= 0) return { y: m[2], m: String(mi + 1).padStart(2, '0'), d: '' };
    }
    if ((m = s.match(/^(\d{4})$/))) return { y: m[1], m: '', d: '' };
    return null;
  };

  function formatDate(value, el) {
    const p = JAF.parseDate(value);
    if (!p) return value;
    const { y, m: mo, d } = p;
    if (el.type === 'date') return d ? `${y}-${mo}-${d}` : value;
    if (el.type === 'month') return mo ? `${y}-${mo}` : value;
    const hint = ((el.getAttribute('placeholder') || '') + ' ' + (el.getAttribute('aria-label') || '')).toLowerCase();
    if (!d || /^mm\s*[\/\-.]\s*yyyy/.test(hint)) return mo ? (/yyyy\s*[\/\-.]\s*mm/.test(hint) ? `${y}-${mo}` : `${mo}/${y}`) : y;
    if (/mm\s*[\/\-.]\s*dd/.test(hint)) return `${mo}/${d}/${y}`;
    if (/yyyy\s*[\/\-.]\s*mm/.test(hint)) return `${y}-${mo}-${d}`;
    return `${d}/${mo}/${y}`;
  }

  // Segmented date widget: one box each for month / day / year.
  async function fillDateParts(entry, value) {
    const p = JAF.parseDate(value);
    if (!p) return { ok: false, note: `could not read a date from "${value}"` };
    const wanted = { month: p.m, day: p.d, year: p.y };
    const set = [];
    const missed = [];
    const same = (a, b) => String(a || '').replace(/^0+/, '') === String(b || '').replace(/^0+/, '');
    for (const part of ['month', 'day', 'year']) {
      const el = entry.parts[part];
      const v = wanted[part];
      if (!el || !v) continue;
      if (el.tagName === 'INPUT') {
        JAF.setNativeValue(el, v);
        await JAF.sleep(40);
        if (!same(el.value, v)) { // React reset it: type it key by key
          el.focus();
          typeInto(el, '');
          for (const ch of v) { key(el, ch, `Digit${ch}`, 48 + Number(ch)); typeInto(el, (el.value || '') + ch); }
          fire(el, ['change']);
          el.blur();
        }
        (same(el.value, v) ? set : missed).push(part);
      } else {
        // role=spinbutton div: type the digits, then check aria-valuenow / text
        el.focus();
        for (const ch of v) key(el, ch, `Digit${ch}`, 48 + Number(ch));
        await JAF.sleep(40);
        const shown = el.getAttribute('aria-valuenow') || JAF.text(el);
        (same(shown, v) ? set : missed).push(part);
      }
    }
    if (!set.length) return { ok: false, note: `date boxes did not accept "${value}"; type it manually` };
    if (missed.length) return { ok: true, note: `set ${set.join('/')}, could not set ${missed.join('/')}` };
    return { ok: true, note: `set ${set.join('/')}` };
  }

  // ---- radios / checkboxes -------------------------------------------------
  function isOn(el) {
    if (el.tagName === 'INPUT') return !!el.checked;
    return el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-pressed') === 'true' || el.getAttribute('aria-selected') === 'true';
  }

  function labelFor(el) {
    if (el.labels && el.labels.length) return el.labels[0];
    const wrap = el.closest && el.closest('label');
    if (wrap) return wrap;
    if (el.id) {
      const root = el.getRootNode();
      const l = (root.querySelector ? root : document).querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l) return l;
    }
    return null;
  }

  // Returns true when the control ends up in the wanted state. Tries the input itself,
  // then its label (custom-styled inputs are hidden behind the label), then the keyboard.
  async function setChoice(el, on) {
    if (isOn(el) === on) return true;
    const native = el.tagName === 'INPUT';
    const attempts = native
      ? [
          () => click(el),
          () => { const l = labelFor(el); if (l) realClick(l); },
          () => { el.checked = on; fire(el, ['input', 'change']); },
        ]
      : [
          () => click(el),
          () => { const l = labelFor(el) || el.parentElement; if (l) realClick(l); },
          () => { el.focus(); key(el, ' ', 'Space', 32); },
          () => { el.focus(); key(el, 'Enter', 'Enter', 13); },
        ];
    for (const attempt of attempts) {
      try { attempt(); } catch { /* try the next strategy */ }
      await JAF.sleep(60);
      if (isOn(el) === on) return true;
    }
    return isOn(el) === on;
  }

  // ---- dropdowns -----------------------------------------------------------
  const OPTION_SEL = '[role="option"], [role="menuitem"], [role="menuitemradio"], [role="listbox"] li, [role="listbox"] > div, [data-automation-id="promptOption"], [data-automation-id="menuItem"], [data-automation-id="promptLeafNode"]';
  const TYPEAHEAD_SEL = '[data-automation-id*="search" i], [data-automation-id*="select" i], [data-uxi-widget-type*="select" i], [data-automation-id*="prompt" i], [class*="typeahead" i], [class*="autocomplete" i], [class*="react-select" i]';
  const PLACEHOLDER_RE = /^(select|choose|please select|no options|no results|no items|no matches|nothing found|loading|searching|search|type to search|start typing|partial list|show (all|more)|view all|see all|more results|all$|--+|-)/i;

  function inOverlay(el) {
    return !!JAF.closestAcrossShadow(el, '#applypilot-root');
  }

  function isTypable(el) {
    return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable || el.getAttribute('role') === 'textbox';
  }

  // Option elements currently visible for this control: its aria-controls/aria-owns
  // listbox first, otherwise any visible option on the page (popups render in portals).
  function visibleOptionEls(el) {
    let opts = [];
    const root = el.getRootNode();
    const ctl = el.getAttribute('aria-controls') || el.getAttribute('aria-owns');
    if (ctl) {
      ctl.split(/\s+/).forEach((id) => {
        const lb = (root.getElementById ? root.getElementById(id) : null) || document.getElementById(id);
        if (lb) opts = opts.concat(Array.from(lb.querySelectorAll('[role="option"], li, [role="menuitem"]')));
      });
    }
    if (!opts.length) opts = JAF.deepQueryAll(OPTION_SEL);
    return opts.filter((o) => JAF.isVisible(o) && !inOverlay(o));
  }

  function toOptions(els) {
    const seen = new Set();
    const out = [];
    for (const el of els) {
      const label = (JAF.text(el) || el.getAttribute('aria-label') || '').trim();
      if (!label || label.length > 200 || seen.has(label) || PLACEHOLDER_RE.test(label)) continue;
      seen.add(label);
      out.push({ label, value: el.getAttribute('data-value') || label, el });
    }
    return out;
  }

  function openDropdown(el) {
    try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch { /* detached */ }
    if (isTypable(el)) {
      el.focus();
      realClick(el);
      key(el, 'ArrowDown', 'ArrowDown', 40);
    } else {
      realClick(el);
    }
  }

  // Close without pressing Escape (Escape can also close the modal the form lives in).
  async function closeDropdown(el, beforeSet) {
    if (isTypable(el)) {
      el.blur();
      fire(el, ['blur', 'focusout']);
    } else {
      const stillOpen = visibleOptionEls(el).some((o) => !beforeSet.has(o));
      if (stillOpen) realClick(el); // toggle buttons close on a second click
    }
    await JAF.sleep(80);
  }

  // Open every combobox that has no options in the DOM, read what the popup shows, close it.
  // Fills q.options and the registry entry so rules and the model can pick a real option.
  JAF.discoverOptions = async function (questions) {
    let found = 0;
    for (const q of questions) {
      if (q.type !== 'combobox' || (q.options && q.options.length) || q.currentValue) continue;
      const entry = JAF.registry.get(q.id);
      if (!entry || entry.kind !== 'single' || !entry.el.isConnected) continue;
      const el = entry.el;
      try {
        const before = new Set(visibleOptionEls(el));
        openDropdown(el);
        await JAF.sleep(350);
        const appeared = visibleOptionEls(el).filter((o) => !before.has(o));
        const opts = toOptions(appeared.length ? appeared : visibleOptionEls(el));
        await closeDropdown(el, before);
        if (opts.length) {
          // Popup nodes are usually unmounted on close: keep labels only, re-find on fill.
          entry.options = opts.map((o) => ({ label: o.label, value: o.value }));
          entry.discovered = true;
          q.options = opts.slice(0, 300).map((o) => o.label);
          if (opts.length > 300) q.meta = { ...(q.meta || {}), optionsPartial: true };
          found++;
        }
      } catch (e) {
        JAF.log('option discovery failed for', q.label, e);
      }
    }
    return found;
  };

  function displayedText(el) {
    const own = isTypable(el) ? el.value : JAF.text(el);
    const box = el.closest('[role="combobox"], [class*="select" i], [class*="control" i], [class*="combobox" i], [class*="dropdown" i]');
    const around = box ? JAF.text(box.parentElement || box) : JAF.text(el.parentElement);
    return `${own || ''} ${around || ''}`;
  }

  // Wait until the popup shows real options (typeaheads load them from the server after a debounce).
  async function waitForOptions(el, ms = 1800, exclude = null) {
    const opts = await JAF.waitFor(() => {
      const o = toOptions(visibleOptionEls(el).filter((x) => !exclude || !exclude.has(x)));
      return o.length ? o : null;
    }, ms, 150);
    return opts || [];
  }

  // Enter is safe to send when it cannot submit a form: no <form> ancestor, or the input is a widget.
  function enterIsSafe(el) {
    return !el.form || el.getAttribute('role') === 'combobox' || el.hasAttribute('aria-haspopup') || el.hasAttribute('aria-autocomplete') || !!el.closest(TYPEAHEAD_SEL);
  }

  // Type a query and return the suggestions it produced. Sites like Workday only run the search
  // when Enter is pressed, so when typing alone shows nothing we press Enter and wait for the
  // server round trip. `exclude` holds option nodes that were visible before, so a stale list
  // from the previous query never counts as a result for this one.
  async function searchOptions(el, query, exclude) {
    typeInto(el, query);
    let opts = await waitForOptions(el, 700, exclude);
    if (!opts.length && enterIsSafe(el)) {
      key(el, 'Enter', 'Enter', 13);
      opts = await waitForOptions(el, 3500, exclude);
    }
    return opts;
  }

  // The site's top result for a query, if it plausibly relates to it (shares a 3-letter token prefix).
  function closestResult(query, opts) {
    if (!opts.length) return null;
    const norm = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const toks = norm(query).split(' ').filter((t) => t.length >= 2);
    const first = opts[0];
    const l = norm(first.label);
    return toks.some((t) => l.includes(t.slice(0, 3))) ? first : null;
  }

  async function pickVisible(el, target, wait = 0) {
    const opts = wait ? await waitForOptions(el, wait) : toOptions(visibleOptionEls(el));
    const pick = JAF.bestOption(target, opts);
    if (!pick) return null;
    click(pick.el);
    await JAF.sleep(200);
    return pick;
  }

  // The element that shows selected chips for a multi-value typeahead (skills).
  function chipBox(el) {
    return el.closest('[data-automation-id*="multiselect" i], [aria-multiselectable="true"], [class*="multi" i][class*="select" i]') || (el.parentElement && el.parentElement.parentElement) || el.parentElement;
  }

  // Skills-style field: type each value, pick the suggestion, repeat. Reports what stuck.
  async function fillMulti(entry, el, values) {
    const box = chipBox(el);
    const added = [];
    const missing = [];
    for (const raw of values) {
      const v = String(raw).trim();
      if (!v) continue;
      if (box && !el.value && JAF.text(box).toLowerCase().includes(v.toLowerCase())) { added.push(v); continue; } // already a chip
      el.focus();
      const stale = new Set(visibleOptionEls(el));
      let opts = await searchOptions(el, v, stale);
      let pick = JAF.bestOption(v, opts);
      if (!pick && v.includes(' ')) {
        const first = v.split(/[\s(,/]+/)[0];
        const stale2 = new Set(visibleOptionEls(el));
        const more = await searchOptions(el, first, stale2);
        pick = JAF.bestOption(v, more);
        if (!opts.length) opts = more;
      }
      let approx = false;
      if (!pick) { pick = closestResult(v, opts); approx = !!pick; }
      if (pick) {
        click(pick.el);
        await JAF.sleep(300);
        added.push(approx && !JAF.fuzzyEq(pick.label, v) ? `${pick.label} (closest to "${v}")` : pick.label);
      } else if (box && JAF.text(box).toLowerCase().includes(v.toLowerCase()) && !el.value) {
        added.push(v); // the site accepted the free value on Enter
      } else {
        missing.push(v);
      }
      if (el.value) typeInto(el, '');
      if (el.disabled || !el.isConnected) break;
    }
    el.blur();
    fire(el, ['blur', 'focusout']);
    if (!added.length) return { ok: false, note: `no suggestions matched ${missing.map((m) => `"${m}"`).join(', ')}; add them manually` };
    const note = `added ${added.join(', ')}` + (missing.length ? `; not found: ${missing.join(', ')}` : '');
    return { ok: true, note };
  }

  // Select `value` in any dropdown-like control: react-select style inputs, Workday
  // buttons, ARIA comboboxes, plain typeahead inputs.
  async function fillDropdown(entry, el, value, q) {
    const typable = isTypable(el);
    const multi = !!(q && q.meta && q.meta.multi);
    const values = Array.isArray(value) ? value : multi ? String(value).split(/\s*[,;|\n]\s*/).filter(Boolean) : [String(value)];
    if (typable && (values.length > 1 || (multi && values.length === 1))) return await fillMulti(entry, el, values);
    value = values[0] ?? '';
    const known = entry.options && entry.options.length ? (JAF.bestOption(value, entry.options) || JAF.rangeOption(value, entry.options)) : null;
    const target = known ? known.label : String(value);

    openDropdown(el);
    await JAF.sleep(300);
    let pick = await pickVisible(el, target);

    if (!pick && typable) {
      // Type to filter (also triggers async option loading, or a search on Enter), then look again.
      const stale = new Set(visibleOptionEls(el));
      let opts = await searchOptions(el, target, stale);
      pick = JAF.bestOption(target, opts);
      if (!pick) {
        const shorter = target.split(/[\s(,/]+/)[0];
        if (shorter && shorter.length >= 2 && shorter !== target) {
          const more = await searchOptions(el, shorter, new Set(visibleOptionEls(el)));
          pick = JAF.bestOption(target, more);
          if (!opts.length) opts = more;
        }
      }
      if (!pick) pick = closestResult(target, opts);
      if (pick) { click(pick.el); await JAF.sleep(200); }
    }

    if (pick) {
      const shown = displayedText(el);
      const verified = JAF.fuzzyEq(shown, pick.label) || shown.toLowerCase().includes(pick.label.toLowerCase().slice(0, 12));
      if (!typable || verified) { el.blur(); return { ok: true, note: `picked "${pick.label}"` }; }
      return { ok: true, note: `picked "${pick.label}" (could not confirm the field shows it, please verify)` };
    }

    if (typable) {
      // Last resort for typeahead fields: keep the typed text and accept the first suggestion.
      if (!el.value) typeInto(el, target);
      key(el, 'ArrowDown', 'ArrowDown', 40);
      await JAF.sleep(100);
      key(el, 'Enter', 'Enter', 13);
      await JAF.sleep(150);
      const shown = displayedText(el);
      if (JAF.fuzzyEq(shown, target)) return { ok: true, note: `typed "${target}"` };
      return { ok: false, note: `typed "${target}" but no dropdown option matched; pick it manually` };
    }
    await closeDropdown(el, new Set());
    return { ok: false, note: `no option matched "${target}"` };
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
    await JAF.sleep(200);
    const sel = entry.el.querySelector('[role="option"][aria-selected="true"]');
    const selLabel = sel ? (sel.getAttribute('aria-label') || sel.getAttribute('data-value') || JAF.text(sel)) : '';
    if (sel && JAF.fuzzyEq(selLabel, best.label)) return { ok: true, note: `picked "${best.label}"` };
    return { ok: false, note: `clicked "${best.label}" but the list did not change; pick it manually` };
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
    // Verify the page took it: the file name should now appear near the input.
    const zone = el.closest('[data-automation-id*="file" i], [class*="upload" i], [class*="dropzone" i], [class*="drop-zone" i], [class*="file" i], [class*="attach" i]') || el.parentElement;
    const shows = () => {
      const scope = zone && zone.parentElement ? zone.parentElement : document.body;
      return JAF.text(scope).toLowerCase().includes(file.name.toLowerCase().slice(0, 20));
    };
    let shown = await JAF.waitFor(shows, 800, 100);
    if (!shown && zone) {
      // Drop zones (Workday, Greenhouse) listen for a drop event rather than the input's change.
      try {
        const init = { bubbles: true, cancelable: true, composed: true, dataTransfer: dt };
        zone.dispatchEvent(new DragEvent('dragenter', init));
        zone.dispatchEvent(new DragEvent('dragover', init));
        zone.dispatchEvent(new DragEvent('drop', init));
        shown = await JAF.waitFor(shows, 1200, 100);
      } catch { /* DragEvent not constructible */ }
    }
    if (shown) return { ok: true, note: `attached ${file.name}` };
    return { ok: true, note: `set ${file.name}, but the page does not show it yet; check before submitting` };
  }

  // Map wanted strings onto group options. A comma-joined answer ("Go, Docker") is
  // split when it does not match a single option itself.
  function matchGroup(wanted, options) {
    const chosen = [];
    for (const w of wanted) {
      const direct = JAF.bestOption(w, options);
      if (direct) { if (!chosen.includes(direct)) chosen.push(direct); continue; }
      for (const part of String(w).split(/\s*[,;|\n]\s*/)) {
        const hit = part && JAF.bestOption(part, options);
        if (hit && !chosen.includes(hit)) chosen.push(hit);
      }
    }
    return chosen;
  }

  // value: string, or array of strings for checkbox groups.
  JAF.fill = async function (q, value, resume) {
    const entry = JAF.registry.get(q.id);
    if (!entry) return { ok: false, note: 'element lost' };
    if (entry.kind === 'unsupported') return { ok: false, note: entry.note || q.meta?.unsupported || 'unsupported' };

    try {
      if (entry.kind === 'group') {
        const wanted = (Array.isArray(value) ? value : [value]).map((v) => String(v ?? '')).filter(Boolean);
        const chosen = matchGroup(wanted, entry.options);
        if (!chosen.length) return { ok: false, note: `no option matched "${wanted.join(', ')}"` };
        if (q.type === 'radio') {
          const c = chosen[0];
          const ok = await setChoice(c.el, true);
          if (!ok) return { ok: false, note: `could not select "${c.label}" (page ignored the click); select it manually` };
          if (c.isOther && c.otherInput) JAF.setNativeValue(c.otherInput, wanted[0]);
          return { ok: true, note: `selected "${c.label}"` };
        }
        const failed = [];
        for (const o of entry.options) {
          const on = chosen.includes(o);
          const ok = await setChoice(o.el, on);
          if (!ok && on) failed.push(o.label);
          if (on && o.isOther && o.otherInput) JAF.setNativeValue(o.otherInput, wanted.find((w) => !entry.options.some((x) => JAF.fuzzyEq(w, x.label))) || '');
          await JAF.sleep(30);
        }
        const done = chosen.filter((c) => !failed.includes(c.label)).map((c) => `"${c.label}"`).join(', ');
        if (failed.length && failed.length === chosen.length) return { ok: false, note: `could not tick ${failed.map((f) => `"${f}"`).join(', ')}; tick manually` };
        if (failed.length) return { ok: true, note: `checked ${done}; could not tick ${failed.map((f) => `"${f}"`).join(', ')}` };
        return { ok: true, note: `checked ${done}` };
      }

      if (entry.kind === 'gforms-listbox') return await fillGFormsListbox(entry, value);
      if (entry.kind === 'gforms-file') return await JAF.gformsAttach(entry, resume);
      if (entry.kind === 'dateparts') return await fillDateParts(entry, Array.isArray(value) ? value[0] : value);

      const el = entry.el;
      const v = Array.isArray(value) ? value.join(', ') : String(value ?? '');
      switch (q.type) {
        case 'file':
          return await fillFile(el, resume);
        case 'select':
        case 'multiselect': {
          if (el.tagName === 'SELECT') {
            const vals = Array.isArray(value) ? value : [value];
            const picks = vals.map((x) => JAF.bestOption(x, entry.options) || JAF.rangeOption(x, entry.options)).filter(Boolean);
            if (!picks.length) return { ok: false, note: `no option matched "${v}"` };
            if (el.multiple) {
              Array.from(el.options).forEach((o) => (o.selected = picks.some((p) => p.el === o)));
              fire(el, ['input', 'change']);
            } else {
              JAF.setNativeValue(el, picks[0].value);
              if (el.value !== picks[0].value) { el.value = picks[0].value; fire(el, ['input', 'change']); }
            }
            return { ok: true, note: `picked "${picks.map((p) => p.label).join(', ')}"` };
          }
          // ARIA listbox with options in the DOM
          const best = JAF.bestOption(v, entry.options);
          if (!best || !best.el) return await fillDropdown(entry, el, v);
          click(el); await JAF.sleep(200); click(best.el); await JAF.sleep(100);
          const sel = el.querySelector('[aria-selected="true"]');
          if (sel && !JAF.fuzzyEq(JAF.text(sel), best.label)) return { ok: false, note: `clicked "${best.label}" but the list did not change` };
          return { ok: true, note: `picked "${best.label}"` };
        }
        case 'combobox':
          return await fillDropdown(entry, el, Array.isArray(value) ? value : v, q);
        case 'date':
          JAF.setNativeValue(el, formatDate(v, el));
          return { ok: true };
        default:
          if (el.isContentEditable || (el.getAttribute('role') === 'textbox' && el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA')) { setEditable(el, v); return { ok: true }; }
          JAF.setNativeValue(el, /^\d{4}-\d{2}(-\d{2})?$/.test(v) ? formatDate(v, el) : v);
          await JAF.sleep(60);
          if (el.tagName === 'INPUT' && v && !el.value) {
            // A controlled input that wiped the value only accepts a picked suggestion: treat it as a typeahead.
            const r = await fillDropdown(entry, el, v, q);
            return r.ok ? r : { ok: false, note: `page rejected typed text; ${r.note}` };
          }
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
      if (!el) continue;
      const hidden = !JAF.isVisible(el);
      const choice = el.type === 'radio' || el.type === 'checkbox' || el.getAttribute('role') === 'radio' || el.getAttribute('role') === 'checkbox';
      const target = el.type === 'file' || choice || hidden ? (labelFor(el) || el.closest('label, div') || el) : el;
      target.style.outline = `2px solid ${color}`;
      target.style.outlineOffset = '1px';
      setTimeout(() => { target.style.outline = ''; target.style.outlineOffset = ''; }, 6000);
    }
  };
})();
