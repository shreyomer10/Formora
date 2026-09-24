# Formora

Chrome extension that fills job application forms for you. Tagline: application forms filled with complete honesty. Works on: ATS pages (Workday, Greenhouse, Lever, iCIMS...), company career pages and Google Forms.

It reads every question on the page, fills the factual ones from your stored profile and resume, and sends only the open-ended or judgement questions to Gemini in a single call. You review the result in an on-page panel and submit yourself. It never auto-submits.

## How it works

1. **Repeatable sections** (no LLM): "Work Experience", "Education" and "Certifications" blocks that only appear after an **Add** / **Add Another** click get one block per entry in your profile (see options, section 3b). The button is clicked, the DOM is watched until the fields show up, then the next one.
2. **Extract** (no LLM): a DOM walker collects native inputs, ARIA widgets (`role=radio|checkbox|listbox|combobox|textbox`, `aria-haspopup=listbox` buttons), custom-styled radios/checkboxes whose native input is hidden behind a label, segmented date boxes (MM / DD / YYYY), search-style typeahead inputs, open shadow roots and Google Forms' `role=listitem` blocks, resolves a label for each and groups radios/checkboxes into one question with options. Each field also learns which heading it sits under ("Education 1"), so fields inside a repeated block are tied to that profile entry. Site chrome (header/nav language and account menus) is ignored. Button dropdowns that only render their options when opened are opened once, their options read, and closed again. Searchable dropdowns are left for manual selection.
3. **Deterministic fill**: fields inside a repeated block come from that entry (Work Experience 2 → second job: title, company, location, from/to, "I currently work here", description). Everything else goes through the regex rules in `src/lib/rules.js` ("notice period", "LinkedIn", ...). Abbreviations are expanded against dropdown options ("B.Tech" picks "Bachelor of Technology"). Searchable dropdowns, including Field of Study and Skills, show profile suggestions in the panel for manual selection on the form. They do not run automated searches or count as filled. Resume drop zones get your stored PDF through the hidden file input, and through a synthetic drop event when the page only listens for drops; the panel says whether the page shows the file name afterwards.
4. **Memory**: an identical, non-job-specific question you already answered is reused verbatim.
5. **One LLM call**: everything left goes to Gemini with your profile (including the structured job/education/certification lists), resume text, page context, section headings and previous answers. The model returns strict JSON (option values are validated against the real options before anything is clicked). If the model is overloaded or rate limited (503 / 429 / 5xx / network error) the call is retried once and then moved to the fallback models listed in options, in order; the panel notes which model answered.
6. **Apply and verify**: every radio, checkbox and dropdown choice is checked after clicking (native `checked`, `aria-checked`, or the text the dropdown now shows). Text rejected by a controlled input is reported for manual selection. If the page ignored the click, the item is reported as failed instead of pretending it worked.
7. **Review panel**: shows what was filled and by what. Radio/select questions get a dropdown of the real options, checkbox questions a tick list, everything else a text box; edit and re-apply one answer with **Apply**, or every edited answer at once with **Apply all**, then you submit. The panel is draggable by its header, resizable from its bottom-right corner (double-click the header to reset both), collapsible, and remembers its position and size for the tab. While the model is working, the answers already filled from your profile are shown immediately and the open questions appear as shimmering placeholders with a spinner in the status bar.
8. **Multi-step applications**: after a fill the panel keeps watching the page. When the application moves to the next step (Workday "Save and Continue", in-page navigation, or a full reload) it shows "Page changed: N new fields found" with **Fill this page** / **Scan only** buttons; nothing is filled until you click, and the list is cleared so only the current page's questions are ever shown. Going back to an earlier step works the same way; fields that already hold a value are left alone unless "overwrite" is on in options. A step counter in the header shows how many fills you have run in this tab.

## Install (unpacked)

1. `chrome://extensions` > enable **Developer mode** > **Load unpacked** > pick this folder.
2. First install opens **Formora Settings** with a setup guide. You can return through the panel gear button or the extension popup.
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
- The only network destination is `generativelanguage.googleapis.com` (the manifest's `host_permissions` allow nothing else). Every request is sent with `store: false` to disable interaction retrieval; this does not override Google's separate safety logging and data retention terms.
- Your resume, profile and the page's questions are sent to Google with each fill. Google's unpaid-service terms say not to send personal, sensitive or confidential information. Use a suitable paid project for personal resume data and review the [Gemini terms](https://ai.google.dev/gemini-api/terms). See the bundled [privacy policy](privacy.html).
- Harden the key in Google AI Studio / Cloud Console: restrict it to the Generative Language API only, set a daily quota, and rotate it if you ever paste it somewhere by mistake. Never commit it; nothing in this repo stores it in a file.

## Notes

- Searchable dropdowns (including Workday Skills and Field of Study) are temporarily manual-only. The review panel shows the suggested value and **Fill manually**; use **Locate** to search and select on the form. These fields are excluded from automatic filling and **Apply all**. Native selects and button dropdowns, such as Degree, still autofill.
- API calls go from the extension's service worker straight to `generativelanguage.googleapis.com` (Interactions API, `store: false`); the key is never exposed to web pages.
- Default model is `gemini-3.8-flash` at medium thinking level. Choose the primary model and up to two ordered fallbacks from dropdowns. Defaults are `gemini-3.5-flash-lite` and `gemini-3.1-pro-preview`. Settings preserves previously saved custom IDs and offers **Test selected models** to check each one independently. Transient failures retry; missing/retired models (404/410) move to the next selection and appear in panel notes. See `store/MODEL-RELEASE-CHECK.md` for release maintenance.
- Profile, resume and answers sit in the system instruction, so repeated applications share the same prefix and benefit from Gemini's implicit caching (cached tokens are shown in the stats line).
- Google Forms file uploads go to your own Google Drive through a picker iframe. The extension clicks **Add file**, and its content script inside the picker hands the stored resume to the picker's upload input. This needs you to be signed in to Google and is best-effort: the panel reports whether the form shows the file afterwards, and says to attach manually when it does not.
- Profile fields for 10th and 12th percentage, graduation CGPA and college roll / enrollment number are filled by rules; the profile is also included as context when an AI request is needed, and the model is told to skip marks, IDs and dates it does not have rather than estimate them.
- `BRAND.md` is a three-step prompt chain (name, then theme from the name, then logo from both) to run yourself; the current name and colours are placeholders.
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

## Settings, support and store preparation

- **Panel appearance** selects a floating dialog (default) or native browser side panel. In side-panel mode, the toolbar icon opens the browser panel and the application gets its own resized viewport. The browser controls which side and width to use. The gear opens Settings; the floating dialog also retains minimize and close controls. Dialog position/size remain remembered when switching layouts.
- **Copy diagnostic** copies the current run's bounded extraction log, field labels, result states and panel notes, with no answer-value or resume-body fields. Known profile strings and common sensitive patterns are filtered, but review labels and notes before sharing. If clipboard access fails, a selectable report appears. Reports are never sent automatically.
- First installation opens a four-step setup guide. Resume upload preserves unsaved settings; extraction leaves the result for review and explicit saving.
- Publisher/support: Shrey Omer, shreyomer10@gmail.com. Privacy policy: `privacy.html`. Store copy, screenshots and promotional assets: `store/`. The preliminary name check found other Formora software: see `store/NAME-CHECK.md` before publication.
- `npm run test:features` covers setup, settings, the native browser side panel, active-tab routing, navigation, remote edits and diagnostics in Chrome using synthetic data and mocked AI. `npm run assets` regenerates store assets. These tests do not call live Gemini or establish model availability.

The native panel requires a Chromium browser implementing `chrome.sidePanel` (Chrome 116+ for programmatic opening). On a browser without that API, select Floating dialog. There is no page-docked sidebar fallback. Side-panel updates travel over a tab-scoped extension port and are not persisted to storage.
