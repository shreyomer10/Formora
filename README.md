# ApplyPilot

Chrome extension that fills job application forms for you: ATS pages (Workday, Greenhouse, Lever, iCIMS...), company career pages and Google Forms.

It reads every question on the page, fills the factual ones from your stored profile and resume, and sends only the open-ended or judgement questions to Gemini in a single call. You review the result in an on-page panel and submit yourself. It never auto-submits.

## How it works

1. **Extract** (no LLM): a DOM walker collects native inputs, ARIA widgets (`role=radio|checkbox|listbox|combobox|textbox`), open shadow roots and Google Forms' `role=listitem` blocks, resolves a label for each and groups radios/checkboxes into one question with options.
2. **Deterministic fill**: regex rules in `src/lib/rules.js` map labels like "notice period" or "LinkedIn" to profile keys. Resume file inputs get your stored PDF.
3. **Memory**: an identical, non-job-specific question you already answered is reused verbatim.
4. **One LLM call**: everything left goes to Gemini with your profile, resume text, page context and previous answers. The model returns strict JSON (option values are validated against the real options before anything is clicked).
5. **Review panel**: shows what was filled and by what, lets you edit and re-apply AI answers, then you submit.

## Install (unpacked)

1. `chrome://extensions` > enable **Developer mode** > **Load unpacked** > pick this folder.
2. Click the extension icon > **Profile, resume & API key**.
3. Paste your Gemini API key (from Google AI Studio), choose a resume PDF, click **Extract profile + text from PDF with AI**, review the fields, **Save everything**.
4. Open any application page, press **Alt+Shift+F** or click **Fill this page**.

To test on the bundled forms, either open `test/sample-form.html` / `test/gforms-mock.html` after enabling *Allow access to file URLs* for the extension, or serve them: `python -m http.server 8080` inside `test/`.

## Automated test

```
cd test/e2e
npm install
npm test            # headless Chrome, loads the unpacked extension, fills both test forms, asserts values
npm run test:headful
```

Needs Chrome installed (set `CHROME_PATH` if it is not in the default location). The test seeds a fake profile and does not call the API, so it covers extraction, deterministic fill, memory reuse, resume attach and the Google Forms adapter.

## Notes

- API calls go from the extension's service worker straight to `generativelanguage.googleapis.com` (Interactions API, `store: false`); the key is never exposed to web pages.
- Default model is `gemini-3.8-flash` at medium thinking level. Any Gemini model id can be typed into the model field.
- Profile, resume and answers sit in the system instruction, so repeated applications share the same prefix and benefit from Gemini's implicit caching (cached tokens are shown in the stats line).
- Google Forms file-upload questions cannot be automated (they open a Drive picker).
- Multi-step forms (Workday): run the fill on each step.

## Layout

```
manifest.json
src/background/service-worker.js   Gemini API calls, keyboard command
src/content/extractor.js           generic DOM -> questions
src/content/gforms.js              Google Forms adapter
src/content/filler.js              framework-safe writes, file upload, comboboxes
src/content/overlay.js|css         review panel
src/content/main.js                orchestration
src/lib/rules.js                   deterministic label -> profile rules
src/options/                       settings page
src/popup/                         toolbar popup
test/sample-form.html              local test form (native + ARIA controls)
test/gforms-mock.html              Google Forms DOM mock
test/e2e/run.js                    puppeteer end-to-end test
```
