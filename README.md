# ApplyPilot

Chrome extension that fills job application forms for you: ATS pages (Workday, Greenhouse, Lever, iCIMS...), company career pages and Google Forms.

It reads every question on the page, fills the factual ones from your stored profile and resume, and sends only the open-ended or judgement questions to Gemini in a single call. You review the result in an on-page panel and submit yourself. It never auto-submits.

## How it works

1. **Repeatable sections** (no LLM): "Work Experience", "Education" and "Certifications" blocks that only appear after an **Add** / **Add Another** click get one block per entry in your profile (see options, section 3b). The button is clicked, the DOM is watched until the fields show up, then the next one.
2. **Extract** (no LLM): a DOM walker collects native inputs, ARIA widgets (`role=radio|checkbox|listbox|combobox|textbox`, `aria-haspopup=listbox` buttons), custom-styled radios/checkboxes whose native input is hidden behind a label, segmented date boxes (MM / DD / YYYY), search-style typeahead inputs, open shadow roots and Google Forms' `role=listitem` blocks, resolves a label for each and groups radios/checkboxes into one question with options. Each field also learns which heading it sits under ("Education 1"), so fields inside a repeated block are tied to that profile entry. Site chrome (header/nav language and account menus) is ignored. Dropdowns that only render their options when opened (react-select, Workday, country pickers) are opened once, their options read, and closed again, so the real option list is known before anything is chosen.
3. **Deterministic fill**: fields inside a repeated block come from that entry (Work Experience 2 → second job: title, company, location, from/to, "I currently work here", description). Everything else goes through the regex rules in `src/lib/rules.js` ("notice period", "LinkedIn", ...). Abbreviations are expanded against dropdown options ("B.Tech" picks "Bachelor of Technology"). Typeahead fields that show "No Items" until you type (Workday's Field of Study, Skills) are filled by typing, waiting for the suggestions and picking the best one. Sites that only search on Enter (Workday) get an Enter keypress when typing alone shows nothing, then the results are awaited. When no suggestion matches exactly, the site's top result for that query is taken if it plausibly relates, and the panel says so (`Python (Programming Language) (closest to "Python")`). Skills-style fields get each value typed and picked in turn, and the panel lists which ones the site did not offer. Resume drop zones get your stored PDF through the hidden file input, and through a synthetic drop event when the page only listens for drops; the panel says whether the page shows the file name afterwards.
4. **Memory**: an identical, non-job-specific question you already answered is reused verbatim.
5. **One LLM call**: everything left goes to Gemini with your profile (including the structured job/education/certification lists), resume text, page context, section headings and previous answers. The model returns strict JSON (option values are validated against the real options before anything is clicked). If the model is overloaded or rate limited (503 / 429 / 5xx / network error) the call is retried once and then moved to the fallback models listed in options, in order; the panel notes which model answered.
6. **Apply and verify**: every radio, checkbox and dropdown choice is checked after clicking (native `checked`, `aria-checked`, or the text the dropdown now shows). Text typed into a controlled input that the page wipes is retried as a typeahead pick. If the page ignored the click, the item is reported as failed instead of pretending it worked.
7. **Review panel**: shows what was filled and by what. Radio/select questions get a dropdown of the real options, checkbox questions a tick list, everything else a text box; edit and re-apply, then you submit. The panel is draggable by its header (double-click the header to snap it back), collapsible, and remembers its position for the tab.
8. **Multi-step applications**: after a fill the panel keeps watching the page. When the application moves to the next step (Workday "Save and Continue", in-page navigation, or a full reload) it shows "Page changed: N new fields found" with **Fill this page** / **Scan only** buttons; nothing is filled until you click. Going back to an earlier step works the same way; fields that already hold a value are left alone unless "overwrite" is on in options. A step counter in the header shows how many fills you have run in this tab.

## Install (unpacked)

1. `chrome://extensions` > enable **Developer mode** > **Load unpacked** > pick this folder.
2. Click the extension icon > **Profile, resume & API key**.
3. Paste your Gemini API key (from Google AI Studio), choose a resume PDF, click **Extract profile + text from PDF with AI**, review the fields (including the extracted job / education / certification lists in section 3b), **Save everything**.
4. Open any application page, press **Alt+Shift+F** or click **Fill this page**.

To test on the bundled forms, either open `test/sample-form.html` / `test/gforms-mock.html` / `test/workday-mock.html` after enabling *Allow access to file URLs* for the extension, or serve them: `python -m http.server 8080` inside `test/`. The Workday mock has a two-step flow, Add / Add Another sections, MM/YYYY date boxes, "No Items" typeaheads and a drop-zone resume upload.

## Automated test

```
cd test/e2e
npm install
npm test            # model-fallback unit test (mocked fetch), then headless Chrome: loads the unpacked extension, fills all three test forms, asserts values
npm run test:headful
npm run debug -- workday-mock.html#step2 --fill   # open one page, fill it, print what was extracted and the panel contents
```

Needs Chrome installed (set `CHROME_PATH` if it is not in the default location). The tests seed a fake profile and do not call the API, so they cover extraction, deterministic fill, memory reuse, resume attach (file input and drop zone), the Google Forms adapter, repeatable sections, segmented dates, typeaheads, the draggable panel, step detection and the 503/429 fallback chain.

## Is the API key safe?

- The key is stored in `chrome.storage.local`, which lives unencrypted inside your Chrome profile on disk. Anyone who can read your Chrome profile folder (other users of the same Windows account, malware running as you) can read it. Treat it like a saved password.
- Web pages never see it. Only the service worker reads the key and makes API calls; the content script that runs on job sites only learns whether a key exists. Content scripts run in an isolated world, so page JavaScript cannot read their variables anyway.
- The only network destination is `generativelanguage.googleapis.com` (the manifest's `host_permissions` allow nothing else). Every request is sent with `store: false`, so Google does not keep the interaction for later retrieval.
- Your resume, profile and the page's questions are sent to Google with each fill. On the free tier Google may use API inputs to improve its products; on a billed project it does not. Check the current Gemini API terms if that matters to you.
- Harden the key in Google AI Studio / Cloud Console: restrict it to the Generative Language API only, set a daily quota, and rotate it if you ever paste it somewhere by mistake. Never commit it; nothing in this repo stores it in a file.

## Notes

- API calls go from the extension's service worker straight to `generativelanguage.googleapis.com` (Interactions API, `store: false`); the key is never exposed to web pages.
- Default model is `gemini-3.8-flash` at medium thinking level. Any Gemini model id can be typed into the model field. Fallback models (default `gemini-3.5-flash-lite, gemini-3.1-pro-preview`) are tried in order when the chosen one returns 503 / 429 / 5xx.
- Profile, resume and answers sit in the system instruction, so repeated applications share the same prefix and benefit from Gemini's implicit caching (cached tokens are shown in the stats line).
- Google Forms file-upload questions cannot be automated (they open a Drive picker).
- Multi-step forms (Workday): the panel notices each new step and offers to fill it; nothing runs without a click.
- Repeatable sections need entries in options section 3b. With none stored the section is left untouched and the panel says so.

## Layout

```
manifest.json
src/background/service-worker.js   Gemini API calls, keyboard command
src/content/extractor.js           generic DOM -> questions (incl. section/entry context, date boxes, typeaheads)
src/content/sections.js            repeatable blocks: click Add per profile entry, map entry fields
src/content/gforms.js              Google Forms adapter
src/content/filler.js              framework-safe writes, file upload, comboboxes
src/content/overlay.js|css         review panel (draggable, step bar)
src/content/main.js                orchestration + multi-step watcher
src/lib/rules.js                   deterministic label -> profile rules
src/options/                       settings page
src/popup/                         toolbar popup
test/sample-form.html              local test form (native + ARIA controls)
test/gforms-mock.html              Google Forms DOM mock
test/workday-mock.html             Workday-style mock: 2 steps, Add sections, date boxes, typeaheads, drop zone
test/e2e/run.js                    puppeteer end-to-end test
test/e2e/fallback.test.js          service worker model-fallback unit test
test/e2e/debug.js                  fill one page and dump what was extracted
```
