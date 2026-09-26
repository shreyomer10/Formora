const $ = (id) => document.getElementById(id);
const profileInputs = () => Array.from(document.querySelectorAll('#profileGrid [data-k]'));
let setupComplete = false;
let hasResume = false;
let savedSettings = {};
let modelIds = [...FormoraModels.ids];

function updateSetup() {
  const steps = [!!$('apiKey').value.trim(), hasResume, !!$('resumeText').value.trim(), setupComplete];
  const current = steps.findIndex((done) => !done);
  document.querySelectorAll('#setupSteps li').forEach((li, i) => {
    li.dataset.done = String(steps[i]);
    if (i === current) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
  });
  $('setupHint').textContent = [
    'Start by adding your Gemini API key below. Test it before continuing.',
    'Choose your resume file below. PDF supports AI extraction.',
    'Extract your PDF with AI, or paste resume text and complete your profile manually.',
    'Review the extracted details, including your name and email, then click Save everything to finish setup.',
  ][current] || 'Setup complete. Open an application and click Fill page, or press Alt+Shift+F.';
  $('onboarding').hidden = setupComplete;
}

function modelOptions(select, selected) {
  select.replaceChildren(...modelIds.map((id) => {
    const option = new Option(id + (FormoraModels.ids.includes(id) ? '' : ' (previously saved; verify availability)'), id);
    option.selected = id === selected;
    return option;
  }));
}

function selectedFallbacks() { return [...$('fallbackModels').querySelectorAll('select')].map((s) => s.value); }
function refreshFallbackChoices() {
  const selected = [$('model').value, ...selectedFallbacks()];
  $('fallbackModels').querySelectorAll('select').forEach((s) => {
    [...s.options].forEach((o) => { o.disabled = o.value !== s.value && selected.includes(o.value); });
  });
  $('fallbackModels').querySelectorAll('[data-move-up]').forEach((b, i) => { b.disabled = i === 0; });
  $('addFallback').disabled = selectedFallbacks().length >= 2 || modelIds.every((id) => selected.includes(id));
}
function addFallback(id) {
  const row = document.createElement('div'); row.className = 'fallback-row';
  const select = document.createElement('select'); select.setAttribute('aria-label', 'Fallback model');
  modelOptions(select, id);
  select.onchange = refreshFallbackChoices;
  const remove = document.createElement('button'); remove.textContent = 'Remove'; remove.type = 'button';
  remove.onclick = () => { row.remove(); refreshFallbackChoices(); };
  const up = document.createElement('button'); up.type = 'button'; up.textContent = '↑';
  up.dataset.moveUp = ''; up.setAttribute('aria-label', 'Try this fallback earlier');
  up.onclick = () => { if (row.previousElementSibling) row.previousElementSibling.before(row); refreshFallbackChoices(); };
  row.append(select, remove, up); $('fallbackModels').append(row);
  refreshFallbackChoices();
}
$('addFallback').onclick = () => addFallback(modelIds.find((id) => ![$('model').value, ...selectedFallbacks()].includes(id)));
$('model').onchange = () => {
  [...$('fallbackModels').querySelectorAll('select')].forEach((s) => { if (s.value === $('model').value) s.parentElement.remove(); });
  refreshFallbackChoices();
};
$('apiKey').addEventListener('input', updateSetup);
$('resumeText').addEventListener('input', updateSetup);

// Repeatable profile sections. Each entry renders as a small grid of fields.
const LISTS = {
  workExperience: {
    el: 'workList',
    fields: [
      ['title', 'Job title'], ['company', 'Company'], ['location', 'Location'], ['employmentType', 'Employment type (Full-time / Internship)'],
      ['startDate', 'Start (YYYY-MM)'], ['endDate', 'End (YYYY-MM, blank if current)'], ['current', 'I currently work here', 'checkbox'],
      ['description', 'What you did (2-4 sentences)', 'textarea'],
    ],
  },
  education: {
    el: 'eduList',
    fields: [
      ['school', 'School / University'], ['degree', 'Degree (full name, e.g. Bachelor of Technology)'], ['field', 'Field of study'],
      ['startDate', 'Start (YYYY-MM)'], ['endDate', 'End / expected (YYYY-MM)'], ['gpa', 'GPA / percentage'],
    ],
  },
  certifications: {
    el: 'certList',
    fields: [['name', 'Certification'], ['issuer', 'Issuer'], ['number', 'Credential number'], ['issued', 'Issued (YYYY-MM)'], ['expires', 'Expires (YYYY-MM)']],
  },
};

function renderList(key, items) {
  const def = LISTS[key];
  const box = $(def.el);
  box.innerHTML = '';
  (items || []).forEach((item) => box.appendChild(entryNode(key, item)));
  if (!box.children.length) box.innerHTML = '<p class="muted">None yet.</p>';
}

function entryNode(key, item = {}) {
  const def = LISTS[key];
  const div = document.createElement('div');
  div.className = 'entry';
  const grid = document.createElement('div');
  grid.className = 'grid';
  for (const [f, label, kind] of def.fields) {
    const lab = document.createElement('label');
    if (kind === 'checkbox') {
      lab.className = 'check';
      const inp = document.createElement('input');
      inp.type = 'checkbox'; inp.dataset.f = f; inp.checked = item[f] === true || /^(yes|true)$/i.test(String(item[f] || ''));
      lab.appendChild(inp); lab.appendChild(document.createTextNode(label));
    } else {
      lab.textContent = label;
      const inp = document.createElement(kind === 'textarea' ? 'textarea' : 'input');
      inp.dataset.f = f; inp.value = item[f] == null ? '' : String(item[f]);
      if (kind === 'textarea') { inp.style.minHeight = '60px'; lab.classList.add('full'); }
      lab.appendChild(inp);
    }
    grid.appendChild(lab);
  }
  const rm = document.createElement('button');
  rm.className = 'remove'; rm.textContent = 'remove'; rm.type = 'button';
  rm.onclick = () => { const box = div.parentElement; div.remove(); if (!box.children.length) box.innerHTML = '<p class="muted">None yet.</p>'; };
  div.appendChild(grid); div.appendChild(rm);
  return div;
}

function readList(key) {
  const def = LISTS[key];
  return Array.from($(def.el).querySelectorAll('.entry')).map((div) => {
    const item = {};
    div.querySelectorAll('[data-f]').forEach((inp) => { item[inp.dataset.f] = inp.type === 'checkbox' ? inp.checked : inp.value.trim(); });
    return item;
  }).filter((item) => Object.values(item).some((v) => v && v !== false));
}

document.querySelectorAll('[data-add]').forEach((b) => {
  b.onclick = () => {
    const key = b.dataset.add;
    const box = $(LISTS[key].el);
    if (!box.querySelector('.entry')) box.innerHTML = '';
    box.appendChild(entryNode(key));
  };
});

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

async function load() {
  const { settings = {}, profile = {}, resume, memory = {}, stats, onboarding = {} } = await chrome.storage.local.get(['settings', 'profile', 'resume', 'memory', 'stats', 'onboarding']);
  savedSettings = settings;
  setupComplete = !!onboarding.completed;
  hasResume = !!resume;
  $('aiConsent').checked = settings.aiConsent === true;
  $('apiKey').value = settings.apiKey || '';
  const primary = /^gemini-/i.test(settings.model || '') ? settings.model : FormoraModels.primary;
  const fallbacks = FormoraModels.parse(settings.fallbackModels).filter((id) => id !== primary);
  modelIds = [...new Set([...FormoraModels.ids, primary, ...fallbacks])];
  modelOptions($('model'), primary);
  $('fallbackModels').replaceChildren();
  fallbacks.forEach(addFallback);
  refreshFallbackChoices();
  $('modelHint').textContent = `Catalog reviewed ${FormoraModels.reviewed}. Test all selected models after Gemini releases. Previously saved IDs are kept until you remove them.`;
  $('panelLayout').value = settings.panelLayout === 'sidebar' ? 'sidebar' : 'dialog';
  $('effort').value = settings.effort || 'medium';
  $('overwrite').checked = !!settings.overwrite;
  $('customInstructions').value = settings.customInstructions || '';
  profileInputs().forEach((el) => (el.value = profile[el.dataset.k] || ''));
  Object.keys(LISTS).forEach((k) => renderList(k, profile[k]));
  if (resume) {
    $('resumeInfo').textContent = `Stored: ${resume.fileName} (${Math.round((resume.base64.length * 3) / 4 / 1024)} KB)${resume.text ? ', text extracted' : ', no text yet'}`;
    $('resumeText').value = resume.text || '';
  }
  renderMemory(memory);
  updateSetup();
  if (stats) $('stats').textContent = `${stats.calls} API calls · ${stats.input.toLocaleString()} input tokens (${stats.cached.toLocaleString()} cached) · ${stats.output.toLocaleString()} output tokens`;
}

function renderMemory(memory) {
  const tb = $('memoryTable').querySelector('tbody');
  tb.innerHTML = '';
  const entries = Object.entries(memory).sort((a, b) => b[1].ts - a[1].ts);
  for (const [key, m] of entries) {
    const tr = document.createElement('tr');
    const answer = Array.isArray(m.answer) ? m.answer.join(', ') : m.answer;
    tr.innerHTML = `<td></td><td></td><td><button>delete</button></td>`;
    tr.children[0].textContent = m.label;
    tr.children[1].textContent = answer;
    tr.querySelector('button').onclick = async () => {
      delete memory[key];
      await chrome.storage.local.set({ memory });
      renderMemory(memory);
    };
    tb.appendChild(tr);
  }
  if (!entries.length) tb.innerHTML = '<tr><td colspan="3" class="muted">Empty.</td></tr>';
}

async function save(completeSetup = false) {
  const settings = {
    ...savedSettings,
    apiKey: $('apiKey').value.trim(),
    aiConsent: $('aiConsent').checked,
    model: $('model').value.trim() || 'gemini-3.8-flash',
    fallbackModels: selectedFallbacks(),
    panelLayout: $('panelLayout').value,
    effort: $('effort').value,
    overwrite: $('overwrite').checked,
    customInstructions: $('customInstructions').value.trim(),
  };
  const profile = {};
  profileInputs().forEach((el) => (profile[el.dataset.k] = el.value.trim()));
  Object.keys(LISTS).forEach((k) => (profile[k] = readList(k)));
  const { resume } = await chrome.storage.local.get(['resume']);
  const patch = { settings, profile };
  if (resume) patch.resume = { ...resume, text: $('resumeText').value };
  if (completeSetup && settings.apiKey && resume && $('resumeText').value.trim() && (profile.firstName || profile.fullName) && profile.email) {
    patch.onboarding = { completed: true, completedAt: Date.now() };
    setupComplete = true;
  }
  await chrome.storage.local.set(patch);
  savedSettings = settings;
  updateSetup();
  $('saveMsg').textContent = 'Saved.';
  setTimeout(() => ($('saveMsg').textContent = ''), 2000);
}

$('save').onclick = () => save(true).catch((e) => { $('saveMsg').textContent = e.message; });

$('resumeFile').onchange = async () => {
  const f = $('resumeFile').files[0];
  if (!f) return;
  try {
    if (f.size > FormoraSecurity.maxResumeBytes) throw new Error('Choose a resume of 4 MB or less. Your previous resume is unchanged.');
    const base64 = await fileToBase64(f);
    const mimeType = f.type || (f.name.endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream');
    await chrome.storage.local.set({ resume: { fileName: f.name, mimeType, base64, text: '' } });
    hasResume = true;
    $('resumeText').value = '';
    $('resumeInfo').textContent = `Stored: ${f.name} (${Math.round(f.size / 1024)} KB), no text yet`;
    $('resumeMsg').textContent = 'Resume stored. Now click extract (PDF) or paste the text.';
    updateSetup();
  } catch (e) { $('resumeMsg').textContent = 'Could not store resume: ' + e.message; }
};

$('extract').onclick = async () => {
  $('extract').disabled = true;
  try {
    await save();
    const { resume } = await chrome.storage.local.get(['resume']);
    if (!resume) { $('resumeMsg').textContent = 'Choose a resume file first.'; return; }
    $('resumeMsg').textContent = 'Reading resume with Gemini...';
    const resp = await chrome.runtime.sendMessage({ type: 'EXTRACT_PROFILE', payload: { base64: resume.base64, mimeType: resume.mimeType } });
    if (!resp.ok) { $('resumeMsg').textContent = 'Failed: ' + resp.error; return; }
    const { resumeText, profile } = resp.data;
    $('resumeText').value = resumeText;
    profileInputs().forEach((el) => {
      const v = profile[el.dataset.k];
      if (v && !el.value) el.value = v;
    });
    Object.keys(LISTS).forEach((k) => {
      // Only replace a list the user has not filled in by hand.
      if (Array.isArray(profile[k]) && profile[k].length && !readList(k).length) renderList(k, profile[k]);
    });
    $('resumeMsg').textContent = 'Done. Review the profile fields below and save.';
    updateSetup();
  } catch (e) { $('resumeMsg').textContent = 'Failed: ' + e.message; }
  finally { $('extract').disabled = false; }
};

$('testKey').onclick = async () => {
  $('testKey').disabled = true;
  try {
    await save();
    $('keyMsg').textContent = 'Testing...';
    const resp = await chrome.runtime.sendMessage({ type: 'TEST_KEY' });
    $('keyMsg').textContent = resp.ok ? `Works (model replied: ${resp.data.trim()})` : 'Failed: ' + resp.error;
  } catch (e) { $('keyMsg').textContent = 'Failed: ' + e.message; }
  finally { $('testKey').disabled = false; }
};

$('testModels').onclick = async () => {
  $('testModels').disabled = true;
  $('modelResults').textContent = 'Testing each selected model…';
  try {
    await save();
    const resp = await chrome.runtime.sendMessage({ type: 'TEST_MODELS' });
    $('modelResults').textContent = resp.ok
      ? resp.results.map((r) => `${r.model}: ${r.ok ? 'Available' : 'Failed — ' + r.error}`).join('\n')
      : 'Failed: ' + resp.error;
  } catch (e) { $('modelResults').textContent = 'Failed: ' + e.message; }
  finally { $('testModels').disabled = false; }
};

$('clearMemory').onclick = async () => {
  if (!confirm('Delete all remembered answers?')) return;
  await chrome.storage.local.set({ memory: {} });
  renderMemory({});
};

load();
