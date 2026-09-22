// Service worker: owns every Gemini API call so the API key never touches page context.
// Raw fetch is used because this is a no-build extension (no npm SDK available).
// Uses the Gemini Interactions API (generateContent is marked legacy).

const API_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const DEFAULT_MODEL = 'gemini-3.8-flash';

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
      },
      required: ['firstName', 'lastName', 'email', 'phone', 'city', 'state', 'country', 'linkedin', 'github', 'portfolio', 'currentCompany', 'currentTitle', 'totalExperienceYears', 'skills', 'college', 'degree', 'branch', 'graduationYear', 'cgpa'],
      additionalProperties: false,
    },
  },
  required: ['resumeText', 'profile'],
  additionalProperties: false,
};

const FILL_SYSTEM = `You fill job application forms on behalf of a candidate. You get the candidate's profile, resume, previous answers, the page context, and a list of unanswered questions. Return one entry per question id.

Rules:
- "select", "radio", "combobox" with options: put exactly one option in "value", copied verbatim from the options list. Choose the option that best matches the candidate's facts. If nothing fits and the question is required, choose the most reasonable/neutral option.
- "combobox" with no options listed: return the most likely short value (e.g. a city or country name) in "value".
- "checkbox": put every applicable option, verbatim, in "values" and leave "value" empty. For a single consent checkbox ("I agree...", "I confirm...") tick it.
- "text", "textarea", "number", "date", "email", "tel", "url": write the answer in "value". Dates as YYYY-MM-DD. Numbers as plain digits.
- Open-ended answers: first person, specific, confident, grounded ONLY in the profile and resume. Never invent employers, degrees, dates, numbers or certifications. Default to 1-3 sentences; up to ~150 words only when the question clearly asks for a paragraph or cover letter. Respect maxLength when given.
- Yes/no and eligibility questions (relocation, work authorisation, notice period, salary): answer from the profile facts. If the profile is silent, pick the answer most favourable to the candidate that is still plausible, unless it is a legal attestation, in which case skip.
- Skip (skip=true) only when the answer needs information you do not have (a reference's name, a code you must receive, a specific ID number).
- Write in the language the question is written in. Do not add greetings, sign-offs, quotes, or markdown.`;

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
  const res = await fetch(API_URL, { method: 'POST', headers, body: JSON.stringify(req) });
  if (!res.ok) {
    const t = await res.text();
    let msg = t;
    try {
      msg = JSON.parse(t).error?.message || t;
    } catch {
      // plain text error body
    }
    throw new Error(`API ${res.status}: ${String(msg).slice(0, 300)}`);
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
  const { text, usage } = await callGemini(body, settings);
  const parsed = JSON.parse(text);
  await bumpUsage(usage);
  return parsed.answers || [];
}

async function extractProfile({ base64, mimeType }) {
  const { settings = {} } = await chrome.storage.local.get(['settings']);
  if (!settings.apiKey) throw new Error('No API key. Save it first.');
  if (mimeType !== 'application/pdf') throw new Error('AI extraction supports PDF resumes. Paste the resume text manually for other formats.');
  const body = {
    model: modelFor(settings),
    input: [
      { type: 'document', mime_type: 'application/pdf', data: base64 },
      { type: 'text', text: 'Extract the full plain text of this resume and the candidate profile fields. Leave a field as an empty string if the resume does not state it. totalExperienceYears is a number as a string, e.g. "2.5" (estimate from work history; "0" for freshers).' },
    ],
    generation_config: { thinking_level: 'medium', max_output_tokens: 16000 },
    response_format: jsonFormat(PROFILE_SCHEMA),
  };
  const { text, usage } = await callGemini(body, settings);
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

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === 'LLM_FILL') sendResponse({ ok: true, answers: await llmFill(msg.payload) });
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
      files: ['src/lib/rules.js', 'src/content/util.js', 'src/content/extractor.js', 'src/content/gforms.js', 'src/content/filler.js', 'src/content/overlay.js', 'src/content/main.js'],
    });
    await chrome.scripting.insertCSS({ target: { tabId: tab.id, allFrames: true }, files: ['src/content/overlay.css'] });
    await chrome.tabs.sendMessage(tab.id, { type });
  }
}

chrome.commands.onCommand.addListener((cmd) => {
  if (cmd === 'fill-page') sendToActiveTab('FILL_PAGE');
});
