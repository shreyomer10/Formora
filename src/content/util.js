// Shared helpers for content scripts. Everything hangs off window.JAF.
(function () {
  const JAF = (window.JAF = window.JAF || {});

  JAF.sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  JAF.text = (el) => (el ? (el.innerText || el.textContent || '') : '').replace(/\s+/g, ' ').trim();

  JAF.isVisible = function (el) {
    if (!el || !el.isConnected) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    // Honeypots are usually pushed far off-screen.
    if (r.right < -1000 || r.bottom < -1000) return false;
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
    return bestScore >= 0.5 ? best : null;
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

  JAF.log = (...a) => console.log('%c[ApplyPilot]', 'color:#7c3aed;font-weight:bold', ...a);
})();
