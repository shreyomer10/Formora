// Google Forms adapter. Google Forms renders every question as div[role=listitem]
// with the title in [role=heading]; controls are ARIA divs, not native inputs.
(function () {
  const JAF = window.JAF;

  JAF.isGForms = () =>
    (/(^|\.)docs\.google\.com$/.test(location.hostname) && /\/forms\//.test(location.pathname)) ||
    !!document.querySelector('form[action*="/formResponse"]');

  let counter = 0;
  const nextId = () => `g${++counter}`;

  function optLabel(el) {
    return (el.getAttribute('aria-label') || el.getAttribute('data-value') || JAF.text(el) || '').trim();
  }

  JAF.extractGForms = function () {
    JAF.registry = new Map();
    counter = 0;
    const questions = [];
    const items = Array.from(document.querySelectorAll('div[role="listitem"]'));

    for (const item of items) {
      const heading = item.querySelector('[role="heading"]');
      const title = heading ? JAF.labelText(heading, 400) : '';
      if (!title) continue;
      const required = /\*\s*$/.test(title) || !!item.querySelector('[aria-required="true"]');
      const label = title.replace(/\s*\*\s*$/, '');
      const desc = (() => {
        const d = heading && heading.nextElementSibling;
        const t = d && !d.querySelector('input, textarea, [role="radio"], [role="checkbox"], [role="listbox"]') ? JAF.labelText(d, 300) : '';
        return t;
      })();
      const fullLabel = desc ? `${label} (${desc})` : label;

      // Grid questions: several radiogroups, one per row.
      const groups = Array.from(item.querySelectorAll('[role="radiogroup"], [role="group"]'));
      const gridRows = groups.filter((g) => g.getAttribute('aria-label') && g.querySelectorAll('[role="radio"], [role="checkbox"]').length > 1);
      if (gridRows.length > 1) {
        for (const row of gridRows) {
          const els = Array.from(row.querySelectorAll('[role="radio"], [role="checkbox"]'));
          const type = els[0].getAttribute('role') === 'radio' ? 'radio' : 'checkbox';
          const options = els.map((el) => ({ label: optLabel(el), value: el.getAttribute('data-value') || optLabel(el), el }));
          const id = nextId();
          JAF.registry.set(id, { kind: 'group', els, options, gforms: true });
          questions.push({ id, label: `${label}: ${row.getAttribute('aria-label')}`, type, options: options.map((o) => o.label), required, currentValue: '', meta: { gforms: true } });
        }
        continue;
      }

      const radios = Array.from(item.querySelectorAll('[role="radio"]'));
      const checks = Array.from(item.querySelectorAll('[role="checkbox"]'));
      const listbox = item.querySelector('[role="listbox"]');
      const textInputs = Array.from(item.querySelectorAll('input:not([type="hidden"]), textarea')).filter(JAF.isVisible);
      const otherInput = item.querySelector('input[aria-label*="Other" i], input[aria-label*="other" i]');

      if (radios.length || checks.length) {
        const els = radios.length ? radios : checks;
        const type = radios.length ? 'radio' : 'checkbox';
        const options = els.map((el) => {
          const dv = el.getAttribute('data-value') || '';
          const isOther = dv === '__other_option__' || /^other/i.test(optLabel(el));
          return { label: isOther ? 'Other' : optLabel(el), value: dv || optLabel(el), el, isOther, otherInput: isOther ? otherInput : null };
        });
        const id = nextId();
        JAF.registry.set(id, { kind: 'group', els, options, gforms: true });
        questions.push({
          id, label: fullLabel, type, options: options.map((o) => o.label), required,
          currentValue: options.filter((o) => o.el.getAttribute('aria-checked') === 'true').map((o) => o.label).join(', '),
          meta: { gforms: true, hasOther: options.some((o) => o.isOther) },
        });
        continue;
      }

      if (listbox) {
        const opts = Array.from(listbox.querySelectorAll('[role="option"]'))
          .map((o) => ({ label: optLabel(o), value: o.getAttribute('data-value') || optLabel(o), el: o }))
          .filter((o) => o.value && o.label && !/^choose$/i.test(o.label));
        const id = nextId();
        JAF.registry.set(id, { kind: 'gforms-listbox', el: listbox, options: opts });
        const sel = listbox.querySelector('[role="option"][aria-selected="true"]');
        questions.push({ id, label: fullLabel, type: 'select', options: opts.map((o) => o.label), required, currentValue: sel && !/^choose$/i.test(optLabel(sel)) ? optLabel(sel) : '', meta: { gforms: true } });
        continue;
      }

      if (textInputs.length) {
        if (textInputs.length === 1) {
          const el = textInputs[0];
          const t = el.tagName === 'TEXTAREA' ? 'textarea' : (el.type === 'date' ? 'date' : el.type === 'email' ? 'email' : 'text');
          const id = nextId();
          JAF.registry.set(id, { kind: 'single', el, options: [] });
          questions.push({ id, label: fullLabel, type: t, options: [], required, currentValue: el.value || '', meta: { gforms: true, placeholder: el.placeholder || '' } });
        } else {
          // Date/time pieces (e.g. hour + minute) - expose each with its aria-label.
          for (const el of textInputs) {
            const sub = el.getAttribute('aria-label') || el.placeholder || el.type;
            const id = nextId();
            JAF.registry.set(id, { kind: 'single', el, options: [] });
            questions.push({ id, label: `${fullLabel} - ${sub}`, type: el.type === 'date' ? 'date' : 'text', options: [], required, currentValue: el.value || '', meta: { gforms: true } });
          }
        }
        continue;
      }

      if (item.querySelector('[role="button"][aria-label*="Add file" i], [aria-label*="upload" i]')) {
        const id = nextId();
        JAF.registry.set(id, { kind: 'unsupported', el: item });
        questions.push({ id, label: fullLabel, type: 'file', options: [], required, currentValue: '', meta: { gforms: true, unsupported: 'Google Forms file upload opens a Drive picker; attach manually.' } });
      }
    }
    return questions;
  };
})();
