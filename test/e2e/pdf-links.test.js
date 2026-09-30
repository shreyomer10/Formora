// Unit checks for reading hyperlink targets out of resume PDFs. Synthetic PDFs only.
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const path = require('node:path');
require(path.resolve(__dirname, '../../src/lib/pdf-links.js'));
const L = globalThis.FormoraPdfLinks;

// LaTeX-style layout: a page content stream first, then the link annotations inside a
// compressed object stream. The scanner must not treat "endstream" as a new stream.
function pdf(objects) {
  const parts = ['%PDF-1.5\n'];
  objects.forEach((o, i) => {
    if (o.stream) {
      const data = zlib.deflateSync(Buffer.from(o.stream, 'latin1'));
      parts.push(Buffer.from(`${i + 1} 0 obj\n<< ${o.dict || ''} /Filter /FlateDecode /Length ${data.length} >>\nstream\n`, 'latin1'), data, Buffer.from('\nendstream\nendobj\n'));
    } else parts.push(Buffer.from(`${i + 1} 0 obj\n${o.raw}\nendobj\n`, 'latin1'));
  });
  parts.push(Buffer.from('%%EOF\n'));
  return Buffer.concat(parts.map((p) => (Buffer.isBuffer(p) ? p : Buffer.from(p, 'latin1')))).toString('base64');
}

(async () => {
  const annots = [
    '<< /Type /Annot /Subtype /Link /A << /S /URI /URI (https://www.linkedin.com/in/asha-synthetic/) >> >>',
    '<< /A << /S /URI /URI (https://github.com/asha-synthetic) >> >>',
    '<< /A << /S /URI /URI (https://asha-synthetic.vercel.app/) >> >>',
    '<< /A << /S /URI /URI (https://codeforces.com/profile/asha_synthetic) >> >>',
    '<< /A << /S /URI /URI (https://www.codechef.com/users/asha_synthetic) >> >>',
    '<< /A << /S /URI /URI (https://leetcode.com/u/asha_synthetic/) >> >>',
    '<< /A << /S /URI /URI (https://github.com/asha-synthetic/chat) >> >>',
    '<< /A << /S /URI /URI (mailto:asha@example.invalid) >> >>',
  ].join('\n');
  const base64 = pdf([
    { stream: 'BT /F1 11 Tf (LinkedIn | GitHub | Portfolio) Tj ET' },
    { stream: 'BT (Codeforces | CodeChef | LeetCode) Tj ET' },
    { dict: '/Type /ObjStm /N 8 /First 40', stream: annots },
    { raw: '<< /URI (javascript:alert1) >>' },
    { raw: '<< /URI (https://x.example/a_(b)) /Hex <68> >>' },
  ]);
  const links = await L.extract(base64);
  assert.deepEqual(links.sort(), [
    'https://asha-synthetic.vercel.app/', 'https://codeforces.com/profile/asha_synthetic', 'https://github.com/asha-synthetic',
    'https://github.com/asha-synthetic/chat', 'https://leetcode.com/u/asha_synthetic/', 'https://www.codechef.com/users/asha_synthetic',
    'https://www.linkedin.com/in/asha-synthetic/', 'https://x.example/a_(b)', 'mailto:asha@example.invalid',
  ].sort());
  console.log('ok   links inside a compressed object stream after other streams are found');

  const { fields, extra } = L.classify(links);
  assert.deepEqual(fields, {
    linkedin: 'https://www.linkedin.com/in/asha-synthetic/', github: 'https://github.com/asha-synthetic',
    leetcode: 'https://leetcode.com/u/asha_synthetic/',
  });
  assert.deepEqual(extra, [
    { label: 'Codeforces profile', value: 'https://codeforces.com/profile/asha_synthetic' },
    { label: 'CodeChef profile', value: 'https://www.codechef.com/users/asha_synthetic' },
  ]);
  console.log('ok   LeetCode wins the coding-profile field; other judges become custom fields; repos are not the GitHub profile');

  // Two root-level personal links are ambiguous; one is the portfolio.
  assert.equal(L.classify(['https://asha-synthetic.vercel.app/', 'https://github.com/asha-synthetic/chat']).fields.portfolio, 'https://asha-synthetic.vercel.app/');
  assert.equal(L.classify(['https://a.example/', 'https://b.example/']).fields.portfolio, undefined);
  console.log('ok   a single personal site becomes the portfolio');
})().catch((e) => { console.error(e); process.exitCode = 1; });
