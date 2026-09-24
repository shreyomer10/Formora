// Service worker: owns every Gemini API call so the API key never touches page context.
// Raw fetch is used because this is a no-build extension (no npm SDK available).
// Uses the Gemini Interactions API (generateContent is marked legacy).

const API_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const DEFAULT_MODEL = 'gemini-3.8-flash';
// Tried in order when the chosen model is overloaded (503), rate limited (429) or down (5xx).
const DEFAULT_FALLBACKS = ['gemini-3.5-flash-lite', 'gemini-3.1-pro-preview'];
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const FILL_SCHEMA = {
  type: 'object',
  properties: {
    answers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          value: { type: 'string', description: 'Answer text, or the chosen option verbatim. Empty string when skip is true.' },
          values: { type: 'array', items: { type: 'string' }, description: 'For checkbox questions: every option to tick, verbatim. Otherwise empty.' },
          skip: { type: 'boolean', description: 'true when no grounded answer is possible from the candidate data.' },
          note: { type: 'string', description: 'Very short reason when skip is true, else empty.' },
        },
        required: ['id', 'value', 'values', 'skip', 'note'],
        additionalProperties: false,
      },
    },
  },
  required: ['answers'],
  additionalProperties: false,
};

const WORK_ITEM = {
  type: 'object',
  properties: {
    title: { type: 'string' }, company: { type: 'string' }, location: { type: 'string' },
    startDate: { type: 'string', description: 'YYYY-MM' }, endDate: { type: 'string', description: 'YYYY-MM, empty when current' },
    current: { type: 'boolean' }, description: { type: 'string', description: '2-4 plain sentences of what was done, from the resume' },
  },
  required: ['title', 'company', 'location', 'startDate', 'endDate', 'current', 'description'],
  additionalProperties: false,
};
const EDU_ITEM = {
  type: 'object',
  properties: {
    school: { type: 'string' }, degree: { type: 'string', description: 'Full degree name, e.g. Bachelor of Technology' }, field: { type: 'string' },
    startDate: { type: 'string', description: 'YYYY-MM or YYYY' }, endDate: { type: 'string', description: 'YYYY-MM or YYYY (expected if ongoing)' }, gpa: { type: 'string' },
  },
  required: ['school', 'degree', 'field', 'startDate', 'endDate', 'gpa'],
  additionalProperties: false,
};
const CERT_ITEM = {
  type: 'object',
  properties: { name: { type: 'string' }, issuer: { type: 'string' }, number: { type: 'string' }, issued: { type: 'string', description: 'YYYY-MM' }, expires: { type: 'string' } },
  required: ['name', 'issuer', 'number', 'issued', 'expires'],
  additionalProperties: false,
};

const PROFILE_SCHEMA = {
  type: 'object',
  properties: {
    resumeText: { type: 'string', description: 'The complete plain text of the resume, all sections, nothing summarized.' },
    profile: {
      type: 'object',
      properties: {
        firstName: { type: 'string' }, lastName: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string' },
        city: { type: 'string' }, state: { type: 'string' }, country: { type: 'string' },
        linkedin: { type: 'string' }, github: { type: 'string' }, portfolio: { type: 'string' },
        currentCompany: { type: 'string' }, currentTitle: { type: 'string' }, totalExperienceYears: { type: 'string' },
        skills: { type: 'string', description: 'Comma separated' },
        college: { type: 'string' }, degree: { type: 'string' }, branch: { type: 'string' }, graduationYear: { type: 'string' }, cgpa: { type: 'string' },
        tenthPercentage: { type: 'string', description: 'Class 10 / SSC / matriculation result as written, e.g. "92%" or "9.2 CGPA"' },
        twelfthPercentage: { type: 'string', description: 'Class 12 / HSC / intermediate result as written' },
        rollNumber: { type: 'string', description: 'College roll / enrollment number if printed' },
        workExperience: { type: 'array', items: WORK_ITEM, description: 'Most recent first. Internships count.' },
        education: { type: 'array', items: EDU_ITEM, description: 'Most recent first.' },
        certifications: { type: 'array', items: CERT_ITEM },
      },
      required: ['firstName', 'lastName', 'email', 'phone', 'city', 'state', 'country', 'linkedin', 'github', 'portfolio', 'currentCompany', 'currentTitle', 'totalExperienceYears', 'skills', 'college', 'degree', 'branch', 'graduationYear', 'cgpa', 'tenthPercentage', 'twelfthPercentage', 'rollNumber', 'workExperience', 'education', 'certifications'],
      additionalProperties: false,
    },
  },
  required: ['resumeText', 'profile'],
  additionalProperties: false,
};

const FILL_SYSTEM = `You fill job application forms on behalf of a candidate. You get the candidate's profile, resume, previous answers, the page context, and a list of unanswered questions. Return one entry per question id.

Choosing options:
- "select", "radio": put exactly one option in "value", copied character for character from the options list. Never write text that is not in the list. Pick the option that matches the candidate's facts; if nothing fits and the question is required, pick the most reasonable or neutral option.
- "combobox" with options: the list is what the dropdown showed when opened and may be incomplete (optionsPartial). If an option fits, copy it verbatim. If none fits, give the short value most likely to appear in such a list (a country, city, university, degree name, dial code).
- "combobox" with no options: the short value as above.
- "combobox" with multi=true (skills, technologies): give a comma separated list in "value"; each item is typed and picked from the site's suggestions, so use common short names ("Python", "Docker", "REST APIs").
- "checkbox": put every applicable option in "values", one array element per option, each copied verbatim. Never join several options into one string. Leave "value" empty. For a single consent checkbox ("I agree...", "I confirm...") tick it.
- "text", "textarea", "number", "date", "email", "tel", "url": write the answer in "value". Dates as YYYY-MM-DD. Numbers as plain digits. Respect maxLength.

Writing free-text answers:
- Sound like a real person typing into a form, not like generated marketing copy. Plain words, first person, direct. Contractions are fine.
- Lead with the concrete fact: what was built, which stack, what it did, what came out of it. Pull specifics (project names, technologies, numbers, dates) from the resume.
- Grounded ONLY in the profile and resume. Never invent employers, degrees, dates, numbers or certifications.
- Length: 1-3 sentences for ordinary questions. Go up to ~150 words only when the question clearly asks for a paragraph, essay or cover letter.
- Avoid buzzwords and filler: "passionate", "leverage", "synergy", "dynamic", "cutting-edge", "fast-paced", "I am excited to", "I believe I would be a great fit", "aligns with my values". Do not open by restating the question. No greetings, sign-offs, quotes, bullet points, markdown or em dashes.
- Vary sentence length. Do not start every sentence with "I".

Other rules:
- "section" is the heading the field sits under; "entry" {kind, index} means the field belongs to the index-th block of a repeated section (Work Experience 2 = profile.workExperience[1], Education 1 = profile.education[0], Certifications 1 = profile.certifications[0]). Answer such fields from that exact entry, never from another one.
- Yes/no and eligibility questions (relocation, work authorisation, notice period, salary): answer from the profile facts. If the profile is silent, pick the answer most favourable to the candidate that is still plausible, unless it is a legal attestation, in which case skip.
- Skip (skip=true) only when the answer needs information you do not have (a reference's name, a code you must receive, a specific ID number).
- Marks, percentages, CGPA, roll numbers, dates and salaries are facts: copy them from the profile or resume, never estimate or reuse a different number (a graduation CGPA is not a 10th or 12th percentage). If the exact figure is absent, skip.
- Write in the language the question is written in.`;

function buildCandidateBlock({ profile, resume, settings }) {
  const p = { ...profile };
  return [
    '## Candidate profile (JSON)',
    JSON.stringify(p, null, 1),
    '',
    '## Resume text',
    (resume && resume.text) || '(no resume text stored)',
    '',
    settings.customInstructions ? `## Candidate's own instructions\n${settings.customInstructions}` : '',
  ].join('\n');
}

// Settings saved by an older build may still hold a non-Gemini model id.
function modelFor(settings) {
  const m = (settings.model || '').trim();
  return /^gemini-/i.test(m) ? m : DEFAULT_MODEL;
}

function jsonFormat(schema) {
  return { type: 'text', mime_type: 'application/json', schema };
}

// Pull the model's text out of an Interactions response.
function extractText(data) {
  if (typeof data.output_text === 'string' && data.output_text) return data.output_text;
  const steps = Array.isArray(data.steps) ? data.steps : [];
  return steps
    .filter((s) => s.type === 'model_output')
    .flatMap((s) => (Array.isArray(s.content) ? s.content : []))
    .filter((c) => c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join('');
}

async function callGemini(body, settings) {
  const headers = {
    'content-type': 'application/json',
    'x-goog-api-key': settings.apiKey,
  };
  const req = { store: false, ...body };
  let res;
  try {
    res = await fetch(API_URL, { method: 'POST', headers, body: JSON.stringify(req) });
  } catch (e) {
    const err = new Error(`Network error: ${e.message}`);
    err.retryable = true;
    throw err;
  }
  if (!res.ok) {
    const t = await res.text();
    let msg = t;
    try {
      msg = JSON.parse(t).error?.message || t;
    } catch {
      // plain text error body
    }
    const err = new Error(`API ${res.status}: ${String(msg).slice(0, 300)}`);
    err.retryable = RETRYABLE.has(res.status);
    throw err;
  }
  const data = await res.json();
  if (data.status === 'failed' || data.status === 'cancelled') {
    const err = (data.errors || [])[0];
    throw new Error(`Model request ${data.status}${err && err.message ? `: ${err.message}` : ''}.`);
  }
  if (data.status === 'incomplete') throw new Error('Response was cut off (max_output_tokens).');
  const text = extractText(data);
  if (!text) throw new Error(`Model returned no text (status: ${data.status || 'unknown'}).`);
  return { text, usage: data.usage, model: data.model };
}

function fallbackModels(settings) {
  const raw = typeof settings.fallbackModels === 'string' ? settings.fallbackModels : DEFAULT_FALLBACKS.join(', ');
  return raw.split(/[,\s]+/).map((m) => m.trim()).filter((m) => /^gemini-/i.test(m));
}

// Try the chosen model (twice, the second time after a pause), then each fallback model once.
// Only overload / rate-limit / server / network errors move on; bad requests fail immediately.
async function callWithFallback(body, settings) {
  const primary = modelFor(settings);
  const chain = [primary, ...fallbackModels(settings).filter((m) => m !== primary)];
  const tried = [];
  for (let i = 0; i < chain.length; i++) {
    const model = chain[i];
    const attempts = i === 0 ? 2 : 1;
    for (let a = 0; a < attempts; a++) {
      try {
        const r = await callGemini({ ...body, model }, settings);
        const fallbackNote = tried.length ? `${primary} failed (${tried[0].split(': ').slice(1).join(': ').slice(0, 80)}); answered by ${model}` : '';
        return { ...r, model, fallbackNote };
      } catch (e) {
        if (!e.retryable) throw e;
        tried.push(`${model}: ${e.message}`);
        await sleep(a === 0 ? 1200 : 2500);
      }
    }
  }
  throw new Error(`All models busy or failing. ${tried.join(' | ')}`.slice(0, 600));
}

async function llmFill(payload) {
  const { profile = {}, resume = null, settings = {} } = await chrome.storage.local.get(['profile', 'resume', 'settings']);
  if (!settings.apiKey) throw new Error('No API key. Open the extension options.');
  const body = {
    model: modelFor(settings),
    // Static instructions first, candidate data second, so the shared prefix is
    // identical across applications and Gemini's implicit caching can reuse it.
    system_instruction: `${FILL_SYSTEM}\n\n${buildCandidateBlock({ profile, resume, settings })}`,
    input: JSON.stringify(
      {
        page: payload.page,
        previousAnswers: payload.previousAnswers || [],
        questions: payload.questions,
      },
      null,
      1
    ),
    generation_config: {
      thinking_level: settings.effort || 'medium',
      max_output_tokens: 16000,
    },
    response_format: jsonFormat(FILL_SCHEMA),
  };
  const { text, usage, model, fallbackNote } = await callWithFallback(body, settings);
  const parsed = JSON.parse(text);
  await bumpUsage(usage);
  return { answers: parsed.answers || [], model, fallbackNote };
}

async function extractProfile({ base64, mimeType }) {
  const { settings = {} } = await chrome.storage.local.get(['settings']);
  if (!settings.apiKey) throw new Error('No API key. Save it first.');
  if (mimeType !== 'application/pdf') throw new Error('AI extraction supports PDF resumes. Paste the resume text manually for other formats.');
  const body = {
    model: modelFor(settings),
    input: [
      { type: 'document', mime_type: 'application/pdf', data: base64 },
      { type: 'text', text: 'Extract the full plain text of this resume and the candidate profile fields. Leave a field as an empty string if the resume does not state it. totalExperienceYears is a number as a string, e.g. "2.5" (estimate from work history; "0" for freshers). Fill workExperience (jobs and internships, most recent first), education and certifications as structured lists with dates as YYYY-MM where the resume gives a month, else YYYY. Set college/degree/branch/graduationYear/cgpa from the most recent education entry.' },
    ],
    generation_config: { thinking_level: 'medium', max_output_tokens: 16000 },
    response_format: jsonFormat(PROFILE_SCHEMA),
  };
  const { text, usage } = await callWithFallback(body, settings);
  await bumpUsage(usage);
  return JSON.parse(text);
}

async function bumpUsage(usage) {
  if (!usage) return;
  const { stats = { calls: 0, input: 0, output: 0, cached: 0 } } = await chrome.storage.local.get(['stats']);
  stats.calls += 1;
  stats.input += usage.total_input_tokens || 0;
  stats.output += (usage.total_output_tokens || 0) + (usage.total_thought_tokens || 0);
  stats.cached += usage.total_cached_tokens || 0;
  await chrome.storage.local.set({ stats });
}

// Chrome has no light/dark variants for action icons. Pages and the popup report the browser's
// colour scheme; on dark toolbars the slate square vanishes, so the white glyph alone is used there.
const ICONS = (dark) => Object.fromEntries([16, 32, 48, 128].map((n) => [n, `icons/${dark ? 'dark/' : ''}icon${n}.png`]));
let iconDark = null;
async function setToolbarIcon(dark) {
  if (iconDark === dark) return;
  iconDark = dark;
  try { await chrome.action.setIcon({ path: ICONS(dark) }); } catch { /* action API unavailable */ }
}
chrome.storage.local.get(['ui']).then(({ ui }) => { if (ui && typeof ui.dark === 'boolean') setToolbarIcon(ui.dark); });

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === 'COLOR_SCHEME') { await setToolbarIcon(!!msg.dark); sendResponse({ ok: true }); }
      else if (msg.type === 'LLM_FILL') sendResponse({ ok: true, ...(await llmFill(msg.payload)) });
      else if (msg.type === 'EXTRACT_PROFILE') sendResponse({ ok: true, data: await extractProfile(msg.payload) });
      else if (msg.type === 'TEST_KEY') {
        const { settings = {} } = await chrome.storage.local.get(['settings']);
        const r = await callGemini(
          {
            model: modelFor(settings),
            input: 'Reply with the single word OK.',
            generation_config: { thinking_level: 'low', max_output_tokens: 1024 },
          },
          settings
        );
        sendResponse({ ok: true, data: r.text });
      } else sendResponse({ ok: false, error: 'unknown message' });
    } catch (e) {
      sendResponse({ ok: false, error: e.message });
    }
  })();
  return true;
});

async function sendToActiveTab(type) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type });
  } catch {
    // Content script not present (page loaded before install). Inject on demand.
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      files: ['src/lib/rules.js', 'src/content/util.js', 'src/content/extractor.js', 'src/content/sections.js', 'src/content/gforms.js', 'src/content/filler.js', 'src/content/overlay.js', 'src/content/main.js'],
    });
    await chrome.scripting.insertCSS({ target: { tabId: tab.id, allFrames: true }, files: ['src/content/overlay.css'] });
    await chrome.tabs.sendMessage(tab.id, { type });
  }
}

chrome.commands.onCommand.addListener((cmd) => {
  if (cmd === 'fill-page') sendToActiveTab('FILL_PAGE');
});
