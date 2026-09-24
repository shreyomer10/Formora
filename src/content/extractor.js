// Generic DOM -> questions extractor. Works on native controls, ARIA widgets and
// framework wrappers. Output: array of normalized question objects. Elements are
// kept in JAF.registry (never serialized).
(function () {
  const JAF = window.JAF;

  const CONTROL_SEL =
    'input, select, textarea, [contenteditable="true"], [role="textbox"], [role="combobox"], ' +
    '[role="radio"], [role="checkbox"], [role="switch"], [role="listbox"], [role="spinbutton"], [aria-haspopup="listbox"]';
  const SKIP_INPUT_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image', 'search', 'password']);
  // Site chrome: language pickers, account menus, job search boxes. Never application questions.
  const NAV_SEL = 'header, nav, footer, [role="banner"], [role="navigation"], [role="contentinfo"], [role="menubar"], [data-automation-id*="header" i], [data-automation-id*="navigation" i]';
  const NAV_LABEL = /\b(selector button|language selector|settings selector|skip to (main )?content|search (for )?jobs|sign (in|out)|log ?(in|out)|candidate home)\b/i;
  // Segmented date widgets (Workday: MM / DD / YYYY boxes).
  const DATE_PART = /^(mm|dd|yyyy|yy|month|day|year)$/i;
  const DROPZONE = /\b(drop (your )?files?|select files?|choose files?|browse|no file chosen|drag (and|&) drop|upload a file|attach(ment)?s?)\b/i;
  // Search-style inputs that only accept a value picked from a suggestion list.
  const TYPEAHEAD_ATTR = '[data-automation-id*="search" i], [data-automation-id*="select" i], [data-uxi-widget-type*="select" i], [data-automation-id*="prompt" i], [class*="typeahead" i], [class*="autocomplete" i], [class*="react-select" i]';
  const MULTI_HINT = /\b(skills?|technolog|tools?|languages?|frameworks?|certifications?|keywords?|tags?|interests?)\b/i;

  JAF.registry = new Map(); // id -> { kind, el, els, options:[{label,value,el}] }
  let counter = 0;
  const nextId = () => `q${++counter}`;

  function humanize(s) {
    return String(s || '')
      .replace(/[_\-\.\[\]]+/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function byIds(el, idList) {
    if (!idList) return '';
    const root = el.getRootNode();
    return idList
      .split(/\s+/)
      .map((id) => (root.getElementById ? root.getElementById(id) : document.getElementById(id)))
      .filter(Boolean)
      .map((n) => JAF.labelText(n))
      .join(' ')
      .trim();
  }

  function inOverlay(el) {
    return !!JAF.closestAcrossShadow(el, '#applypilot-root');
  }

  function inNav(el) {
    return !!JAF.closestAcrossShadow(el, NAV_SEL);
  }

  function isControl(el) {
    return el.matches && el.matches(CONTROL_SEL);
  }

  // A hidden native radio/checkbox still counts when the user can see a label for it.
  function hasVisibleLabel(el) {
    if (el.labels && Array.from(el.labels).some(JAF.isVisible)) return true;
    const wrap = el.closest('label');
    if (wrap && JAF.isVisible(wrap)) return true;
    const p = el.parentElement;
    return !!(p && JAF.isVisible(p) && JAF.labelText(p, 120));
  }

  function countOtherControls(container, ownEls) {
    const own = new Set(ownEls);
    let n = 0;
    container.querySelectorAll(CONTROL_SEL).forEach((c) => {
      if (own.has(c)) return;
      if (c.tagName === 'INPUT' && SKIP_INPUT_TYPES.has(c.type)) return;
      if (c.matches('option, [role="option"]')) return;
      n++;
    });
    return n;
  }

  // Own label of a single control (used for option labels and simple fields).
  function ownLabel(el) {
    const parts = [];
    const lb = byIds(el, el.getAttribute('aria-labelledby'));
    if (lb) parts.push(lb);
    const al = el.getAttribute('aria-label');
    if (al) parts.push(al.trim());
    if (el.labels && el.labels.length) {
      el.labels.forEach((l) => parts.push(JAF.labelText(l)));
    }
    const wrap = el.closest && el.closest('label');
    if (wrap) parts.push(JAF.labelText(wrap));
    return parts.filter(Boolean)[0] || '';
  }

  // Option label for a radio/checkbox element: own label, else the text sitting next to it.
  function optionLabel(el) {
    const own = ownLabel(el);
    if (own) return own;
    const t = JAF.text(el);
    if (t && t.length < 120) return t;
    const sib = el.nextElementSibling || el.parentElement;
    const st = JAF.labelText(sib, 120);
    if (st) return st;
    return el.value || el.getAttribute('data-value') || '';
  }

  // Question label for a group/container: walk up until we hit an ancestor
  // that carries text but no foreign controls.
  function containerLabel(startEl, ownEls) {
    let node = startEl;
    let best = '';
    for (let depth = 0; node && depth < 8; depth++) {
      if (node instanceof Element) {
        if (node.matches('form, body, html, main, [role="main"]')) break;
        if (countOtherControls(node, ownEls) > 0) break;
        // Prefer explicit question markers inside this ancestor.
        const marker = node.querySelector('legend, [role="heading"], h1, h2, h3, h4, h5, h6, label, .label, [class*="label" i], [class*="question" i], [class*="title" i]');
        const mt = marker && !ownEls.includes(marker) ? JAF.labelText(marker, 300) : '';
        const ct = JAF.labelText(node, 300);
        const candidate = mt || ct;
        if (candidate) { best = candidate; if (mt || depth >= 1) break; }
      }
      const root = node.getRootNode && node.getRootNode();
      node = node.parentElement || (root && root.host) || null;
    }
    return best;
  }

  function fieldLabel(el) {
    const own = ownLabel(el);
    if (own) return own;
    const ph = el.getAttribute('placeholder');
    const ct = containerLabel(el.parentElement, [el]);
    if (ct) return ct;
    if (ph) return ph.trim();
    return humanize(el.getAttribute('name') || el.id || el.getAttribute('title') || '');
  }

  // File inputs sit inside a drop zone whose text ("Drop files here or Select files") says
  // nothing about what to upload. The heading / label right above it does ("Resume/CV").
  function fileLabel(el) {
    const base = fieldLabel(el);
    if (base && !DROPZONE.test(base)) return base;
    // Labels right above the drop zone, up to and including the nearest section heading ("Resume/CV").
    const near = [];
    for (const h of JAF.precedingHeadings(el, JAF.HEADING_SEL + ', label, [class*="label" i]', 6)) {
      const t = JAF.labelText(h, 120);
      const heading = h.matches(JAF.HEADING_SEL);
      if (t && !/\b(drop (your )?files?|select files?|choose files?|browse|no file chosen)\b/i.test(t)) near.push(t);
      if (heading || near.length >= 2) break;
    }
    near.reverse();
    return near.length ? near.join(' ') : base;
  }

  function isRequired(el, label, container) {
    if (el.required || el.getAttribute('aria-required') === 'true') return true;
    if (container && container.querySelector('[aria-required="true"], [required]')) return true;
    if (/\*\s*$/.test(label) || /^\*/.test(label)) return true;
    if (/\brequired\b/i.test(label)) return true;
    return false;
  }

  function isTypeahead(el) {
    if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') return false;
    if (el.getAttribute('role') === 'combobox' || el.getAttribute('aria-autocomplete') === 'list' || el.getAttribute('aria-haspopup') === 'listbox') return true;
    if (el.hasAttribute('aria-controls') && !el.hasAttribute('list')) return true;
    if (/^(search|type to search|start typing|type to add)/i.test(el.getAttribute('placeholder') || '')) return true;
    if (el.matches(TYPEAHEAD_ATTR)) return true;
    const wrap = el.closest(TYPEAHEAD_ATTR);
    return !!(wrap && wrap.querySelectorAll('input, textarea').length === 1);
  }

  function inputType(el) {
    const tag = el.tagName;
    if (tag === 'TEXTAREA') return 'textarea';
    if (tag === 'SELECT') return el.multiple ? 'multiselect' : 'select';
    if (tag === 'INPUT') {
      const t = (el.type || 'text').toLowerCase();
      if (['email', 'tel', 'url', 'number', 'date', 'file', 'radio', 'checkbox'].includes(t)) return t;
      if (isTypeahead(el)) return 'combobox';
      return 'text';
    }
    const role = el.getAttribute('role');
    if (role === 'textbox' || el.isContentEditable) return el.getAttribute('aria-multiline') === 'true' || el.isContentEditable ? 'textarea' : 'text';
    if (role === 'combobox' || el.getAttribute('aria-haspopup') === 'listbox') return 'combobox';
    if (role === 'listbox') return 'select';
    if (role === 'radio') return 'radio';
    if (role === 'checkbox' || role === 'switch') return 'checkbox';
    if (role === 'spinbutton') return 'number';
    return 'text';
  }

  function isMulti(el, label) {
    if (el.getAttribute('aria-multiselectable') === 'true') return true;
    if (el.closest('[aria-multiselectable="true"], [data-automation-id*="multiselect" i], [class*="multi-select" i], [class*="multiselect" i]')) return true;
    return MULTI_HINT.test(label || '');
  }

  function selectOptions(el) {
    return Array.from(el.options)
      .filter((o) => !o.disabled)
      .map((o) => ({ label: JAF.text(o) || o.value, value: o.value, el: o }))
      .filter((o) => o.label && !/^(select|choose|please select|--|-)/i.test(o.label.trim()));
  }

  function ariaListboxOptions(el) {
    let opts = Array.from(el.querySelectorAll('[role="option"]'));
    if (!opts.length) {
      const controls = el.getAttribute('aria-controls') || el.getAttribute('aria-owns');
      if (controls) {
        const root = el.getRootNode();
        controls.split(/\s+/).forEach((id) => {
          const lb = root.getElementById ? root.getElementById(id) : document.getElementById(id);
          if (lb) opts = opts.concat(Array.from(lb.querySelectorAll('[role="option"]')));
        });
      }
    }
    return opts
      .map((o) => ({ label: JAF.text(o) || o.getAttribute('aria-label') || o.getAttribute('data-value') || '', value: o.getAttribute('data-value') ?? JAF.text(o), el: o }))
      .filter((o) => o.label && o.value !== '' && !/^(select|choose)/i.test(o.label));
  }

  function currentValue(el, type, options) {
    if (type === 'select' || type === 'multiselect') {
      if (el.tagName === 'SELECT') return Array.from(el.selectedOptions).map((o) => JAF.text(o)).filter((t) => t && !/^(select|choose)/i.test(t)).join(', ');
      const sel = el.querySelector('[aria-selected="true"]');
      return sel ? JAF.text(sel) : '';
    }
    if (type === 'file') return el.files && el.files.length ? el.files[0].name : '';
    if (el.isContentEditable || el.getAttribute('role') === 'textbox') return JAF.text(el);
    if (type === 'combobox' && el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') {
      // Dropdown button: its text is the selection, unless it is still the placeholder.
      const t = JAF.text(el);
      return t && !/^(select|choose|please|--+|-)/i.test(t) ? t : '';
    }
    if (type === 'combobox' && !el.value) {
      // Typeahead with chips (skills): the selected values sit next to the input.
      const box = el.closest('[data-automation-id*="multiselect" i], [class*="multi" i][class*="select" i], [aria-multiselectable="true"]');
      const chips = box ? Array.from(box.querySelectorAll('[data-automation-id*="selectedItem" i], [role="listitem"], [class*="chip" i], [class*="token" i], [class*="tag" i]')).map((c) => JAF.text(c)).filter(Boolean) : [];
      if (chips.length) return chips.join(', ');
    }
    return el.value || '';
  }

  // ---- section / entry context -------------------------------------------
  const ENTRY_RE = /^(.*?[a-z\)])\s*[#:-]?\s*(\d{1,2})\s*$/i;

  // { section: 'Education 1', entry: {kind:'education', index:1} | null }
  function sectionInfo(el) {
    const heads = JAF.precedingHeadings(el).slice(0, 4);
    const section = heads.length ? JAF.labelText(heads[0], 120) : '';
    let entry = null;
    for (const h of heads) {
      const t = JAF.labelText(h, 120);
      const kind = JAF.sectionKind ? JAF.sectionKind(t) : null;
      const m = t.match(ENTRY_RE);
      if (m && kind) { entry = { kind, index: parseInt(m[2], 10) }; break; }
      // Any other real heading means we left the entry block; only a fieldset legend inside it is skipped.
      if (h.tagName !== 'LEGEND') break;
    }
    return { section, entry };
  }

  // ---- grouping -----------------------------------------------------------
  function groupKey(el, type) {
    if (el.tagName === 'INPUT') {
      const form = el.form ? el.form : el.closest('form') || document;
      const name = el.name || '';
      if (name) return { key: `${type}:${name}`, container: null };
      // No name: group by nearest fieldset/container.
    }
    const explicit = JAF.closestAcrossShadow(el, '[role="radiogroup"], [role="group"], fieldset, [role="listitem"]');
    if (explicit) return { key: null, container: explicit };
    // nearest ancestor that holds >1 same-type control and no other kinds of control:
    // a checkbox next to text fields is a lone checkbox ("I currently work here"), not part of a group.
    const sameSel = type === 'radio' ? 'input[type="radio"], [role="radio"]' : 'input[type="checkbox"], [role="checkbox"], [role="switch"]';
    let node = el.parentElement;
    for (let d = 0; node && d < 6; d++) {
      const n = node.querySelectorAll(sameSel).length;
      const foreign = Array.from(node.querySelectorAll('input, select, textarea, [role="combobox"], [role="textbox"]')).filter((c) => !c.matches(sameSel) && !(c.tagName === 'INPUT' && SKIP_INPUT_TYPES.has(c.type))).length;
      if (foreign > 1) break;
      if (n > 1) return { key: null, container: node };
      node = node.parentElement;
    }
    return { key: null, container: el.closest('label') || el.parentElement };
  }

  // ---- segmented dates ------------------------------------------------------
  function datePartName(el) {
    const hint = (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('data-automation-id') || el.name || '').trim();
    if (!hint) return null;
    const m = hint.match(/\b(month|day|year)\b/i) || hint.match(DATE_PART);
    if (!m) return null;
    const w = m[1] ? m[1].toLowerCase() : m[0].toLowerCase();
    if (/^(mm|month)$/.test(w)) return 'month';
    if (/^(dd|day)$/.test(w)) return 'day';
    if (/^(yyyy|yy|year)$/.test(w)) return 'year';
    return null;
  }

  function datePartOf(el) {
    if (!(el.tagName === 'INPUT' && ['text', 'number', 'tel'].includes((el.type || 'text').toLowerCase())) && el.getAttribute('role') !== 'spinbutton') return null;
    const part = datePartName(el);
    if (!part) return null;
    if (el.tagName === 'INPUT' && String(el.maxLength) !== '-1' && el.maxLength > 4) return null;
    // The widget is the nearest ancestor that holds another date part, or at least this one plus a separator.
    let node = el.parentElement;
    for (let d = 0; node && d < 4; d++) {
      const parts = Array.from(node.querySelectorAll('input, [role="spinbutton"]')).filter((x) => datePartName(x));
      const others = Array.from(node.querySelectorAll('input, select, textarea, [role="combobox"]')).filter((x) => !datePartName(x) && x.type !== 'hidden');
      if (others.length) break;
      if (parts.length >= 2 || (parts.length === 1 && /\/|-/.test(JAF.text(node)))) return { part, widget: node };
      node = node.parentElement;
    }
    return null;
  }

  // ---- main ---------------------------------------------------------------
  JAF.extractGeneric = function (root = document) {
    JAF.registry = new Map();
    counter = 0;
    const questions = [];
    const seen = new Set();
    const groups = new Map(); // key or container -> {type, els:[]}
    const dateWidgets = new Map(); // widget el -> {parts:{month,day,year}}

    const controls = JAF.deepQueryAll(CONTROL_SEL, root).filter((el) => {
      if (inOverlay(el) || inNav(el)) return false;
      if (el.tagName === 'INPUT' && SKIP_INPUT_TYPES.has((el.type || '').toLowerCase())) return false;
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
      if (el.readOnly && el.tagName !== 'INPUT') return false;
      if (el.matches('[role="listbox"] [role="option"], option')) return false;
      if (el.closest('[role="listbox"]') && el.getAttribute('role') !== 'listbox') return false;
      // Nested: a [role=combobox] / [aria-haspopup] wrapper around a real input -> keep the input only.
      if ((el.getAttribute('role') === 'combobox' || el.hasAttribute('aria-haspopup')) && el.querySelector('input, textarea, select, [role="textbox"]')) return false;
      const t = (el.type || '').toLowerCase();
      if (t === 'file') return true; // usually hidden behind a styled button
      // Custom-styled radios/checkboxes hide the native input and show a label instead.
      if (t === 'radio' || t === 'checkbox') return JAF.isVisible(el) || hasVisibleLabel(el);
      return JAF.isVisible(el);
    });
    const fileCount = controls.filter((el) => (el.type || '').toLowerCase() === 'file').length;

    for (const el of controls) {
      if (seen.has(el)) continue;
      const type = inputType(el);

      if (type === 'radio' || type === 'checkbox') {
        const g = groupKey(el, type);
        const gk = g.key || g.container;
        if (!groups.has(gk)) groups.set(gk, { type, els: [], container: g.container });
        groups.get(gk).els.push(el);
        seen.add(el);
        continue;
      }

      const dp = (type === 'text' || type === 'number') ? datePartOf(el) : null;
      if (dp) {
        if (!dateWidgets.has(dp.widget)) dateWidgets.set(dp.widget, { parts: {} });
        dateWidgets.get(dp.widget).parts[dp.part] = el;
        seen.add(el);
        continue;
      }

      seen.add(el);
      const id = nextId();
      const label = type === 'file' ? fileLabel(el) : fieldLabel(el);
      if (NAV_LABEL.test(label)) continue;
      let options = [];
      if (el.tagName === 'SELECT') options = selectOptions(el);
      else if (type === 'select' || type === 'combobox') options = ariaListboxOptions(el);
      const ctx = sectionInfo(el);
      const q = {
        id,
        label,
        type,
        options: options.map((o) => o.label),
        required: isRequired(el, label, null),
        currentValue: currentValue(el, type, options),
        meta: {
          name: el.getAttribute('name') || '',
          idAttr: el.id || '',
          placeholder: el.getAttribute('placeholder') || '',
          autocomplete: el.getAttribute('autocomplete') || '',
          accept: el.getAttribute('accept') || '',
          maxLength: el.maxLength > 0 ? el.maxLength : null,
          section: ctx.section,
          entry: ctx.entry,
          multi: type === 'combobox' && isMulti(el, label),
          onlyFile: type === 'file' && fileCount === 1,
        },
      };
      JAF.registry.set(id, { kind: 'single', el, options });
      questions.push(q);
    }

    for (const [widget, w] of dateWidgets) {
      const els = Object.values(w.parts);
      const id = nextId();
      const label = ownLabel(widget) || containerLabel(widget, els) || containerLabel(widget.parentElement, els) || 'Date';
      const ctx = sectionInfo(widget);
      const cur = ['year', 'month', 'day'].map((p) => w.parts[p] && (w.parts[p].value || w.parts[p].getAttribute('aria-valuenow') || JAF.text(w.parts[p]))).filter(Boolean);
      const q = {
        id, label, type: 'date', options: [],
        required: isRequired(els[0], label, widget),
        currentValue: cur.length ? cur.join('-') : '',
        meta: { name: els[0].name || '', dateParts: Object.keys(w.parts), section: ctx.section, entry: ctx.entry, placeholder: els.map((e) => e.getAttribute('placeholder') || '').join('/') },
      };
      JAF.registry.set(id, { kind: 'dateparts', el: els[0], els, parts: w.parts, options: [] });
      questions.push(q);
    }

    for (const [, g] of groups) {
      const id = nextId();
      const options = g.els.map((el) => ({ label: optionLabel(el), value: el.value || el.getAttribute('data-value') || '', el }));
      const container = g.container || (g.els[0].closest('fieldset, [role="radiogroup"], [role="group"]') || g.els[0].parentElement);
      let label = containerLabel(container, g.els.concat(g.els.map((e) => e.closest('label')).filter(Boolean)));
      if (!label && g.els.length === 1) {
        // A lone checkbox: the option text IS the question ("I agree to ...").
        label = options[0].label;
      }
      if (!label) label = humanize(g.els[0].name || g.els[0].id);
      if (NAV_LABEL.test(label)) continue;
      const ctx = sectionInfo(g.els[0]);
      const q = {
        id,
        label,
        type: g.type,
        options: options.map((o) => o.label),
        required: isRequired(g.els[0], label, container),
        currentValue: options.filter((o) => o.el.checked || o.el.getAttribute('aria-checked') === 'true').map((o) => o.label).join(', '),
        meta: { name: g.els[0].name || '', section: ctx.section, entry: ctx.entry },
      };
      JAF.registry.set(id, { kind: 'group', els: g.els, options });
      questions.push(q);
    }

    return questions;
  };

  // Cheap fingerprint of the form on the page: used to notice when a multi-step
  // application moved to another step without a full page load.
  JAF.formFingerprint = function () {
    const els = JAF.deepQueryAll(CONTROL_SEL).filter((el) => !inOverlay(el) && !inNav(el) && !(el.tagName === 'INPUT' && SKIP_INPUT_TYPES.has((el.type || '').toLowerCase())) && (el.type === 'file' || JAF.isVisible(el)));
    const known = els.filter((el) => { for (const e of JAF.registry.values()) { if (e.el === el || (e.els && e.els.includes(el))) return true; } return false; }).length;
    return { url: location.href, count: els.length, unknown: els.length - known };
  };

  // Page context for the LLM: title, URL and a slice of the visible text that is
  // most likely the job description (the longest non-form text region).
  JAF.pageContext = function () {
    let jd = '';
    const candidates = Array.from(document.querySelectorAll('main, article, [class*="description" i], [id*="description" i], [class*="job" i], section'));
    for (const c of candidates) {
      const t = JAF.labelText(c, 6000);
      if (t.length > jd.length) jd = t;
    }
    if (jd.length < 400) jd = JAF.labelText(document.body, 6000);
    return { title: document.title, url: location.href, jobDescription: jd.slice(0, 6000) };
  };
})();
