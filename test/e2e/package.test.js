// Verify the exact distribution artifact and smoke-test it in Chrome via security.test.js.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'pack.ps1')], { cwd: root, stdio: 'inherit' });
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const zip = path.join(root, 'dist', `formora-${manifest.version}.zip`);
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'formora-package-'));
try {
  // Paths are supplied through environment variables, not interpolated into shell code.
  execFileSync('powershell.exe', ['-NoProfile', '-Command', 'Expand-Archive -LiteralPath $env:FORMORA_PACKAGE_ZIP -DestinationPath $env:FORMORA_PACKAGE_STAGE'], { env: { ...process.env, FORMORA_PACKAGE_ZIP: zip, FORMORA_PACKAGE_STAGE: stage } });
  const files = fs.readdirSync(stage);
  assert.deepEqual(files.sort(), ['icons', 'manifest.json', 'privacy.html', 'src']);
  for (const filename of ['privacy.html', 'src/options/options.html', 'src/background/service-worker.js', ...manifest.content_scripts[0].js, ...Object.values(manifest.icons)]) assert(fs.statSync(path.join(stage, filename)).isFile(), filename);
  for (const filename of fs.readdirSync(path.join(stage, 'src'), { recursive: true })) {
    if (!filename.endsWith('.html')) continue;
    const absolute = path.join(stage, 'src', filename);
    const html = fs.readFileSync(absolute, 'utf8');
    for (const [, reference] of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
      if (/^[a-z]+:/i.test(reference)) continue;
      assert(fs.existsSync(path.resolve(path.dirname(absolute), reference)), `Missing packaged link: ${filename} -> ${reference}`);
    }
  }
  assert.equal(manifest.content_scripts[0].all_frames, false);
  assert(!manifest.content_scripts[0].matches.includes('http://*/*'));
  assert.match(manifest.content_security_policy.extension_pages, /connect-src https:\/\/generativelanguage.googleapis.com/);
  console.log('PASS packaging: bundled privacy, runtime links, manifest scope and CSP');
  const result = spawnSync(process.execPath, [path.join(__dirname, 'security.test.js')], { env: { ...process.env, FORMORA_TEST_EXT: stage }, stdio: 'inherit' });
  assert.equal(result.status, 0, 'Packaged extension browser regressions must pass');
} finally {
  // This exact directory is created by mkdtemp above; never remove a computed repo path.
  const resolved = fs.realpathSync(stage), tmp = fs.realpathSync(os.tmpdir());
  assert.equal(path.dirname(resolved).toLowerCase(), tmp.toLowerCase());
  assert(path.basename(resolved).startsWith('formora-package-'));
  fs.rmSync(resolved, { recursive: true, force: true });
}
