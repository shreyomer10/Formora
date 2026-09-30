# Formora store listing draft

Publisher: Shrey Omer  
Support: shreyomer10@gmail.com  
Category: Productivity  
Language: English

Title: Formora - one-click job application autofill

Short description (matches manifest, under 132 characters):
Fill job applications from your profile and resume. Review every answer in a sidebar or dialog. You stay in control of submitting.

## Detailed description

Spend less time repeating your profile across job applications.

Formora reads application questions and fills supported fields from your saved profile and resume. Use your own Gemini API key to extract a PDF resume and draft answers to open-ended questions. AI answers go straight into the form, and you can edit any of them in the panel (or switch to reviewing drafts before they are applied). Then submit the application yourself. Consent and sensitive declarations stay manual.

- Choose the browser's native side panel or a movable, resizable dialog.
- Set up with a guide: API key, resume, extraction, review and save.
- Fill supported fields on career pages, ATS forms and Google Forms.
- Prepare repeated work experience, education and certification sections.
- Review AI answers, locate manual fields and apply your edits.
- Choose up to two fallback models and test every selected model.

Compatibility varies by site. Searchable dropdowns may need manual selection. AI can make mistakes: review every answer. Formora never submits applications automatically. Gemini API charges and Google's data terms apply. PDF supports AI extraction; other resume formats require pasted text.

Your setup is stored locally in Chrome. AI features send resume/profile information and relevant form context directly to Google. Filled answers and attachments go to the application site. Formora has no advertising or analytics backend. Read the privacy policy before using AI with personal data.

## Privacy tab preparation

Single purpose: help the user fill and review job application forms from their own profile and resume.

Disclose handling of personally identifiable information, authentication information (API key), website content, and user-provided profile/resume/form content. Profile facts may include sensitive categories depending on what users enter; review the dashboard's current categories against `privacy.html`. Only page origins are included in AI URL context; paths, query strings and fragments are omitted. Data sent to Google must be disclosed even though the publisher has no backend.

Permission justifications:
- `storage`: save profile, resume, API key, settings, answers and setup progress locally.
- `activeTab`: target the page on which the user invokes Formora.
- `scripting`: inject or refresh form controls and panel styles on that page.
- `sidePanel`: display the review UI beside the application in the browser-owned panel, without covering the page.
- Google API host: direct, user-key-authenticated AI extraction and answer requests.
- Top-level HTTPS and loopback HTTP content scripts: support different application sites and local tests; detect SPA step changes. Personal data access requires explicit document authorization. Unrelated frames are not filled; Drive-picker uploads are manual.

Remote code: none. Model responses are treated as data, not executed.

## Assets and publication

Run `node test/e2e/store-assets.js` to regenerate actual UI screenshots using synthetic data and promotional tiles rendered from the existing logo and HTML/CSS. No live API requests. Outputs are in `store/assets/`. `native-panel-reference.png` is a capture of the real native panel for review, at its browser-assigned size; it is not one of the store-sized screenshots.

Include the 128px icon, 1280×800 dialog and onboarding screenshots, 440×280 small promotional tile, and optional 1400×560 marquee. Verify current dimensions in [Chrome's listing documentation](https://developer.chrome.com/docs/webstore/cws-dashboard-listing) and [image guidance](https://developer.chrome.com/docs/webstore/images).

Before submission:
1. Resolve the name conflict described in `NAME-CHECK.md`; assets currently use Formora as requested.
2. Host the repository's `privacy.html` at a public HTTPS URL and put that URL in the developer dashboard. The bundled Settings link already works offline. No public policy URL has been deployed by this change.
3. Review the privacy disclosures, distribution regions and Google's current API terms for this product. These are publisher decisions.
4. Test the selected model chain with a suitable API project; perform a real application-page review and attach screenshots from this release.
5. Package runtime files, icons and privacy.html only; omit tests, node_modules and repository metadata. Upload through the Chrome Web Store developer dashboard. Nothing has been published by this change.

Store assets were regenerated from 0.2.1 with synthetic data, including the AI-sharing setting and native review panel. Review the images and listing together before submission. See `PUBLISHING.md` and `SECURITY-REMEDIATION.md`.
