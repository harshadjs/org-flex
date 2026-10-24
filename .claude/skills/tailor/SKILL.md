---
name: tailor
description: Tailor this Org Flex fork to how its owner uses Org mode - interview them about their workflow, then add, change or drop features and rules through SPEC.md. Use when the user wants Org Flex to fit their own workflow, asks to set it up for themselves, or wants to drop or add a feature.
---

Follow `TAILOR.md` at the repository root, step by step: read `AGENTS.md`,
`FLAVOUR.md` and the SPEC sections involved, read the user's Emacs Org
configuration and a few of their files, interview them about the packages
and habits that shape their Org (org-roam or denote, org-attach,
org-transclusion, capture, agenda, and whatever else they use; in short
rounds, with choices, using the question tool, and open to anything new), propose, record the person in
`FLAVOUR.md`, change `SPEC.md` first, then the code and tests, and finish with
`npm test`, `npm run build` and `npm run deploy`. Never break the §0
invariants in `SPEC.md`.

If the user named a specific change, skip the parts of the interview that
don't bear on it, but still read `FLAVOUR.md` so the change fits the rest.
