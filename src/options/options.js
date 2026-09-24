const $ = (id) => document.getElementById(id);
const profileInputs = () => Array.from(document.querySelectorAll('#profileGrid [data-k]'));

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
  const { settings = {}, profile = {}, resume, memory = {}, stats } = await chrome.storage.local.get(['settings', 'profile', 'resume', 'memory', 'stats']);
  $('apiKey').value = settings.apiKey || '';
  $('model').value = /^gemini-/i.test(settings.model || '') ? settings.model : 'gemini-3.8-flash';
  $('fallbackModels').value = settings.fallbackModels == null ? 'gemini-3.5-flash-lite, gemini-3.1-pro-preview' : settings.fallbackModels;
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

async function save() {
  const settings = {
    apiKey: $('apiKey').value.trim(),
    model: $('model').value.trim() || 'gemini-3.8-flash',
    fallbackModels: $('fallbackModels').value.trim(),
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
  await chrome.storage.local.set(patch);
  $('saveMsg').textContent = 'Saved.';
  setTimeout(() => ($('saveMsg').textContent = ''), 2000);
}

$('save').onclick = save;

$('resumeFile').onchange = async () => {
  const f = $('resumeFile').files[0];
  if (!f) return;
  const base64 = await fileToBase64(f);
  const { resume } = await chrome.storage.local.get(['resume']);
  const mimeType = f.type || (f.name.endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream');
  await chrome.storage.local.set({ resume: { fileName: f.name, mimeType, base64, text: resume && resume.text ? resume.text : '' } });
  $('resumeMsg').textContent = 'Resume stored. Now click extract (PDF) or paste the text.';
  load();
};

$('extract').onclick = async () => {
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
  await save();
  $('resumeMsg').textContent = 'Done. Review the profile fields below and save.';
  load();
};

$('testKey').onclick = async () => {
  await save();
  $('keyMsg').textContent = 'Testing...';
  const resp = await chrome.runtime.sendMessage({ type: 'TEST_KEY' });
  $('keyMsg').textContent = resp.ok ? `Works (model replied: ${resp.data.trim()})` : 'Failed: ' + resp.error;
};

$('clearMemory').onclick = async () => {
  if (!confirm('Delete all remembered answers?')) return;
  await chrome.storage.local.set({ memory: {} });
  renderMemory({});
};

load();
