# Formora: account setup, testing and sharing

Checked against Chrome's official documentation on September 25, 2026. Account setup can be completed while development continues. Use the current release ZIP (0.3.0), built by CI or `pack.ps1`.

## Set up the publisher account

1. Choose the Google account that should own the extension long term; use an email you monitor.
2. Enable Google account two-step verification, required for publication and updates.
3. Open the [Chrome Web Store developer dashboard](https://chrome.google.com/webstore/devconsole), accept its agreement/policies and pay the one-time registration fee shown there. Account creation does not publish an extension.
4. Complete the publisher/contact information and any verification requested by the dashboard. Keep account ownership and recovery details secure.

Sources: [developer registration](https://developer.chrome.com/docs/webstore/register), [developer account setup](https://developer.chrome.com/docs/webstore/set-up-account), [store policies](https://developer.chrome.com/docs/webstore/program-policies/policies).

## Share with a few development testers without the store

After the release package checks pass, share `dist/formora-0.3.0.zip` with chosen testers. It contains code/assets and the privacy policy; it does not contain Chrome's stored profile, resume or API key.

Testers extract the ZIP, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select the extracted folder containing `manifest.json`. Each tester configures their own profile and suitable Gemini project/key, or tests factual filling without AI. An unpacked copy does not receive normal Web Store updates; send a new package when changing builds.

Use synthetic data for the first smoke test. The local test forms are in the repository, not the distribution ZIP. Serve `test/` locally with `python -m http.server 8080 --bind 127.0.0.1 --directory test` from the repository root. [Chrome unpacked installation guide](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world)

## Create a store draft

1. Build and verify the ZIP: `cd test/e2e`, then `npm.cmd run test:package` on Windows.
2. In the dashboard select **Add new item** and upload `dist/formora-0.3.0.zip`.
3. Use `LISTING.md` as the starting copy. Add current screenshots, icon, description and support contact. Regenerate/review screenshots after the security changes; old screenshots may show the old AI workflow.
4. Host the current repository `privacy.html` at a public HTTPS URL on a site you control. Verify it loads without login, then enter that exact URL in the dashboard. The ZIP's bundled copy does not replace the public URL.
5. Fill the Privacy fields accurately: local profile/resume/key storage, Google AI transfers after opt-in, page-origin/context processing, and data written to application sites. Explain each requested permission. The extension has no remotely executed code; AI responses are data.
6. Supply reviewer instructions: Settings setup, factual-only test flow, AI opt-in and browser-side-panel approval, and manual Google Forms uploads. Do not put a personal production API key in the listing or ZIP.
7. Choose distribution regions and visibility. Resolve the existing naming concern recorded in `NAME-CHECK.md` before a launch decision.

Source: [publication workflow](https://developer.chrome.com/docs/webstore/publish).

## Choose who can install

| Visibility | Who can install | Suggested use |
| --- | --- | --- |
| Private | Authorized trusted testers or configured Google Groups | First controlled beta |
| Unlisted | Anyone who knows the listing URL | Broader link-based beta; not access-controlled |
| Public | Users who find the store listing | General release after acceptance checks |

For Private visibility, add testers' Google-account emails under the publisher's trusted testers settings, or configure an appropriate group. Submit the draft for review. Private and Unlisted submissions have the same policy/review requirements as Public submissions. After approval and publication to the selected audience, share the listing URL; they use **Add to Chrome**. [Distribution documentation](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution)

For later updates, increase the manifest version, rerun tests, upload the new ZIP to the same item and submit the update for review. Do not create a second public listing just to deliver an update. Account setup, hosting, review and publication were not performed by the code changes in this repository.

## Before submitting

- Functional, security and extracted-package browser checks pass.
- A synthetic PDF and open-ended question work with the intended live Gemini project/model settings; mocked tests do not prove this.
- Repeat the real ATS/site flows used during development. Embedded applications must be opened directly; Google Forms Drive-picker uploads are manual.
- Verify AI drafts stay blank on the site until approved; consent and sensitive declarations stay manual.
- Public privacy URL, screenshots, disclosure fields, reviewer instructions and naming decision are complete.
