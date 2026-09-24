# Gemini release check

Catalog: `src/lib/models.js`, shared by Settings and the worker. Reviewed against [Google's model list](https://ai.google.dev/gemini-api/docs/models) on 2026-09-25. Keep the recommended list short and limited to models supporting text, PDF input and structured output through the Interactions API.

After a Gemini release or retirement announcement:

1. Read the official [models](https://ai.google.dev/gemini-api/docs/models), [release notes](https://ai.google.dev/gemini-api/docs/changelog) and [deprecations](https://ai.google.dev/gemini-api/docs/deprecations) pages. Update the IDs and review date together.
2. In Settings, use a test project/key and click **Test selected models**. Each selected model gets its own structured-output request; failures are reported individually and are never hidden by fallback. Requests can incur API charges.
3. Extract a synthetic PDF and fill a synthetic open question to check document input, thinking configuration and both production schemas. The small model test alone does not validate PDF extraction.
4. Run `cd test/e2e; npm test`. Mocked tests cover retry rules, retired model handling, legacy comma-separated settings, array selection, empty fallbacks, per-model checks and installation behavior. They do not prove live availability.
5. Record the date, project tier, model IDs and results in the release notes; never record the key or real resume data.

Current implementation uses the primary model twice for transient failures and each fallback once. Missing/retired models (404/410) are skipped without a retry. Authentication and malformed-request errors stop immediately. Previously saved custom IDs remain visible in Settings with a verification label; removing them is explicit. No scheduled background API tests or charges are introduced.
