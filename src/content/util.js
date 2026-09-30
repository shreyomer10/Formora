// Shared helpers for content scripts. Everything hangs off window.JAF.
(function () {
  const JAF = (window.JAF = window.JAF || {});

  JAF.documentToken = JAF.documentToken || crypto.randomUUID();
  JAF.worker = (message) => chrome.runtime.sendMessage({ ...message, documentToken: JAF.documentToken });

  JAF.sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  JAF.text = (el) => (el ? (el.innerText || el.textContent || '') : '').replace(/\s+/g, ' ').trim();

  JAF.isVisible = function (el) {
    if (!el || !el.isConnected) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    // Honeypots are usually pushed far off-page (left: -9999px). Use document coordinates so an
    // element that is merely scrolled out of the viewport still counts as visible.
    if (r.right + window.scrollX < -1000 || r.bottom + window.scrollY < -1000) return false;
    return true;
  };

  // querySelectorAll that also descends into open shadow roots.
  JAF.deepQueryAll = function (selector, root = document) {
    const out = [];
    const walk = (node) => {
      if (!node || !node.querySelectorAll) return;
      node.querySelectorAll(selector).forEach((el) => out.push(el));
      node.querySelectorAll('*').forEach((el) => {
        if (el.shadowRoot) walk(el.shadowRoot);
      });
    };
    walk(root);
    return out;
  };

  JAF.closestAcrossShadow = function (el, selector) {
    let node = el;
    while (node) {
      if (node instanceof Element) {
        const hit = node.closest(selector);
        if (hit) return hit;
      }
      const root = node.getRootNode && node.getRootNode();
      node = root && root.host ? root.host : null;
    }
    return null;
  };

  // Text of a container excluding text inside controls and option lists.
  JAF.labelText = function (container, maxLen = 400) {
    if (!container) return '';
    const clone = container.cloneNode(true);
    clone
      .querySelectorAll('input, select, textarea, option, button, [role="option"], [role="radio"], [role="checkbox"], [role="listbox"], script, style, svg')
      .forEach((n) => n.remove());
    const t = (clone.innerText || clone.textContent || '').replace(/\s+/g, ' ').trim();
    return t.length > maxLen ? t.slice(0, maxLen) : t;
  };

  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  JAF.fuzzyEq = function (a, b) {
    const x = norm(a), y = norm(b);
    if (!x || !y) return false;
    return x === y || x.includes(y) || y.includes(x);
  };

  // Pick the option whose label best matches `value`. Options: [{label, value, el?}].
  JAF.bestOption = function (value, options) {
    if (!options || !options.length) return null;
    const v = norm(value);
    if (!v) return null;
    let hit = options.find((o) => norm(o.label) === v || norm(o.value) === v);
    if (hit) return hit;
    hit = options.find((o) => norm(o.label).startsWith(v) || v.startsWith(norm(o.label)));
    if (hit) return hit;
    hit = options.find((o) => norm(o.label).includes(v) || v.includes(norm(o.label)));
    if (hit) return hit;
    // Token overlap, ignoring bare numbers (a "5" in "2.5" must not select "5+").
    const vt = new Set(v.split(' ').filter((t) => t.length > 1 && !/^\d+$/.test(t)));
    let best = null, bestScore = 0;
    for (const o of options) {
      const ot = norm(o.label).split(' ').filter((t) => t.length > 1 && !/^\d+$/.test(t));
      if (!ot.length) continue;
      const score = ot.filter((t) => vt.has(t)).length / ot.length;
      if (score > bestScore) { bestScore = score; best = o; }
    }
    if (bestScore >= 0.5) return best;
    // "B.Tech" against "Bachelor of Technology": expand the abbreviation and retry once.
    const alias = JAF.aliasOf ? JAF.aliasOf(value) : null;
    if (alias && alias !== v) return JAF.bestOption(alias, options);
    return null;
  };

  // For numeric values against range-style options ("0-1", "1-3 years", "3 to 5", "5+", "less than 1",
  // "more than 10"). Returns the option whose range contains the number, else null.
  JAF.rangeOption = function (value, options) {
    const num = parseFloat(String(value).replace(/[^0-9.]/g, ''));
    if (!isFinite(num)) return null;
    let best = null;
    for (const o of options) {
      const l = String(o.label).toLowerCase().replace(/,/g, '');
      const nums = (l.match(/\d+(\.\d+)?/g) || []).map(Number);
      if (!nums.length) continue;
      let lo = -Infinity, hi = Infinity;
      if (nums.length >= 2 && /(-|–|to|and)/.test(l)) { lo = nums[0]; hi = nums[1]; }
      else if (/\+|more than|greater|above|over|at least|or more|>/.test(l)) lo = nums[0];
      else if (/less than|under|below|up to|fewer|<|max/.test(l)) hi = nums[0];
      else if (nums.length === 1) { lo = nums[0]; hi = nums[0]; }
      else continue;
      const strictHi = /less than|under|below|<|fewer/.test(l);
      const inRange = num >= lo && (strictHi ? num < hi : num <= hi);
      if (inRange && (!best || hi - lo < best.span)) best = { o, span: hi - lo };
    }
    return best ? best.o : null;
  };

  // Poll `fn` until it returns a truthy value or `ms` elapses.
  JAF.waitFor = async function (fn, ms = 1500, step = 120) {
    const end = Date.now() + ms;
    for (;;) {
      let v;
      try { v = fn(); } catch { v = null; }
      if (v) return v;
      if (Date.now() >= end) return null;
      await JAF.sleep(step);
    }
  };

  // Common abbreviations that dropdowns spell out ("B.Tech" -> "Bachelor of Technology").
  JAF.ALIASES = {
    'b tech': 'bachelor of technology', 'btech': 'bachelor of technology', 'b e': 'bachelor of engineering', 'be': 'bachelor of engineering',
    'b sc': 'bachelor of science', 'bsc': 'bachelor of science', 'b a': 'bachelor of arts', 'ba': 'bachelor of arts', 'b com': 'bachelor of commerce', 'bcom': 'bachelor of commerce',
    'bca': 'bachelor of computer application', 'bba': 'bachelor of business administration', 'b arch': 'bachelor of architecture', 'llb': 'bachelor of law', 'mbbs': 'bachelor of medicine',
    'm tech': 'master of technology', 'mtech': 'master of technology', 'm e': 'master of engineering', 'me': 'master of engineering', 'm sc': 'master of science', 'msc': 'master of science', 'ms': 'master of science',
    'm a': 'master of arts', 'ma': 'master of arts', 'mba': 'master of business administration', 'mca': 'master of computer application', 'm com': 'master of commerce', 'mcom': 'master of commerce',
    'phd': 'doctor of philosophy', 'ph d': 'doctor of philosophy', 'doctorate': 'doctor of philosophy', 'hs': 'high school', 'hsc': 'higher secondary', 'ssc': 'secondary',
  };
  JAF.aliasOf = (value) => JAF.ALIASES[norm(value)] || null;

  // Degree level of a value ("B.Tech" -> bachelor), for lists that only offer levels ("Bachelor's Degree").
  const LEVELS = [
    ['bachelor', /\b(bachelor|undergraduate)\b/], ['master', /\b(master|postgraduate)\b/], ['doctor', /\b(doctor|doctorate|phd)\b/],
    ['associate', /\bassociate\b/], ['diploma', /\bdiploma\b/], ['high school', /\b(high school|higher secondary|secondary)\b/],
  ];
  JAF.degreeLevel = function (value) {
    const v = `${norm(value)} ${norm(JAF.aliasOf(value) || '')}`;
    const hit = LEVELS.find(([, re]) => re.test(v));
    return hit ? hit[0] : null;
  };

  // Strict pick for searchable dropdowns, where the site's list decides what is valid.
  // The option must be the same thing as the value, not merely share a word:
  // "India" -> "India +91" but never "British Indian Ocean Territory"; "IIIT Naya Raipur" never
  // becomes "IIIT Hyderabad". Two equally good different options mean no pick.
  const STOP = new Set(['of', 'and', 'the', 'in', 'at', 'for', 'an']);
  const words = (s) => norm(s).split(' ').filter((t) => t.length > 1 && !STOP.has(t) && !/^\d+$/.test(t));
  function matchScore(value, label) {
    const nl = norm(label);
    if (!nl) return 0;
    if (nl === norm(value)) return 3;
    // One comma part of a composite value ("Raipur, Chhattisgarh, India") named exactly.
    const parts = String(value).split(/\s*,\s*/).filter(Boolean);
    const vt = new Set(words(value)), ot = new Set(words(label));
    if (!vt.size || !ot.size) return 0;
    const m = [...ot].filter((t) => vt.has(t)).length;
    const f1 = (2 * m) / (vt.size + ot.size);
    if (f1 === 1) return 2; // same words, other punctuation or a code suffix
    if (parts.length > 1 && parts.some((p) => norm(p) === nl)) return 1.5;
    if (m && m === vt.size) return f1; // option spells the value out further
    if (m >= 2 && m === ot.size) return f1; // option is a real sub-phrase of the value
    return f1 >= 0.8 ? f1 : 0;
  }
  JAF.closestOption = function (value, options) {
    const variants = [value, JAF.aliasOf(value)].filter(Boolean);
    let best = null, bestScore = 0, tie = false;
    for (const o of options || []) {
      const s = Math.max(...variants.map((v) => matchScore(v, o.label)));
      if (s > bestScore) { best = o; bestScore = s; tie = false; }
      else if (s && s === bestScore && norm(o.label) !== norm(best.label)) tie = true;
    }
    if (best && !tie) return best;
    // Degree lists that only name levels.
    const level = JAF.degreeLevel(value);
    if (!level) return null;
    const hits = (options || []).filter((o) => norm(o.label).split(' ').includes(level.split(' ')[0]) || norm(o.label).includes(level));
    const degrees = hits.filter((o) => /\bdegree\b/.test(norm(o.label)));
    const pool = hits.length === 1 ? hits : degrees;
    return pool.length === 1 ? pool[0] : null;
  };

  // Heading-like elements that introduce a section or a repeated entry ("Work Experience 1").
  JAF.HEADING_SEL = 'h1, h2, h3, h4, h5, h6, [role="heading"], legend';

  // Headings that come before `el` in document order, nearest first. Walks up the
  // ancestors until one holds at least one preceding heading, so a field inside an
  // entry block sees "Education 1" before "Education".
  JAF.precedingHeadings = function (el, selector = JAF.HEADING_SEL, maxDepth = 12) {
    let node = el && el.parentElement;
    for (let depth = 0; node && depth < maxDepth; depth++) {
      if (node instanceof Element) {
        if (node.matches('body, html')) break;
        const hs = Array.from(node.querySelectorAll(selector))
          .filter((h) => h !== el && !h.contains(el) && !el.contains(h) && (h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING))
          .filter((h) => JAF.text(h));
        if (hs.length) return hs.reverse();
      }
      const root = node.getRootNode && node.getRootNode();
      node = node.parentElement || (root && root.host) || null;
    }
    return [];
  };

  JAF.log = (...a) => console.log('%c[ApplyPilot]', 'color:#1c3a4b;font-weight:bold', ...a);
})();
