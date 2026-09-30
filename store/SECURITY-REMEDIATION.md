# 0.2.1 security remediation

This supersedes the code status in the historical `SECURITY-AUDIT.md`. It does not claim Web Store approval or a complete independent penetration test.

| Finding | Change | Focused regression |
| --- | --- | --- |
| S1: unauthorized page-triggered filling | Page session storage cannot grant authority; trusted extension actions authorize one top-level document for 30 minutes. Full navigation invalidates the grant. Floating controls reject synthetic clicks. | Browser test plants the old activation flag, attempts synthetic/direct handler calls and checks a post-navigation stale grant; positive control fills a profile/resume. |
| S2: unrelated frames | Manifest scripts and command routing target frame 0. No automatic cross-frame filling. | Different-origin loopback iframe remains empty during a top-level fill. Worker rejects nonzero frame IDs. |
| S3: picker messages | Removed the page-message upload bridge. Google Forms Drive-picker uploads provide a manual fallback. | Forged attach messages do not attach a resume; fallback reports manual action. This does not implement authenticated automatic Drive uploading. |
| S4: keys and privileged messages | Local/session storage restricted to trusted extension contexts. Worker exposes sanitized settings/data only to authorized documents; extraction/key/model tests are Settings-only. | Actual Chrome content-script storage access is denied; worker tests reject wrong roles, IDs, frames, tokens, origins and documents. Upgrade preserves profile/key. |
| S5: unreviewed AI/consent | Product decision (0.3): AI answers are written into the form after an authorized Fill by default, not remembered until the user applies an edit. With auto-apply off, AI values remain in the isolated content world and browser-owned panel until approval. No AI text/notes are rendered into website DOM before approval. Consent/eligibility/sensitive declarations stay manual. Unknown facts must be skipped; response shape/options are checked. | Mocked AI produces identifiable private text; page DOM, fields and memory stay clean until real side-panel Apply. Invalid answers/options and declarations are rejected. |
| S6: context and memory | AI URL context is origin-only. Job-description collection avoids whole-body scraping. Professional profile allowlist, bounded resume text and basic contact redaction; saved answers stay local. New memory is approved, same-origin, capped at 200 and reusable for 90 days. Legacy URL metadata is sanitized. | Tests check request bodies and memory for URL tokens, unrelated saved answers and contact fields; wrong-site/expired/unreviewed memory is excluded. |
| Reliability | 4 MB resume limit, bounded requests/responses, 30-second per-attempt timeout, concurrency limits, cancel control and generic provider/JSON errors. | Oversized upload preserves the old resume; worker tests verify timeout/abort, concurrency rejection, response bounds and no error-body/model-text leakage. |
| Packaging | 0.2.1 ZIP includes privacy.html, local runtime links and restrictive extension-page CSP. | Package test builds/extracts ZIP, verifies links/scope/CSP and runs the browser security suite against that extracted copy. |

## User-visible changes

Embedded (cross-origin iframe) applications are detected and offered as "Open the form in this tab". Normal top-level factual autofill, ordinary resume attachment, SPA step detection, floating layout and native panel remain. AI drafts require approval in the native panel; the floating dialog links to that review. Google Forms uploads, consent and sensitive declarations are manual. Open embedded applications directly in a tab. After full navigation/reload or authorization expiry, start again from the toolbar, shortcut or native panel. Non-local HTTP pages are rejected.

Existing API key/profile/resume values are retained. AI sharing requires a new explicit Settings opt-in for legacy installations. Legacy answers remain available for inspection but are not automatically assumed approved. New memory is written only after browser-panel approval and never carries full application URLs.

## Verified results

On September 25, 2026, `npm.cmd test` passed: existing model-fallback tests, all three mock-form browser flows, onboarding/settings/native-side-panel checks, 12 focused worker security groups and 10 focused browser security groups. `npm.cmd run test:package` passed its ZIP/link/manifest checks and all 10 browser security groups against the extracted 0.2.1 package. Tests used temporary headless Chrome profiles, synthetic records and mocked AI; no real API key or application submission was used. Store screenshots were regenerated and the onboarding disclosure was visually checked. The dependency lockfile is retained for reproducible `npm ci` setup.

## Validation commands

From `test/e2e` on Windows:

```
npm.cmd test
npm.cmd run test:package
```

The main suite contains the existing fallback, sample-form, Google Forms, Workday-style, onboarding/settings and side-panel tests, plus focused worker and browser security regressions. Test data and model responses are synthetic. `security-audit.js` now delegates to the rejection-based regression suite, replacing the old exploit-success diagnostic.

## Remaining release work and limits

- Top-level HTTPS content scripts remain broadly matched to support diverse application sites and in-document step detection. They cannot access sensitive extension storage without document authorization; this scope still needs an accurate store permission explanation.
- Resume redaction is deliberately limited, not a promise that all personal details have been removed. Google still receives resume data after explicit opt-in; configure a suitable project and follow applicable terms.
- Tests do not establish resistance to every prompt injection, every malicious site's social engineering, local malware, live Google model availability or every ATS implementation.
- Before submission, complete synthetic-data live Gemini/PDF and real-site smoke tests, public privacy hosting, current screenshots/disclosures, reviewer instructions and the recorded naming decision. Follow `PUBLISHING.md`.
