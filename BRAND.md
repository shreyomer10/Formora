# Branding: prompt chain

Three prompts, run in order. Each one takes the output of the previous. Nothing here fixes a name or a colour; the current "ApplyPilot" / violet look in the code is a placeholder to be replaced.

Fill the `{...}` slots before pasting. The product brief below is shared by all three; paste it once at the top of each prompt.

---

## Product brief (paste into every prompt)

```
PRODUCT BRIEF
What it is: a Chrome extension that fills job application forms in one click, on every site, not just LinkedIn.
LinkedIn has "Easy Apply" for jobs posted on LinkedIn. This gives the same one-click feeling on company career pages
and applicant tracking systems (Workday, Greenhouse, Lever, iCIMS, SuccessFactors) and on Google Forms.
How it works: the user stores a profile and resume once. On any application page the extension reads every question,
fills the factual ones from the profile, asks an AI model only for the open-ended ones (grounded in the resume),
shows a review panel with what was filled and by what, and the user submits. It never submits on its own.
Who it is for: students and early-career candidates in India applying to many internships and jobs; later, anyone job hunting.
Personality: fast, reliable, quietly capable, honest about what it did and did not fill. Not hype, not "AI magic".
Do NOT use: the words "Easy Apply" (LinkedIn's trademark), "AI" in the name, "GPT", "bot".
```

---

## Prompt 1: name

```
<paste PRODUCT BRIEF>

TASK: propose names for this product.

Give 15 candidates across these styles, 3 each:
1. Descriptive compound (two plain words that say what it does)
2. Invented/coined word (pronounceable, 2-3 syllables)
3. Metaphor (an object or action that evokes "one click and the form is done")
4. Verb-led (a name that works as a command, e.g. "___ it")
5. Playful / memorable (fine to be a little cheeky, still professional enough for a Chrome Web Store listing)

For every candidate give, in a table:
- Name
- One-line rationale
- How to pronounce (only if not obvious)
- Tagline (max 7 words, must not contain "Easy Apply")
- Likely conflicts: well-known products, extensions or companies with the same or a confusable name (say "none I know of" if so; I will verify)
- Domain / handle guess: is <name>.com or <name>.app plausibly free? (guess, mark as unverified)
- Score 1-5 on: memorable, says-what-it-does, distinct from competitors (Simplify, LazyApply, Sonara, Teal, Huntr)

Then pick your top 3 and argue for each in 2-3 sentences. Do not pick a default; make me choose.
Constraints: max 12 characters for the name itself, no numbers, no hyphens, easy to type, reads well in a 16px browser toolbar tooltip.
```

After running it: pick one name, check the trademark and the Chrome Web Store for clashes, then continue.

---

## Prompt 2: theme, derived from the chosen name

```
<paste PRODUCT BRIEF>

The product is named: {NAME}
Tagline: {TAGLINE}
Why this name was chosen: {one sentence, e.g. "it sounds like a verb and suggests speed"}

TASK: design the visual theme so it grows out of the name, not out of generic "tech" defaults.

Rules:
- Start from the name: what does it evoke (material, motion, place, object, mood)? Derive the palette from that.
- Explicitly avoid the stock "AI product" look: no navy-to-purple gradients, no electric violet/cyan, no glow, no dark-mode-by-default, no sparkles.
- The primary colour must work as a solid on a 16px toolbar icon and as a button on white pages that we do not control
  (job sites use every colour; the panel must read as "not part of the page").
- WCAG AA contrast for text on every surface you propose.

Deliver:
1. Mood in 3 adjectives and one sentence.
2. Palette as CSS custom properties, exact hex:
   --primary, --primary-hover, --primary-soft (tinted background), --on-primary (text on primary),
   --success, --warning, --danger, --info,
   --surface, --surface-alt, --border, --text, --text-muted.
   For each: where it is used in a review panel that lists filled answers, and its contrast ratio against its usual background.
3. Typography: one font stack (system fonts preferred, one optional Google Font), sizes for panel title / body / badge.
4. Shape language: corner radius for panel, cards, buttons; border vs shadow; density.
5. Three small mockup descriptions in words: the toolbar icon, the review panel header, a filled-answer card with "profile" and "ai" badges.
6. A one-paragraph "why this fits {NAME}" that I can put in the README.
Give two alternative palettes (A, B) that both follow the rules, then recommend one and say why in two sentences.
```

Where the colours live in the code once you have them: `src/content/overlay.css` (panel), `src/options/options.html` and `src/popup/popup.html` (inline `<style>`), and the highlight colours passed to `JAF.highlight` in `src/content/main.js`. The panel title text is in `src/content/overlay.js` (`ap-title`) and the product name in `manifest.json`.

---

## Prompt 3: logo, from name + theme

Use with an image model (Imagen, Midjourney, DALL-E, Ideogram). Run the text part first if your image model accepts a design brief; otherwise paste only the "IMAGE PROMPT" block.

```
Name: {NAME}
Tagline: {TAGLINE}
Theme mood: {3 adjectives from Prompt 2}
Primary colour: {--primary hex}   Secondary/soft: {--primary-soft hex}   Text/ink: {--text hex}

TASK (text model, optional): propose 5 icon concepts that come from the name {NAME} itself (its meaning, its letters,
its sound), not from generic job-search imagery. For each: the single shape, why it links to the name, and whether it
survives at 16x16 px. Reject any concept that needs more than one shape or any text. Then write the image prompt for the
winner in the format below.

IMAGE PROMPT:
"Flat vector app icon for a browser extension named {NAME}. Concept: {ONE SHAPE, e.g. 'a single lightning-bolt-shaped
checkmark'}. One bold glyph in {--on-primary or --text hex} centred on a solid {--primary hex} rounded square with 22%
corner radius. Even stroke width, generous padding (glyph fills about 60% of the canvas), perfectly centred, geometric,
no text, no letters unless the concept is a monogram, no gradient, no glow, no shadow, no 3D, no photorealism, no
sparkles, no robot, no brain. Legible at 16x16 pixels. Clean modern SaaS icon. 1024x1024, transparent background
outside the rounded square."

Also generate:
- the same glyph in {--primary hex} on white (light-background variant)
- the glyph alone, monochrome white, no background (for dark toolbars)
- a horizontal lockup: glyph left, wordmark "{NAME}" right in a geometric sans, single colour
```

Export 16, 32, 48 and 128 px PNGs into `icons/` and reference them in `manifest.json` under `"icons"` and `"action.default_icon"`.

---

## Checklist before committing to a name

- Search the Chrome Web Store and the App Store for the exact name and obvious misspellings.
- Search USPTO / India IP for a live trademark in class 9 or 42.
- Say it out loud to two people and ask them to spell it.
- Check that the tagline never contains "Easy Apply".
