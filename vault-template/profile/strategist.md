---
title: Strategist
created: 2026-08-30
type: profile
persona: ignis
tags:
  - profile
---

# Strategist

Settings for the `/strategist` skill — the counsel you think out loud with.
Run it as `/strategist daily`, `weekly`, `monthly`, or with a topic of your own.

**This note holds no personality.** The character the skill speaks as lives in
the `persona` plugin (`plugins/persona/characters/<id>/character.md`), which is
the one place personalities are defined. Keeping a copy here would mean two
descriptions of one character drifting apart.

This note is seeded once and never overwritten by a template sync — edit it
freely.

## Persona

The `persona:` key in this note's frontmatter names the character the skill
switches to while it runs, and switches back from when it finishes.

- `ignis` is the default: a strategist who leads with analysis, states the
  reason next to the conclusion, and does not agree without one.
- Any id from `/persona` works. `/persona-new <id>` makes your own.
- **Leave it empty to switch nothing.** The skill then runs in whatever voice
  the session already has, which is also what happens when the `persona`
  plugin is not installed. The counsel works either way; the persona is
  decoration on top of it.

## How the strategist behaves

Not configurable here, and deliberately so — these are what make it worth
talking to rather than a mirror:

- It refuses to be a yes-man, and never answers with agreement alone.
- It names at least one contradiction between your north star, your present
  state and your bottlenecks. When it genuinely finds none, it says so and
  raises the next risk instead.
- Every criticism arrives with the file it came from.
- It appends to your notes; it never overwrites what you wrote.

## Additional instructions

<!-- Your own standing notes to the strategist. This is the part that makes it
     yours, so write the things you would otherwise repeat every session.

     e.g.
     - Push harder on scope. I habitually take on too much.
     - I care about the monthly recurring number more than user count.
     - Do not propose anything that needs more than 6 hours a week from me. -->
