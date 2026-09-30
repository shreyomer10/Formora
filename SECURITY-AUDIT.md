# Security and release audit — 2026-09-25

**Historical audit of 0.2.0. See [the 0.2.1 remediation report](store/SECURITY-REMEDIATION.md) for fixes and regression results.**

**Original decision: do not publish version 0.2.0.** Functional tests pass, but a hostile web page can trigger autofill and obtain a saved resume without a user click in the default floating-dialog mode. Use a separate Chrome profile and synthetic data for testing until the release blockers are resolved.

Scope: current working tree based on `ced66fd`, manifest, runtime JavaScript/HTML, privacy/store documentation, packaging script, existing ZIP and test dependencies. Existing uncommitted `.gitignore`, `pack.ps1` and logo changes were preserved. This audit adds this report and a diagnostic script; runtime vulnerabilities remain unfixed. No publication was performed.

## Findings

### S1 — High: page-controlled UI can trigger unauthorized autofill and resume disclosure

Locations: `src/content/main.js:95`, `src/content/main.js:346`, `src/content/overlay.js:52`, `src/content/overlay.js:231`.

The activation flag uses the website's `sessionStorage`. A page can set `applypilot.active=1` before the content script starts. The extension then creates its floating panel. Its Fill and Apply handlers accept synthetic clicks from ordinary page JavaScript; there is no trusted-event check. The panel and answer editors are in the page's shared DOM.

**Reproduced in real Chrome:** a loopback page set this flag, invoked the Fill button using page-world `.click()`, read a synthetic email from the filled input, and read the entire synthetic resume through `input.files[0].text()`. No popup invocation, user click, real API key, or previous use on that site was needed. The reproduction uses the default dialog setting and a saved profile/resume. The website can transmit the resulting data without waiting for form submission. Repeated runs could also trigger AI requests when a key is present; that cost scenario was not exercised.

Fix: keep authorization in extension-owned state bound to a tab/document and explicit user action. Prefer browser-owned review controls. For retained page controls, reject untrusted events on every action that reads/writes personal data or starts requests; do not treat page session storage as authorization. Address page modification of answer editors and cross-site memory writes as part of the same trust boundary. Add negative browser regression tests.

### S2 — High: Fill broadcasts personal data to unrelated embedded origins

Locations: `manifest.json:53`, `src/popup/popup.js:32`, `src/background/service-worker.js:353`, `src/content/main.js:292`.

Content scripts run in every HTTP/HTTPS frame. Popup and keyboard fill commands use `chrome.tabs.sendMessage` without a frame target, and every receiving frame runs the fill handler. A user choosing to fill the main application can consequently fill an unrelated third-party iframe too.

**Reproduced in real Chrome:** a top-level loopback form on `127.0.0.1` embedded a form on `localhost` (a different origin). The existing tab-wide fill message filled the synthetic email in the embedded frame. That frame can read the result. This is separate from S1 and does not require synthetic UI clicks.

Fix: default to frame 0. Support legitimate embedded application forms through explicit frame discovery and authorization bound to the selected origin/document. Restrict upload permissions to the particular authorized frame. Test that unrelated and newly navigated frames stay empty.

### S3 — High: Drive picker upload messages lack authentication

Locations: `src/content/main.js:305`, `src/content/gforms.js:123`.

The picker handler accepts any `message` with type `applypilot-attach`, without checking `event.origin`, `event.source`, or an extension-authorized upload operation. It reads the stored resume and assigns it to the picker's file input. Messages and replies use wildcard target origins. The parent also accepts result messages without verifying their sender. The hostname regex additionally matches names ending in `docs.google.com` without requiring an exact hostname boundary.

**Reproduced with the actual handler in a Node VM:** an event from `https://untrusted.example` caused the synthetic resume to be read and attached. This confirms the missing check, not a complete exploit against Google's live picker; embedding and Google-side restrictions were not tested.

Fix: replace the page-message authorization path with extension-mediated, tab/frame/document-bound upload requests. Validate the exact picker URL and intended parent, expire authorization, reject replay, and verify replies. Origin checks alone are insufficient when the parent page can itself send messages.

### S4 — Medium: API key is exposed to content-script contexts

Locations: `src/content/main.js:75`, `src/content/overlay.js:22`, `src/background/service-worker.js:302`, `README.md` section “Is the API key safe?”.

`loadState()` reads all settings, including the API key, inside the content script, and only then removes the key from the returned object. Overlay initialization also reads the full settings object. There is no `storage.local.setAccessLevel` restriction. Consequently the README's assertion that only the worker reads the key is incorrect. Chrome exposes local extension storage to content scripts by default. [Chrome storage documentation](https://developer.chrome.com/docs/extensions/reference/api/storage)

This does **not** mean an ordinary webpage can directly call extension storage or read isolated-world variables. It increases the impact of a content-script compromise; direct key theft by a webpage was not demonstrated.

Fix: restrict local storage to trusted extension contexts and provide narrow worker APIs returning sanitized settings and authorized profile data. Migrate direct content-script reads/writes and storage-change listeners together. Validate message type, sender role, tab/frame/document, size and operation authorization; reserve extraction/model-testing operations for Settings. Correct the README. Local disk storage is also unencrypted, as already disclosed.

### S5 — High release risk: AI can invent eligibility answers and auto-accept consent

Locations: `src/background/service-worker.js:91`, `:96`, `:109`; `src/content/main.js:264`.

The system prompt instructs the model to tick single consent/confirmation checkboxes, choose a reasonable required option without matching facts, and select a favorable plausible eligibility answer when the profile is silent. These instructions conflict with the product's honesty claim. AI results are written to the website and saved as reusable answers before review. The site can collect them immediately.

Untrusted page questions/context are supplied alongside the full candidate profile and resume. There is no dependable boundary preventing a malicious question from soliciting unrelated private candidate information. Schema/option checks constrain formatting and available choices; they do not establish factual accuracy or prevent prompt injection. A live-model injection was not attempted.

Fix: leave consent, attestations, sensitive declarations and unknown eligibility facts for explicit user choice. Stage AI drafts in the extension's browser-owned panel before writing to a page. Minimize candidate context per task and treat page content as untrusted. Do not rely solely on prompt wording as a security control. Reuse only answers the user has approved, with appropriate question/site context.

### S6 — Medium: unnecessary URL/context disclosure and broad ambient access

Locations: `src/content/extractor.js:455`, `src/content/main.js:86`, `manifest.json:53`.

AI context includes `location.href`, including query parameters and fragments, plus up to 6,000 characters selected from page text. Answer memory also stores full URLs. Application links can contain tokens or private identifiers. The heuristic can select unrelated text. Always-on content scripts cover all HTTP and HTTPS pages, not just an explicitly chosen application; HTTP autofill additionally exposes data to pages delivered without transport security.

Fix: strip query/fragment and retain only necessary URL components, constrain context collection, reduce sensitive-memory retention, and require deliberate handling of non-local HTTP pages. Prefer `activeTab`/on-demand injection or optional site access where practical. Document any remaining broad permissions accurately. Chrome requires the narrowest necessary permissions. [Chrome Web Store policies](https://developer.chrome.com/docs/webstore/program-policies/policies)

The README also incorrectly treats `host_permissions` as a universal outbound network firewall. The current reviewed runtime has one explicit `fetch` destination, Google, but a host permission declaration alone is not a comprehensive egress guarantee. An explicit restrictive extension CSP can add defense in depth.

## Other production and publication blockers

- **Broken packaged privacy link:** `pack.ps1:10` includes only manifest, source and icons. Inspection of `dist/formora-0.2.0.zip` confirms `privacy.html` is absent, while Settings links to `../../privacy.html`. Include it, rebuild, then smoke-test the extracted final ZIP.
- **Public privacy URL and store declarations:** `store/LISTING.md` says a public policy URL has not been deployed by that change. No live listing/dashboard was available to verify. Host the policy publicly, verify it, complete data/permission disclosures and provide reviewer setup instructions. Publication requires a developer account and two-step verification. [Publication guide](https://developer.chrome.com/docs/webstore/publish), [store policies](https://developer.chrome.com/docs/webstore/program-policies/policies)
- **Gemini personal-data setup:** Settings discloses Google transfers and the privacy policy mentions unpaid-service restrictions, but onboarding does not prominently establish that the selected project is suitable for resume data. Google's terms prohibit personal/sensitive/confidential data in Unpaid Services, with regional differences in applicable data-use terms. Surface this before the first upload and use an appropriately configured project. `store:false` is not a zero-retention guarantee. [Gemini terms](https://ai.google.dev/gemini-api/terms)
- **Live integration unverified:** the configured model IDs appear in Google's current model catalog, but this audit made no live requests and did not verify project access, PDF extraction, response schemas or real ATS/Drive compatibility. Complete synthetic-data live smoke tests before release. [Google model catalog](https://ai.google.dev/gemini-api/docs/models)
- **Resource and reliability bounds:** `callGemini()` has no explicit request timeout/cancellation, and settings upload reads/encodes files without a size guard or local error handling. Bound PDF/request/response sizes, surface storage-quota failures, cap concurrent/costly operations and provide cancellation. Chrome local storage has a default 10 MB quota. [Chrome storage documentation](https://developer.chrome.com/docs/extensions/reference/api/storage)
- **Existing naming concern:** `store/NAME-CHECK.md` records an unresolved name conflict. This audit did not independently perform trademark clearance; resolve the recorded release decision before publishing.

## Validation and limits

- `cd test/e2e; npm.cmd test`: **passed** all existing fallback, mock-form Chrome, onboarding/settings and native-side-panel tests. Initial sandbox Chrome launch failed; rerun in a temporary headless Chrome profile outside the sandbox passed. Test AI responses are mocked.
- `npm.cmd audit --json`: **0 known vulnerabilities** across the 25 reported dependencies, after a network-enabled retry. These are development/test dependencies; runtime source is bundled without an npm SDK. Advisory results do not assess application logic or prove absence of malicious code.
- `node test/e2e/security-audit.js`: reproduced S1 and S2 in real Chrome and S3 at the handler level in a VM, using synthetic data only. All reported exposure flags were `true`. This is an audit diagnostic that succeeds when the current weaknesses reproduce, **not** a passing security-regression suite. Convert it to rejection assertions when fixing the issues.
- Current-tree pattern scan found no matching Google API key, long `sk-` key or private-key header outside excluded dependencies/Git/ZIPs. This was a limited scan, not a full history or secret-detection audit.
- Positive controls reviewed: Manifest V3; local packaged scripts; no observed dynamic code evaluation or downloaded executable code; HTTPS Google API URL with key in a header; escaped question/answer rendering; password fields excluded; no explicit application-submit automation; native panel edit requests validate document/version and connected elements.
- No real resume, personal Chrome profile, live Google account, live application submission or real API key was used. No full penetration test, independent certification, Google-side picker exploit, or Web Store approval is claimed.

## Release acceptance criteria

1. Fix S1–S3 and prove hostile-page clicks/messages and unrelated frames cannot obtain stored data.
2. Restrict secrets/storage and privileged messages; make sensitive/unknown declarations manual and AI answers reviewable before page writes.
3. Minimize context/URLs and permissions; add request/file bounds and clear failure handling.
4. Include and host the privacy policy, resolve outstanding store/naming decisions, and verify the actual packaged artifact.
5. Rerun functional and new negative security tests; complete controlled live API and supported-site smoke tests, then reassess publication readiness.

## Load locally in Chrome

1. Use a separate Chrome testing profile and synthetic data for this vulnerable build.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select `C:\Users\ASUS\OneDrive\Desktop\projects\job-autofill` (the folder containing `manifest.json`, not the ZIP or `src`).
4. Open Formora Settings, configure the synthetic profile/resume and save. Deterministic test filling works without an API key; use a suitable project only when deliberately testing AI.
5. Serve the included forms from the project directory with `python -m http.server 8080 --bind 127.0.0.1 --directory test`, then visit `http://127.0.0.1:8080/sample-form.html` and use the extension's Fill control or `Alt+Shift+F`.
6. After code changes, click **Reload** on the extension card and refresh the test page. [Chrome's unpacked-install instructions](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world)
