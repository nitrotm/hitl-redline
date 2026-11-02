---
description: Open the preview in Firefox, wait for annotated screenshots from the Redline extension, apply the feedback, and repeat
argument-hint: '[preview URL]'
allowed-tools: Bash(redline:*)
---

# /redline: a review loop with the Redline extension

The user reviews the page you are developing in Firefox, with the Redline extension. They take
screenshots of it, draw rectangles, arrows and freehand marks on them, comment on each mark
(`#1`, `#2`…), and send the round to you. You apply it, reload the page, and wait for the next round. Repeat until
they click **Done**.

The browser is the one of the **firefox-devtools** MCP server: use its tools (`install_extension`,
`new_page`, `navigate_page`, `list_pages`, `select_page`, `screenshot_page`).

## 1. Find the preview

The preview URL is `$ARGUMENTS` if given. Otherwise find the project's dev server: a running one
(look for a listening port of the project), or start it in the background
(`run_in_background`) from the project's own scripts (`package.json`, `Makefile`, `flake.nix`…),
and use the URL it prints. Ask the user only if you cannot tell.

## 2. Wait for feedback, then open the page

Run `redline wait --url <preview URL>` **with `run_in_background: true`**. It listens on the
loopback for one round, writes it to `.redline/rounds/NNN/`, prints the path of its `feedback.md`,
and exits. That exit wakes you up. Start it **before** opening the page: Redline starts by itself
on a tab of the preview only while a `redline wait` names it.

If it fails because the port is in use, another `redline wait` is running. Check with
`redline status`, and stop the stale one if it is yours.

Then:

1. Run `redline extension-path` and install that directory with the MCP's `install_extension`
   (`type: "path"`, a temporary add-on). Do it at every `/redline`: a restart of Firefox removes
   temporary add-ons, and installing again is harmless.
2. Open the preview with `new_page`, or `navigate_page` if a tab already shows it. The Redline
   toolbar shows up on the page.
3. Tell the user, in two lines: take a screenshot (Ctrl+S), draw on it and comment each mark, then
   **Send to Claude** from the sidebar (the Redline toolbar button), or **Done** to finish.
4. End your turn. Do not poll, do not sleep: the background task's exit wakes you.

Make sure `.redline/` is in the project's `.gitignore`. Add it if not, and say so.

## 3. On each round

When `redline wait` exits, its output ends with the path of `feedback.md`:

- Exit 0: read `feedback.md`, then the annotated screenshots it names (`S1.annotated.png`…) with
  the Read tool. Look at them: each `#id` is drawn next to its mark. The `.clean.png` is the same
  view without marks, for when a mark hides what it points at. `feedback.json` has every detail
  (coordinates, selectors, viewport), if you need more.
- Exit 1: report the error and stop.

Then:

1. Apply the feedback in the code. Each comment belongs to a mark: find the element from its
   selector and text, and from what the screenshot shows. When a comment is unclear, apply what
   you can and ask about the rest at the end. Do not guess wildly.
2. If the status is **done**, apply what the round holds (it may be empty), summarize the session,
   and stop: no new `redline wait`.
3. Otherwise start `redline wait --url <preview URL>` in the background again, **then** reload
   the page with `navigate_page` (same URL) so the user sees the changes. Wait for the dev server's rebuild first if it has one.
4. Reply briefly, one line per mark: `#3: padding 8 → 16px in Button.tsx`. Then end your turn
   and wait again.

The `#id`s are never reused in a session: `#7` in round 3 is the same mark as `#7` in round 2.
Refer to marks by their `#id` when you talk about them.
