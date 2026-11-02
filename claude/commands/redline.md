---
description: Review the page being developed in the browser, with the Redline extension, round after round until the user is done
argument-hint: '[preview URL]'
allowed-tools: Bash(redline:*)
---

Start a Redline review session: follow the `redline` skill of this plugin (`skills/redline/SKILL.md`).
The preview URL is `$ARGUMENTS` if given; otherwise find it as the skill says.

It is a continuous session: round after round, until the user sends a round with nothing to change
(Done, or Ctrl+D with nothing to send).
