# Formora

Chrome extension for filling and reviewing job applications from your saved facts. Supports native and common custom fields on ATS pages, company career pages and Google Forms. Compatibility varies by site; review each application.

It reads supported questions on the authorized page, fills the factual ones from your stored profile and resume, and sends only the open-ended or judgement questions to Gemini in a single call. Factual fields autofill after your explicit action. AI answers remain private drafts in the browser side panel until you Apply them. You submit yourself. It never auto-submits.

## How it works

1. **Repeatable sections** (no LLM): "Work Experience", "Education" and "Certifications" blocks that only appear after an **Add** / **Add Another** click get one block per entry in your profile (see options, section 3b). The button is clicked, the DOM is watched until the fields show up, then the next one.
2. **Extract** (no LLM): a DOM walker collects native inputs, ARIA widgets (`role=radio|checkbox|listbox|combobox|textbox`, `aria-haspopup=listbox` buttons), custom-styled radios/checkboxes whose native input is hidden behind a label, segmented date boxes (MM / DD / YYYY), search-style typeahead inputs, open shadow roots and Google Forms' `role=listitem` blocks, resolves a label for each and groups radios/checkboxes into one question with options. Each field also learns which heading it sits under ("Education 1"), so fields inside a repeated block are tied to that profile entry. Site chrome (header/nav language and account menus) is ignored. Button dropdowns that only render their options when opened are opened once, their options read, and closed again. Searchable dropdowns are left for manual selection.
3. **Deterministic fill**: fields inside a repeated block come from that entry (Work Experience 2 → second job: title, company, location, from/to, "I currently work here", description). Everything else goes through the regex rules in `src/lib/rules.js` ("notice period", "LinkedIn", ...). Abbreviations are expanded against dropdown options ("B.Tech" picks "Bachelor of Technology"). Searchable dropdowns, including Field of Study and Skills, show profile suggestions in the panel for manual selection on the form. They do not run automated searches or count as filled. Resume drop zones get your stored PDF through the hidden file input, and through a synthetic drop event when the page only listens for drops; the panel says whether the page shows the file name afterwards.
4. **Memory**: an identical, non-job-specific answer approved in the browser side panel can be reused on the same origin for up to 90 days. Older unreviewed answers remain visible in Settings but are not automatically reused.
5. **One LLM call**: everything left goes to Gemini with professional profile fields, bounded resume text with known contact details removed, relevant job-description context and section headings. Previous answers stay local. The model returns strict JSON (option values are validated against the real options before anything is clicked). If the model is overloaded or rate limited (503 / 429 / 5xx / network error) the call is retried once and then moved to the fallback models listed in options, in order; the panel notes which model answered.
6. **Apply and verify**: every radio, checkbox and dropdown choice is checked after clicking (native `checked`, `aria-checked`, or the text the dropdown now shows). Text rejected by a controlled input is reported for manual selection. If the page ignored the click, the item is reported as failed instead of pretending it worked.
7. **Review panel**: shows what was filled and by what. Radio/select questions get a dropdown of the real options, checkbox questions a tick list, everything else a text box; edit and re-apply one answer with **Apply**, or every edited answer at once with **Apply all**, then you submit. The panel is draggable by its header, resizable from its bottom-right corner (double-click the header to reset both), collapsible, and remembers its position and size for the tab. While the model is working, the answers already filled from your profile are shown immediately and the open questions appear as shimmering placeholders with a spinner in the status bar.
8. **Multi-step applications**: after a fill the panel keeps watching the page. When the application moves to the next step (Workday "Save and Continue", in-page navigation) it shows "Page changed: N new fields found" with **Fill this page** / **Scan only** buttons; nothing is filled until you click, and the list is cleared so only the current page's questions are ever shown. Going back to an earlier step works the same way; fields that already hold a value are left alone unless "overwrite" is on in options. A step counter shows fills in the current document. After a full navigation or reload, start from the toolbar, shortcut or browser side panel again.

## Install (unpacked)

1. `chrome://extensions` > enable **Developer mode** > **Load unpacked** > pick this folder.
2. First install opens **Formora Settings** with a setup guide. Enable AI sharing only after reviewing the disclosure and using a suitable Google project. You can return through the panel gear button or the extension popup.
3. Review and enable AI sharing, then paste your Gemini API key (from Google AI Studio), choose a resume PDF, click **Extract profile + text from PDF with AI**, review the fields (including the extracted job / education / certification lists in section 3b), **Save everything**.
4. Open any application page, press **Alt+Shift+F** or click **Fill this page**.

To test on the bundled forms, serve the `test/` directory: `python -m http.server 8080 --bind 127.0.0.1` inside `test/`. The Workday mock has a two-step flow, Add / Add Another sections, MM/YYYY date boxes, "No Items" typeaheads and a drop-zone resume upload.

## Automated test

```
cd test/e2e
npm ci
npm test            # model-fallback unit test (mocked fetch), then headless Chrome: loads the unpacked extension, fills all three test forms, asserts values
npm run test:headful
npm run debug -- workday-mock.html#step2 --fill   # open one page, fill it, print what was extracted and the panel contents
```

Needs Chrome installed (set `CHROME_PATH` if it is not in the default location). The tests seed a fake profile and do not call the API, so they cover extraction, deterministic fill, memory reuse, resume attach (file input and drop zone), the Google Forms adapter, repeatable sections, segmented dates, typeaheads, the draggable panel, step detection and the 503/429 fallback chain.

## Is the API key safe?

- The key is stored in `chrome.storage.local`, which lives unencrypted inside your Chrome profile on disk. Anyone who can read your Chrome profile folder (other users of the same Windows account, malware running as you) can read it. Treat it like a saved password.
- Settings manages the key; the service worker uses it for API calls. Chrome local and session storage are restricted to trusted extension contexts. Authorized top-level content scripts receive sanitized settings and the profile/resume needed for filling, never the key.
- The only explicit API destination is `generativelanguage.googleapis.com`; extension-page CSP also restricts connections to that API. Host permissions alone are not a universal network firewall. Every request is sent with `store: false` to disable interaction retrieval; this does not override Google's separate safety logging and data retention terms.
- After AI sharing is enabled in Settings, AI requests send professional profile context, bounded resume text and unresolved questions to Google. Factual-only fills stay local. Google's unpaid-service terms say not to send personal, sensitive or confidential information. Use a suitable paid project for personal resume data and review the [Gemini terms](https://ai.google.dev/gemini-api/terms). See the bundled [privacy policy](privacy.html).
- Harden the key in Google AI Studio / Cloud Console: restrict it to the Generative Language API only, set a daily quota, and rotate it if you ever paste it somewhere by mistake. Never commit it; nothing in this repo stores it in a file.

## Notes

- Searchable dropdowns (including Workday Skills and Field of Study) are temporarily manual-only. The review panel shows the suggested value and **Fill manually**; use **Locate** to search and select on the form. These fields are excluded from automatic filling and **Apply all**. Native selects and button dropdowns, such as Degree, still autofill.
- API calls go from the extension's service worker straight to `generativelanguage.googleapis.com` (Interactions API, `store: false`); the key is never exposed to web pages.
- Default model is `gemini-3.8-flash` at medium thinking level. Choose the primary model and up to two ordered fallbacks from dropdowns. Defaults are `gemini-3.5-flash-lite` and `gemini-3.1-pro-preview`. Settings preserves previously saved custom IDs and offers **Test selected models** to check each one independently. Transient failures retry; missing/retired models (404/410) move to the next selection and appear in panel notes. See `store/MODEL-RELEASE-CHECK.md` for release maintenance.
- Professional profile fields and bounded resume text sit in the system instruction, so repeated applications share the same prefix and benefit from Gemini's implicit caching (cached tokens are shown in the stats line).
- Google Forms Drive-picker uploads are manual. Use the form's **Add file** control. The unauthenticated cross-frame upload bridge has been removed; ordinary top-level resume inputs still autofill.
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
- First installation opens a four-step setup guide. Resume upload preserves unsaved settings; extraction leaves the result for review and explicit saving.
- Publisher/support: Shrey Omer, shreyomer10@gmail.com. Privacy policy: `privacy.html`. Store copy, screenshots and promotional assets: `store/`. The preliminary name check found other Formora software: see `store/NAME-CHECK.md` before publication.
- `npm run test:features` covers setup, settings, the native browser side panel, active-tab routing, navigation, remote edits in Chrome using synthetic data and mocked AI. `npm run assets` regenerates store assets. These tests do not call live Gemini or establish model availability.

The native panel requires a Chromium browser implementing `chrome.sidePanel` (Chrome 116+ for programmatic opening). On a browser without that API, select Floating dialog. There is no page-docked sidebar fallback. Side-panel updates travel over a tab-scoped extension port and are not persisted to storage.

## Security changes in 0.2.1

- Fill/scan starts from the toolbar, shortcut or browser side panel and authorizes only the top-level document for 30 minutes. A full reload/navigation requires a fresh action there; SPA step detection continues within an authorized document. Scripts run only in top-level HTTPS and loopback HTTP documents. Embedded applications should be opened directly in their own tab; unrelated frames are never filled.
- Floating controls reject synthetic clicks. AI drafts and model notes never appear in website DOM before approval: use **Review AI draft** to open the browser-owned panel, then **Apply** or **Apply all**. Consent, eligibility and sensitive declarations stay manual.
- Keys/profile/resume remain in restricted local storage without changing the saved key. Legacy remembered answers are retained for inspection, have URL metadata sanitized, and are not automatically treated as approved. New memory contains only same-origin approved answers; URLs sent to AI or stored with answers contain only the origin.
- Resume uploads are limited to 4 MB. AI calls have 30-second per-attempt timeouts, response/request bounds, concurrency limits and a Cancel AI control. AI sharing is off until explicitly enabled, including after upgrading from 0.2.0.
- A full security regression run is `cd test/e2e; npm.cmd test` on Windows. `npm.cmd run test:security` runs the focused tests; `npm.cmd run test:package` builds the release ZIP, verifies its links and reruns the browser security tests against the extracted ZIP.

Release evidence and outstanding live-service checks: [security remediation](store/SECURITY-REMEDIATION.md). Account setup and sharing: [publishing guide](store/PUBLISHING.md).
