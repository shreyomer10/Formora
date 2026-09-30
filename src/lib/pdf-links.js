// Hyperlinks in a PDF ("LinkedIn" as clickable text) live in link annotations (/URI),
// which the model's document reader does not see. Read them from the raw bytes,
// inflating compressed object streams where annotations are often stored.
globalThis.FormoraPdfLinks = (function () {
  const MAX_STREAMS = 400;
  const MAX_STREAM_BYTES = 2 * 1024 * 1024;

  function latin1(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return s;
  }

  // Streams end with a stray EOL before "endstream", which DecompressionStream reports
  // as trailing junk. Keep whatever inflated before that.
  async function inflate(bytes) {
    const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
    const chunks = []; let size = 0;
    try {
      while (size < MAX_STREAM_BYTES * 4) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value); size += value.length;
      }
    } catch { /* trailing bytes or a damaged stream */ }
    const out = new Uint8Array(size); let offset = 0;
    for (const c of chunks) { out.set(c, offset); offset += c.length; }
    return out;
  }

  function pdfString(raw) {
    let s = raw.replace(/\\(\r\n|\r|\n)/g, '').replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, c) => {
      if (/^[0-7]+$/.test(c)) return String.fromCharCode(parseInt(c, 8));
      return { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' }[c] ?? c;
    });
    if (s.startsWith('\xfe\xff')) {
      let u = '';
      for (let i = 2; i + 1 < s.length; i += 2) u += String.fromCharCode((s.charCodeAt(i) << 8) | s.charCodeAt(i + 1));
      s = u;
    }
    return s;
  }

  function hexString(hex) {
    const h = hex.replace(/\s+/g, '');
    let s = '';
    for (let i = 0; i + 1 < h.length; i += 2) s += String.fromCharCode(parseInt(h.slice(i, i + 2), 16));
    return pdfString(s.replace(/\\/g, '\\\\'));
  }

  // Literal strings may hold balanced unescaped parentheses: "(https://x.com/a_(b))".
  function literalAt(text, open) {
    let depth = 0;
    for (let i = open; i < text.length && i - open < 2000; i++) {
      const c = text[i];
      if (c === '\\') { i++; continue; }
      if (c === '(') depth++;
      else if (c === ')' && --depth === 0) return text.slice(open + 1, i);
    }
    return '';
  }

  function urisIn(text, found) {
    for (const m of text.matchAll(/\/URI\s*\(/g)) found.add(pdfString(literalAt(text, m.index + m[0].length - 1)));
    for (const m of text.matchAll(/\/URI\s*<([0-9A-Fa-f\s]*)>/g)) found.add(hexString(m[1]));
  }

  function clean(uri) {
    let u = String(uri || '').trim();
    if (/^www\./i.test(u)) u = 'https://' + u;
    if (!/^(https?:\/\/|mailto:)/i.test(u) || u.length > 500 || /[\s<>"]/.test(u)) return '';
    return u;
  }

  // base64 PDF -> unique http(s)/mailto link targets, in document order.
  async function extract(base64) {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const raw = latin1(bytes);
    const found = new Set();
    urisIn(raw, found);
    // "stream" must not be the tail of "endstream": matching there would skip the next real stream.
    const re = /(?<![a-z])stream\r?\n/g;
    let m, streams = 0;
    while ((m = re.exec(raw)) && streams < MAX_STREAMS) {
      const start = m.index + m[0].length;
      const end = raw.indexOf('endstream', start);
      if (end < 0) break;
      re.lastIndex = end + 'endstream'.length;
      if (end - start > MAX_STREAM_BYTES) continue;
      // Only Flate-compressed non-binary streams can hold annotation dictionaries.
      const dict = raw.slice(Math.max(0, m.index - 1000), m.index).split(/endobj|endstream/).pop();
      if (!/FlateDecode/.test(dict) || /\/Subtype\s*\/Image|\/Length[123]\b|\/DecodeParms/.test(dict)) continue;
      streams++;
      urisIn(latin1(await inflate(bytes.subarray(start, end))), found);
    }
    return [...found].map(clean).filter(Boolean).filter((u, i, a) => a.indexOf(u) === i).slice(0, 50);
  }

  // Profile sites. `key` is a profile field; the rest become custom fields named after the site.
  const SITES = [
    { host: /(^|\.)linkedin\.com$/i, key: 'linkedin' },
    { host: /(^|\.)leetcode\.(com|cn)$/i, key: 'leetcode', label: 'LeetCode profile' },
    { host: /(^|\.)codeforces\.com$/i, label: 'Codeforces profile' },
    { host: /(^|\.)codechef\.com$/i, label: 'CodeChef profile' },
    { host: /(^|\.)hackerrank\.com$/i, label: 'HackerRank profile' },
    { host: /(^|\.)hackerearth\.com$/i, label: 'HackerEarth profile' },
    { host: /(^|\.)atcoder\.jp$/i, label: 'AtCoder profile' },
    { host: /(^|\.)geeksforgeeks\.org$/i, label: 'GeeksforGeeks profile' },
    { host: /(^|\.)kaggle\.com$/i, label: 'Kaggle profile' },
    { host: /(^|\.)stackoverflow\.com$/i, label: 'Stack Overflow profile' },
    { host: /(^|\.)medium\.com$/i, label: 'Medium profile' },
    { host: /(^|\.)(twitter|x)\.com$/i, label: 'Twitter / X profile' },
    { host: /(^|\.)behance\.net$/i, label: 'Behance profile' },
    { host: /(^|\.)dribbble\.com$/i, label: 'Dribbble profile' },
  ];
  // Hosts that serve documents or other people's pages rather than the candidate's own site.
  const NOT_PORTFOLIO = /(^|\.)(github\.com|gitlab\.com|bitbucket\.org|google\.com|youtube\.com|youtu\.be|drive\.google\.com|docs\.google\.com|coursera\.org|udemy\.com|credly\.com|wikipedia\.org)$/i;

  // -> { fields: {linkedin, github, leetcode, portfolio}, extra: [{label, value}] }
  function classify(links) {
    const fields = {}, extra = [], others = [];
    for (const link of links) {
      let u;
      try { u = new URL(link); } catch { continue; }
      if (!/^https?:$/.test(u.protocol)) continue;
      const path = u.pathname.split('/').filter(Boolean);
      // github.com/<user> is the profile; github.com/<user>/<repo> is a project.
      if (/(^|\.)github\.com$/i.test(u.hostname)) { if (path.length === 1 && !fields.github) fields.github = link; continue; }
      const site = SITES.find((s) => s.host.test(u.hostname));
      if (site) {
        if (site.key && !fields[site.key]) fields[site.key] = link;
        else if (site.label && !extra.some((e) => e.label === site.label)) extra.push({ label: site.label, value: link });
        continue;
      }
      if (!NOT_PORTFOLIO.test(u.hostname)) others.push({ link, depth: path.length });
    }
    // A personal site is usually linked at its root; one such link is the portfolio.
    const roots = others.filter((o) => o.depth <= 1);
    if (roots.length === 1) fields.portfolio = roots[0].link;
    return { fields, extra };
  }

  return { extract, classify };
})();
