// Generic DOM -> questions extractor. Works on native controls, ARIA widgets and
// framework wrappers. Output: array of normalized question objects. Elements are
// kept in JAF.registry (never serialized).
(function () {
  const JAF = window.JAF;

  const CONTROL_SEL =
    'input, select, textarea, [contenteditable="true"], [role="textbox"], [role="combobox"], ' +
    '[role="radio"], [role="checkbox"], [role="switch"], [role="listbox"], [role="spinbutton"]';
  const SKIP_INPUT_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image', 'search', 'password']);

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

  function isControl(el) {
    return el.matches && el.matches(CONTROL_SEL);
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

  function isRequired(el, label, container) {
    if (el.required || el.getAttribute('aria-required') === 'true') return true;
    if (container && container.querySelector('[aria-required="true"], [required]')) return true;
    if (/\*\s*$/.test(label) || /^\*/.test(label)) return true;
    if (/\brequired\b/i.test(label)) return true;
    return false;
  }

  function inputType(el) {
    const tag = el.tagName;
    if (tag === 'TEXTAREA') return 'textarea';
    if (tag === 'SELECT') return el.multiple ? 'multiselect' : 'select';
    if (tag === 'INPUT') {
      const t = (el.type || 'text').toLowerCase();
      if (['email', 'tel', 'url', 'number', 'date', 'file', 'radio', 'checkbox'].includes(t)) return t;
      if (el.getAttribute('role') === 'combobox' || el.getAttribute('aria-autocomplete') === 'list') return 'combobox';
      return 'text';
    }
    const role = el.getAttribute('role');
    if (role === 'textbox' || el.isContentEditable) return el.getAttribute('aria-multiline') === 'true' || el.isContentEditable ? 'textarea' : 'text';
    if (role === 'combobox') return 'combobox';
    if (role === 'listbox') return 'select';
    if (role === 'radio') return 'radio';
    if (role === 'checkbox' || role === 'switch') return 'checkbox';
    if (role === 'spinbutton') return 'number';
    return 'text';
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
    return el.value || '';
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
    // nearest ancestor that holds >1 same-type control
    let node = el.parentElement;
    for (let d = 0; node && d < 6; d++) {
      const n = node.querySelectorAll(type === 'radio' ? 'input[type="radio"], [role="radio"]' : 'input[type="checkbox"], [role="checkbox"], [role="switch"]').length;
      if (n > 1) return { key: null, container: node };
      node = node.parentElement;
    }
    return { key: null, container: el.parentElement };
  }

  // ---- main ---------------------------------------------------------------
  JAF.extractGeneric = function (root = document) {
    JAF.registry = new Map();
    counter = 0;
    const questions = [];
    const seen = new Set();
    const groups = new Map(); // key or container -> {type, els:[]}

    const controls = JAF.deepQueryAll(CONTROL_SEL, root).filter((el) => {
      if (inOverlay(el)) return false;
      if (el.tagName === 'INPUT' && SKIP_INPUT_TYPES.has((el.type || '').toLowerCase())) return false;
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
      if (el.readOnly && el.tagName !== 'INPUT') return false;
      if (el.matches('[role="listbox"] [role="option"], option')) return false;
      if (el.closest('[role="listbox"]') && el.getAttribute('role') !== 'listbox') return false;
      // Nested: a [role=combobox] wrapper around a real input -> keep the input only.
      if (el.getAttribute('role') === 'combobox' && el.querySelector('input, [role="textbox"]')) return false;
      const t = (el.type || '').toLowerCase();
      if (t === 'file') return true; // usually hidden behind a styled button
      return JAF.isVisible(el);
    });

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

      seen.add(el);
      const id = nextId();
      const label = fieldLabel(el);
      let options = [];
      if (el.tagName === 'SELECT') options = selectOptions(el);
      else if (type === 'select' || type === 'combobox') options = ariaListboxOptions(el);
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
        },
      };
      JAF.registry.set(id, { kind: 'single', el, options });
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
      const q = {
        id,
        label,
        type: g.type,
        options: options.map((o) => o.label),
        required: isRequired(g.els[0], label, container),
        currentValue: options.filter((o) => o.el.checked || o.el.getAttribute('aria-checked') === 'true').map((o) => o.label).join(', '),
        meta: { name: g.els[0].name || '' },
      };
      JAF.registry.set(id, { kind: 'group', els: g.els, options });
      questions.push(q);
    }

    return questions;
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
