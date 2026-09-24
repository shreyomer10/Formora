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

      const addFile = item.querySelector('[role="button"][aria-label*="Add file" i], [aria-label*="upload" i], [role="button"]');
      if (addFile && /add file|upload/i.test((addFile.getAttribute('aria-label') || '') + ' ' + JAF.text(addFile))) {
        const id = nextId();
        JAF.registry.set(id, { kind: 'gforms-file', el: item, button: addFile });
        questions.push({ id, label: fullLabel, type: 'file', options: [], required, currentValue: '', meta: { gforms: true, unsupported: 'Google Forms uploads go through a Drive picker; attach manually if the automatic hand-off does not show the file.' } });
      }
    }
    return questions;
  };

  // Google Forms uploads go to the respondent's Drive through a picker iframe. Open it, ask our
  // content script inside the picker to feed it the resume, then watch the form for the file name.
  JAF.gformsAttach = async function (entry, resume) {
    if (!resume || !resume.base64) return { ok: false, note: 'no resume stored in options' };
    const item = entry.el;
    const already = () => JAF.text(item).includes((resume.fileName || '').slice(0, 20));
    if (already()) return { ok: true, note: `${resume.fileName} already attached` };
    entry.button.click();
    const frame = await JAF.waitFor(() => Array.from(document.querySelectorAll('iframe')).find((f) => /picker/.test(f.src) && JAF.isVisible(f)), 6000, 200);
    if (!frame) return { ok: false, note: 'the Drive picker did not open; click "Add file" and attach manually' };
    await JAF.sleep(1200); // let the picker boot
    const result = await new Promise((resolve) => {
      const onMsg = (e) => { if (e.data && e.data.type === 'applypilot-attach-result') { window.removeEventListener('message', onMsg); resolve(e.data); } };
      window.addEventListener('message', onMsg);
      let tries = 0;
      const ping = () => { try { frame.contentWindow.postMessage({ type: 'applypilot-attach' }, '*'); } catch { /* not ready */ } if (++tries < 8) setTimeout(ping, 1000); };
      ping();
      setTimeout(() => { window.removeEventListener('message', onMsg); resolve(null); }, 9000);
    });
    if (!result) return { ok: false, note: 'no answer from the Drive picker (are you signed in to Google?); attach manually' };
    if (!result.ok) return { ok: false, note: `${result.note}; attach manually` };
    const shown = await JAF.waitFor(already, 20000, 500);
    if (shown) return { ok: true, note: `attached ${resume.fileName} via Drive` };
    return { ok: false, note: `${result.note}, but the form does not show it yet; check the picker` };
  };
})();
