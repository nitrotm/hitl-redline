---
name: redline
description: >-
  A visual review loop of the page being developed, with the Redline browser extension: open the
  dev server's preview in Firefox (firefox-devtools MCP), wait for the user's screenshots annotated
  with numbered marks (#1, #2…) and comments, apply them in the code, reload, reply in the user's
  sidebar, and wait again. Use it when the user wants to review, mark up, annotate or give visual
  feedback on the UI in the browser, or runs /redline. It is a continuous session: round after
  round, until the user sends a round with nothing to change (Done, or Ctrl+D with nothing to send).
allowed-tools: Bash(redline:*)
---

# Redline: a review loop with the user, in the browser

The user reviews the page you are developing in Firefox, with the Redline extension. They take
screenshots of it, draw rectangles, arrows and freehand marks on them, comment on each mark
(`#1`, `#2`…), and send the round to you. You apply it, reload the page, reply in their sidebar,
and wait for the next round.

## The session

**This is a continuous session, not a one-off request.** After each round, start waiting for the
next one, and end your turn: the user goes on reviewing the result of your changes, round after
round. The session ends only when a round's status is **done**: the user clicked **Done**, or
pressed Ctrl+D with nothing to send, meaning there is nothing more to change. Do not stop on your
own after a round, nor ask whether to go on: waiting is the default, and a `redline wait` in the
background costs nothing. When the user writes to you in the terminal meanwhile, answer them and
keep the wait running.

The browser is the one of the **firefox-devtools** MCP server: use its tools (`install_extension`,
`new_page`, `navigate_page`, `list_pages`, `select_page`, `screenshot_page`).

## 1. Find the preview

The preview URL is the one the user gave (the argument of `/redline`, or named in the request), if any. Otherwise find the project's dev server: a running one
(look for a listening port of the project), or start it in the background
(`run_in_background`) from the project's own scripts (`package.json`, `Makefile`, `flake.nix`…),
and use the URL it prints. Ask the user only if you cannot tell.

## 2. Wait for feedback, then open the page

Run `redline wait --url <preview URL>` **with `run_in_background: true`**. It listens on the
loopback for one round, writes it to `.redline/rounds/NNN/`, prints the path of its `feedback.md`,
and exits. That exit wakes you up. Start it **before** opening the page: Redline starts by itself
on a tab of the preview only while a `redline wait` names it.

Each `redline wait` takes the first free port of 47390-47399, so the loops of several projects run
at once; the extension sends a tab's round to the one whose `--url` the tab shows. If it fails
because all ten are in use, `redline status` lists them: stop the stale ones that are yours.

Then:

1. Run `redline extension-path` and install that directory with the MCP's `install_extension`
   (`type: "path"`, a temporary add-on). Do it at every `/redline`: a restart of Firefox removes
   temporary add-ons, and installing again is harmless.
2. Open the preview with `new_page`, or `navigate_page` if a tab already shows it. Redline
   starts on it by itself.
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
   path (from under `<body>`; `…` is the snapshot's common path, `[1/2]` the first of two
   alike siblings, `div ×3` three nested divs), its selector and text, and from what the
   screenshot shows. With a Preact page in development, a mark also names the components that
   rendered its element and where its JSX is (`Preact: App › Hero › Button, its JSX at
src/Hero.tsx:42:7`): start there. A round may also hold **Answers to Claude's questions**:
   the user's answers to the questions of your last reply, each under its question.
2. If the status is **done**, apply what the round holds (it may be empty), summarize the session,
   and stop: no new `redline wait`.
3. Otherwise write your reply to the round to `.redline/reply.json`: it shows in the user's
   sidebar until they send the next round, with a field to answer each question.

   ```json
   {
     "sessionId": "<the round's session>",
     "round": <the round's number>,
     "summary": "One sentence on what changed.",
     "marks": [{ "id": 3, "text": "padding 8 → 16px in Button.tsx" }],
     "questions": [{ "id": "Q1", "mark": 2, "text": "The signed-in user's name, or literally John?" }]
   }
   ```

   One entry in `marks` per mark you acted on. When a comment is unclear, apply what you can and
   ask about the rest in `questions` (`mark` when it is about one), rather than guessing.

4. Start `redline wait --url <preview URL> --reply .redline/reply.json` in the background,
   **then** reload the page with `navigate_page` (same URL) so the user sees the changes. Wait
   for the dev server's rebuild first if it has one.
5. Say the same briefly here, one line per mark (`#3: padding 8 → 16px in Button.tsx`), and the
   questions. Then end your turn and wait again.

The `#id`s are never reused in a session: `#7` in round 3 is the same mark as `#7` in round 2.
Refer to marks by their `#id` when you talk about them.
