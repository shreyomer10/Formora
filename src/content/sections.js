// Repeatable sections: "Work Experience", "Education", "Certifications" blocks that only
// show their fields after an "Add" / "Add Another" click. Before extraction we click Add
// once per entry stored in the profile; after extraction each field is mapped to the
// matching entry (Work Experience 2 -> profile.workExperience[1]) by label.
(function () {
  const JAF = window.JAF;

  const KINDS = [
    { kind: 'work', profileKey: 'workExperience', re: /\b(work|professional|employment|job)\s*(experience|history)\b|\bemployment\b|\bexperience\s*\d*$/i, noun: 'work experience' },
    { kind: 'education', profileKey: 'education', re: /\beducation\b|\bacademic\b|\bqualifications?\b/i, noun: 'education' },
    { kind: 'certification', profileKey: 'certifications', re: /\bcertif|\blicen[sc]e/i, noun: 'certification' },
  ];
  const ADD_RE = /^\s*(\+\s*)?add(\s+(another|more|new|one|row|entry|experience|education|certification|position|job|degree|school))*\s*$/i;
  const ENTRY_RE = /^(.*?[a-z\)])\s*[#:-]?\s*(\d{1,2})\s*$/i;

  JAF.sectionKind = function (text) {
    const t = String(text || '').trim();
    if (!t || t.length > 60) return null;
    const hit = KINDS.find((k) => k.re.test(t));
    return hit ? hit.kind : null;
  };
  const kindDef = (kind) => KINDS.find((k) => k.kind === kind);

  function inOverlay(el) { return !!JAF.closestAcrossShadow(el, '#applypilot-root'); }

  function addButtons(root = document) {
    return JAF.deepQueryAll('button, [role="button"], a[href="#"], input[type="button"]', root)
      .filter((b) => !inOverlay(b) && JAF.isVisible(b) && !b.disabled && ADD_RE.test(b.value || JAF.text(b) || b.getAttribute('aria-label') || ''));
  }

  // Which section does this Add button belong to, and which element bounds that section?
  function sectionOf(btn) {
    let node = btn.parentElement;
    for (let depth = 0; node && depth < 12; depth++) {
      if (node.matches && node.matches('body, html')) break;
      const heads = Array.from(node.querySelectorAll(JAF.HEADING_SEL))
        .filter((h) => !h.contains(btn) && (h.compareDocumentPosition(btn) & Node.DOCUMENT_POSITION_FOLLOWING) && JAF.text(h))
        .reverse()
        .slice(0, 6);
      for (const h of heads) {
        const kind = JAF.sectionKind(JAF.labelText(h, 80));
        if (kind) return { kind, container: node, heading: h };
        if (h.tagName !== 'LEGEND') return null; // the nearest real heading is unrelated: not a repeatable section
      }
      const root = node.getRootNode && node.getRootNode();
      node = node.parentElement || (root && root.host) || null;
    }
    return null;
  }

  function entryCount(container, kind) {
    const nums = new Set();
    Array.from(container.querySelectorAll(JAF.HEADING_SEL)).forEach((h) => {
      const t = JAF.labelText(h, 80);
      const m = t.match(ENTRY_RE);
      if (m && JAF.sectionKind(m[1]) === kind) nums.add(m[2]);
    });
    return nums.size;
  }

  function controlCount() {
    return JAF.deepQueryAll('input, select, textarea, [role="combobox"], [role="textbox"]').filter((el) => !inOverlay(el)).length;
  }

  // Click "Add" until every profile entry has a block on the page. Returns notes for the panel.
  JAF.prepareSections = async function (profile) {
    const notes = [];
    const done = new Set();
    const initial = new Map(); // kind -> entries present before we clicked anything
    for (let pass = 0; pass < 12; pass++) {
      const buttons = addButtons();
      let clicked = false;
      for (const btn of buttons) {
        const sec = sectionOf(btn);
        if (!sec || done.has(sec.kind)) continue;
        const def = kindDef(sec.kind);
        const items = Array.isArray(profile[def.profileKey]) ? profile[def.profileKey].filter((it) => it && Object.values(it).some((v) => v && v !== false)) : [];
        const have = entryCount(sec.container, sec.kind);
        if (!initial.has(sec.kind)) initial.set(sec.kind, have);
        if (!items.length) { done.add(sec.kind); if (!have) notes.push({ kind: sec.kind, text: `${def.noun}: no entries in your profile, section left empty` }); continue; }
        if (have >= items.length) { done.add(sec.kind); continue; }
        const before = controlCount();
        try { btn.scrollIntoView({ block: 'center' }); } catch { /* detached */ }
        btn.click();
        const grew = await JAF.waitFor(() => controlCount() > before, 2500, 100);
        await JAF.sleep(250);
        if (!grew) { done.add(sec.kind); notes.push({ kind: sec.kind, text: `${def.noun}: clicking "${JAF.text(btn)}" added no fields` }); continue; }
        clicked = true;
        const now = entryCount(sec.container, sec.kind);
        if (now >= items.length || now === have) { // done, or the page does not number entries: add exactly one per missing item
          if (now === have) {
            for (let i = have + 1; i < items.length; i++) {
              const again = addButtons(sec.container).pop();
              if (!again) break;
              const b2 = controlCount();
              again.click();
              await JAF.waitFor(() => controlCount() > b2, 2500, 100);
              await JAF.sleep(250);
            }
          }
          done.add(sec.kind);
          notes.push({ kind: sec.kind, text: `${def.noun}: added ${Math.max(1, items.length - initial.get(sec.kind))} block(s) for your ${items.length} entr${items.length === 1 ? 'y' : 'ies'}` });
        }
        break; // the DOM changed: re-scan buttons
      }
      if (!clicked) break;
    }
    return notes;
  };

  // ---- entry field mapping ---------------------------------------------------
  const FIELDS = {
    work: [
      { key: 'description', re: /\b(description|responsibilit|duties|summary|details|achievements?)\b/i, types: ['textarea', 'text'] },
      { key: 'current', re: /\b(current(ly)?|present|still work|ongoing)\b/i, types: ['checkbox'] },
      { key: 'startDate', re: /\b(from|start|since|joined|begin)\b/i },
      { key: 'endDate', re: /\b(to|end|until|till|left)\b/i },
      { key: 'title', re: /\b(job )?title\b|\bposition\b|\brole\b|\bdesignation\b/i },
      { key: 'company', re: /\b(company|employer|organi[sz]ation|firm|business)\b/i },
      { key: 'location', re: /\b(location|city|country|place)\b/i },
      { key: 'employmentType', re: /\b(employment type|job type|type of employment)\b/i },
    ],
    education: [
      { key: 'gpa', re: /\b(gpa|cgpa|grade|percentage|marks|score)\b/i },
      { key: 'startDate', re: /\b(from|start|since|begin)\b/i },
      { key: 'endDate', re: /\b(to|end|until|till|graduat|completion|passing)\b/i },
      { key: 'currentlyEnrolled', re: /\b(current|enrolled|still study|ongoing)\b/i, types: ['checkbox'] },
      { key: 'school', re: /\b(school|university|college|institution|institute|alma mater)\b/i },
      { key: 'field', re: /\b(field of study|major|discipline|specializ|specialis|branch|stream|course|subject|concentration)\b/i },
      { key: 'degree', re: /\b(degree|qualification|level)\b/i },
    ],
    certification: [
      { key: 'number', re: /\b(number|credential id|license no|id)\b/i },
      { key: 'issued', re: /\b(issued?|issue date|obtained|awarded|earned|date received)\b/i },
      { key: 'expires', re: /\b(expir|valid (until|through|to))\b/i },
      { key: 'issuer', re: /\b(issuer|issuing|authority|organi[sz]ation|provider|body)\b/i },
      { key: 'name', re: /\b(certification|certificate|license|licence|name|title)\b/i },
    ],
  };

  // Value for a question that belongs to a repeated entry. Returns:
  //   { value, key }  -> fill with this
  //   { skip, note }  -> intentionally left empty (e.g. end date of a current job)
  //   null            -> no rule; let the general rules / model handle it
  JAF.sectionValue = function (q, profile) {
    const e = q.meta && q.meta.entry;
    if (!e) return null;
    const def = kindDef(e.kind);
    const items = def && Array.isArray(profile[def.profileKey]) ? profile[def.profileKey] : [];
    const item = items[e.index - 1];
    if (!item) return null;
    if (q.type === 'file') return { skip: true, note: 'attachment: add manually if you have one' };
    const label = String(q.label || '');
    const rule = FIELDS[e.kind].find((r) => (!r.types || r.types.includes(q.type) || (r.types.includes('text') && q.type === 'combobox')) && r.re.test(label));
    if (!rule) return null;
    let v = item[rule.key];
    if (rule.key === 'current' || rule.key === 'currentlyEnrolled') {
      const on = v === true || /^(yes|true|1)$/i.test(String(v || ''));
      if (!on && rule.key === 'current' && !item.endDate) v = true;
      if (!(v === true || on)) return { skip: true, note: 'not a current position' };
      return { value: q.options && q.options.length ? [q.options[0]] : ['yes'], key: rule.key };
    }
    if (rule.key === 'endDate' && (item.current === true || /^(present|current|now|ongoing)$/i.test(String(item.endDate || '')))) {
      return { skip: true, note: 'current position: end date left empty' };
    }
    if (v == null || v === '' || v === false) return null;
    return { value: String(v), key: rule.key };
  };
})();
